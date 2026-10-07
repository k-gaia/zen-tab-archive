// archiveLibrarySection.uc.js — a section in Zen 1.23b's new Library
// feature (<zen-library>), showing the same cross-workspace archived-tabs
// view as the popup (archiveView.uc.js), just homed in the Library instead
// of a toolbar popup.
//
// A Sine "window script" (.uc.js), same loading model as the other two UI
// files — runs directly in the browser window's own scope, gBrowser/
// gZenWorkspaces/document are bare globals.
//
// Confirmed live (dryrun/probe-zen-library.js) before writing this:
//   - <zen-library> is a PERMANENT element (always in the DOM, toggled via
//     an `open` attribute, not created on demand) -- parent chain
//     #browser > #zen-main-app-wrapper > body > #main-window.
//   - It's a real LitElement (has requestUpdate()).
//   - zenLibrarySections is a plain object on the instance: no public
//     registration API, just {media, downloads, boosts, spaces, history} --
//     we add our own key and call requestUpdate() to force a re-render.
//   - No shadow DOM -- light DOM, so plain global CSS works here the same
//     as the popup and sidebar.
//
// NOT using lit or MozLitElement, despite Zen's own sections doing so --
// confirmed live this throws "ReferenceError: document is not defined"
// (chrome://global/content/vendor/lit.all.mjs's own top-level code touches
// document). ChromeUtils.importESModule ALWAYS gives a privileged
// module-global scope with no document/window, no matter who calls it or
// when -- the exact same limitation archiver.sys.mjs hit early in this
// project. Zen's own ZenLibrary.mjs avoids this because it's compiled into
// the browser at build time through a privileged loading path we don't have
// at runtime. Checked ZenLibrary.mjs's own render() first: the tab icon in
// the sidebar list is built straight from static id/label, no render() call
// needed; the content area only calls Section.render(library) once a tab is
// first opened, and accepts a plain DOM Node (not just a lit TemplateResult)
// as an embeddable child. So we just build a plain Node, the same way the
// popup and sidebar already do, and skip lit entirely.
//
// Section.label is a Fluent l10n id (confirmed: Zen's own sections use ids
// like "library-history-section-title", resolved via data-l10n-id in
// <zen-library>'s own template) -- not plain text.
//
// First attempt called document.l10n.addResourceIds() with the .ftl file's
// full absolute chrome:// path, which produced "Missing resource in locale
// en-US/en-GB" warnings -- addResourceIds() treats its argument as a
// resource id to resolve against REGISTERED locale sources, not an
// arbitrary absolute URL; passing the full path meant it tried (and failed)
// to find a source covering an id that looks like that, for every
// negotiated locale. The real mechanism (confirmed from dom/webidl/
// Localization.webidl's doc comments and Mozilla's own L10nFileSource.
// createMock() test-writing docs) is to register an actual L10nFileSource
// -- name, a metasource category, the locales it covers, and a prePath
// URL TEMPLATE containing a {locale} placeholder -- then add the resource
// by its RELATIVE filename, which gets resolved against that template.
// L10nRegistry/L10nFileSource are WebIDL [Exposed=Window] interfaces, same
// as Localization itself (document.l10n), so they're real bare globals in
// our window-scoped script -- no ChromeUtils.importESModule needed, so
// this doesn't risk the same "document is not defined" class of failure
// lit.all.mjs hit.

