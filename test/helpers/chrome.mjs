// Minimal fakes for the Firefox/Zen chrome APIs the mod touches, so its
// modules can run under Node. Each test file installs a fresh set on
// globalThis before importing the module under test.

let importCounter = 0;

// Each call returns a fresh module instance (separate module state).
export function freshImport(path) {
  return import(`${new URL(path, import.meta.url).href}?instance=${++importCounter}`);
}

export function makeServices({ prefs = {}, window = null } = {}) {
  const observers = new Map(); // topic -> Set
  let uuidCounter = 0;
  const services = {
    window,
    prefs: {
      values: { ...prefs },
      getBoolPref(name, fallback) {
        return name in this.values ? this.values[name] : fallback;
      },
      getStringPref(name, fallback) {
        return name in this.values ? this.values[name] : fallback;
      },
      setStringPref(name, value) {
        this.values[name] = value;
      },
    },
    obs: {
      addObserver(observer, topic) {
        if (!observers.has(topic)) observers.set(topic, new Set());
        observers.get(topic).add(observer);
      },
      removeObserver(observer, topic) {
        observers.get(topic)?.delete(observer);
      },
      notifyObservers(subject, topic) {
        for (const o of [...(observers.get(topic) ?? [])]) o.observe(subject, topic);
      },
      count(topic) {
        return observers.get(topic)?.size ?? 0;
      },
    },
    wm: {
      getMostRecentWindow: () => services.window,
    },
    uuid: {
      generateUUID: () => ({ toString: () => `{uuid-${++uuidCounter}}` }),
    },
  };
  return services;
}

export function notFoundError() {
  const err = new Error("file not found");
  err.name = "NotFoundError";
  return err;
}

// In-memory IOUtils + PathUtils.
export function makeFs(files = {}) {
  const fs = {
    files: new Map(Object.entries(files)),
    writes: [],
    failNextWrite: false,
    readError: null,
    IOUtils: {
      async readUTF8(path) {
        if (fs.readError) throw fs.readError;
        if (!fs.files.has(path)) throw notFoundError();
        return fs.files.get(path);
      },
      async writeUTF8(path, text, opts) {
        if (fs.failNextWrite) {
          fs.failNextWrite = false;
          throw new Error("disk full");
        }
        fs.writes.push({ path, opts });
        fs.files.set(path, text);
      },
      async makeDirectory(path, opts) {
        fs.dirs.push({ path, opts });
      },
    },
    dirs: [],
    PathUtils: {
      profileDir: "/profile",
      join: (...parts) => parts.join("/"),
      parent: (p) => p.slice(0, p.lastIndexOf("/")),
    },
  };
  return fs;
}

export const ARCHIVE_PATH = "/profile/zen-tab-archive/archive.json";

export function installChromeGlobals({ prefs, window, files } = {}) {
  const fs = makeFs(files);
  const services = makeServices({ prefs, window });
  globalThis.Services = services;
  globalThis.IOUtils = fs.IOUtils;
  globalThis.PathUtils = fs.PathUtils;
  return { services, fs };
}

// --- Fake browser window -------------------------------------------------

export function makeTab({
  url = "https://example.com/",
  lastAccessed = Date.now() - 100 * 3.6e6,
  selected = false,
  pinned = false,
  attrs = {},
  label = "Example",
  browser = true,
} = {}) {
  const attributes = { ...attrs };
  return {
    linkedBrowser: browser ? { currentURI: url === null ? undefined : { spec: url } } : undefined,
    lastAccessed,
    selected,
    pinned,
    label,
    attributes,
    hasAttribute: (n) => n in attributes,
    getAttribute: (n) => attributes[n] ?? null,
    setAttribute: (n, v) => {
      attributes[n] = v;
    },
  };
}

// A bare element: just enough DOM for attribute assertions.
function makeElement(id) {
  const attributes = {};
  return {
    id,
    attributes,
    setAttribute: (n, v) => {
      attributes[n] = v;
    },
    getAttribute: (n) => attributes[n] ?? null,
  };
}

export function makeWindow({ tabs = [], allStoredTabs = tabs, activeWorkspace = "ws-a" } = {}) {
  const elements = new Map();
  const library = { activeTab: "history" };
  const Library = { isLibraryOpen: false, toggles: [], toggle: (id) => Library.toggles.push(id) };
  const win = {
    document: {
      getElementById: (id) => elements.get(id) ?? null,
      querySelector: (sel) => (sel === "zen-library" ? library : null),
    },
    customElements: { get: (name) => (name === "zen-library" ? Library : undefined) },
    library,
    Library,
    gZenUIManager: {
      toasts: [],
      // Like Zen's, builds the toast (and its button) synchronously.
      showToast(messageId, options) {
        this.toasts.push({ messageId, options });
        if (options.button) elements.set(options.button.id, makeElement(options.button.id));
        return Promise.resolve();
      },
    },
    intervals: [],
    clearedIntervals: [],
    setInterval(fn, ms) {
      const id = win.intervals.length + 1;
      win.intervals.push({ id, fn, ms });
      return id;
    },
    clearInterval(id) {
      win.clearedIntervals.push(id);
    },
    gZenWorkspaces: {
      allStoredTabs,
      activeWorkspace,
      promiseInitialized: Promise.resolve(),
      changes: [],
      moves: [],
      async changeWorkspaceWithID(id) {
        this.changes.push(id);
        this.activeWorkspace = id;
      },
      moveTabToWorkspace(tab, id) {
        this.moves.push(id);
        tab.setAttribute("zen-workspace-id", id);
      },
    },
    gBrowser: {
      tabs,
      removed: [],
      added: [],
      selectedTab: null,
      removeTab(tab, opts) {
        this.removed.push({ tab, opts });
      },
      addTrustedTab(url, opts) {
        const tab = makeTab({ url: "about:blank", attrs: { "zen-workspace-id": win.gZenWorkspaces.activeWorkspace } });
        this.added.push({ tab, url, opts });
        return tab;
      },
    },
    SessionStore: {
      promiseAllWindowsRestored: Promise.resolve(),
      states: [],
      getTabState(tab) {
        if (tab.stateError) throw tab.stateError;
        return JSON.stringify({ entries: [{ url: tab.linkedBrowser?.currentURI?.spec }], index: 1 });
      },
      setTabState(tab, json) {
        const state = JSON.parse(json);
        if (state.failRestore) throw new Error("setTabState failed");
        this.states.push({ tab, state });
      },
    },
  };
  return win;
}
