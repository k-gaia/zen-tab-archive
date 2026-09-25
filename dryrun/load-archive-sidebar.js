// dryrun/load-archive-sidebar.js — console bootstrap for the inline
// per-workspace archive sections (src/archiveSidebar.mjs). Non-destructive:
// only reads archiver.list() and appends DOM into each <zen-workspace>
// element, right after its real tabs. Safe to run alongside
// load-archiver.js / load-archive-view.js in the same session.
//
// EDIT SRC_DIR below if your checkout lives somewhere else.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Sections appear automatically for any
// workspace that already has archived tabs (collapsed by default, click to
// expand). Switch workspaces to see each one's own section.
//   zenArchiveSidebar.refreshAll()  // force a re-render now
//   zenArchiveSidebar.uninstall()   // remove all sections + stop polling

(async () => {
  const SRC_DIR = "file:///C:/Users/Kevin/Developer/zen-tab-cleanup/src/";

  const resProto = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  resProto.setSubstitution("zen-tab-archive", Services.io.newURI(SRC_DIR));

  const archiveSidebar = ChromeUtils.importESModule(`resource://zen-tab-archive/archiveSidebar.mjs?t=${Date.now()}`);

  window.zenArchiveSidebar = archiveSidebar;
  archiveSidebar.install();
  console.log(
    "%czenArchiveSidebar loaded%c — sections appended inline per workspace",
    "color:#7aa2f7;font-weight:bold", "color:inherit"
  );
})();
