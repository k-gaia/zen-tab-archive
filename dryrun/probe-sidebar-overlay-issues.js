// dryrun/probe-sidebar-overlay-issues.js — self-correcting version: the
// previous run's header.click() actually COLLAPSED the section (it was
// already open from manual testing), producing another all-zero-rect
// result. This checks the real post-click state and clicks again if it
// guessed the wrong direction, instead of assuming collapsed-by-default.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(async () => {
  const header = [...document.querySelectorAll(".zag-header")].find((h) => {
    const m = h.querySelector(".zag-title")?.textContent?.match(/\((\d+)\)/);
    return m && Number(m[1]) > 8;
  });
  if (!header) {
    console.log("%cno workspace with >8 archived tabs found (visible ones, anyway)", "color:#f7768e");
    return;
  }
  console.log("using header:", header.querySelector(".zag-title")?.textContent);

  const section = header.closest(".zen-archive-ghost-section");
  const list = section.querySelector(".zag-list");

  const isExpanded = () => list.children.length > 0 && list.style.height && list.style.height !== "0px";

  if (!isExpanded()) {
    header.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!isExpanded()) {
    // First click went the wrong way (was actually already open) -- click
    // again rather than assume.
    header.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log("expanded now:", isExpanded(), "| list.style.height:", list.style.height, "| row count:", list.children.length);

  console.log("%c== geometry ==", "font-weight:bold;color:#7aa2f7");
  const fadeTop = section.querySelector(".zag-fade-top");
  const fadeBottom = section.querySelector(".zag-fade-bottom");
  const wrap = section.querySelector(".zag-list-wrap");
  console.log("arrowscrollbox rect:", list.getBoundingClientRect());
  console.log(".zag-list-wrap rect:", wrap.getBoundingClientRect());
  console.log("fadeTop rect:", fadeTop.getBoundingClientRect());
  console.log("fadeBottom rect:", fadeBottom.getBoundingClientRect());
  console.log("fadeTop computed display/opacity:", getComputedStyle(fadeTop).display, getComputedStyle(fadeTop).opacity);

  const sidebarBox = document.getElementById("tabbrowser-tabbox")?.closest("box, vbox, hbox, div") ?? document.getElementById("browser");
  console.log("a broad sidebar-area reference rect:", sidebarBox?.getBoundingClientRect());
  console.log("<zen-workspace> ancestor rect:", header.closest("zen-workspace")?.getBoundingClientRect());
})();
