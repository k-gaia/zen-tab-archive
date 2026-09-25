// dryrun/restore-poc.js — restore-to-workspace proof of concept.
// Archives ONE real tab through the real archiveStore.mjs module, then
// restores it into its origin workspace. This is the "real 80%" per CONTEXT.md.
//
// APIs used, by confidence:
//   CONFIRMED (via probe-workspaces.js on this profile):
//     gZenWorkspaces.activeWorkspace, gZenWorkspaces.changeWorkspaceWithID(id)
//     SessionStore.getTabState(tab) / setTabState(tab, stateString)
//   STANDARD FIREFOX (well-documented, not Zen-specific, but unverified in
//   this exact combination -- this run is the test):
//     gBrowser.removeTab(tab, { skipPermitUnload })
//     gBrowser.addTab(url, { skipAnimation, triggeringPrincipal })
//
// EDIT SRC_DIR below if your checkout lives somewhere else.
//
// Note: ChromeUtils.importESModule only accepts resource://chrome:// schemes
// (file:// throws "System modules must be loaded from a trusted scheme"), so
// this registers a resource:// substitution pointing at src/ first -- the
// same mechanism Sine/fx-autoconfig-style mods use for their own modules.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Then drive it by hand:
//   const id = await zenRestorePoc.archive(gBrowser.selectedTab.previousSibling) // pick a REAL, non-critical tab
//   await zenRestorePoc.list()      // confirm it's in archive.json, tab is gone from strip
//   await zenRestorePoc.restore(id) // confirm it reappears in its origin workspace w/ history intact

(async () => {
  const SRC_DIR = "file:///C:/Users/Kevin/Developer/zen-tab-cleanup/src/";

  const resProto = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  resProto.setSubstitution("zen-tab-archive", Services.io.newURI(SRC_DIR));

  const store = ChromeUtils.importESModule(`resource://zen-tab-archive/archiveStore.mjs?t=${Date.now()}`);

  function uuid() {
    return Services.uuid.generateUUID().toString().replace(/[{}]/g, "");
  }

  async function archive(tab) {
    if (!tab || tab.selected) throw new Error("pass a specific, non-active tab to archive");
    if (tab.pinned || tab.hasAttribute("zen-essential")) {
      throw new Error("refusing to archive a pinned/essential tab");
    }

    const record = {
      id: uuid(),
      workspaceId: tab.getAttribute("zen-workspace-id"),
      url: tab.linkedBrowser?.currentURI?.spec ?? "",
      title: tab.label,
      favicon: null, // not wired up yet -- not needed to prove restore
      archivedAt: Date.now(),
      lastAccessedAt: tab.lastAccessed,
      tabState: JSON.parse(SessionStore.getTabState(tab)),
    };

    await store.appendTab(record);
    gBrowser.removeTab(tab, { skipPermitUnload: true });
    console.log("%carchived", "color:#9ece6a;font-weight:bold", record.id, record.url, "ws:", record.workspaceId);
    return record.id;
  }

  async function restore(id) {
    const tabs = await store.listTabs();
    const record = tabs.find((t) => t.id === id);
    if (!record) throw new Error(`no archived tab with id ${id}`);

    const originalWorkspace = gZenWorkspaces.activeWorkspace;
    if (originalWorkspace !== record.workspaceId) {
      await gZenWorkspaces.changeWorkspaceWithID(record.workspaceId);
    }

    const newTab = gBrowser.addTab("about:blank", {
      skipAnimation: true,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    SessionStore.setTabState(newTab, JSON.stringify(record.tabState));
    gBrowser.selectedTab = newTab;

    await store.removeTab(id);
    console.log(
      "%crestored", "color:#9ece6a;font-weight:bold",
      id, "-> expected ws", record.workspaceId, "actual ws", newTab.getAttribute("zen-workspace-id")
    );
    return newTab;
  }

  window.zenRestorePoc = { archive, restore, list: store.listTabs };
  console.log(
    "%czenRestorePoc ready%c — const id = await zenRestorePoc.archive(tab); await zenRestorePoc.restore(id);",
    "color:#7aa2f7;font-weight:bold", "color:inherit"
  );
})();
