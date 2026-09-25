// dryrun/probe-workspace-element.js — read-only probe of the real
// <zen-workspace> DOM structure for the active workspace, to confirm where
// an "archived tabs" section could be safely appended (a sibling of
// tabsContainer/pinnedTabsContainer, not inside either) without touching
// Zen's own tab reorder/drag/count logic. Changes nothing.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const activeId = gZenWorkspaces.activeWorkspace;
  const el = document.getElementById(activeId);
  if (!el) {
    console.log("%ccould not find <zen-workspace> element for active workspace", "color:#f7768e");
    return;
  }

  console.log("%c<zen-workspace> element:", "font-weight:bold;color:#7aa2f7", el);
  console.log("tagName:", el.tagName, "id:", el.id, "class:", el.className);

  console.log("%cdirect children:", "font-weight:bold;color:#7aa2f7");
  console.table([...el.children].map((c) => ({
    tag: c.tagName,
    id: c.id,
    class: (c.className || "").toString().slice(0, 60),
    childCount: c.children.length,
  })));

  console.log("el.tabsContainer:", el.tabsContainer, "=== a direct child?", [...el.children].includes(el.tabsContainer));
  console.log("el.pinnedTabsContainer:", el.pinnedTabsContainer, "=== a direct child?", [...el.children].includes(el.pinnedTabsContainer));

  console.log("%ccomputed transform (should show the active-workspace positioning):", "font-weight:bold;color:#7aa2f7");
  console.log(getComputedStyle(el).transform);

  // Sanity check: does appending a harmless test div break anything visible?
  // (It's appended then immediately removed — nothing persists.)
  const probe = document.createElement("div");
  probe.textContent = "probe";
  probe.style.cssText = "opacity:0;pointer-events:none;height:0;";
  el.appendChild(probe);
  console.log("appended+removed a test div as last child with no error:", true);
  probe.remove();
})();
