// dryrun/probe-sidebar-overlay-issues.js — v3: scoped to the ACTIVE
// workspace specifically (gZenWorkspaces.activeWorkspace), not just the
// first >8-tab header found in DOM order -- the previous run measured an
// inactive, off-screen-translated workspace (x: -187, past the left edge
// of #browser), which explained why nothing looked "overflowing" there:
// it wasn't the panel actually visible on screen.
//
// Run: Ctrl+Shift+J -> paste -> Enter, on the workspace you can currently
// see (with its Archived Tabs section either state, expanded or not).

(async () => {
  const activeId = gZenWorkspaces.activeWorkspace;
  const workspaceEl = document.getElementById(activeId);
  if (!workspaceEl) {
    console.log("%ccould not find <zen-workspace> for the active workspace", "color:#f7768e");
    return;
  }
  const header = workspaceEl.querySelector(".zag-header");
  if (!header) {
    console.log("%cno .zag-header found on the active workspace -- does it have any archived tabs?", "color:#f7768e");
    return;
  }
  console.log("active workspace:", activeId, "| header:", header.querySelector(".zag-title")?.textContent);
  console.log("<zen-workspace> rect:", workspaceEl.getBoundingClientRect());

  const section = header.closest(".zen-archive-ghost-section");
  const list = section.querySelector(".zag-list");
  const isExpanded = () => list.children.length > 0 && list.style.height && list.style.height !== "0px";

  if (!isExpanded()) {
    header.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!isExpanded()) {
    header.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log("expanded now:", isExpanded(), "| row count:", list.children.length);

  console.log("%c== geometry (active workspace) ==", "font-weight:bold;color:#7aa2f7");
  const fadeTop = section.querySelector(".zag-fade-top");
  const fadeBottom = section.querySelector(".zag-fade-bottom");
  const wrap = section.querySelector(".zag-list-wrap");
  console.log("arrowscrollbox rect:", list.getBoundingClientRect());
  console.log(".zag-list-wrap rect:", wrap.getBoundingClientRect());
  console.log("fadeTop rect:", fadeTop.getBoundingClientRect());
  console.log("fadeBottom rect:", fadeBottom.getBoundingClientRect());

  // Compare against the real, visible sidebar width -- #tabbrowser-arrowscrollbox
  // is the OUTER scrollbox holding all 5 <zen-workspace> panels, a much more
  // reliable "what's actually visible" reference than #browser (the whole window).
  const outerScrollbox = document.getElementById("tabbrowser-arrowscrollbox");
  console.log("outer #tabbrowser-arrowscrollbox rect (the real visible sidebar area):", outerScrollbox?.getBoundingClientRect());
})();
