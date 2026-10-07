// dryrun/probe-icon-render.js — injects the icon SVG directly into the
// page, floating at large size with hardcoded colors (bypassing
// context-fill/context-stroke entirely), so we can see the raw geometry
// isolated from all of Zen's CSS and the -moz-context-properties
// mechanism. If this looks right but the real icon still doesn't, the
// bug is in Zen's styling/sizing, not our shape. If this looks wrong,
// the bug is in our path data.
//
// Run: Ctrl+Shift+J -> paste -> Enter. A green/blue box will appear
// top-left of the browser window; remove it by running
// document.getElementById("zen-tab-archive-icon-debug").remove()

(async () => {
  const url = "chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg";
  const svgText = await (await fetch(url)).text();
  const recolored = svgText
    .replaceAll('fill="context-fill"', 'fill="#39c26b"')
    .replaceAll('stroke="context-stroke"', 'stroke="#1a73e8"')
    .replace("<svg ", '<svg style="width:160px;height:160px;background:#222;" ');

  document.getElementById("zen-tab-archive-icon-debug")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "zen-tab-archive-icon-debug";
  wrap.style.cssText = "position:fixed;top:40px;left:40px;z-index:99999999;box-shadow:0 0 0 2px red;";
  wrap.innerHTML = recolored;
  document.documentElement.appendChild(wrap);
  console.log("[zen-tab-archive/probe] injected debug render, top-left of the window");
})();
