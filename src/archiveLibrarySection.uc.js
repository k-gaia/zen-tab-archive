// archiveLibrarySection.uc.js — a section in Zen 1.23b's new Library
// feature (<zen-library>), showing archived tabs grouped by workspace with
// search/filter. Replaced the earlier toolbar-popup (archiveView.uc.js) and
// per-workspace sidebar ghost-tabs section (archiveSidebar.uc.js), both
// removed once this covered both their use cases in one place.
//
// A Sine "window script" (.uc.js) — runs directly in the browser window's
// own scope, gBrowser/gZenWorkspaces/document are bare globals.
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
    /* Search box + filter button/panel dropped in favour of reusing Zen's
       own real markup and classes (.zen-library-search-top/-header/-box/
       -filter-*, confirmed from ZenLibrarySearchSection.mjs, the shared
       base all of Zen's own sections render through) -- those are styled
       globally by zen-library.css, not scoped to any particular
       data-section, so we get the real pill search box, filter chip
       panel, and open/close height animation for free instead of
       hand-rolling CSS for them. */
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
    /* Dropped the earlier approach (reusing the plain, fill-only
       history.svg + hand-tuned opacity/fill overrides to fake a
       selected/unselected contrast) after going back to Zen's real
       source. Its library icons are 36-frame sprite sheets built with a
       genuine two-channel construction -- confirmed from
       library-history-sprite.svg: every shape drawn twice, once
       fill="context-fill" and once stroke="context-stroke"
       stroke-width="7.1" -- so Zen's native CSS (fill hidden while
       inactive, stroke always visible, filled in when active) just
       works. src/icons/archived-tabs.svg follows the same two-channel
       construction, as a single static frame instead of a 36-frame
       sprite, so no color overrides are needed at all here -- only the
       two things that are genuinely about frame count, not color:
       - width: the base rule sizes icon-image to 36 * one frame
         unconditionally (confirmed via probe: 1008px computed width
         against a 20px height for a single-frame image, stretched
         illegibly thin by background-size: 100% 100%) -- we have one
         frame, so set width back to match it.
       - the [animate] sprite-step animation (translateX 0 to -35 * one
         frame width, steps(36, jump-none)) assumes a sprite sliding
         behind a fixed clip window -- with no sprite, that same
         translateX just drags our one frame off to the side and snaps
         back when [animate] is removed (confirmed live: "disappears,
         then flashes back" on selection). No sprite, so no reason to
         run it. */
    [data-section="archived-tabs"] :is(.zen-library-tab-icon-image, .empty-state-icon-image) {
      background-image: url("chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg");
      width: var(--zen-library-sprite-size);
    }
    /* Zen's [animate] sprite-step animation (translateX across 36 hand-drawn
       frames, steps(36, jump-none), 0.583s -- see zen-library.css) assumes a
       sprite; with one static frame it just drags the icon off to the side
       and snaps back (the "disappears then flashes back" bug). Hand-drawing
       36 frames for a 2-shape glyph isn't worth it, so this swaps in a
       transform-only "pop" instead: same trigger ([animate], same
       prefers-reduced-motion guard Zen's own rule uses), same rough duration,
       no sprite assumption. */
    @media (prefers-reduced-motion: no-preference) {
      .zen-library-tab[animate][data-section="archived-tabs"] .zen-library-tab-icon-image {
        animation: zen-tab-archive-icon-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
    }
    @keyframes zen-tab-archive-icon-pop {
      from { transform: scale(0.75); }
      60% { transform: scale(1.12); }
      to { transform: scale(1); }
    }
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

  // "When archived" filter, same semantics/day-thresholds as Zen's own
  // History section (WHEN_DAYS in ZenLibrarySearchSection.mjs: today=1,
  // week=7, month=30) -- null means no filter active. Module-scope, same
  // persistence pattern as expandedGroups.
  const WHEN_DAYS = { today: 1, week: 7, month: 30 };
  let activeWhen = null;

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
    const textFiltered = q
      ? records.filter((r) => (r.title || "").toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
      : records;
    const cutoff = activeWhen ? Date.now() - WHEN_DAYS[activeWhen] * 86400000 : null;
    const filtered = cutoff ? textFiltered.filter((r) => r.archivedAt >= cutoff) : textFiltered;

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

    const rerender = () => renderInto(root, root.querySelector(".zen-library-search-box input")?.value ?? "");

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

  // Builds a Zen library icon <img>, same convention used throughout
  // zen-library.css (-moz-context-properties recoloring applies to these
  // automatically since they're Zen's own chrome://browser/skin icons).
  function libraryIcon(path) {
    const img = document.createElementNS(HTML_NS, "img");
    img.src = `chrome://browser/skin/zen-icons/${path}`;
    img.alt = "";
    return img;
  }

  // Reuses Zen's own real search/filter markup and classes (confirmed
  // from ZenLibrarySearchSection.mjs, the shared base all of Zen's own
  // library sections render through) instead of a custom search box, so
  // it gets Zen's real pill styling, filter-chip panel, and open/close
  // height animation for free. library-filter-button/-done/-today/-week/
  // -month are Zen's OWN existing Fluent ids (already registered app-wide
  // since History/Downloads/etc use them) -- only the section title, the
  // search placeholder, and the filter panel's own title are ours.
  function buildSectionNode() {
    const root = document.createElementNS(HTML_NS, "div");
    root.className = "zen-library-section zal-root";
    root.dataset.section = SECTION_ID;

    const searchTop = document.createElementNS(HTML_NS, "div");
    searchTop.className = "zen-library-search-top";

    const searchHeader = document.createElementNS(HTML_NS, "div");
    searchHeader.className = "zen-library-search-header";

    const searchBox = document.createElementNS(HTML_NS, "div");
    searchBox.className = "zen-library-search-box";
    const input = document.createElementNS(HTML_NS, "input");
    input.type = "search";
    input.setAttribute("data-l10n-id", "zen-tab-archive-search-placeholder");
    input.addEventListener("input", () => renderInto(root, input.value));
    searchBox.append(libraryIcon("search-glass.svg"), input);

    const filterButton = document.createElementNS(HTML_NS, "button");
    filterButton.className = "zen-library-filter-button";
    const filterButtonLabel = document.createElementNS(HTML_NS, "span");
    filterButtonLabel.setAttribute("data-l10n-id", "library-filter-button");
    filterButton.append(libraryIcon("circle-bars-filter.svg"), filterButtonLabel);

    searchHeader.append(searchBox, filterButton);
    // searchHeader and filterHeader share the same CSS grid cell (stacked
    // via grid-area: 1/1 in zen-library.css) and are told apart only by
    // opacity -- neither gets pointer-events:none when hidden. Zen's real
    // ZenLibrarySearchSection instead toggles the `inert` attribute on
    // whichever one is currently invisible (confirmed from its render()):
    // inert removes a subtree from hit-testing/focus entirely. Without this,
    // filterHeader (appended after searchHeader, so painted on top) swallows
    // every click aimed at the search box/filter button underneath it.
    searchHeader.inert = false;

    const filterHeader = document.createElementNS(HTML_NS, "div");
    filterHeader.className = "zen-library-filter-header";
    filterHeader.inert = true;
    const filterTitle = document.createElementNS(HTML_NS, "h2");
    filterTitle.setAttribute("data-l10n-id", "zen-tab-archive-filter-title");
    const doneButton = document.createElementNS(HTML_NS, "button");
    doneButton.className = "zen-library-filter-done";
    doneButton.setAttribute("data-l10n-id", "library-filter-done");
    filterHeader.append(filterTitle, doneButton);

    const filterPanel = document.createElementNS(HTML_NS, "div");
    filterPanel.className = "zen-library-filter-panel";
    const filterPanelInner = document.createElementNS(HTML_NS, "div");
    filterPanelInner.className = "zen-library-filter-panel-inner";
    filterPanelInner.inert = true;
    const filterGroup = document.createElementNS(HTML_NS, "div");
    filterGroup.className = "zen-library-filter-group";
    const groupTitle = document.createElementNS(HTML_NS, "h3");
    groupTitle.setAttribute("data-l10n-id", "zen-tab-archive-filter-when");
    const filterOptions = document.createElementNS(HTML_NS, "div");
    filterOptions.className = "zen-library-filter-options";

    for (const [key, l10nId] of [
      ["today", "library-filter-today"],
      ["week", "library-filter-week"],
      ["month", "library-filter-month"],
    ]) {
      const chip = document.createElementNS(HTML_NS, "button");
      chip.className = "zen-library-filter-chip";
      chip.dataset.when = key;
      const chipLabel = document.createElementNS(HTML_NS, "span");
      chipLabel.setAttribute("data-l10n-id", l10nId);
      chip.appendChild(chipLabel);
      chip.addEventListener("click", () => {
        activeWhen = activeWhen === key ? null : key;
        for (const c of filterOptions.children) c.toggleAttribute("active", c.dataset.when === activeWhen);
        renderInto(root, input.value);
      });
      filterOptions.appendChild(chip);
    }

    filterGroup.append(groupTitle, filterOptions);
    filterPanelInner.appendChild(filterGroup);
    filterPanel.appendChild(filterPanelInner);

    filterButton.addEventListener("click", () => {
      searchTop.setAttribute("open", "true");
      root.style.setProperty("--zen-library-filter-height", `${filterPanelInner.scrollHeight + 8}px`);
      searchHeader.inert = true;
      filterHeader.inert = false;
      filterPanelInner.inert = false;
    });
    doneButton.addEventListener("click", () => {
      searchTop.removeAttribute("open");
      searchHeader.inert = false;
      filterHeader.inert = true;
      filterPanelInner.inert = true;
    });

    searchTop.append(searchHeader, filterHeader, filterPanel);

    const list = document.createElementNS(HTML_NS, "div");
    list.className = "zal-list zen-library-search-results";

    root.append(searchTop, list);
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
    } catch (err) {
      console.log("[zen-tab-archive/library] Fluent registration FAILED:", err.message, err);
    }
  }

  function install() {
    ensureStyle();
    registerFluentSource();

    const tryInstall = () => {
      const lib = document.querySelector("zen-library");
      if (!lib || !lib.zenLibrarySections) return false;
      lib.zenLibrarySections = { ...lib.zenLibrarySections, [SECTION_ID]: ZenArchiveLibrarySection };
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
