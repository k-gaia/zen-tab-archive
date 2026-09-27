// archiver.sys.mjs — the real auto-archiver. Timer-driven, all-workspace,
// silent: no more manual zenRestorePoc.archive() calls, no more dry-run
// logging-only table. This is what CONTEXT.md's roadmap step 4 asked for.
//
// Scans gZenWorkspaces._allStoredTabs (confirmed: the only true cross-
// workspace tab list — gBrowser.tabs is scoped to the active workspace +
// globally-visible essentials). Confirmed separately (probe-remove-without-
// switch.js): gBrowser.removeTab works on a tab from a non-active workspace
// with no workspace switch required, so archiving needs none. Restoring
// still switches workspace (changeWorkspaceWithID) since the new tab has to
// land somewhere visible.
//
// skipPermitUnload: true — archiving bypasses the "leave page?" prompt.
// Deliberate: this runs unattended on a timer, so a blocking modal firing
// on a tab the user isn't looking at is worse than silently archiving it.
// Nothing is actually lost — SessionStore.getTabState captures form data
// too, so restore() brings it back intact.
//
// A Sine "background script" (.sys.mjs, listed in theme.json's `scripts`) —
// loaded once via ChromeUtils.importESModule, same as when hand-loaded via
// dryrun/load-archiver.js during dev. Chrome-context ESM either way, so it
// still gets its own module-global scope, not a browser window's scope --
// gBrowser/gZenWorkspaces/SessionStore/setInterval are NOT bare globals here.

import * as store from "./archiveStore.sys.mjs";

// This runs as an ESM module (ChromeUtils.importESModule), which gets its
// own privileged module-global scope -- NOT the browser chrome window's
// scope. gBrowser/gZenWorkspaces/SessionStore and setInterval/clearInterval
// all live on the window object, so they must be fetched explicitly rather
// than referenced as bare globals (unlike a script pasted directly into the
// Browser Console, which DOES execute in window scope).
function getWin() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win) throw new Error("no browser window found");
  return win;
}

// ---- knobs ----
// Backed by real about:config prefs (declared in preferences.json, shown in
// Zen's native settings UI via Sine) instead of hardcoded constants. Read
// live on every scan rather than cached at module load, so a pref change
// takes effect on the next scan with no restart needed -- except
// interval-minutes, which only takes effect on the next start() (re-arming
// the timer mid-interval isn't worth the complexity); preferences.json
// marks that one `restart: true` so the user gets a heads-up.
const PREF_BRANCH = "uc.zen-tab-archive.";
const DEFAULTS = {
  "threshold-hours": 24, // archive ordinary tabs idle longer than this
  "interval-minutes": 5, // how often to scan
  "skip-pinned": true, // permanent shelf
  "skip-essentials": true, // zen-essential, permanent shelf
  "skip-active": true, // currently selected tab (any workspace)
  "skip-audible": true, // tab currently playing sound
};

