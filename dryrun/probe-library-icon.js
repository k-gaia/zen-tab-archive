// dryrun/probe-library-icon.js — checks why the Archived Tabs library tab
// has no icon: is our CSS rule even in the document, does the tab element
// have the expected data-section attribute, what's the actual computed
// background-image on its icon element.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const style = document.getElementById("zen-archive-library-style");
  console.log("style tag present:", !!style);
  console.log("style contains our icon rule:", style?.textContent.includes("archived-tabs") && style.textContent.includes("background-image"));

  const tab = document.querySelector('.zen-library-tab[data-section="archived-tabs"]');
  console.log("tab element found:", !!tab, tab);
  if (!tab) {
    console.log("trying a broader search...");
    const all = [...document.querySelectorAll(".zen-library-tab")].map((t) => t.dataset.section);
    console.log("all .zen-library-tab data-section values:", all);
    return;
  }

  const iconImage = tab.querySelector(".zen-library-tab-icon-image");
  console.log("icon-image element found:", !!iconImage, iconImage);
  if (iconImage) {
    const cs = getComputedStyle(iconImage);
    console.log("computed background-image:", cs.backgroundImage);
    console.log("computed width/height:", cs.width, cs.height);
    console.log("computed -moz-context-properties:", cs.getPropertyValue("-moz-context-properties"));
  }
})();
