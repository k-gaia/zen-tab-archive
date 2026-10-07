// dryrun/probe-icon-load.js — confirms whether our icon SVG actually loads
// at all, independent of any CSS. If this fails, the problem is the file/
// cache, not styling. Prefix: zen-tab-archive (survives the console filter).
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const url = "chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg";
  fetch(url)
    .then((r) => {
      console.log("[zen-tab-archive/probe] fetch status:", r.status);
      return r.text();
    })
    .then((text) => {
      console.log("[zen-tab-archive/probe] fetched bytes:", text.length);
      console.log("[zen-tab-archive/probe] content:", text);
    })
    .catch((err) => {
      console.log("[zen-tab-archive/probe] fetch FAILED:", err.message);
    });

  const img = new Image();
  img.onload = () => console.log("[zen-tab-archive/probe] Image() onload OK, size:", img.naturalWidth, img.naturalHeight);
  img.onerror = (e) => console.log("[zen-tab-archive/probe] Image() onerror:", e);
  img.src = url + "?bust=" + Date.now();
})();
