// archiver.sys.mjs — the auto-archiver. Timer-driven and silent: tabs idle
// past the threshold, in any workspace, are saved to the archive store and
// closed; restore() recreates them from their saved session state.
//
// Scans gZenWorkspaces.allStoredTabs, the only cross-workspace tab list
// (gBrowser.tabs covers just the active workspace plus essentials).
// gBrowser.removeTab works on a tab in an inactive workspace, so archiving
// never switches workspace.
//
// skipPermitUnload: true — archiving bypasses the "leave page?" prompt.
// Deliberate: this runs unattended on a timer, so a blocking modal firing
// on a tab the user isn't looking at is worse than silently archiving it.
// Nothing is lost: SessionStore.getTabState captures form data too.
//
// A Sine background module (.sys.mjs, listed in theme.json's `scripts`),
// loaded once via ChromeUtils.importESModule. That gives it its own module
// scope, not a browser window's: gBrowser/gZenWorkspaces/SessionStore and
// setInterval live on the window and must be fetched through getWin().

import * as store from "./archiveStore.sys.mjs";

function getWin() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win) throw new Error("no browser window found");
  return win;
}

// Settings are about:config prefs (declared in preferences.json, shown in
// Zen's settings via Sine), read on every scan so changes apply without a
// restart -- except interval-minutes, which only applies on the next
// start(); preferences.json marks it `restart: true`.
const PREF_BRANCH = "uc.zen-tab-archive.";
const DEFAULTS = {
  "threshold-hours": 24, // archive ordinary tabs idle longer than this
  "interval-minutes": 5, // how often to scan
  "retention-days": 30, // archived tabs older than this are deleted; 0 = keep forever
  "skip-pinned": true, // permanent shelf
  "skip-essentials": true, // zen-essential, permanent shelf
  "skip-active": true, // currently selected tab (any workspace)
  "skip-audible": true, // tab currently playing sound
  "startup-summary": true, // toast summarising what was archived since the last start
};

