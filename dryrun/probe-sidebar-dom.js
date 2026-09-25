// dryrun/probe-sidebar-dom.js — read-only probe of Zen's chrome DOM to find
// where the sidebar/workspace-switcher UI actually lives, so archiveView.mjs
// can be embedded there instead of floating as a detached arrow-panel.
// Changes nothing.
//
// Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const doc = document;

  function summarize(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string"
      ? `.${el.className.trim().split(/\s+/).join(".")}`
      : "";
    return `<${el.tagName.toLowerCase()}${id}${cls}>`;
  }

  console.log("%c-- elements with 'zen' in id --", "font-weight:bold;color:#7aa2f7");
  const zenIds = [...doc.querySelectorAll('[id*="zen" i]')];
  console.log(`count: ${zenIds.length}`);
  console.table(zenIds.map((el) => ({
    id: el.id,
    tag: el.tagName.toLowerCase(),
    parentId: el.parentElement?.id ?? "",
    class: (el.className || "").toString().slice(0, 60),
  })));

  console.log("%c-- elements with 'zen' in class (id-less) --", "font-weight:bold;color:#7aa2f7");
  const zenClasses = [...doc.querySelectorAll('[class*="zen" i]')].filter((el) => !el.id);
  console.log(`count: ${zenClasses.length}`);
  console.table(zenClasses.slice(0, 60).map((el) => ({
    tag: el.tagName.toLowerCase(),
    class: (el.className || "").toString().slice(0, 60),
    parent: summarize(el.parentElement ?? el),
  })));

  console.log("%c-- likely sidebar/workspace containers --", "font-weight:bold;color:#7aa2f7");
  const candidates = [
    "navigator-toolbox", "TabsToolbar", "tabbrowser-tabs", "sidebar-box",
    "browser-sidebar-container", "titlebar", "zen-sidebar-top-buttons",
    "zen-workspaces-button", "zen-current-workspace-indicator",
    "zen-appcontent-wrapper", "tabbrowser-arrowscrollbox",
  ];
  for (const id of candidates) {
    const el = doc.getElementById(id);
    console.log(id, "->", el ? summarize(el) : "NOT FOUND");
  }

  console.log("%c-- gZenWorkspaces DOM hook, if exposed --", "font-weight:bold;color:#7aa2f7");
  console.log("gZenWorkspaces.panel:", window.gZenWorkspaces?.panel);
  console.log("gZenWorkspaces.workspaceEl ?? _workspaceEl:", window.gZenWorkspaces?.workspaceEl ?? window.gZenWorkspaces?._workspaceEl);
  console.log(
    "own-property function/getter names on gZenWorkspaces mentioning 'panel' or 'popup' or 'sidebar':",
    Object.getOwnPropertyNames(Object.getPrototypeOf(window.gZenWorkspaces ?? {}))
      .filter((n) => /panel|popup|sidebar|button/i.test(n))
  );
})();
