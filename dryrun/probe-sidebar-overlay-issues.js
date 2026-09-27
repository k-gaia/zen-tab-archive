// dryrun/probe-sidebar-overlay-issues.js — auto-expands a workspace's
// "Archived Tabs" section itself (rather than relying on manual click
// timing, which produced an all-zero-rect result last time because the
// section was actually collapsed when the probe ran) and measures real
// geometry: the fade overlay's rect, the arrowscrollbox's rect, and -- via
// InspectorUtils, which can see anonymous content that document.* APIs
// can't -- the arrowscrollbox's native up/down arrow buttons' actual rects,
// to see exactly how much they overlap our fade zone.
//
// Run: Ctrl+Shift+J -> paste -> Enter. Finds the first workspace with more
// than 8 archived tabs and expands it automatically.

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

  const section = header.closest(`.${"zen-archive-ghost-section"}`);
  const list = section.querySelector(".zag-list");
  // Click to expand if not already (list.style.height is only set when expanded).
  if (!list.style.height || list.style.height === "0px") {
    header.click();
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log("%c== geometry ==", "font-weight:bold;color:#7aa2f7");
  const fadeTop = section.querySelector(".zag-fade-top");
  const fadeBottom = section.querySelector(".zag-fade-bottom");
  const wrap = section.querySelector(".zag-list-wrap");
  console.log("list.style.height:", list.style.height);
  console.log("arrowscrollbox rect:", list.getBoundingClientRect());
  console.log(".zag-list-wrap rect:", wrap.getBoundingClientRect());
  console.log("fadeTop rect:", fadeTop.getBoundingClientRect());
  console.log("fadeBottom rect:", fadeBottom.getBoundingClientRect());

  const sidebarBox = document.getElementById("browser") ?? document.getElementById("tabbrowser-tabbox")?.parentElement;
  console.log("a broad sidebar-area reference rect (#browser):", sidebarBox?.getBoundingClientRect());

  console.log("%c== arrowscrollbox native anonymous content (via InspectorUtils) ==", "font-weight:bold;color:#7aa2f7");
  if (typeof InspectorUtils !== "undefined") {
    try {
      const kids = InspectorUtils.getChildrenForNode(list, true, false);
      console.log("children (incl. anonymous), count:", kids.length);
      for (const kid of kids) {
        console.log(`  <${kid.tagName}${kid.className ? "." + kid.className : ""}>`, kid.getBoundingClientRect?.());
      }
    } catch (e) {
      console.log("InspectorUtils.getChildrenForNode failed:", e.message);
    }
  } else {
    console.log("InspectorUtils not available in this scope");
  }
})();
