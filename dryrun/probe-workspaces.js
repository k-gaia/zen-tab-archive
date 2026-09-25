// dryrun/probe-workspaces.js — read-only probe of Zen's workspace-switching API.
// Purpose: confirm gZenWorkspaces' real method names before writing the
// restore-to-workspace PoC against them instead of guessing. Changes nothing.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const dump = (label, obj) => {
    if (!obj) {
      console.log(`%c${label}: NOT FOUND on window`, "color:#f7768e;font-weight:bold");
      return;
    }
    const proto = Object.getPrototypeOf(obj);
    const ownProps = Object.getOwnPropertyNames(obj);
    const protoProps = proto ? Object.getOwnPropertyNames(proto) : [];
    console.log(`%c${label}`, "font-weight:bold;color:#7aa2f7");
    console.log("  own props:", ownProps);
    console.log("  proto props:", protoProps);
  };

  dump("gZenWorkspaces", window.gZenWorkspaces);
  dump("gZenPinnedTabManager", window.gZenPinnedTabManager);
  dump("nsZenPinnedTabManager", window.nsZenPinnedTabManager);
  dump("gZenFolders", window.gZenFolders);

  console.log("%cstate snapshot", "font-weight:bold;color:#9ece6a");
  console.log("selected tab workspace id:", gBrowser.selectedTab.getAttribute("zen-workspace-id"));

  // Best-guess property names for "which workspace is active" and "list of
  // workspaces" -- logged defensively since we don't know the real shape yet.
  const gzw = window.gZenWorkspaces;
  if (gzw) {
    for (const key of ["activeWorkspace", "activeWorkspaceId", "_activeWorkspace", "selectedWorkspace"]) {
      if (key in gzw) console.log(`gZenWorkspaces.${key} =`, gzw[key]);
    }
    for (const method of ["changeWorkspace", "changeWorkspaceWithID", "getActiveWorkspace", "switchTabIfNeeded"]) {
      console.log(`gZenWorkspaces.${method} is`, typeof gzw[method]);
    }
  }

  // SessionStore surface we'll need for capture/restore of tab state.
  console.log("%cSessionStore", "font-weight:bold;color:#9ece6a");
  console.log("typeof SessionStore.getTabState:", typeof SessionStore?.getTabState);
  console.log("typeof SessionStore.setTabState:", typeof SessionStore?.setTabState);
})();