function getPref(key) {
  const name = PREF_BRANCH + key;
  const fallback = DEFAULTS[key];
  if (typeof fallback === "boolean") return Services.prefs.getBoolPref(name, fallback);
  // Numbers are string prefs so they can be edited as text in Zen's settings.
  const parsed = parseFloat(Services.prefs.getStringPref(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const EMPTY_URLS = new Set(["about:blank", "about:newtab", "about:home", ""]);

// Fired after anything changes the archive, so open views can re-render.
export const CHANGED_TOPIC = "zen-tab-archive-changed";
function notifyChanged() {
  Services.obs.notifyObservers(null, CHANGED_TOPIC);
}

// How long an archived tab is kept, in ms; null means forever.
export function retentionMs() {
  const days = getPref("retention-days");
  return days > 0 ? days * 864e5 : null;
}

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

// Only called for tabs shouldKeep() let through, which have a URL.
async function archiveTab(win, tab) {
  const record = {
    id: uuid(),
    workspaceId: tab.getAttribute("zen-workspace-id"),
    url: tab.linkedBrowser.currentURI.spec,
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
    // The public getter, not the _allStoredTabs field behind it: that field
    // is a lazy cache that's null until something calls the getter.
    const allTabs = [...(win.gZenWorkspaces.allStoredTabs ?? win.gBrowser.tabs)];
    let archived = 0;
    let failed = 0;

    const keepMs = retentionMs();
    const expired = keepMs ? await store.pruneArchivedBefore(Date.now() - keepMs) : 0;

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
      `%c[${stamp}] archiver scan · ${allTabs.length} tabs · ${archived} archived · ${failed} failed · ${expired} expired`,
      "font-weight:bold;color:#7aa2f7"
    );
    if (archived || expired) notifyChanged();
    return { scanned: allTabs.length, archived, failed, expired };
  } finally {
    isScanning = false;
  }
}

// The timer handle lives on the window rather than in module scope, so a
// reloaded module instance can find and clear the previous instance's
// timer instead of leaving it archiving with stale code.
const TIMER_KEY = "__zenArchiverTimer";

export async function start() {
  const win = getWin();
  // Scanning before both of these resolve sees only a fraction of the tabs:
  // session restore may not have recreated them yet, and before Zen builds
  // the per-space strips allStoredTabs covers only the active space.
  await win.gZenWorkspaces.promiseInitialized;
  await win.SessionStore.promiseAllWindowsRestored;
  stop();
  const scanStartedAt = Date.now();
  const firstScan = scanOnce();
  const intervalMin = getPref("interval-minutes");
  win[TIMER_KEY] = win.setInterval(scanOnce, intervalMin * 6e4);
  console.log(
    `%carchiver armed · scanning every ${intervalMin} min · call archiver.stop() to disarm`,
    "color:#9ece6a"
  );
  await firstScan;
  await showStartupSummary(win, scanStartedAt);
}

// Stored as a string: epoch ms overflows an int pref.
const LAST_STARTUP_PREF = PREF_BRANCH + "last-startup";
export const SECTION_ID = "archived-tabs";
export const SUMMARY_BUTTON_ID = "zen-tab-archive-summary-view";

// A brief Zen toast after the first scan: how many tabs are archived since
// Zen was last started, with a button to open them. With no previous start
// recorded (first run) only this start's scan counts, so an existing
// archive isn't announced all at once.
async function showStartupSummary(win, scanStartedAt) {
  const since = parseFloat(Services.prefs.getStringPref(LAST_STARTUP_PREF, String(scanStartedAt)));
  Services.prefs.setStringPref(LAST_STARTUP_PREF, String(scanStartedAt));
  if (!getPref("startup-summary")) return;
  const count = (await store.listTabs()).filter((t) => t.archivedAt >= since).length;
  if (!count) return;
  win.gZenUIManager.showToast("zen-tab-archive-summary-toast", {
    l10nArgs: { count },
    timeout: 6000,
    button: { id: SUMMARY_BUTTON_ID, command: () => openArchive(win) },
  });
  // Zen's toast buttons are icon-only (see the window script's CSS for the
  // icon) and built synchronously, so label this one for tooltips and
  // screen readers now.
  const button = win.document.getElementById(SUMMARY_BUTTON_ID);
  button.setAttribute("tooltiptext", "Open Archived Tabs");
  button.setAttribute("aria-label", "Open Archived Tabs");
}

// Opens the Library on Archived Tabs. toggle() closes the Library if it's
// already showing that section, so leave it alone in that case.
function openArchive(win) {
  const Library = win.customElements.get("zen-library");
  const showing = Library.isLibraryOpen && win.document.querySelector("zen-library").activeTab === SECTION_ID;
  if (!showing) Library.toggle(SECTION_ID);
}

export function stop() {
  const win = getWin();
  if (win[TIMER_KEY]) {
    win.clearInterval(win[TIMER_KEY]);
    win[TIMER_KEY] = null;
    console.log("%carchiver disarmed", "color:#e0af68");
  }
}

// Created the way Firefox's own duplicate/undo-close do it: no URL and
// skipLoad. Creating it with an about:blank load instead left
// background-restored tabs loading blank when selected (seen in a real
// profile; not reproducible in a clean one). The container can only be
// chosen at creation, so it's passed here too.
// The saved state carries the tab's old lastAccessed; restoring it as-is
// would make the next scan archive the tab again straight away.
function recreateTab(win, record) {
  const tab = win.gBrowser.addTrustedTab(null, {
    skipLoad: true,
    skipAnimation: true,
    userContextId: record.tabState.userContextId ?? 0,
  });
  win.SessionStore.setTabState(tab, JSON.stringify({ ...record.tabState, lastAccessed: Date.now() }));
  return tab;
}

// Restores several tabs in the background, each into its own workspace,
// without switching workspace or selecting anything.
export async function restoreMany(ids) {
  const win = getWin();
  const want = new Set(ids);
  const records = (await store.listTabs()).filter((t) => want.has(t.id));
  const restored = [];
  for (const record of records) {
    try {
      const tab = recreateTab(win, record);
      if (tab.getAttribute("zen-workspace-id") !== record.workspaceId) {
        win.gZenWorkspaces.moveTabToWorkspace(tab, record.workspaceId);
      }
      restored.push(record.id);
    } catch (err) {
      console.log("%crestore failed for record:", "color:#f7768e;font-weight:bold", record.id, err);
    }
  }
  await store.removeTabs(restored);
  if (restored.length) notifyChanged();
  return restored.length;
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

  const newTab = recreateTab(win, record);
  win.gBrowser.selectedTab = newTab;

  await store.removeTab(id);
  notifyChanged();
  console.log(
    "%crestored", "color:#9ece6a;font-weight:bold",
    id, "-> expected ws", record.workspaceId, "actual ws", newTab.getAttribute("zen-workspace-id")
  );
  return newTab;
}

export const list = store.listTabs;
// Permanently discard, no restore.
export async function forget(id) {
  const removed = await store.removeTab(id);
  if (removed) notifyChanged();
  return removed;
}

// Batch forget: one archive write instead of one per tab.
export async function forgetMany(ids) {
  const removed = await store.removeTabs(ids);
  if (removed) notifyChanged();
  return removed;
}

// Self-start. Sine may load background modules before any browser window
// exists, so start now if there is one, otherwise when the first window
// finishes starting up.
const startLogged = () => start().catch((err) => console.error("[zen-tab-archive] start failed", err));
try {
  getWin();
  startLogged();
} catch {
  const obs = {
    observe() {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      startLogged();
    },
  };
  Services.obs.addObserver(obs, "browser-delayed-startup-finished");
}
