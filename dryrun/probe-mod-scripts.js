// dryrun/probe-mod-scripts.js — checks whether Sine's own utils.getScripts()
// sees our mod's scripts at all, and manually replays loading
// archiveView.uc.js the same way Sine's manager would, to surface any error
// that Sine's own try/catch (console.warn only) might have hidden in a
// noisy console.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(async () => {
  const utils = ChromeUtils.importESModule("chrome://userscripts/content/core/utils.sys.mjs").default
    ?? ChromeUtils.importESModule("chrome://userscripts/content/core/utils.sys.mjs");

  const mods = await utils.getMods();
  console.log("%cinstalled mods:", "font-weight:bold;color:#7aa2f7", Object.keys(mods));
  console.log("zen-tab-archive mod entry:", mods["zen-tab-archive"]);

  const scripts = await utils.getScripts({ mods });
  console.log("%call resolved scripts (flattened):", "font-weight:bold;color:#7aa2f7", Object.keys(scripts));
  console.log("full scripts object:", scripts);

  const ourScripts = Object.keys(scripts).filter((k) => k.includes("archiveView") || k.includes("archiveSidebar") || k.includes("archiver") || k.includes("archiveStore"));
  console.log("%cour scripts specifically:", "font-weight:bold;color:#9ece6a", ourScripts);

  // Manually replay loading archiveView.uc.js the way Sine's manager would.
  const uiScriptPath = ourScripts.find((s) => s.endsWith("archiveView.uc.js"));
  if (uiScriptPath) {
    const chromePath = `chrome://sine/content/${uiScriptPath}`;
    console.log("attempting manual load of:", chromePath);
    try {
      Services.scriptloader.loadSubScriptWithOptions(chromePath, { target: window, ignoreCache: true });
      console.log("%cmanual load succeeded, window.ZenTabArchive:", "color:#9ece6a;font-weight:bold", window.ZenTabArchive);
    } catch (err) {
      console.log("%cmanual load FAILED:", "color:#f7768e;font-weight:bold", err.message, err);
    }
  } else {
    console.log("%cno archiveView.uc.js entry found in resolved scripts -- path/manifest mismatch", "color:#f7768e;font-weight:bold");
  }
})();
