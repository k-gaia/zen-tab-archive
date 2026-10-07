// dryrun/probe-library-icon-state.js — checks whether our active/inactive
// icon CSS is actually being applied, and whether the two states compute
// to genuinely different values. Prefix every log with zen-tab-archive so
// it survives the console's default filter.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Prints the CURRENT state (whichever
// tab happens to be selected right now); run it once with Archived Tabs
// selected and once with something else selected, and compare both.

(() => {
  const tab = document.querySelector('.zen-library-tab[data-section="archived-tabs"]');
  if (!tab) {
    console.log("[zen-tab-archive/probe] tab not found");
    return;
  }
  const iconImage = tab.querySelector(".zen-library-tab-icon-image");
  const cs = getComputedStyle(iconImage);
  console.log("[zen-tab-archive/probe] tab has [active] attr:", tab.hasAttribute("active"));
  console.log("[zen-tab-archive/probe] computed fill:", cs.fill);
  console.log("[zen-tab-archive/probe] computed opacity:", cs.opacity);
  console.log("[zen-tab-archive/probe] computed background-image:", cs.backgroundImage);

  // Which rules actually matched, in cascade order, so we can see if
  // something else is clobbering ours.
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      try {
        if (iconImage.matches(rule.selectorText)) {
          console.log("[zen-tab-archive/probe] matched rule:", rule.selectorText, "->", rule.style.cssText, "| sheet:", sheet.href || "(inline)");
        }
      } catch {
        // invalid selector for matches(), e.g. SCSS-nesting leftovers -- skip
      }
    }
  }
})();