function getPref(key) {
  const name = PREF_BRANCH + key;
  const fallback = DEFAULTS[key];
  if (typeof fallback === "boolean") return Services.prefs.getBoolPref(name, fallback);
  if (typeof fallback === "number") {
    const raw = Services.prefs.getStringPref(name, String(fallback));
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return Services.prefs.getStringPref(name, fallback);
}

const EMPTY_URLS = new Set(["about:blank", "about:newtab", "about:home", ""]);

let isScanning = false;

function uuid() {
  return Services.uuid.generateUUID().toString().replace(/[{}]/g, "");
}

function shouldKeep(tab) {
  const url = tab.linkedBrowser?.currentURI?.spec ?? "";
  const last = tab.lastAccessed || 0;
  const idle = last ? Date.now() - last : Infinity;
  const thresholdMs = getPref("threshold-hours") * 3.6e6;

  // Guard order matters: essential BEFORE pinned (essentials are pinned too).
  if (getPref("skip-active") && tab.selected) return "active";
  if (getPref("skip-essentials") && tab.hasAttribute("zen-essential")) return "essential";
  if (getPref("skip-pinned") && tab.pinned) return "pinned";
  if (getPref("skip-audible") && tab.hasAttribute("soundplaying")) return "audio";
  if (EMPTY_URLS.has(url)) return "empty";
  if (!last) return "no-timestamp";
  if (idle < thresholdMs) return "recent";
  return null; // archive it
}

async function archiveTab(win, tab) {
  const record = {
    id: uuid(),
    workspaceId: tab.getAttribute("zen-workspace-id"),
    url: tab.linkedBrowser?.currentURI?.spec ?? "",
    title: tab.label,
    favicon: tab.getAttribute("image") || null,
    archivedAt: Date.now(),
    lastAccessedAt: tab.lastAccessed,
    tabState: JSON.parse(win.SessionStore.getTabState(tab)),
  };
  await store.appendTab(record);
  win.gBrowser.removeTab(tab, { skipPermitUnload: true });
  return record;
}

export async function scanOnce() {
  if (isScanning) return { skipped: "already scanning" };
  isScanning = true;
  try {
    const win = getWin();
    const allTabs = [...(win.gZenWorkspaces._allStoredTabs ?? win.gBrowser.tabs)];
    let archived = 0;
    let failed = 0;

    for (const tab of allTabs) {
      if (shouldKeep(tab) !== null) continue;
      try {
        const record = await archiveTab(win, tab);
        archived++;
        console.log(
          "%carchived (idle)", "color:#9ece6a;font-weight:bold",
          record.url, "ws:", record.workspaceId
        );
      } catch (err) {
        failed++;
        console.log("%carchive failed for tab:", "color:#f7768e;font-weight:bold", tab, err);
      }
    }

    const stamp = new Date().toLocaleTimeString();
    console.log(
      `%c[${stamp}] archiver scan · ${allTabs.length} tabs · ${archived} archived · ${failed} failed`,
      "font-weight:bold;color:#7aa2f7"
    );
    return { scanned: allTabs.length, archived, failed };
  } finally {
    isScanning = false;
  }
}

// Timer handle lives on the window, not module-scope state -- a fresh
// module instance (from re-pasting the loader) can't see a previous
// instance's module-scope variable, so it would never be able to cancel a
// timer that instance started. Storing it on the window (which persists
// across reloads) lets a new instance find and clear whatever the last one
// left running. See the identical writeup in archiveSidebar.mjs for the
// full failure mode this avoids -- orphaned timers silently continuing to
// archive tabs with stale logic in the background.
const TIMER_KEY = "__zenArchiverTimer";

export function start() {
  stop();
  scanOnce();
  const win = getWin();
  const intervalMin = getPref("interval-minutes");
  win[TIMER_KEY] = win.setInterval(scanOnce, intervalMin * 6e4);
  console.log(
    `%carchiver armed · scanning every ${intervalMin} min · call archiver.stop() to disarm`,
    "color:#9ece6a"
  );
}

export function stop() {
  const win = getWin();
  if (win[TIMER_KEY]) {
    win.clearInterval(win[TIMER_KEY]);
    win[TIMER_KEY] = null;
    console.log("%carchiver disarmed", "color:#e0af68");
  }
}

export async function restore(id) {
  const win = getWin();
  const tabs = await store.listTabs();
  const record = tabs.find((t) => t.id === id);
  if (!record) throw new Error(`no archived tab with id ${id}`);

  const originalWorkspace = win.gZenWorkspaces.activeWorkspace;
  if (originalWorkspace !== record.workspaceId) {
    await win.gZenWorkspaces.changeWorkspaceWithID(record.workspaceId);
  }

  const newTab = win.gBrowser.addTab("about:blank", {
    skipAnimation: true,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  win.SessionStore.setTabState(newTab, JSON.stringify(record.tabState));
  win.gBrowser.selectedTab = newTab;

  await store.removeTab(id);
  console.log(
    "%crestored", "color:#9ece6a;font-weight:bold",
    id, "-> expected ws", record.workspaceId, "actual ws", newTab.getAttribute("zen-workspace-id")
  );
  return newTab;
}

export const list = store.listTabs;
export const forget = store.removeTab; // permanently discard, no restore

// Self-starting now that this loads as a real installed mod, instead of
// requiring a manual zenArchiver.start() console call (that was a
// deliberate dev-time safety gate, since it actually closes tabs -- not
// appropriate for a background module that should just work once installed).
//
// Sine loads background modules (.sys.mjs) before per-window scripts, and
// possibly before any browser window exists yet at all -- calling start()
// immediately could hit getWin()'s "no browser window found" throw. Start
// right away if a window already exists (e.g. mod installed/reloaded while
// windows are open); otherwise wait for the first one to finish starting up.
try {
  getWin();
  start();
} catch {
  const obs = {
    observe() {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      start();
    },
  };
  Services.obs.addObserver(obs, "browser-delayed-startup-finished");
}
