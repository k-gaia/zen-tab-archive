// dryrun/load-archiver.js — console bootstrap for the REAL archiver
// (src/archiver.mjs). This is not the mod itself, just the loader shim
// until a real fx-autoconfig/Sine loader exists.
//
// THIS ONE ACTUALLY CLOSES TABS. Idle (24h+) ordinary tabs across every
// workspace get archived through archiveStore.mjs and removed from the
// strip, on a 5 min timer. They're fully recoverable via
// window.zenArchiver.restore(id) — nothing is deleted, just moved out of
// the tab strip into the JSON store.
//
// EDIT SRC_DIR below if your checkout lives somewhere else.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Then:
//   await zenArchiver.list()        // see what's archived
//   await zenArchiver.restore(id)   // bring one back
//   zenArchiver.stop()              // disarm the timer
//   zenArchiver.start()             // re-arm (also runs an immediate scan)

(async () => {
  const SRC_DIR = "file:///C:/Users/Kevin/Developer/zen-tab-cleanup/src/";

  const resProto = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  resProto.setSubstitution("zen-tab-archive", Services.io.newURI(SRC_DIR));

  const archiver = ChromeUtils.importESModule(`resource://zen-tab-archive/archiver.mjs?t=${Date.now()}`);

  window.zenArchiver = archiver;
  console.log(
    "%czenArchiver loaded%c — call zenArchiver.start() to arm it (scans + archives immediately, then every 5 min)",
    "color:#7aa2f7;font-weight:bold", "color:inherit"
  );
})();
