import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { installChromeGlobals, freshImport, makeTab, makeWindow } from "./helpers/chrome.mjs";

const HOUR = 3.6e6;
const DAY = 864e5;
const settle = () => new Promise((r) => setTimeout(r, 0));

mock.method(console, "log", () => {});
mock.method(console, "error", () => {});

// Imported with no browser window, so it waits for one (tested below).
const { services } = installChromeGlobals();
const archiver = await import("../src/archiver.sys.mjs");
const store = await import("../src/archiveStore.sys.mjs");

let changes;
const observer = { observe: () => changes++ };
services.obs.addObserver(observer, archiver.CHANGED_TOPIC);

async function clearStore() {
  await store.removeTabs((await store.listTabs()).map((t) => t.id));
}

function useWindow(opts) {
  const win = makeWindow(opts);
  services.window = win;
  return win;
}

const record = (id, extra = {}) => ({
  id,
  workspaceId: "ws-a",
  url: `https://${id}.test/`,
  title: id,
  archivedAt: Date.now(),
  tabState: { entries: [{ url: `https://${id}.test/` }], index: 1, lastAccessed: 1 },
  ...extra,
});

beforeEach(async () => {
  services.prefs.values = {};
  await clearStore();
  changes = 0;
});

describe("startup", () => {
  test("waits for the first browser window, then arms the scan timer", async () => {
    const topic = "browser-delayed-startup-finished";
    assert.equal(services.obs.count(topic), 1);
    const win = useWindow();
    services.obs.notifyObservers(null, topic);
    await settle();
    assert.equal(services.obs.count(topic), 0, "observer removed after firing");
    assert.equal(win.intervals.length, 1);
    assert.equal(win.intervals[0].ms, 5 * 60e3);
  });

  test("starts straight away when a window already exists", async () => {
    const win = useWindow();
    await freshImport("../../src/archiver.sys.mjs");
    await settle();
    assert.equal(win.intervals.length, 1);
  });

  test("waits for Zen's workspaces and session restore before scanning", async () => {
    let releaseRestore;
    const old = makeTab({ url: "https://old.test/" });
    const win = useWindow({ tabs: [old] });
    win.SessionStore.promiseAllWindowsRestored = new Promise((r) => (releaseRestore = r));
    const started = archiver.start();
    await settle();
    assert.equal(win.gBrowser.removed.length, 0, "no scan before restore finishes");
    releaseRestore();
    await started;
    await settle();
    assert.equal(win.gBrowser.removed.length, 1);
  });

  test("logs instead of throwing when start fails", async () => {
    const win = useWindow();
    win.gZenWorkspaces.promiseInitialized = Promise.reject(new Error("boom"));
    console.error.mock.resetCalls();
    await freshImport("../../src/archiver.sys.mjs");
    await settle();
    assert.equal(console.error.mock.callCount(), 1);
    assert.match(console.error.mock.calls[0].arguments[0], /start failed/);
  });

  test("start replaces an existing timer and uses the interval pref", async () => {
    const win = useWindow();
    services.prefs.values["uc.zen-tab-archive.interval-minutes"] = "2";
    await archiver.start();
    await archiver.start();
    assert.deepEqual(win.clearedIntervals, [1], "first timer cleared");
    assert.equal(win.intervals[1].ms, 2 * 60e3);
  });

  test("stop clears the timer, and is a no-op when none is armed", async () => {
    const win = useWindow();
    archiver.stop();
    assert.deepEqual(win.clearedIntervals, []);
    await archiver.start();
    archiver.stop();
    archiver.stop();
    assert.deepEqual(win.clearedIntervals, [1]);
  });

  test("throws a clear error when there is no browser window", () => {
    services.window = null;
    assert.throws(() => archiver.stop(), /no browser window found/);
  });
});

