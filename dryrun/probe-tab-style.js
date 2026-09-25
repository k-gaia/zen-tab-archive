// dryrun/probe-tab-style.js — read-only probe of a real <tab> element's DOM
// structure and computed styles, so the ghost archive rows can be rebuilt to
// match real tabs (size, spacing, font, icon, border-radius) instead of our
// own guessed compact styling. Changes nothing.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Ideally with at least one non-pinned,
// non-active tab visible in the current workspace.

(() => {
  const tab = gBrowser.selectedTab.nextElementSibling?.tagName === "tab"
    ? gBrowser.selectedTab.nextElementSibling
    : gBrowser.selectedTab;

  console.log("%cprobing tab:", "font-weight:bold;color:#7aa2f7", tab);

  function dump(el, label, depth = 0) {
    if (!el || depth > 4) return;
    const cs = getComputedStyle(el);
    console.log(
      "  ".repeat(depth) + `<${el.tagName}${el.className ? "." + [...el.classList].join(".") : ""}>`,
      { height: cs.height, padding: cs.padding, margin: cs.margin, borderRadius: cs.borderRadius, font: cs.font, gap: cs.gap }
    );
    for (const child of el.children) dump(child, label, depth + 1);
  }
  dump(tab, "tab");

  const icon = tab.querySelector(".tab-icon-image, .tab-icon-stack, image");
  if (icon) {
    const cs = getComputedStyle(icon);
    console.log("%cicon element:", "font-weight:bold;color:#9ece6a", icon, { width: cs.width, height: cs.height, borderRadius: cs.borderRadius });
  }

  const label = tab.querySelector(".tab-label, .tab-text");
  if (label) {
    const cs = getComputedStyle(label);
    console.log("%clabel element:", "font-weight:bold;color:#9ece6a", label, { font: cs.font, color: cs.color, lineHeight: cs.lineHeight });
  }

  console.log("%cfull outerHTML (structure reference):", "font-weight:bold;color:#7aa2f7");
  console.log(tab.outerHTML.slice(0, 2000));

  const csTab = getComputedStyle(tab);
  console.log("%ctab computed height/padding/border-radius:", "font-weight:bold;color:#7aa2f7", {
    height: csTab.height, padding: csTab.padding, borderRadius: csTab.borderRadius,
  });
})();
