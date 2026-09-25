// dryrun/probe-remove-without-switch.js — does archiving a tab require
// switching to its workspace first, or can gBrowser.removeTab (via the real
// zenRestorePoc.archive) act directly on a tab pulled from
// gZenWorkspaces._allStoredTabs while a DIFFERENT workspace stays active?
//
// Requires zenRestorePoc to already be loaded (paste restore-poc.js first if
// window.zenRestorePoc is undefined). Real action: archives one real tab
// through the real store, so it's recoverable via zenRestorePoc.restore(id)
// if you want it back.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Stay on whatever workspace is
// currently active -- do NOT switch first, that's the point of this test.

(async () => {
  if (!window.zenRestorePoc) {
    console.log("%czenRestorePoc not loaded — paste restore-poc.js first", "color:#f7768e;font-weight:bold");
    return;
  }

  const activeWs = gZenWorkspaces.activeWorkspace;
  const candidate = gZenWorkspaces._allStoredTabs.find((tab) => {
    const ws = tab.getAttribute("zen-workspace-id");
    return ws && ws !== activeWs
      && !tab.pinned
      && !tab.hasAttribute("zen-essential")
      && !tab.selected;
  });

  if (!candidate) {
    console.log("%cno candidate found in a non-active workspace", "color:#f7768e");
    return;
  }

  const targetId = candidate.id;
  const url = candidate.linkedBrowser?.currentURI?.spec;
  const ws = candidate.getAttribute("zen-workspace-id");
  console.log("active workspace (unchanged):", activeWs);
  console.log("candidate:", url, "belongs to ws:", ws);

  let archivedId;
  try {
    archivedId = await window.zenRestorePoc.archive(candidate);
    console.log("%carchive() did not throw, id =", "color:#9ece6a", archivedId);
  } catch (e) {
    console.log("%carchive() threw:", "color:#f7768e;font-weight:bold", e.message);
    return;
  }

  const stillPresent = gZenWorkspaces._allStoredTabs.some((t) => t.id === targetId);
  console.log(
    stillPresent
      ? "%cRESULT: tab still present in _allStoredTabs — removal silently failed"
      : "%cRESULT: tab gone from _allStoredTabs — removal succeeded without switching workspace",
    `color:${stillPresent ? "#f7768e" : "#9ece6a"};font-weight:bold`
  );
})();
