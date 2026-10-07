// dryrun/probe-search-unclickable.js — the search box/filter button are
// visible but don't respond to clicks. v1 queried `document.querySelector`
// unscoped and accidentally matched Zen's own (hidden) History section's
// native search input, which shares the same class names we reused — not
// our element. v2 scopes every query to our `.zal-root` element so we're
// actually inspecting the real thing the user sees.
//
// Run: Ctrl+Shift+J -> paste -> Enter, with Archived Tabs selected and
// visible.

(() => {
  const roots = document.querySelectorAll(".zal-root");
  console.log("[zen-tab-archive/probe] number of .zal-root elements:", roots.length);
  if (!roots.length) return;

  // If there's more than one, log all of them so we can see which is the
  // "live" one actually under the visible section.
  roots.forEach((r, i) => {
    const rect = r.getBoundingClientRect();
    console.log(`[zen-tab-archive/probe] root[${i}] rect:`, JSON.stringify(rect), "data-section:", r.dataset.section, "closest visible section tag:", r.closest("[data-section]")?.tagName);
  });

  const root = roots[0];
  const input = root.querySelector(".zen-library-search-box input");
  const filterButton = root.querySelector(".zen-library-filter-button");
  console.log("[zen-tab-archive/probe] (scoped) input found:", !!input, "filterButton found:", !!filterButton);
  if (!input || !filterButton) return;

  for (const [name, el] of [["input", input], ["filterButton", filterButton]]) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(el);
    console.log(`[zen-tab-archive/probe] ${name} rect:`, JSON.stringify(r));
    console.log(`[zen-tab-archive/probe] ${name} elementFromPoint at center:`, hit, "| is same element:", hit === el, "| hit tag/class:", hit?.tagName, hit?.className);
    console.log(`[zen-tab-archive/probe] ${name} computed pointer-events:`, cs.pointerEvents, "| -moz-window-dragging:", cs.getPropertyValue("-moz-window-dragging"), "| z-index:", cs.zIndex, "| position:", cs.position, "| display:", cs.display, "| visibility:", cs.visibility);
  }

  // Walk up from the input checking each ancestor's pointer-events and
  // -moz-window-dragging, in case something further up is the real cause.
  let el = input;
  let depth = 0;
  while (el && depth < 12) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    console.log(
      `[zen-tab-archive/probe] ancestor[${depth}]`,
      el.tagName + (el.className ? "." + String(el.className).replace(/\s+/g, ".") : ""),
      "| pointer-events:", cs.pointerEvents,
      "| -moz-window-dragging:", cs.getPropertyValue("-moz-window-dragging"),
      "| rect:", rect ? JSON.stringify(rect) : "n/a"
    );
    el = el.parentElement;
    depth++;
  }

  // Finally: does a synthetic click on the real input actually focus it?
  input.focus();
  console.log("[zen-tab-archive/probe] after input.focus(), activeElement is input:", document.activeElement === input, document.activeElement);
})();