(() => {
  const archiver = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const FTL_SOURCE_NAME = "zen-tab-archive";
  const FTL_PRE_PATH = "chrome://sine/content/zen-tab-archive/src/locale/{locale}/";
  const FTL_RESOURCE_ID = "zen-tab-archive.ftl";
  const SECTION_ID = "archived-tabs";
  const STYLE_ID = "zen-archive-library-style";

  function fmtRelative(ms) {
    const diff = Date.now() - ms;
    const h = diff / 3.6e6;
    if (h < 1) return `${Math.max(1, Math.round(diff / 6e4))}m ago`;
    if (h < 48) return `${h.toFixed(1)}h ago`;
    return `${(h / 24).toFixed(1)}d ago`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Same token set as the popup/sidebar -- see their CSS comments for where
  // these come from (Zen's own zen-theme.css/zen-buttons.css/zen-popup.css).
  const CSS = `
    .zal-root {
      --zal-radius: calc(var(--zen-border-radius, 7px) * var(--zen-squircle-value, 1.3));
      --zal-radius-sm: calc(var(--zal-radius) * 0.65);
      --zal-corner: superellipse(var(--zen-squircle-value, 1.3));
      display: flex;
      flex-direction: column;
      height: 100%;
      font: menu;
      font-size: 13px;
    }
    .zal-search {
      flex: 0 0 auto;
      padding: 10px;
      border-bottom: 1px solid var(--zen-colors-border, ThreeDShadow);
    }
    .zal-search input {
      width: 100%;
      box-sizing: border-box;
      appearance: none;
      padding: 7px 10px;
      border-radius: var(--zal-radius);
      corner-shape: var(--zal-corner);
      border: 1px solid var(--zen-colors-border, ThreeDShadow);
      background: var(--zen-colors-input-bg, Field);
      color: inherit;
      font: inherit;
    }
    .zal-list { flex: 1 1 auto; overflow-y: auto; padding: 8px; }
    .zal-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      margin-top: 4px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.7;
      cursor: pointer;
      border-radius: var(--zal-radius-sm);
    }
    .zal-group-header:hover { opacity: 1; background: var(--zen-colors-hover-bg, color-mix(in srgb, AccentColor 8%, transparent)); }
    .zal-chevron { display: inline-block; width: 10px; text-align: center; }
    .zal-clear-all {
      opacity: 0;
      transition: opacity 0.1s;
      appearance: none;
      font: inherit;
      font-size: 10.5px;
      font-weight: 500;
      padding: 3px 8px;
      margin-left: auto;
      border-radius: var(--zal-radius-sm);
      corner-shape: var(--zal-corner);
      border: none;
      background: var(--zen-colors-secondary, ButtonFace);
      color: inherit;
      cursor: pointer;
    }
    .zal-group-header:hover .zal-clear-all { opacity: 1; }
    .zal-clear-all:hover { background: color-mix(in srgb, #ff5f57 22%, var(--zen-colors-secondary, ButtonFace)); }
    .zal-row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: var(--zal-radius-sm);
      corner-shape: var(--zal-corner);
    }
    .zal-row:hover { background: var(--zen-colors-hover-bg, color-mix(in srgb, AccentColor 12%, transparent)); }
    .zal-favicon {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      border-radius: 4px;
      background: var(--zen-colors-border, ThreeDShadow);
      filter: grayscale(0.45) brightness(0.9);
      transition: filter 0.15s;
    }
    .zal-row:hover .zal-favicon { filter: none; }
    .zal-meta { flex: 1 1 auto; min-width: 0; }
    .zal-title { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .zal-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; opacity: 0.55; }
    .zal-row:hover .zal-meta {
      mask-image: linear-gradient(to left, transparent 0, transparent 96px, black 116px);
    }
    .zal-actions {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .zal-row:hover .zal-actions { opacity: 1; }
    .zal-actions button {
      appearance: none;
      font: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 9px;
      border-radius: var(--zal-radius-sm);
      corner-shape: var(--zal-corner);
      border: none;
      color: inherit;
      cursor: pointer;
    }
    .zal-actions .zal-restore {
      background: color-mix(in srgb, var(--zen-accent-button-background, AccentColor) 20%, var(--zen-colors-secondary, ButtonFace));
      color: var(--zen-accent-button-color, var(--zen-accent-button-background, AccentColor));
    }
    .zal-actions .zal-forget { background: var(--zen-colors-secondary, ButtonFace); }
    .zal-actions .zal-forget:hover { background: color-mix(in srgb, #ff5f57 22%, var(--zen-colors-secondary, ButtonFace)); }
    .zal-empty { padding: 32px 10px; text-align: center; opacity: 0.5; font-size: 12.5px; }
  `;

  function ensureStyle() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElementNS(HTML_NS, "style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  // Workspace ids the user has expanded -- module-scope, persists across
  // re-renders the same way the popup's expandedGroups does.
  const expandedGroups = new Set();

  function makeRow(record, rerender) {
    const row = document.createElementNS(HTML_NS, "div");
    row.className = "zal-row";

    const icon = document.createElementNS(HTML_NS, "img");
    icon.className = "zal-favicon";
    if (record.favicon) icon.src = record.favicon;

    const meta = document.createElementNS(HTML_NS, "div");
    meta.className = "zal-meta";
    const title = document.createElementNS(HTML_NS, "div");
    title.className = "zal-title";
    title.textContent = record.title || record.url;
    const sub = document.createElementNS(HTML_NS, "div");
    sub.className = "zal-sub";
    sub.textContent = `${hostOf(record.url)} · ${fmtRelative(record.archivedAt)}`;
    meta.append(title, sub);

    const actions = document.createElementNS(HTML_NS, "div");
    actions.className = "zal-actions";

    const restoreBtn = document.createElementNS(HTML_NS, "button");
    restoreBtn.className = "zal-restore";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      await archiver.restore(record.id);
      rerender();
    });

    const forgetBtn = document.createElementNS(HTML_NS, "button");
    forgetBtn.className = "zal-forget";
    forgetBtn.textContent = "Forget";
    forgetBtn.addEventListener("click", async () => {
      forgetBtn.disabled = true;
      await archiver.forget(record.id);
      rerender();
    });

    actions.append(restoreBtn, forgetBtn);
    row.append(icon, meta, actions);
    return row;
  }

  async function renderInto(root, filterValue = "") {
    const list = root.querySelector(".zal-list");
    list.textContent = "";

    const records = await archiver.list();
    const q = filterValue.trim().toLowerCase();
    const filtered = q
      ? records.filter((r) => (r.title || "").toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
      : records;

    if (filtered.length === 0) {
      const empty = document.createElementNS(HTML_NS, "div");
      empty.className = "zal-empty";
      empty.textContent = records.length === 0 ? "No archived tabs yet." : "No matches.";
      list.appendChild(empty);
      return;
    }

    const wsNames = new Map(
      (gZenWorkspaces._workspaceCache ?? []).map((ws) => [ws.uuid, `${ws.icon ?? ""} ${ws.name}`.trim()])
    );

    const groups = new Map();
    for (const r of filtered) {
      const key = r.workspaceId || "(unknown)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const rows of groups.values()) rows.sort((a, b) => b.archivedAt - a.archivedAt);

    const rerender = () => renderInto(root, root.querySelector(".zal-search input")?.value ?? "");

    for (const [wsId, rows] of groups) {
      const isExpanded = expandedGroups.has(wsId);

      const header = document.createElementNS(HTML_NS, "div");
      header.className = "zal-group-header";
      const chevron = document.createElementNS(HTML_NS, "span");
      chevron.className = "zal-chevron";
      chevron.textContent = isExpanded ? "▾" : "▸";
      const label = document.createElementNS(HTML_NS, "span");
      label.textContent = `${wsNames.get(wsId) ?? wsId} (${rows.length})`;

      const clearBtn = document.createElementNS(HTML_NS, "button");
      clearBtn.className = "zal-clear-all";
      clearBtn.textContent = "Forget all";
      clearBtn.title = `Permanently discard all ${rows.length} archived tabs in this workspace`;
      clearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Permanently forget all ${rows.length} archived tabs in "${wsNames.get(wsId) ?? wsId}"? This can't be undone.`)) return;
        clearBtn.disabled = true;
        await Promise.all(rows.map((r) => archiver.forget(r.id)));
        rerender();
      });

      header.append(chevron, label, clearBtn);
      header.addEventListener("click", () => {
        if (expandedGroups.has(wsId)) expandedGroups.delete(wsId);
        else expandedGroups.add(wsId);
        rerender();
      });
      list.appendChild(header);

      if (isExpanded) {
        for (const record of rows) list.appendChild(makeRow(record, rerender));
      }
    }
  }

  function buildSectionNode() {
    const root = document.createElementNS(HTML_NS, "div");
    root.className = "zen-library-section zal-root";
    root.dataset.section = SECTION_ID;

    const searchWrap = document.createElementNS(HTML_NS, "div");
    searchWrap.className = "zal-search";
    const input = document.createElementNS(HTML_NS, "input");
    input.type = "search";
    input.placeholder = "Search archived tabs…";
    input.addEventListener("input", () => renderInto(root, input.value));
    searchWrap.appendChild(input);

    const list = document.createElementNS(HTML_NS, "div");
    list.className = "zal-list";

    root.append(searchWrap, list);
    renderInto(root);
    return root;
  }

  // Matches Zen's own section contract (confirmed from ZenLibraryBoostsSection
  // etc.): static id/label read by the sidebar tab list, static render(library)
  // called once the tab is first opened. No customElements.define, no
  // MozLitElement -- see the file header for why.
  class ZenArchiveLibrarySection {
    static id = SECTION_ID;
    static label = "zen-tab-archive-library-section-title";
    static render() {
      return buildSectionNode();
    }
  }

  function registerFluentSource() {
    try {
      const registry = L10nRegistry.getInstance();
      const source = new L10nFileSource(FTL_SOURCE_NAME, "app", ["en-US"], FTL_PRE_PATH);
      // Re-registering the same name on every reload would throw -- update
      // in place if it's already there (same stale-reload lesson as
      // everywhere else in this project).
      if (registry.hasSource(FTL_SOURCE_NAME)) {
        registry.updateSources([source]);
      } else {
        registry.registerSources([source]);
      }
      document.l10n?.addResourceIds([FTL_RESOURCE_ID]);
      console.log("[zen-tab-archive/library] Fluent source registered OK");
    } catch (err) {
      console.log("[zen-tab-archive/library] Fluent registration FAILED:", err.message, err);
    }
  }

  function install() {
    ensureStyle();
    registerFluentSource();

    const tryInstall = () => {
      const lib = document.querySelector("zen-library");
      console.log("[zen-tab-archive/library] <zen-library> found:", !!lib);
      if (!lib) return false;
      console.log("[zen-tab-archive/library] zenLibrarySections before:", lib.zenLibrarySections ? Object.keys(lib.zenLibrarySections) : lib.zenLibrarySections);
      if (!lib.zenLibrarySections) return false;
      lib.zenLibrarySections = { ...lib.zenLibrarySections, [SECTION_ID]: ZenArchiveLibrarySection };
      console.log("[zen-tab-archive/library] zenLibrarySections after:", Object.keys(lib.zenLibrarySections));
      console.log("[zen-tab-archive/library] has requestUpdate:", typeof lib.requestUpdate === "function");
      lib.requestUpdate?.();
      return true;
    };

    if (tryInstall()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (tryInstall() || attempts > 20) clearInterval(timer);
    }, 500);
  }

  window.ZenTabArchive = window.ZenTabArchive || {};
  window.ZenTabArchive.librarySection = { install, Section: ZenArchiveLibrarySection };
  install();
})();
