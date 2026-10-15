// archiveLibrarySection.uc.js — an "Archived Tabs" section in Zen's Library
// (<zen-library>): archived tabs grouped by workspace, with search, a
// "when archived" filter, multi-select, keyboard navigation and bulk
// restore/forget.
//
// A Sine window script (.uc.js): runs in each browser window's own scope,
// so gBrowser/gZenWorkspaces/document are bare globals.
//
// How it hooks into Zen (from Zen's ZenLibrary.mjs):
//   - <zen-library> is always in the DOM (toggled via an `open` attribute)
//     and is a LitElement rendering into light DOM, so global CSS applies.
//   - zenLibrarySections is a plain object with no registration API: we
//     add our own key and call requestUpdate().
//   - The sidebar tab is built from the section's static id/label; the
//     content area calls Section.render(library) and accepts a plain DOM
//     Node, so this builds plain DOM and doesn't use lit. (Importing lit
//     from here fails: ChromeUtils.importESModule gives a module scope
//     with no document, and lit touches document at load.)
//
// Section.label is a Fluent id. Our .ftl is registered as an
// L10nFileSource whose prePath has a {locale} placeholder, then added to
// document.l10n by relative filename; addResourceIds() with an absolute
// chrome:// path doesn't resolve.

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

  // Time until the archiver's retention rule deletes a record, rounded down
  // so it never overstates what's left.
  function fmtLeft(archivedAt, keepMs) {
    const left = archivedAt + keepMs - Date.now();
    if (left >= 864e5) return `${Math.floor(left / 864e5)}d left`;
    return `${Math.max(1, Math.floor(left / 3.6e6))}h left`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Zen's own design tokens (zen-theme.css/zen-buttons.css), with fallbacks.
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
    /* The search box and filter panel reuse Zen's own markup and classes
       (.zen-library-search-*, .zen-library-filter-*), which zen-library.css
       styles globally, so they need no CSS here. */
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
    .zal-row, .zal-group-header { user-select: none; }
    .zal-row[selected] { background: color-mix(in srgb, var(--zen-primary-color, AccentColor) 22%, transparent); }
    .zal-row[selected]:hover { background: color-mix(in srgb, var(--zen-primary-color, AccentColor) 30%, transparent); }
    .zal-row[selected] .zal-favicon { filter: none; }
    :is(.zal-row, .zal-group-header):focus-visible {
      outline: var(--focus-outline, 2px solid AccentColor);
      outline-offset: -2px;
    }
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
    .zal-row:is(:hover, :focus-visible) .zal-meta {
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
    .zal-row:is(:hover, :focus-visible) .zal-actions { opacity: 1; }
    :is(.zal-actions, .zal-selbar) button {
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
    :is(.zal-actions, .zal-selbar) .zal-restore {
      background: color-mix(in srgb, var(--zen-accent-button-background, AccentColor) 20%, var(--zen-colors-secondary, ButtonFace));
      color: var(--zen-accent-button-color, var(--zen-accent-button-background, AccentColor));
    }
    :is(.zal-actions, .zal-selbar) .zal-forget { background: var(--zen-colors-secondary, ButtonFace); }
    :is(.zal-actions, .zal-selbar) .zal-forget:hover { background: color-mix(in srgb, #ff5f57 22%, var(--zen-colors-secondary, ButtonFace)); }
    .zal-selbar {
      display: none;
      align-items: center;
      gap: 6px;
      margin: 0 8px 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--zal-radius);
      corner-shape: var(--zal-corner);
      background: var(--zen-colors-secondary, ButtonFace);
      font-size: 12px;
    }
    .zal-selbar[active] { display: flex; }
    .zal-selcount { margin-right: auto; font-weight: 600; }
    .zal-selbar .zal-selclear { background: transparent; opacity: 0.7; }
    .zal-selbar .zal-selclear:hover { opacity: 1; }
    .zal-empty { padding: 32px 10px; text-align: center; opacity: 0.5; font-size: 12.5px; }
    /* Zen's library icons are 36-frame sprites where every shape is drawn
       twice, once with fill="context-fill" and once with
       stroke="context-stroke", so its CSS can show an outline when inactive
       and a filled icon when active. archived-tabs.svg uses the same
       construction as a single frame, so only the width needs overriding:
       the base rule sizes the image to 36 frames. */
    [data-section="archived-tabs"] :is(.zen-library-tab-icon-image, .empty-state-icon-image) {
      background-image: url("chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg");
      width: var(--zen-library-sprite-size);
    }
    /* Zen's [animate] rule slides a sprite across its 36 frames; on a
       single frame that drags the icon out of view. Replace it with a
       transform-only "pop" on the same trigger and reduced-motion guard. */
    @media (prefers-reduced-motion: no-preference) {
      .zen-library-tab[animate][data-section="archived-tabs"] .zen-library-tab-icon-image {
        animation: zen-tab-archive-icon-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
    }
    /* The startup summary toast's "View" button (Zen's toast buttons are
       icon-only; their icon is set by id, as Zen does for its own). */
    #zen-tab-archive-summary-view {
      list-style-image: url("chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg");
      -moz-context-properties: fill, stroke;
      fill: transparent;
      stroke: currentColor;
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

  // Workspace groups the user has expanded; module scope so it survives
  // re-renders.
  const expandedGroups = new Set();

  // "When archived" filter, with the same day thresholds as Zen's History
  // section; null means no filter.
  const WHEN_DAYS = { today: 1, week: 7, month: 30 };
  let activeWhen = null;

  // Restore/Forget don't re-render here: the archiver's change notification
  // re-renders every open view (see install()).
  function makeRow(record, keepMs) {
    const row = document.createElementNS(HTML_NS, "div");
    row.className = "zal-row";
    row.dataset.id = record.id;
    row.tabIndex = -1;
    row.setAttribute("role", "option");

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
    const parts = [hostOf(record.url), fmtRelative(record.archivedAt)];
    if (keepMs) parts.push(fmtLeft(record.archivedAt, keepMs));
    sub.textContent = parts.join(" · ");
    meta.append(title, sub);

    const actions = document.createElementNS(HTML_NS, "div");
    actions.className = "zal-actions";

    const restoreBtn = document.createElementNS(HTML_NS, "button");
    restoreBtn.className = "zal-restore";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      await archiver.restore(record.id);
    });

    const forgetBtn = document.createElementNS(HTML_NS, "button");
    forgetBtn.className = "zal-forget";
    forgetBtn.textContent = "Forget";
    forgetBtn.addEventListener("click", async () => {
      forgetBtn.disabled = true;
      await archiver.forget(record.id);
    });

    // Not tab stops: Enter/Delete on the focused row do the same thing.
    restoreBtn.tabIndex = -1;
    forgetBtn.tabIndex = -1;
    actions.append(restoreBtn, forgetBtn);
    row.append(icon, meta, actions);
    return row;
  }

  const searchInput = (root) => root.querySelector(".zen-library-search-box input");

  // Renders can overlap (change notifications, typing, expand clicks), so
  // only the newest one for a root is allowed to touch the list.
  const renderGen = new WeakMap();

  async function renderInto(root, filterValue = "") {
    const gen = (renderGen.get(root) ?? 0) + 1;
    renderGen.set(root, gen);
    const records = await archiver.list();
    if (renderGen.get(root) !== gen) return;

    const list = root.querySelector(".zal-list");
    const hadFocus = list.contains(document.activeElement);
    list.textContent = "";
    const keepMs = archiver.retentionMs();
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
      afterRender(root, hadFocus);
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

    const rerender = () => renderInto(root, searchInput(root).value);

    for (const [wsId, rows] of groups) {
      const isExpanded = expandedGroups.has(wsId);

      const header = document.createElementNS(HTML_NS, "div");
      header.className = "zal-group-header";
      header.dataset.ws = wsId;
      header.tabIndex = -1;
      header.setAttribute("aria-expanded", String(isExpanded));
      const chevron = document.createElementNS(HTML_NS, "span");
      chevron.className = "zal-chevron";
      chevron.textContent = isExpanded ? "▾" : "▸";
      const label = document.createElementNS(HTML_NS, "span");
      label.textContent = `${wsNames.get(wsId) ?? wsId} (${rows.length})`;

      const clearBtn = document.createElementNS(HTML_NS, "button");
      clearBtn.className = "zal-clear-all";
      clearBtn.tabIndex = -1;
      clearBtn.textContent = "Forget all";
      clearBtn.title = `Permanently discard all ${rows.length} archived tabs in this workspace`;
      clearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Permanently forget all ${rows.length} archived tabs in "${wsNames.get(wsId) ?? wsId}"? This can't be undone.`)) return;
        clearBtn.disabled = true;
        await archiver.forgetMany(rows.map((r) => r.id));
      });

      header.append(chevron, label, clearBtn);
      header.addEventListener("click", () => {
        if (expandedGroups.has(wsId)) expandedGroups.delete(wsId);
        else expandedGroups.add(wsId);
        rerender();
      });
      list.appendChild(header);

      if (isExpanded) {
        for (const record of rows) list.appendChild(makeRow(record, keepMs));
      }
    }
    afterRender(root, hadFocus);
  }

  // --- Selection and keyboard navigation ---------------------------------
  // Zen's own Library sections have neither, so this follows file-manager
  // conventions. Selection only ever covers rows that are currently visible:
  // collapsing a group or filtering drops hidden rows from it, so bulk
  // actions never touch something you can't see.

  const ITEM_SEL = ".zal-group-header, .zal-row";
  const viewState = new WeakMap();

  function stateOf(root) {
    let st = viewState.get(root);
    if (!st) {
      st = { ids: new Set(), anchor: null, focusKey: null, focusIndex: 0 };
      viewState.set(root, st);
    }
    return st;
  }

  const keyOf = (el) => (el.dataset.id ? `row:${el.dataset.id}` : `ws:${el.dataset.ws}`);
  const navItems = (root) => [...root.querySelectorAll(ITEM_SEL)];
  const visibleRowIds = (root) => [...root.querySelectorAll(".zal-row")].map((r) => r.dataset.id);

  // Both ids are visible rows: afterRender clears an anchor that isn't.
  function rangeIds(root, fromId, toId) {
    const ids = visibleRowIds(root);
    const a = ids.indexOf(fromId);
    const b = ids.indexOf(toId);
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  function applySelection(root) {
    const st = stateOf(root);
    for (const row of root.querySelectorAll(".zal-row")) {
      const on = st.ids.has(row.dataset.id);
      row.toggleAttribute("selected", on);
      row.setAttribute("aria-selected", String(on));
    }
    const bar = root.querySelector(".zal-selbar");
    bar.toggleAttribute("active", st.ids.size > 0);
    bar.querySelector(".zal-selcount").textContent = `${st.ids.size} selected`;
  }

  function afterRender(root, hadFocus) {
    const st = stateOf(root);
    const visible = new Set(visibleRowIds(root));
    for (const id of st.ids) if (!visible.has(id)) st.ids.delete(id);
    if (!visible.has(st.anchor)) st.anchor = null;

    // Same item as before, or whatever now sits where it was (e.g. after
    // restoring the focused row).
    const items = navItems(root);
    const target =
      items.find((el) => keyOf(el) === st.focusKey) ?? items[Math.min(st.focusIndex, items.length - 1)];
    for (const el of items) el.tabIndex = el === target ? 0 : -1;
    applySelection(root);
    if (!hadFocus) return;
    if (target) target.focus();
    else searchInput(root).focus();
  }

  async function restoreSelection(root) {
    const st = stateOf(root);
    const ids = [...st.ids];
    st.ids.clear();
    applySelection(root);
    await archiver.restoreMany(ids);
  }

  async function forgetSelection(root, fallbackId) {
    const st = stateOf(root);
    const ids = st.ids.size ? [...st.ids] : [fallbackId];
    if (ids.length > 1 && !confirm(`Permanently forget ${ids.length} archived tabs? This can't be undone.`)) return;
    st.ids.clear();
    applySelection(root);
    await archiver.forgetMany(ids);
  }

  function onRowClick(root, e) {
    if (e.target.closest("button")) return;
    const row = e.target.closest(".zal-row");
    if (!row) return;
    const st = stateOf(root);
    const id = row.dataset.id;
    const accel = e.ctrlKey || e.metaKey;
    if (e.shiftKey && st.anchor) {
      if (!accel) st.ids.clear();
      for (const r of rangeIds(root, st.anchor, id)) st.ids.add(r);
    } else if (accel) {
      if (st.ids.has(id)) st.ids.delete(id);
      else st.ids.add(id);
      st.anchor = id;
    } else if (st.ids.size === 1 && st.ids.has(id)) {
      st.ids.clear(); // clicking the only selected row again deselects it
    } else {
      st.ids = new Set([id]);
      st.anchor = id;
    }
    applySelection(root);
  }

  function onListKey(root, e) {
    if (e.target.closest("button")) return;
    const cur = e.target.closest(ITEM_SEL);
    if (!cur) return;
    const st = stateOf(root);
    const items = navItems(root);
    const i = items.indexOf(cur);
    const isRow = cur.classList.contains("zal-row");
    const accel = e.ctrlKey || e.metaKey;

    const moveTo = (j, extend) => {
      const t = items[Math.max(0, Math.min(items.length - 1, j))];
      t.focus();
      if (extend && t.dataset.id) {
        st.anchor ??= isRow ? cur.dataset.id : t.dataset.id;
        st.ids = new Set(rangeIds(root, st.anchor, t.dataset.id));
        applySelection(root);
      }
    };

    switch (e.key) {
      case "ArrowDown":
        moveTo(i + 1, e.shiftKey);
        break;
      case "ArrowUp":
        moveTo(i - 1, e.shiftKey);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(items.length - 1);
        break;
      case "ArrowRight":
        if (isRow) return;
        if (cur.getAttribute("aria-expanded") === "false") cur.click();
        else moveTo(i + 1);
        break;
      case "ArrowLeft":
        if (!isRow && cur.getAttribute("aria-expanded") === "true") cur.click();
        else if (isRow) items.slice(0, i).reverse().find((el) => !el.dataset.id)?.focus();
        else return;
        break;
      case " ":
        if (!isRow) {
          cur.click();
          break;
        }
        if (st.ids.has(cur.dataset.id)) st.ids.delete(cur.dataset.id);
        else st.ids.add(cur.dataset.id);
        st.anchor = cur.dataset.id;
        applySelection(root);
        break;
      case "Enter":
        if (!isRow) cur.click();
        else if (st.ids.size > 1 || (st.ids.size === 1 && !st.ids.has(cur.dataset.id))) restoreSelection(root);
        else archiver.restore(cur.dataset.id); // a single tab: restore and switch to it
        break;
      case "Delete":
      case "Backspace":
        if (!isRow && !st.ids.size) return;
        forgetSelection(root, cur.dataset.id);
        break;
      case "a":
      case "A":
        if (!accel) return;
        st.ids = new Set(visibleRowIds(root));
        applySelection(root);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function libraryIcon(path) {
    const img = document.createElementNS(HTML_NS, "img");
    img.src = `chrome://browser/skin/zen-icons/${path}`;
    img.alt = "";
    return img;
  }

  // The search/filter markup mirrors Zen's ZenLibrarySearchSection so it
  // picks up Zen's styling and animations. The library-filter-* Fluent ids
  // are Zen's own; only the section title, placeholder and filter titles
  // are ours.
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
    // searchHeader and filterHeader share one CSS grid cell and are told
    // apart only by opacity, so whichever is hidden must be `inert` (as in
    // Zen's own section); otherwise the filter header, painted on top,
    // swallows clicks meant for the search box.
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
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-multiselectable", "true");
    list.addEventListener("click", (e) => onRowClick(root, e));
    list.addEventListener("dblclick", (e) => {
      const row = e.target.closest(".zal-row");
      if (row && !e.target.closest("button")) archiver.restore(row.dataset.id);
    });
    list.addEventListener("keydown", (e) => onListKey(root, e));
    // Roving tabindex: whichever item has focus is the one Tab returns to.
    list.addEventListener("focusin", (e) => {
      const item = e.target.closest(ITEM_SEL);
      if (!item) return;
      const st = stateOf(root);
      const items = navItems(root);
      st.focusKey = keyOf(item);
      st.focusIndex = items.indexOf(item);
      for (const el of items) el.tabIndex = el === item ? 0 : -1;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown") return;
      const first = navItems(root)[0];
      if (!first) return;
      e.preventDefault();
      first.focus();
    });

    const bar = document.createElementNS(HTML_NS, "div");
    bar.className = "zal-selbar";
    const count = document.createElementNS(HTML_NS, "span");
    count.className = "zal-selcount";
    const restoreSel = document.createElementNS(HTML_NS, "button");
    restoreSel.className = "zal-restore";
    restoreSel.textContent = "Restore";
    restoreSel.addEventListener("click", () => restoreSelection(root));
    const forgetSel = document.createElementNS(HTML_NS, "button");
    forgetSel.className = "zal-forget";
    forgetSel.textContent = "Forget";
    forgetSel.addEventListener("click", () => forgetSelection(root));
    const clearSel = document.createElementNS(HTML_NS, "button");
    clearSel.className = "zal-selclear";
    clearSel.textContent = "✕";
    clearSel.title = "Clear selection";
    clearSel.addEventListener("click", () => {
      stateOf(root).ids.clear();
      applySelection(root);
    });
    bar.append(count, restoreSel, forgetSel, clearSel);

    root.append(searchTop, list, bar);
    renderInto(root);
    return root;
  }

  // Zen's section contract: static id/label for the Library's tab list, and
  // static render() called when the tab is first opened.
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
      // Registering an existing name throws, e.g. when a second window loads
      // this script; update it in place instead.
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

  function watchArchiveChanges() {
    let pending = null;
    const observer = {
      observe() {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          for (const root of document.querySelectorAll(".zal-root")) renderInto(root, searchInput(root).value);
        }, 100);
      },
    };
    Services.obs.addObserver(observer, archiver.CHANGED_TOPIC);
    window.addEventListener("unload", () => Services.obs.removeObserver(observer, archiver.CHANGED_TOPIC), { once: true });
  }

  function install() {
    ensureStyle();
    registerFluentSource();
    watchArchiveChanges();

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