describe("startup summary", () => {
  const LAST = "uc.zen-tab-archive.last-startup";

  test("first run: summarises only this start's scan, with a labelled View button", async () => {
    await store.appendTab(record("from-before", { archivedAt: Date.now() - DAY }));
    const win = useWindow({ tabs: [makeTab(), makeTab()] });
    const before = Date.now();
    await archiver.start();
    const [toast] = win.gZenUIManager.toasts;
    assert.equal(toast.messageId, "zen-tab-archive-summary-toast");
    assert.deepEqual(toast.options.l10nArgs, { count: 2 }, "the existing archive isn't announced");
    assert.equal(toast.options.timeout, 6000);
    const button = win.document.getElementById(archiver.SUMMARY_BUTTON_ID);
    assert.equal(button.getAttribute("tooltiptext"), "Open Archived Tabs");
    assert.equal(button.getAttribute("aria-label"), "Open Archived Tabs");
    assert.ok(Number(services.prefs.values[LAST]) >= before, "start time recorded for next time");
  });

  test("later starts count everything archived since the previous start", async () => {
    const lastStart = Date.now() - 2 * DAY;
    services.prefs.values[LAST] = String(lastStart);
    await store.appendTab(record("before-last-start", { archivedAt: lastStart - HOUR }));
    await store.appendTab(record("during-last-session", { archivedAt: lastStart + HOUR }));
    const win = useWindow({ tabs: [makeTab()] });
    await archiver.start();
    assert.deepEqual(win.gZenUIManager.toasts[0].options.l10nArgs, { count: 2 });
  });

  test("no toast when nothing was archived", async () => {
    const win = useWindow({ tabs: [makeTab({ selected: true })] });
    await archiver.start();
    assert.deepEqual(win.gZenUIManager.toasts, []);
    assert.ok(services.prefs.values[LAST], "start time still recorded");
  });

  test("no toast when the summary is turned off, but the start time is still recorded", async () => {
    services.prefs.values["uc.zen-tab-archive.startup-summary"] = false;
    const win = useWindow({ tabs: [makeTab()] });
    await archiver.start();
    assert.deepEqual(win.gZenUIManager.toasts, []);
    assert.ok(services.prefs.values[LAST]);
  });

  test("View opens the Library on Archived Tabs, unless it's already showing", async () => {
    const win = useWindow({ tabs: [makeTab()] });
    await archiver.start();
    const view = win.gZenUIManager.toasts[0].options.button.command;
    view();
    assert.deepEqual(win.Library.toggles, ["archived-tabs"], "closed: opens it");
    win.Library.isLibraryOpen = true;
    view();
    assert.equal(win.Library.toggles.length, 2, "open on another section: switches");
    win.library.activeTab = "archived-tabs";
    view();
    assert.equal(win.Library.toggles.length, 2, "already showing: left alone rather than closed");
  });
});

describe("scanOnce", () => {
  test("archives idle tabs and keeps everything else", async () => {
    const tabs = {
      idle: makeTab({ url: "https://idle.test/", attrs: { "zen-workspace-id": "ws-b", image: "data:icon" } }),
      active: makeTab({ selected: true }),
      essential: makeTab({ pinned: true, attrs: { "zen-essential": "true" } }),
      pinned: makeTab({ pinned: true }),
      audio: makeTab({ attrs: { soundplaying: "" } }),
      blank: makeTab({ url: "about:blank" }),
      noUri: makeTab({ url: null }),
      noBrowser: makeTab({ browser: false }),
      neverAccessed: makeTab({ lastAccessed: 0 }),
      recent: makeTab({ lastAccessed: Date.now() - HOUR }),
    };
    const win = useWindow({ tabs: Object.values(tabs) });
    const result = await archiver.scanOnce();
    assert.deepEqual(result, { scanned: 10, archived: 1, failed: 0, expired: 0 });
    assert.deepEqual(win.gBrowser.removed, [{ tab: tabs.idle, opts: { skipPermitUnload: true } }]);
    const [saved] = await store.listTabs();
    assert.equal(saved.url, "https://idle.test/");
    assert.equal(saved.workspaceId, "ws-b");
    assert.equal(saved.favicon, "data:icon");
    assert.equal(saved.title, "Example");
    assert.equal(saved.id, saved.id.replace(/[{}]/g, ""), "uuid braces stripped");
    assert.deepEqual(saved.tabState.entries, [{ url: "https://idle.test/" }]);
    assert.equal(changes, 1);
  });

  test("the skip rules can each be turned off", async () => {
    for (const key of ["skip-active", "skip-essentials", "skip-pinned", "skip-audible"]) {
      services.prefs.values[`uc.zen-tab-archive.${key}`] = false;
    }
    const win = useWindow({
      tabs: [
        makeTab({ selected: true }),
        makeTab({ pinned: true, attrs: { "zen-essential": "true" } }),
        makeTab({ pinned: true }),
        makeTab({ attrs: { soundplaying: "" } }),
      ],
    });
    assert.equal((await archiver.scanOnce()).archived, 4);
    assert.equal(win.gBrowser.removed.length, 4);
    const [first] = await store.listTabs();
    assert.equal(first.favicon, null);
  });

  test("uses the threshold pref, falling back to the default when it isn't a number", async () => {
    const tab = makeTab({ lastAccessed: Date.now() - 30 * HOUR });
    useWindow({ tabs: [tab] });
    services.prefs.values["uc.zen-tab-archive.threshold-hours"] = "72";
    assert.equal((await archiver.scanOnce()).archived, 0);
    services.prefs.values["uc.zen-tab-archive.threshold-hours"] = "not a number";
    assert.equal((await archiver.scanOnce()).archived, 1, "falls back to 24h");
  });

  test("falls back to gBrowser.tabs when allStoredTabs is unavailable", async () => {
    const win = useWindow({ tabs: [makeTab()], allStoredTabs: null });
    assert.equal((await archiver.scanOnce()).archived, 1);
    assert.equal(win.gBrowser.removed.length, 1);
  });

  test("counts a tab that fails to archive and carries on", async () => {
    const broken = makeTab();
    broken.stateError = new Error("no state");
    const win = useWindow({ tabs: [broken, makeTab()] });
    assert.deepEqual(await archiver.scanOnce(), { scanned: 2, archived: 1, failed: 1, expired: 0 });
    assert.equal(win.gBrowser.removed.length, 1);
  });

  test("doesn't notify when nothing changed", async () => {
    useWindow({ tabs: [makeTab({ selected: true })] });
    await archiver.scanOnce();
    assert.equal(changes, 0);
  });

  test("a scan already in progress makes a second call return immediately", async () => {
    useWindow({ tabs: [makeTab()] });
    const first = archiver.scanOnce();
    assert.deepEqual(await archiver.scanOnce(), { skipped: "already scanning" });
    await first;
    assert.equal((await archiver.scanOnce()).scanned, 1, "runs again once finished");
  });
});

