// dryrun/probe-sine-load.js — manually replays config.js's exact steps
// (which normally run silently, wrapped in a try/catch that swallows
// errors) to find out why Sine isn't loading. Read-only except for the
// final importESModule call, which is exactly what should already be
// happening automatically at startup.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  console.log("general.config.filename:", Services.prefs.getCharPref("general.config.filename", "<unset>"));
  console.log("general.config.obscure_value:", Services.prefs.getIntPref("general.config.obscure_value", -1));
  console.log("general.config.sandbox_enabled:", Services.prefs.getBoolPref("general.config.sandbox_enabled", true));

  try {
    const cmanifest = Services.dirsvc.get("UChrm", Ci.nsIFile);
    cmanifest.append("utils");
    cmanifest.append("chrome.manifest");
    console.log("chrome.manifest path:", cmanifest.path);
    console.log("chrome.manifest exists:", cmanifest.exists());

    if (cmanifest.exists()) {
      Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(cmanifest);
      console.log("%cautoRegister succeeded", "color:#9ece6a");
      const mod = ChromeUtils.importESModule("chrome://userscripts/content/sine.sys.mjs");
      console.log("%cimportESModule succeeded", "color:#9ece6a;font-weight:bold", mod);
    }
  } catch (err) {
    console.log("%cFAILED at:", "color:#f7768e;font-weight:bold", err.message, err);
  }

  console.log("window.manager after manual load attempt:", window.manager);
})();
