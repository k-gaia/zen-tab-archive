// dryrun/load-archive-view.js — console bootstrap for the master archive
// view (src/archiveView.mjs). Non-destructive: only renders a panel and
// wires Restore/Forget buttons to the real archiver. Safe to run alongside
// load-archiver.js in the same window/session.
//
// EDIT SRC_DIR below if your checkout lives somewhere else.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Then:
//   zenArchiveView.show()    // open the panel
//   zenArchiveView.hide()    // close it
//   zenArchiveView.toggle()  // either

(async () => {
  const SRC_DIR = "file:///C:/Users/Kevin/Developer/zen-tab-cleanup/src/";

  const resProto = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  resProto.setSubstitution("zen-tab-archive", Services.io.newURI(SRC_DIR));

  const archiveView = ChromeUtils.importESModule(`resource://zen-tab-archive/archiveView.mjs?t=${Date.now()}`);

  window.zenArchiveView = archiveView;
  archiveView.install(); // adds the sidebar button now, non-destructive
  console.log(
    "%czenArchiveView loaded%c — button added to the sidebar; click it, or call zenArchiveView.show()/toggle()",
    "color:#7aa2f7;font-weight:bold", "color:inherit"
  );
})();
