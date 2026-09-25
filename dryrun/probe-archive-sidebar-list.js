// dryrun/probe-archive-sidebar-list.js — read-only probe of the archive
// sidebar's arrowscrollbox, to find out (1) why the last row still clips
// (checking if .scrollbutton-up/-down are really the right class names) and
// (2) why the fade overlay isn't visibly painting. Run this with a
// workspace's "Archived Tabs" section EXPANDED (click it open first).
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const activeId = gZenWorkspaces.activeWorkspace;
  const workspaceEl = document.getElementById(activeId);
  const section = workspaceEl?.querySelector(".zen-archive-ghost-section");
  if (!section) {
    console.log("%cno archive section found on the active workspace", "color:#f7768e");
    return;
  }

  const list = section.querySelector(".zag-list");
  const wrap = section.querySelector(".zag-list-wrap");
  const fadeTop = section.querySelector(".zag-fade-top");
  const fadeBottom = section.querySelector(".zag-fade-bottom");

  console.log("%clist (arrowscrollbox):", "font-weight:bold;color:#7aa2f7", list);
  console.log("list style.height:", list?.style.height);
  const listRect = list?.getBoundingClientRect();
  console.log("list getBoundingClientRect:", listRect);
  console.log("list clientHeight/scrollHeight:", list?.clientHeight, list?.scrollHeight);
  console.log("list children count:", list?.children.length);
  console.log("list direct children tag/class:", [...(list?.children ?? [])].map(c => `${c.tagName}.${c.className}`));

  console.log("%clooking for scroll buttons:", "font-weight:bold;color:#7aa2f7");
  console.log(".scrollbutton-up found:", list?.querySelector(".scrollbutton-up"));
  console.log(".scrollbutton-down found:", list?.querySelector(".scrollbutton-down"));
  console.log("any element with 'scroll' in class name:", [...(list?.querySelectorAll('[class*="scroll" i]') ?? [])].map(el => `${el.tagName}.${el.className}`));
  console.log("any element with 'button' in class/tag:", [...(list?.querySelectorAll('[class*="button" i]') ?? [])].map(el => `${el.tagName}.${el.className}`));

  console.log("%crow heights:", "font-weight:bold;color:#7aa2f7");
  const rows = [...(list?.querySelectorAll(".zag-row") ?? [])];
  console.log("row count:", rows.length, "each getBoundingClientRect().height:", rows.slice(0, 3).map(r => r.getBoundingClientRect().height));
  if (rows.length) {
    const first = rows[0].getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    console.log("first row top:", first.top, "last row bottom:", last.bottom, "listRect.top/bottom:", listRect?.top, listRect?.bottom);
  }

  console.log("%cfade overlays:", "font-weight:bold;color:#7aa2f7");
  console.log("wrap:", wrap, "wrap computed position:", wrap ? getComputedStyle(wrap).position : null);
  console.log("fadeTop:", fadeTop, "display:", fadeTop ? getComputedStyle(fadeTop).display : null, "background:", fadeTop?.style.background, "computed background-image:", fadeTop ? getComputedStyle(fadeTop).backgroundImage : null);
  console.log("fadeTop rect:", fadeTop?.getBoundingClientRect());
  console.log("fadeBottom rect:", fadeBottom?.getBoundingClientRect());
  console.log("workspaceEl computed backgroundColor:", getComputedStyle(workspaceEl).backgroundColor);
})();
