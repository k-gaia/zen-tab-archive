import { test, describe, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { freshImport, makeServices } from "./helpers/chrome.mjs";

const HOUR = 3.6e6;
const DAY = 864e5;
const TOPIC = "zen-tab-archive-changed";
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

mock.method(console, "log", () => {});

const rec = (id, extra = {}) => ({
  id,
  workspaceId: "ws-a",
  url: `https://${id}.example/page`,
  title: `Title ${id}`,
  archivedAt: Date.now() - HOUR,
  ...extra,
});

// Loads the window script into a fresh jsdom document with a fake archiver.
async function load({
  records = [],
  keepMs = 30 * DAY,
  library = true,
  sections = { history: {} },
  requestUpdate = true,
  workspaces = [
    { uuid: "ws-a", name: "Home", icon: "🏠" },
    { uuid: "ws-b", name: "Work" },
  ],
  l10n = true,
  hasSource = false,
  registryThrows = false,
  existing,
  html = "",
} = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${library ? "<zen-library></zen-library>" : ""}${html}</body></html>`);
  const { window } = dom;
  const { document } = window;
  const lib = document.querySelector("zen-library");
  if (lib) {
    if (sections) lib.zenLibrarySections = sections;
    if (requestUpdate) lib.requestUpdate = mock.fn();
  }
  if (l10n) document.l10n = { addResourceIds: mock.fn() };
  if (existing) window.ZenTabArchive = existing;

  const archiver = {
    CHANGED_TOPIC: TOPIC,
    records,
    list: mock.fn(async () => archiver.records),
    retentionMs: () => keepMs,
    restore: mock.fn(async () => {}),
    restoreMany: mock.fn(async () => {}),
    forget: mock.fn(async () => {}),
    forgetMany: mock.fn(async () => {}),
  };
  const registry = {
    hasSource: mock.fn(() => hasSource),
    registerSources: mock.fn(),
    updateSources: mock.fn(),
  };
  const services = makeServices();
  Object.assign(globalThis, {
    window,
    document,
    Services: services,
    ChromeUtils: { importESModule: () => archiver },
    L10nRegistry: {
      getInstance: () => {
        if (registryThrows) throw new Error("no registry");
        return registry;
      },
    },
    L10nFileSource: class {
      constructor(...args) {
        this.args = args;
      }
    },
    gZenWorkspaces: { _workspaceCache: workspaces },
    confirm: mock.fn(() => true),
  });
  await freshImport("../../src/archiveLibrarySection.uc.js");
  const Section = window.ZenTabArchive.librarySection.Section;
  return { window, document, lib, archiver, registry, services, Section };
}

// Renders the section into the document and waits for the first render.
async function open(opts) {
  const env = await load(opts);
  const root = env.Section.render();
  env.document.body.append(root);
  await settle();
  return { ...env, root };
}

const rows = (root) => [...root.querySelectorAll(".zal-row")];
const rowIds = (root) => rows(root).map((r) => r.dataset.id);
const headers = (root) => [...root.querySelectorAll(".zal-group-header")];
const header = (root, ws) => root.querySelector(`.zal-group-header[data-ws="${ws}"]`);
const row = (root, id) => root.querySelector(`.zal-row[data-id="${id}"]`);
const selected = (root) => rows(root).filter((r) => r.hasAttribute("selected")).map((r) => r.dataset.id);
const bar = (root) => root.querySelector(".zal-selbar");
const input = (root) => root.querySelector(".zen-library-search-box input");

function click(env, el, opts = {}) {
  el.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, ...opts }));
}
function key(env, el, k, opts = {}) {
  const e = new env.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(e);
  return e;
}
async function expand(env, ws) {
  header(env.root, ws).click();
  await settle();
}

afterEach(() => mock.timers.reset());

describe("installation", () => {
  test("registers the section with Zen's Library and asks it to re-render", async () => {
    const { lib, Section, window } = await load();
    assert.equal(lib.zenLibrarySections["archived-tabs"], Section);
    assert.ok(lib.zenLibrarySections.history, "keeps Zen's own sections");
    assert.equal(lib.requestUpdate.mock.callCount(), 1);
    assert.equal(Section.id, "archived-tabs");
    assert.equal(Section.label, "zen-tab-archive-library-section-title");
    assert.equal(typeof window.ZenTabArchive.librarySection.install, "function");
  });

  test("keeps anything already on window.ZenTabArchive", async () => {
    const { window } = await load({ existing: { other: 1 } });
    assert.equal(window.ZenTabArchive.other, 1);
    assert.ok(window.ZenTabArchive.librarySection);
  });

  test("works when the Library has no requestUpdate", async () => {
    const { lib, Section } = await load({ requestUpdate: false });
    assert.equal(lib.zenLibrarySections["archived-tabs"], Section);
  });

  test("retries until the Library appears", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    const { document, Section } = await load({ library: false });
    mock.timers.tick(500);
    const lib = document.createElement("zen-library");
    document.body.append(lib);
    mock.timers.tick(500);
    assert.equal(lib.zenLibrarySections, undefined, "not installed while it has no section registry");
    lib.zenLibrarySections = {};
    mock.timers.tick(500);
    assert.equal(lib.zenLibrarySections["archived-tabs"], Section);
  });

  test("gives up after about ten seconds", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    const { document } = await load({ library: false });
    mock.timers.tick(500 * 21);
    const lib = document.createElement("zen-library");
    lib.zenLibrarySections = {};
    document.body.append(lib);
    mock.timers.tick(500 * 5);
    assert.deepEqual(lib.zenLibrarySections, {}, "stopped retrying");
  });

  test("adds its stylesheet once, replacing an old copy", async () => {
    const { document } = await load({ html: '<style id="zen-archive-library-style">old</style>' });
    const styles = document.querySelectorAll("#zen-archive-library-style");
    assert.equal(styles.length, 1);
    assert.match(styles[0].textContent, /\.zal-row/);
  });

  test("registers its Fluent strings", async () => {
    const { registry, document } = await load();
    const [source] = registry.registerSources.mock.calls[0].arguments[0];
    assert.deepEqual(source.args, [
      "zen-tab-archive",
      "app",
      ["en-US"],
      "chrome://sine/content/zen-tab-archive/src/locale/{locale}/",
    ]);
    assert.deepEqual(document.l10n.addResourceIds.mock.calls[0].arguments[0], ["zen-tab-archive.ftl"]);
  });

  test("updates the Fluent source if another window already registered it", async () => {
    const { registry } = await load({ hasSource: true });
    assert.equal(registry.updateSources.mock.callCount(), 1);
    assert.equal(registry.registerSources.mock.callCount(), 0);
  });

  test("tolerates a document without l10n, and a failing registry", async () => {
    await load({ l10n: false });
    console.log.mock.resetCalls();
    await load({ registryThrows: true });
    assert.match(console.log.mock.calls.at(-1).arguments[0], /Fluent registration FAILED/);
  });
});

describe("rendering", () => {
  test("shows an empty state", async () => {
    const { root } = await open();
    assert.equal(root.querySelector(".zal-empty").textContent, "No archived tabs yet.");
  });

  test("groups by workspace, collapsed, with names, icons and counts", async () => {
    const { root } = await open({
      records: [rec("a"), rec("b", { workspaceId: "ws-b" }), rec("c"), rec("d", { workspaceId: "ws-gone" }), rec("e", { workspaceId: "" })],
    });
    assert.deepEqual(
      headers(root).map((h) => h.textContent.replace("Forget all", "")),
      ["▸🏠 Home (2)", "▸Work (1)", "▸ws-gone (1)", "▸(unknown) (1)"],
    );
    assert.deepEqual(rows(root), [], "groups start collapsed");
    assert.equal(header(root, "ws-a").getAttribute("aria-expanded"), "false");
  });

  test("falls back to workspace ids when Zen has no workspace list", async () => {
    const { root } = await open({ records: [rec("a")], workspaces: null });
    assert.match(headers(root)[0].textContent, /^▸ws-a \(1\)/);
  });

  test("expanding a group shows its rows, newest first; clicking again collapses it", async () => {
    const env = await open({
      records: [rec("old", { archivedAt: Date.now() - 5 * HOUR }), rec("new", { archivedAt: Date.now() - HOUR })],
    });
    await expand(env, "ws-a");
    assert.deepEqual(rowIds(env.root), ["new", "old"]);
    assert.equal(header(env.root, "ws-a").getAttribute("aria-expanded"), "true");
    assert.match(header(env.root, "ws-a").textContent, /^▾/);
    await expand(env, "ws-a");
    assert.deepEqual(rows(env.root), []);
  });

  test("row text: title, host, age and time left", async () => {
    const env = await open({
      records: [
        rec("mins", { archivedAt: Date.now() - 30e3 }),
        rec("hours", { archivedAt: Date.now() - 5 * HOUR, favicon: "data:icon" }),
        rec("days", { archivedAt: Date.now() - 3 * DAY }),
        rec("nearly", { archivedAt: Date.now() - 30 * DAY + 5.5 * HOUR }),
        rec("last", { archivedAt: Date.now() - 30 * DAY + 10 * 60e3 }),
        rec("untitled", { title: "", url: "not a url", archivedAt: Date.now() - 50 * DAY }),
      ],
    });
    await expand(env, "ws-a");
    const sub = (id) => row(env.root, id).querySelector(".zal-sub").textContent;
    assert.equal(sub("mins"), "mins.example · 1m ago · 29d left");
    assert.equal(sub("hours"), "hours.example · 5.0h ago · 29d left");
    assert.equal(sub("days"), "days.example · 3.0d ago · 26d left", "rounds down");
    assert.equal(sub("nearly"), "nearly.example · 29.8d ago · 5h left");
    assert.equal(sub("last"), "last.example · 30.0d ago · 1h left");
    assert.equal(row(env.root, "untitled").querySelector(".zal-title").textContent, "not a url");
    assert.equal(row(env.root, "hours").querySelector(".zal-favicon").getAttribute("src"), "data:icon");
    assert.equal(row(env.root, "mins").querySelector(".zal-favicon").hasAttribute("src"), false);
  });

  test("no time left is shown when tabs are kept forever", async () => {
    const env = await open({ records: [rec("a")], keepMs: null });
    await expand(env, "ws-a");
    assert.equal(row(env.root, "a").querySelector(".zal-sub").textContent, "a.example · 1.0h ago");
  });

  test("a row's Restore and Forget buttons act on that tab", async () => {
    const env = await open({ records: [rec("a")] });
    await expand(env, "ws-a");
    const restoreBtn = row(env.root, "a").querySelector(".zal-restore");
    restoreBtn.click();
    assert.equal(restoreBtn.disabled, true);
    assert.deepEqual(env.archiver.restore.mock.calls[0].arguments, ["a"]);
    const forgetBtn = row(env.root, "a").querySelector(".zal-forget");
    forgetBtn.click();
    assert.equal(forgetBtn.disabled, true);
    assert.deepEqual(env.archiver.forget.mock.calls[0].arguments, ["a"]);
    assert.deepEqual(selected(env.root), [], "button clicks don't select the row");
  });

  test("Forget all asks first, then forgets the whole group without toggling it", async () => {
    const env = await open({ records: [rec("a"), rec("b"), rec("c", { workspaceId: "ws-b" })] });
    const clear = header(env.root, "ws-a").querySelector(".zal-clear-all");
    globalThis.confirm = mock.fn(() => false);
    clear.click();
    assert.equal(env.archiver.forgetMany.mock.callCount(), 0);
    globalThis.confirm = mock.fn(() => true);
    clear.click();
    assert.match(confirm.mock.calls[0].arguments[0], /forget all 2 archived tabs in "🏠 Home"/);
    assert.deepEqual(env.archiver.forgetMany.mock.calls[0].arguments[0].sort(), ["a", "b"]);
    assert.equal(clear.disabled, true);
    await settle();
    assert.deepEqual(rows(env.root), [], "group not expanded by the click");
  });

  test("Forget all names a deleted workspace by its id", async () => {
    const env = await open({ records: [rec("a", { workspaceId: "ws-gone" })] });
    header(env.root, "ws-gone").querySelector(".zal-clear-all").click();
    assert.match(confirm.mock.calls[0].arguments[0], /in "ws-gone"/);
  });

  test("double-clicking a row restores it, but not when double-clicking a button", async () => {
    const env = await open({ records: [rec("a")] });
    await expand(env, "ws-a");
    row(env.root, "a").querySelector(".zal-meta").dispatchEvent(new env.window.MouseEvent("dblclick", { bubbles: true }));
    row(env.root, "a").querySelector(".zal-forget").dispatchEvent(new env.window.MouseEvent("dblclick", { bubbles: true }));
    header(env.root, "ws-a").dispatchEvent(new env.window.MouseEvent("dblclick", { bubbles: true }));
    assert.equal(env.archiver.restore.mock.callCount(), 1);
    assert.deepEqual(env.archiver.restore.mock.calls[0].arguments, ["a"]);
  });

  test("only the newest of overlapping renders updates the list", async () => {
    const env = await open({ records: [rec("apple"), rec("banana")] });
    await expand(env, "ws-a");
    const box = input(env.root);
    box.value = "apple";
    box.dispatchEvent(new env.window.Event("input"));
    box.value = "banana";
    box.dispatchEvent(new env.window.Event("input"));
    await settle();
    assert.deepEqual(rowIds(env.root), ["banana"]);
  });
});

describe("search and filters", () => {
  async function search(env, q) {
    input(env.root).value = q;
    input(env.root).dispatchEvent(new env.window.Event("input"));
    await settle();
  }

  test("search matches titles and URLs, case-insensitively", async () => {
    const env = await open({
      records: [rec("a", { title: "Cooking Recipes" }), rec("b", { url: "https://RECIPE-site.test/" }), rec("c"), rec("d", { title: undefined })],
    });
    await expand(env, "ws-a");
    await search(env, "  Recipe ");
    assert.deepEqual(rowIds(env.root).sort(), ["a", "b"]);
    await search(env, "nothing matches this");
    assert.equal(env.root.querySelector(".zal-empty").textContent, "No matches.");
  });

  test("the filter button swaps the search header for the filter panel, and Done swaps back", async () => {
    const env = await open();
    const top = env.root.querySelector(".zen-library-search-top");
    const searchHeader = env.root.querySelector(".zen-library-search-header");
    const filterHeader = env.root.querySelector(".zen-library-filter-header");
    const panel = env.root.querySelector(".zen-library-filter-panel-inner");
    assert.deepEqual([searchHeader.inert, filterHeader.inert, panel.inert], [false, true, true]);
    env.root.querySelector(".zen-library-filter-button").click();
    assert.equal(top.getAttribute("open"), "true");
    assert.match(env.root.style.getPropertyValue("--zen-library-filter-height"), /^\d+px$/);
    assert.deepEqual([searchHeader.inert, filterHeader.inert, panel.inert], [true, false, false]);
    env.root.querySelector(".zen-library-filter-done").click();
    assert.equal(top.hasAttribute("open"), false);
    assert.deepEqual([searchHeader.inert, filterHeader.inert, panel.inert], [false, true, true]);
  });

  test("when-archived chips filter by age, one at a time, and toggle off", async () => {
    const env = await open({
      records: [
        rec("today", { archivedAt: Date.now() - HOUR }),
        rec("week", { archivedAt: Date.now() - 3 * DAY }),
        rec("month", { archivedAt: Date.now() - 20 * DAY }),
      ],
    });
    await expand(env, "ws-a");
    const chip = (k) => env.root.querySelector(`.zen-library-filter-chip[data-when="${k}"]`);
    const active = () => [...env.root.querySelectorAll(".zen-library-filter-chip[active]")].map((c) => c.dataset.when);

    chip("today").click();
    await settle();
    assert.deepEqual(rowIds(env.root), ["today"]);
    assert.deepEqual(active(), ["today"]);

    chip("week").click();
    await settle();
    assert.deepEqual(rowIds(env.root), ["today", "week"]);
    assert.deepEqual(active(), ["week"]);

    chip("week").click();
    await settle();
    assert.deepEqual(rowIds(env.root), ["today", "week", "month"]);
    assert.deepEqual(active(), []);
  });
});

describe("live updates", () => {
  test("re-renders open views once per burst of change notifications", async () => {
    const env = await open({ records: [rec("a")] });
    const before = env.archiver.list.mock.callCount();
    env.archiver.records = [];
    env.services.obs.notifyObservers(null, TOPIC);
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.equal(env.archiver.list.mock.callCount(), before + 1);
    assert.equal(env.root.querySelector(".zal-empty").textContent, "No archived tabs yet.");
  });

  test("keeps the search text when re-rendering", async () => {
    const env = await open({ records: [rec("apple"), rec("banana")] });
    await expand(env, "ws-a");
    input(env.root).value = "apple";
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.deepEqual(rowIds(env.root), ["apple"]);
  });

  test("stops listening when the window unloads", async () => {
    const env = await load();
    assert.equal(env.services.obs.count(TOPIC), 1);
    env.window.dispatchEvent(new env.window.Event("unload"));
    assert.equal(env.services.obs.count(TOPIC), 0);
  });
});

describe("mouse selection", () => {
  async function openExpanded() {
    const env = await open({
      records: [1, 2, 3, 4, 5].map((n) => rec(`t${n}`, { archivedAt: Date.now() - n * HOUR })),
    });
    await expand(env, "ws-a");
    return env;
  }
  const clickRow = (env, id, opts) => click(env, row(env.root, id).querySelector(".zal-title"), opts);

  test("click selects one row; clicking it again deselects", async () => {
    const env = await openExpanded();
    clickRow(env, "t2");
    assert.deepEqual(selected(env.root), ["t2"]);
    assert.equal(row(env.root, "t2").getAttribute("aria-selected"), "true");
    assert.equal(bar(env.root).hasAttribute("active"), true);
    assert.equal(bar(env.root).querySelector(".zal-selcount").textContent, "1 selected");
    clickRow(env, "t4");
    assert.deepEqual(selected(env.root), ["t4"]);
    clickRow(env, "t4");
    assert.deepEqual(selected(env.root), []);
    assert.equal(bar(env.root).hasAttribute("active"), false);
  });

  test("Ctrl- and Cmd-click add and remove rows", async () => {
    const env = await openExpanded();
    clickRow(env, "t1");
    clickRow(env, "t3", { ctrlKey: true });
    clickRow(env, "t5", { metaKey: true });
    assert.deepEqual(selected(env.root), ["t1", "t3", "t5"]);
    clickRow(env, "t3", { ctrlKey: true });
    assert.deepEqual(selected(env.root), ["t1", "t5"]);
  });

  test("Shift-click selects a range from the last clicked row; Ctrl+Shift adds it", async () => {
    const env = await openExpanded();
    clickRow(env, "t2");
    clickRow(env, "t4", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["t2", "t3", "t4"]);
    clickRow(env, "t1", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["t1", "t2"], "range replaces the selection");
    clickRow(env, "t5", { ctrlKey: true });
    clickRow(env, "t4", { ctrlKey: true, shiftKey: true });
    assert.deepEqual(selected(env.root), ["t1", "t2", "t4", "t5"], "Ctrl+Shift adds the range");
  });

  test("Shift-click with no anchor just selects the row", async () => {
    const env = await openExpanded();
    clickRow(env, "t3", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["t3"]);
  });

  test("clicks outside rows don't change the selection", async () => {
    const env = await openExpanded();
    clickRow(env, "t1");
    click(env, env.root.querySelector(".zal-list"));
    assert.deepEqual(selected(env.root), ["t1"]);
  });

  test("the selection bar restores, forgets and clears the selection", async () => {
    const env = await openExpanded();
    clickRow(env, "t1");
    clickRow(env, "t2", { ctrlKey: true });
    bar(env.root).querySelector(".zal-restore").click();
    assert.deepEqual(env.archiver.restoreMany.mock.calls[0].arguments[0], ["t1", "t2"]);
    assert.deepEqual(selected(env.root), []);

    clickRow(env, "t3");
    bar(env.root).querySelector(".zal-forget").click();
    assert.equal(confirm.mock.callCount(), 0, "no confirmation for a single tab");
    assert.deepEqual(env.archiver.forgetMany.mock.calls[0].arguments[0], ["t3"]);

    clickRow(env, "t4");
    clickRow(env, "t5", { ctrlKey: true });
    globalThis.confirm = mock.fn(() => false);
    bar(env.root).querySelector(".zal-forget").click();
    assert.equal(env.archiver.forgetMany.mock.callCount(), 1, "cancelled");
    assert.deepEqual(selected(env.root), ["t4", "t5"]);
    globalThis.confirm = mock.fn(() => true);
    bar(env.root).querySelector(".zal-forget").click();
    assert.match(confirm.mock.calls[0].arguments[0], /forget 2 archived tabs/);
    assert.deepEqual(env.archiver.forgetMany.mock.calls[1].arguments[0], ["t4", "t5"]);

    clickRow(env, "t1");
    bar(env.root).querySelector(".zal-selclear").click();
    assert.deepEqual(selected(env.root), []);
  });

  test("selection only covers visible rows", async () => {
    const env = await openExpanded();
    clickRow(env, "t1");
    clickRow(env, "t2", { ctrlKey: true });
    await expand(env, "ws-a"); // collapse
    await expand(env, "ws-a"); // and reopen
    assert.deepEqual(selected(env.root), []);
    clickRow(env, "t1", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["t1"], "the old anchor was dropped too");
  });

  test("selection survives a re-render while its rows stay visible", async () => {
    const env = await openExpanded();
    clickRow(env, "t1");
    clickRow(env, "t2", { ctrlKey: true });
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.deepEqual(selected(env.root), ["t1", "t2"]);
  });
});

describe("keyboard", () => {
  async function openKb() {
    const env = await open({
      records: [
        rec("a1", { archivedAt: Date.now() - 1 * HOUR }),
        rec("a2", { archivedAt: Date.now() - 2 * HOUR }),
        rec("a3", { archivedAt: Date.now() - 3 * HOUR }),
        rec("b1", { workspaceId: "ws-b" }),
      ],
    });
    await expand(env, "ws-a");
    await expand(env, "ws-b");
    return env;
  }
  const focused = (env) => env.document.activeElement;
  const press = (env, k, opts) => key(env, focused(env), k, opts);
  const label = (el) => el.dataset.id ?? `[${el.dataset.ws}]`;

  test("ArrowDown from the search box enters the list; arrows, Home and End move focus", async () => {
    const env = await openKb();
    input(env.root).focus();
    const e = key(env, input(env.root), "ArrowDown");
    assert.equal(e.defaultPrevented, true);
    assert.equal(label(focused(env)), "[ws-a]");
    press(env, "ArrowDown");
    assert.equal(label(focused(env)), "a1");
    press(env, "End");
    assert.equal(label(focused(env)), "b1");
    press(env, "ArrowDown");
    assert.equal(label(focused(env)), "b1", "stops at the end");
    press(env, "Home");
    assert.equal(label(focused(env)), "[ws-a]");
    press(env, "ArrowUp");
    assert.equal(label(focused(env)), "[ws-a]", "stops at the start");
    assert.deepEqual(selected(env.root), [], "moving focus doesn't select");
  });

  test("other keys in the search box, and ArrowDown with nothing to focus, are left alone", async () => {
    const env = await open();
    assert.equal(key(env, input(env.root), "a").defaultPrevented, false);
    assert.equal(key(env, input(env.root), "ArrowDown").defaultPrevented, false);
  });

  test("focus is roving: only the focused item is a tab stop", async () => {
    const env = await openKb();
    row(env.root, "a2").focus();
    const stops = [...env.root.querySelectorAll(".zal-group-header, .zal-row")].filter((el) => el.tabIndex === 0);
    assert.deepEqual(stops.map(label), ["a2"]);
  });

  test("Shift+arrows extend the selection from the starting row", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    press(env, "ArrowDown", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["a1", "a2"]);
    press(env, "ArrowDown", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["a1", "a2", "a3"]);
    press(env, "ArrowUp", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["a1", "a2"]);
  });

  test("Shift+ArrowDown from a header anchors on the first row; onto a header selects nothing new", async () => {
    const env = await openKb();
    header(env.root, "ws-a").focus();
    press(env, "ArrowDown", { shiftKey: true });
    assert.deepEqual(selected(env.root), ["a1"]);
    row(env.root, "a3").focus();
    press(env, "ArrowDown", { shiftKey: true });
    assert.equal(label(focused(env)), "[ws-b]");
    assert.deepEqual(selected(env.root), ["a1"]);
  });

  test("Space toggles a row, or a header's group", async () => {
    const env = await openKb();
    row(env.root, "a2").focus();
    press(env, " ");
    assert.deepEqual(selected(env.root), ["a2"]);
    press(env, " ");
    assert.deepEqual(selected(env.root), []);
    header(env.root, "ws-b").focus();
    press(env, " ");
    await settle();
    assert.equal(row(env.root, "b1"), null, "collapsed");
    assert.equal(label(focused(env)), "[ws-b]", "focus kept on the header after re-render");
  });

  test("ArrowRight/Left open and close groups, and Left from a row jumps to its header", async () => {
    const env = await openKb();
    row(env.root, "a2").focus();
    assert.equal(press(env, "ArrowRight").defaultPrevented, false, "no-op on a row");
    press(env, "ArrowLeft");
    assert.equal(label(focused(env)), "[ws-a]");
    press(env, "ArrowRight");
    assert.equal(label(focused(env)), "a1", "on an open group, Right moves into it");
    header(env.root, "ws-a").focus();
    press(env, "ArrowLeft");
    await settle();
    assert.equal(row(env.root, "a1"), null, "collapsed");
    assert.equal(press(env, "ArrowLeft").defaultPrevented, false, "no-op on a closed group");
    press(env, "ArrowRight");
    await settle();
    assert.ok(row(env.root, "a1"), "expanded again");
  });

  test("Enter on a header toggles it", async () => {
    const env = await openKb();
    header(env.root, "ws-a").focus();
    press(env, "Enter");
    await settle();
    assert.equal(row(env.root, "a1"), null);
  });

  test("Enter restores and switches to a single tab, or restores a selection in the background", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    press(env, "Enter");
    assert.deepEqual(env.archiver.restore.mock.calls[0].arguments, ["a1"]);

    press(env, " "); // select a1 itself, then Enter: still a single switch-to restore
    press(env, "Enter");
    assert.equal(env.archiver.restore.mock.callCount(), 2);

    row(env.root, "a2").focus();
    press(env, "Enter"); // selection is a1 only, focus on a2
    assert.deepEqual(env.archiver.restoreMany.mock.calls[0].arguments[0], ["a1"]);

    row(env.root, "a1").focus();
    press(env, " ");
    row(env.root, "a3").focus();
    press(env, " ");
    press(env, "Enter");
    assert.deepEqual(env.archiver.restoreMany.mock.calls[1].arguments[0], ["a1", "a3"]);
  });

  test("Delete and Backspace forget the focused row or the selection", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    press(env, "Delete");
    assert.deepEqual(env.archiver.forgetMany.mock.calls[0].arguments[0], ["a1"]);

    header(env.root, "ws-a").focus();
    assert.equal(press(env, "Backspace").defaultPrevented, false, "nothing to forget on a header");

    row(env.root, "a2").focus();
    press(env, " ");
    header(env.root, "ws-a").focus();
    press(env, "Backspace");
    assert.deepEqual(env.archiver.forgetMany.mock.calls[1].arguments[0], ["a2"]);
  });

  test("Ctrl/Cmd+A selects every visible row; plain A does nothing", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    assert.equal(press(env, "a").defaultPrevented, false);
    assert.deepEqual(selected(env.root), []);
    press(env, "a", { ctrlKey: true });
    assert.deepEqual(selected(env.root), ["a1", "a2", "a3", "b1"]);
    press(env, " ");
    press(env, "A", { metaKey: true });
    assert.deepEqual(selected(env.root), ["a1", "a2", "a3", "b1"]);
  });

  test("handled keys don't reach Zen; others and keys on buttons pass through", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    assert.equal(press(env, "ArrowDown").defaultPrevented, true);
    assert.equal(press(env, "x").defaultPrevented, false);
    const btn = row(env.root, "a1").querySelector(".zal-restore");
    assert.equal(key(env, btn, "Enter").defaultPrevented, false);
    assert.equal(key(env, env.root.querySelector(".zal-list"), "ArrowDown").defaultPrevented, false);
  });

  test("after the focused row goes away, focus moves to what took its place", async () => {
    const env = await openKb();
    row(env.root, "a2").focus();
    env.archiver.records = env.archiver.records.filter((r) => r.id !== "a2");
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.equal(label(focused(env)), "a3");
  });

  test("when the list empties, focus returns to the search box", async () => {
    const env = await openKb();
    row(env.root, "a1").focus();
    env.archiver.records = [];
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.equal(focused(env), input(env.root));
  });

  test("a re-render doesn't steal focus from outside the list", async () => {
    const env = await openKb();
    input(env.root).focus();
    env.services.obs.notifyObservers(null, TOPIC);
    await settle(150);
    assert.equal(focused(env), input(env.root));
  });

  test("focus events from non-items inside the list are ignored", async () => {
    const env = await openKb();
    const list = env.root.querySelector(".zal-list");
    list.dispatchEvent(new env.window.FocusEvent("focusin", { bubbles: true }));
    assert.equal(list.tabIndex, -1);
  });
});
