// dryrun/probe-stored-tabs.js — read-only probe of Zen's internal tab-caching
// structures, to check whether inactive workspaces' tab data (url, lastAccessed)
// is readable WITHOUT switching to them. Changes nothing.
//
// Confirmed separately: gBrowser.tabs only contains the ACTIVE workspace's
// ordinary tabs + globally-visible essentials -- an inactive workspace's tabs
// are simply absent from it. This probes whether gZenWorkspaces keeps a
// side-channel with enough data to inspect other workspaces without switching.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Ideally while NOT on the "dev" workspace
// ({60ab8d6f-7414-466d-9b7e-fad6c7c4a4e1}), so any dev-tab data found here is
// clearly coming from the cache, not from gBrowser.tabs.

(() => {
  const gzw = window.gZenWorkspaces;

  function describe(label, val) {
    console.log(`%c${label}`, "font-weight:bold;color:#7aa2f7", val);
    if (val instanceof Map) {
      console.log(`  Map with ${val.size} entries, keys:`, [...val.keys()]);
    } else if (Array.isArray(val)) {
      console.log(`  Array, length ${val.length}`);
    } else if (val && typeof val === "object") {
      console.log("  plain object, keys:", Object.keys(val));
    } else {
      console.log("  typeof:", typeof val);
    }
  }

  console.log("active workspace:", gzw.activeWorkspace);
  describe("_allStoredTabs", gzw._allStoredTabs);
  describe("_workspaceCache", gzw._workspaceCache);
  describe("lastSelectedWorkspaceTabs", gzw.lastSelectedWorkspaceTabs);

  // If _allStoredTabs is a Map/object keyed by workspace id, try to pull out
  // one entry for the dev workspace specifically and see what it looks like.
  const DEV_WS = "{60ab8d6f-7414-466d-9b7e-fad6c7c4a4e1}";
  let devEntry;
  if (gzw._allStoredTabs instanceof Map) {
    devEntry = gzw._allStoredTabs.get(DEV_WS);
  } else if (gzw._allStoredTabs && typeof gzw._allStoredTabs === "object") {
    devEntry = gzw._allStoredTabs[DEV_WS];
  }
  console.log("%c_allStoredTabs entry for dev workspace:", "font-weight:bold;color:#9ece6a", devEntry);

  if (devEntry) {
    const asArray = devEntry instanceof Map ? [...devEntry.values()] : Array.isArray(devEntry) ? devEntry : [devEntry];
    console.log("dev entry as array, length:", asArray.length);
    const sample = asArray[0];
    console.log("sample entry:", sample);
    if (sample?.tagName) {
      // looks like a real <tab> element -- check if metadata is readable without attachment
      console.log("sample is a DOM element. url:", sample.linkedBrowser?.currentURI?.spec);
      console.log("sample lastAccessed:", sample.lastAccessed, "pending:", sample.hasAttribute?.("pending"));
    }
  }
})();
