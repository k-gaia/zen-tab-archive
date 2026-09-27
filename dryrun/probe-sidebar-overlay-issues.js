// dryrun/probe-sidebar-overlay-issues.js — real geometry/computed-style
// data instead of guessing further. Covers: (1) why .zag-clear-all's masked
// icon might not be rendering, (2) why the fade overlay appears to extend
// past the sidebar's own width, (3) how the fade overlay's rect relates to
// the arrowscrollbox's native arrow-button area (are we literally
// overlapping them?).
//
// Run with a workspace's "Archived Tabs" header visible AND expanded (click
// it open) so the arrowscrollbox is actually overflowing/showing its arrows.
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  console.log("%c== clear-all icon ==", "font-weight:bold;color:#7aa2f7");
  const btn = document.querySelector(".zag-clear-all");
  if (!btn) {
    console.log("%cno .zag-clear-all found in the document", "color:#f7768e;font-weight:bold");
  } else {
    const cs = getComputedStyle(btn);
    console.log("element:", btn);
    console.log("computed:", {
      width: cs.width, height: cs.height, display: cs.display, opacity: cs.opacity,
      backgroundColor: cs.backgroundColor,
      maskImage: cs.maskImage,
      mozMaskImage: cs.getPropertyValue("-moz-mask-image"),
      maskSize: cs.maskSize, maskPosition: cs.maskPosition,
    });
    console.log("CSS.supports mask-image url:", CSS.supports("mask-image", "url(chrome://browser/skin/zen-icons/trash.svg)"));
    console.log("CSS.supports -moz-mask-image url:", CSS.supports("-moz-mask-image", "url(chrome://browser/skin/zen-icons/trash.svg)"));
    console.log("bounding rect:", btn.getBoundingClientRect());
    const actions = btn.closest(".zag-actions");
    console.log("parent .zag-actions computed opacity:", actions ? getComputedStyle(actions).opacity : "not found");
  }

  console.log("%c== fade overlay geometry ==", "font-weight:bold;color:#7aa2f7");
  const fadeTop = document.querySelector(".zag-fade-top");
  const list = document.querySelector(".zag-list");
  const wrap = document.querySelector(".zag-list-wrap");
  const sidebar = document.getElementById("tabbrowser-arrowscrollbox")?.closest("#navigator-toolbox") ?? document.getElementById("browser");
  if (fadeTop) {
    console.log("fadeTop rect:", fadeTop.getBoundingClientRect());
  }
  if (list) console.log("arrowscrollbox (.zag-list) rect:", list.getBoundingClientRect());
  if (wrap) console.log(".zag-list-wrap rect:", wrap.getBoundingClientRect());
  console.log("sidebar box width (for comparison):", document.getElementById("sidebar-box")?.getBoundingClientRect() ?? "not found, trying alt");

  // Try to find the arrowscrollbox's native up/down arrow anonymous content
  // via getAnonymousNodes / getAnonymousElementByAttribute if available (old
  // Gecko API, may not exist) -- to see if their rect overlaps our fade zone.
  if (list && document.getAnonymousNodes) {
    try {
      const anon = document.getAnonymousNodes(list);
      console.log("arrowscrollbox anonymous nodes:", anon ? [...anon] : anon);
    } catch (e) {
      console.log("getAnonymousNodes failed:", e.message);
    }
  } else {
    console.log("document.getAnonymousNodes not available in this build");
  }
})();
