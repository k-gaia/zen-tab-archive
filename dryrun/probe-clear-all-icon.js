// dryrun/probe-clear-all-icon.js — checks why .zag-clear-all's masked icon
// might not be rendering: computed mask-image/background-color/opacity/
// dimensions, and whether mask-image even resolved (vs. silently failing).
// Also dumps whether `mask-image`/`-moz-mask-image` are supported at all in
// this Gecko build. Run with a workspace's "Archived Tabs" header visible.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const btn = document.querySelector(".zag-clear-all");
  if (!btn) {
    console.log("%cno .zag-clear-all button found in the document at all", "color:#f7768e;font-weight:bold");
    return;
  }
  console.log("%c.zag-clear-all element:", "font-weight:bold;color:#7aa2f7", btn);

  const cs = getComputedStyle(btn);
  console.log("computed styles:", {
    width: cs.width,
    height: cs.height,
    display: cs.display,
    opacity: cs.opacity,
    backgroundColor: cs.backgroundColor,
    maskImage: cs.maskImage,
    webkitMaskImage: cs.getPropertyValue("-webkit-mask-image"),
    mozMaskImage: cs.getPropertyValue("-moz-mask-image"),
    maskSize: cs.maskSize,
    maskPosition: cs.maskPosition,
  });

  console.log("CSS.supports mask-image url:", CSS.supports("mask-image", "url(chrome://browser/skin/zen-icons/trash.svg)"));
  console.log("CSS.supports -moz-mask-image url:", CSS.supports("-moz-mask-image", "url(chrome://browser/skin/zen-icons/trash.svg)"));

  const rect = btn.getBoundingClientRect();
  console.log("bounding rect:", rect);

  // Force-hover state to check if opacity:0 (hover-gated) is why it "looks gone".
  const header = btn.closest(".zag-header");
  console.log("parent .zag-header found:", !!header);
  if (header) {
    const headerCs = getComputedStyle(header);
    console.log("header opacity:", headerCs.opacity);
  }
})();