describe("retention", () => {
  test("defaults to 30 days, honours the pref, and 0 means forever", () => {
    assert.equal(archiver.retentionMs(), 30 * DAY);
    services.prefs.values["uc.zen-tab-archive.retention-days"] = "7";
    assert.equal(archiver.retentionMs(), 7 * DAY);
    services.prefs.values["uc.zen-tab-archive.retention-days"] = "0";
    assert.equal(archiver.retentionMs(), null);
  });

  test("each scan deletes expired records", async () => {
    await store.appendTab(record("old", { archivedAt: Date.now() - 31 * DAY }));
    await store.appendTab(record("new"));
    useWindow();
    assert.equal((await archiver.scanOnce()).expired, 1);
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["new"]);
    assert.equal(changes, 1);
  });

  test("nothing expires when retention is off", async () => {
    services.prefs.values["uc.zen-tab-archive.retention-days"] = "0";
    await store.appendTab(record("old", { archivedAt: Date.now() - 400 * DAY }));
    useWindow();
    assert.equal((await archiver.scanOnce()).expired, 0);
    assert.equal((await store.listTabs()).length, 1);
  });
});

describe("restore", () => {
  test("switches to the tab's workspace and selects the recreated tab", async () => {
    await store.appendTab(record("a", { workspaceId: "ws-b", tabState: { entries: [], userContextId: 3, lastAccessed: 1 } }));
    const win = useWindow();
    const before = Date.now();
    const tab = await archiver.restore("a");
    assert.deepEqual(win.gZenWorkspaces.changes, ["ws-b"]);
    assert.equal(win.gBrowser.selectedTab, tab);
    const [{ url, opts }] = win.gBrowser.added;
    assert.equal(url, null);
    assert.deepEqual(opts, { skipLoad: true, skipAnimation: true, userContextId: 3 });
    const [{ state }] = win.SessionStore.states;
    assert.ok(state.lastAccessed >= before, "lastAccessed refreshed so it isn't re-archived");
    assert.deepEqual(await store.listTabs(), []);
    assert.equal(changes, 1);
  });

  test("stays put when the tab belongs to the current workspace", async () => {
    await store.appendTab(record("a"));
    const win = useWindow();
    await archiver.restore("a");
    assert.deepEqual(win.gZenWorkspaces.changes, []);
    assert.equal(win.gBrowser.added[0].opts.userContextId, 0, "default container");
  });

  test("rejects an unknown id", async () => {
    useWindow();
    await assert.rejects(archiver.restore("nope"), /no archived tab with id nope/);
  });
});

describe("restoreMany", () => {
  test("restores in the background into each tab's own workspace", async () => {
    await store.appendTab(record("a"));
    await store.appendTab(record("b", { workspaceId: "ws-b" }));
    await store.appendTab(record("untouched"));
    const win = useWindow();
    assert.equal(await archiver.restoreMany(["a", "b"]), 2);
    assert.deepEqual(win.gZenWorkspaces.moves, ["ws-b"], "only the other-workspace tab is moved");
    assert.deepEqual(win.gZenWorkspaces.changes, [], "never switches workspace");
    assert.equal(win.gBrowser.selectedTab, null, "never selects");
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["untouched"]);
    assert.equal(changes, 1);
  });

  test("skips a record that fails to restore and keeps it archived", async () => {
    await store.appendTab(record("ok"));
    await store.appendTab(record("bad", { tabState: { failRestore: true } }));
    useWindow();
    assert.equal(await archiver.restoreMany(["ok", "bad"]), 1);
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["bad"]);
  });

  test("doesn't notify when nothing was restored", async () => {
    useWindow();
    assert.equal(await archiver.restoreMany(["missing"]), 0);
    assert.equal(changes, 0);
  });
});

describe("forget", () => {
  test("forget removes one record and notifies only if it existed", async () => {
    await store.appendTab(record("a"));
    assert.equal(await archiver.forget("a"), true);
    assert.equal(await archiver.forget("a"), false);
    assert.equal(changes, 1);
  });

  test("forgetMany removes several records and notifies only if any existed", async () => {
    await store.appendTab(record("a"));
    await store.appendTab(record("b"));
    assert.equal(await archiver.forgetMany(["a", "b", "c"]), 2);
    assert.equal(await archiver.forgetMany(["a"]), 0);
    assert.equal(changes, 1);
  });

  test("list returns the archived records", async () => {
    await store.appendTab(record("a"));
    assert.deepEqual((await archiver.list()).map((t) => t.id), ["a"]);
  });
});
