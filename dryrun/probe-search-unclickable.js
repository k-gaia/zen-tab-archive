// dryrun/probe-search-unclickable.js — the search box/filter button are
// visible but don't respond to clicks. Checks: (1) how many copies of our
// section exist (duplicate/stacked renders would explain stale handlers),
// (2) what element actually receives a hit-test at the search box/filter
// button's own coordinates (reveals an invisible overlay or duplicate on
// top), (3) pointer-events/-moz-window-dragging computed values on the
// real elements.
//
// Run: Ctrl+Shift+J -> paste -> Enter, with Archived Tabs selected and
// visible.

(() => {
  const roots = document.querySelectorAll(".zal-root");
  console.log("[zen-tab-archive/probe] number of .zal-root elements:", roots.length);

  const input = document.querySelector(".zen-library-search-box input");
  const filterButton = document.querySelector(".zen-library-filter-button");
  console.log("[zen-tab-archive/probe] input found:", !!input, "filterButton found:", !!filterButton);
  if (!input || !filterButton) return;

  for (const [name, el] of [["input", input], ["filterButton", filterButton]]) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(el);
    console.log(`[zen-tab-archive/probe] ${name} rect:`, JSON.stringify(r));
    console.log(`[zen-tab-archive/probe] ${name} elementFromPoint at center:`, hit, "| is same element:", hit === el);
    console.log(`[zen-tab-archive/probe] ${name} computed pointer-events:`, cs.pointerEvents, "| -moz-window-dragging:", cs.getPropertyValue("-moz-window-dragging"), "| z-index:", cs.zIndex, "| position:", cs.position);
  }

  // Walk up from the input checking each ancestor's pointer-events and
  // -moz-window-dragging, in case something further up is the real cause.
  let el = input;
  let depth = 0;
  while (el && depth < 10) {
    const cs = getComputedStyle(el);
    console.log(
      `[zen-tab-archive/probe] ancestor[${depth}]`,
      el.tagName + (el.className ? "." + String(el.className).replace(/\s+/g, ".") : ""),
      "| pointer-events:", cs.pointerEvents,
      "| -moz-window-dragging:", cs.getPropertyValue("-moz-window-dragging")
    );
    el = el.parentElement;
    depth++;
  }
})();
