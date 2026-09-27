// archiveView.uc.js — the master archive view. A privileged panel embedded
// directly in Zen's own chrome document (NOT a browser tab / webpage), so it
// keeps native access to gBrowser/archiver without any content-process
// principal boundary to work around.
//
// A Sine "window script" (.uc.js, listed in theme.json's `scripts`) — Sine
// loads this via Services.scriptloader.loadSubScriptWithOptions with
// target: <browser window>, once per browser window. That means it runs
// directly in that window's own global scope: gBrowser/gZenWorkspaces/
// document/SessionStore are real bare globals here, unlike the archiver.sys.mjs
// background module (or this file's own earlier dev-only .mjs incarnation),
// which had to resolve a window explicitly via Services.wm.getMostRecentWindow
// since ES modules get their own module-global scope, not a window's.
//
// Shows every archived tab, grouped by workspace (via
// gZenWorkspaces._workspaceCache for name/icon), newest-first within each
// group, with a live search box and per-row Restore / Forget actions.

(() => {
  // Sine serves each mod's files under chrome://sine/content/<mod-id>/...
  // (matching the real disk layout: chrome/sine-mods/<mod-id>/src/...) --
  // the mod id prefix is required, confirmed after "Failed to load
  // chrome://sine/content/src/archiver.sys.mjs" errors from omitting it.
  const archiver = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const PANEL_ID = "zen-archive-panel";
  const BUTTON_ID = "zen-archive-button";

  // Confirmed via Zen's own source (src/browser/base/content/zen-sidebar-icons.inc.xhtml):
  // the sidebar's bottom toolbar is #zen-sidebar-foot-buttons, holding the
  // expand-sidebar button, the workspace-icons switcher (#zen-workspaces-button),
  // and the "+" create-new button (#zen-create-new-button) — in that order.
  // Reusing their exact class list gives us native icon-button styling for free.
  function buildButton() {
    // Rebuild fresh rather than reusing an existing node -- cheap insurance
    // against a leftover button from a previous load (mod update, dev
    // force-reload) keeping stale event listeners bound to an old closure.
    document.getElementById(BUTTON_ID)?.remove();

    const footToolbar = document.getElementById("zen-sidebar-foot-buttons");
    if (!footToolbar) throw new Error("#zen-sidebar-foot-buttons not found — Zen UI may have changed");

    const btn = document.createXULElement("toolbarbutton");
    btn.id = BUTTON_ID;
    btn.className = "chromeclass-toolbar-additional toolbarbutton-1 zen-sidebar-action-button";
    btn.setAttribute("removable", "true");
    btn.setAttribute("tooltiptext", "Archived tabs");
    btn.setAttribute("image", "chrome://browser/skin/zen-icons/history.svg");
    btn.addEventListener("command", () => toggle());

    const createBtn = document.getElementById("zen-create-new-button");
    footToolbar.insertBefore(btn, createBtn ?? null);
    return btn;
  }

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

  // Time-bucket label for a workspace's row list -- Today/Yesterday/This
  // week/This month/Older. Rows are already sorted newest-first, so buckets
  // come out contiguous; this just labels where one bucket ends and the
  // next begins, instead of one flat list of potentially hundreds of rows.
  function bucketLabel(ms) {
    const days = (Date.now() - ms) / 8.64e7;
    if (days < 1) return "Today";
    if (days < 2) return "Yesterday";
    if (days < 7) return "This week";
    if (days < 30) return "This month";
    return "Older";
  }

  // Real Zen design tokens instead of generic system colors (Canvas/
  // ButtonFace/AccentColor/ThreeDShadow) -- confirmed from Zen's own
  // stylesheets (src/zen/common/styles/zen-theme.css, zen-buttons.css,
  // zen-popup.css): --zen-colors-primary/secondary/tertiary, a dedicated
  // --zen-colors-hover-bg and --zen-colors-input-bg, --zen-colors-border,
  // and --zen-border-radius scaled by --zen-squircle-value (their actual
  // corner-shape system -- Zen uses `corner-shape: superellipse()` for true
  // squircles, not just border-radius). The panel itself already inherits
  // Zen's native --panel-background-color/--panel-border-radius as a real
  // <panel type="arrow">; the previous CSS was overriding all of that with
  // generic system colors on our own inner content, which is what actually
  // made it look like a generic dialog instead of part of Zen.
  const CSS = `
    #${PANEL_ID} {
      --zav-radius: calc(var(--zen-border-radius, 7px) * var(--zen-squircle-value, 1.3));
      --zav-radius-sm: calc(var(--zav-radius) * 0.65);
      --zav-corner: superellipse(var(--zen-squircle-value, 1.3));
    }
    .zav-root {
      display: flex;
      flex-direction: column;
      width: 420px;
      max-height: 70vh;
      font: menu;
      font-size: 13px;
      background: var(--panel-background-color, var(--zen-colors-primary, Canvas));
      color: var(--zen-colors-primary-foreground, CanvasText);
      /* Rounds to match the outer <panel>'s own native corner radius
         instead of being a flat rectangle bleeding out from inside a
         rounded frame -- the panel itself is already rounded (inherited
         from Zen's --panel-border-radius), this is our own inner content. */
      border-radius: var(--panel-border-radius, var(--zav-radius));
      overflow: hidden;
    }
    .zav-search {
      flex: 0 0 auto;
      padding: 10px;
      border-bottom: 1px solid var(--zen-colors-border, ThreeDShadow);
    }
    .zav-search input {
      width: 100%;
      box-sizing: border-box;
      appearance: none;
      padding: 7px 10px;
      border-radius: var(--zav-radius);
      corner-shape: var(--zav-corner);
      border: 1px solid var(--zen-colors-border, ThreeDShadow);
      background: var(--zen-colors-input-bg, Field);
      color: inherit;
      font: inherit;
    }
    .zav-search input:focus-visible {
      outline: 2px solid var(--zen-accent-button-color, AccentColor);
      outline-offset: -1px;
    }
    .zav-list { flex: 1 1 auto; overflow-y: auto; padding: 6px; }
    .zav-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      margin-top: 2px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.7;
      cursor: pointer;
      border-radius: var(--zav-radius-sm);
    }
    .zav-group-header:hover { opacity: 1; background: var(--zen-colors-hover-bg, color-mix(in srgb, AccentColor 8%, transparent)); }
    .zav-group-chevron { display: inline-block; width: 10px; text-align: center; }
    .zav-time-header {
      padding: 6px 8px 2px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.4;
    }
    .zav-clear-all {
      opacity: 0;
      transition: opacity 0.1s, background 0.1s, scale 0.1s;
      appearance: none;
      font: inherit;
      font-size: 10.5px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: var(--zav-radius-sm);
      corner-shape: var(--zav-corner);
      border: none;
      background: var(--zen-colors-secondary, ButtonFace);
      color: inherit;
      cursor: pointer;
    }
    .zav-group-header:hover .zav-clear-all { opacity: 1; }
    .zav-clear-all:hover { background: color-mix(in srgb, #ff5f57 22%, var(--zen-colors-secondary, ButtonFace)); }
    .zav-clear-all:active { scale: 0.94; }
    .zav-row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: var(--zav-radius-sm);
      corner-shape: var(--zav-corner);
      cursor: default;
    }
    .zav-row:hover { background: var(--zen-colors-hover-bg, color-mix(in srgb, AccentColor 12%, transparent)); }
    /* Desaturated to match neighboring text rather than sitting at full
       saturation while nothing else is -- same reasoning as the sidebar. */
    .zav-favicon {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      border-radius: 4px;
      background: var(--zen-colors-border, ThreeDShadow);
      filter: grayscale(0.45) brightness(0.9);
      transition: filter 0.15s;
    }
    .zav-row:hover .zav-favicon { filter: none; }
    .zav-meta { flex: 1 1 auto; min-width: 0; }
    .zav-title { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .zav-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; opacity: 0.55; }
    /* Actions float over .zav-meta on hover instead of reserving flex space
       -- same reasoning as the sidebar's row actions: a permanent flex
       sibling would shrink the title/subtitle even while invisible. */
    .zav-row:hover .zav-meta {
      mask-image: linear-gradient(to left, transparent 0, transparent 96px, black 116px);
    }
    .zav-actions {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .zav-row:hover .zav-actions { opacity: 1; }
    .zav-actions button {
      appearance: none;
      font: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 9px;
      border-radius: var(--zav-radius-sm);
      corner-shape: var(--zav-corner);
      border: none;
      color: inherit;
      cursor: pointer;
      transition: background 0.1s, filter 0.1s, scale 0.1s;
    }
    .zav-actions button:active { scale: 0.94; }
    /* Tonal treatment (soft tint background + accent-colored text) instead
       of a solid full-saturation fill -- a solid fill happens to clash when
       the button's hue is close to the workspace's own accent hue (e.g. a
       green button on a green-themed workspace read as harsh), a soft tint
       reads as integrated across any workspace color instead of just some. */
    .zav-actions .zav-restore {
      background: color-mix(in srgb, var(--zen-accent-button-background, AccentColor) 20%, var(--zen-colors-secondary, ButtonFace));
      color: var(--zen-accent-button-color, var(--zen-accent-button-background, AccentColor));
    }
    .zav-actions .zav-restore:hover { background: color-mix(in srgb, var(--zen-accent-button-background, AccentColor) 32%, var(--zen-colors-secondary, ButtonFace)); }
    .zav-actions .zav-forget { background: var(--zen-colors-secondary, ButtonFace); }
    .zav-actions .zav-forget:hover { background: color-mix(in srgb, #ff5f57 22%, var(--zen-colors-secondary, ButtonFace)); }
    .zav-empty { padding: 32px 10px; text-align: center; opacity: 0.5; font-size: 12.5px; }
  `;

  // Workspace ids the user has chosen to expand. Default is collapsed for
  // everything — with a few hundred archived tabs the fully-expanded list is
  // an unreadable wall of text, so groups start closed and open on click.
  const expandedGroups = new Set();

  function buildPanel() {
    // Same reasoning as buildButton: rebuild fresh, don't reuse a node left
    // over from a previous load.
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createXULElement("panel");
    panel.id = PANEL_ID;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("flip", "both");

    const style = document.createElementNS(HTML_NS, "style");
    style.textContent = CSS;

    const root = document.createElementNS(HTML_NS, "div");
    root.className = "zav-root";

    const searchWrap = document.createElementNS(HTML_NS, "div");
    searchWrap.className = "zav-search";
    const input = document.createElementNS(HTML_NS, "input");
    input.type = "search";
    input.placeholder = "Search archived tabs…";
    input.addEventListener("input", () => render(panel, input.value));
    searchWrap.appendChild(input);

    const list = document.createElementNS(HTML_NS, "div");
    list.className = "zav-list";

    root.append(style, searchWrap, list);
    panel.appendChild(root);
    document.documentElement.appendChild(panel);
    return panel;
  }

  function makeRow(record) {
    const row = document.createElementNS(HTML_NS, "div");
    row.className = "zav-row";

    const icon = document.createElementNS(HTML_NS, "img");
    icon.className = "zav-favicon";
    if (record.favicon) icon.src = record.favicon;

    const meta = document.createElementNS(HTML_NS, "div");
    meta.className = "zav-meta";
    const title = document.createElementNS(HTML_NS, "div");
    title.className = "zav-title";
    title.textContent = record.title || record.url;
    const sub = document.createElementNS(HTML_NS, "div");
    sub.className = "zav-sub";
    sub.textContent = `${hostOf(record.url)} · ${fmtRelative(record.archivedAt)}`;
    meta.append(title, sub);

    const actions = document.createElementNS(HTML_NS, "div");
    actions.className = "zav-actions";

    const rerender = () => {
      const panel = document.getElementById(PANEL_ID);
      render(panel, panel.querySelector(".zav-search input")?.value ?? "");
    };

    const restoreBtn = document.createElementNS(HTML_NS, "button");
    restoreBtn.className = "zav-restore";
    restoreBtn.textContent = "Restore";
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      await archiver.restore(record.id);
      rerender();
    });

    const forgetBtn = document.createElementNS(HTML_NS, "button");
    forgetBtn.className = "zav-forget";
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

  async function render(panel, filter = "") {
    const list = panel.querySelector(".zav-list");
    list.textContent = "";

    const records = await archiver.list();
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? records.filter((r) => (r.title || "").toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
      : records;

    if (filtered.length === 0) {
      const empty = document.createElementNS(HTML_NS, "div");
      empty.className = "zav-empty";
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

    for (const [wsId, rows] of groups) {
      const isExpanded = expandedGroups.has(wsId);

      const header = document.createElementNS(HTML_NS, "div");
      header.className = "zav-group-header";
      const chevron = document.createElementNS(HTML_NS, "span");
      chevron.className = "zav-group-chevron";
      chevron.textContent = isExpanded ? "▾" : "▸";
      const label = document.createElementNS(HTML_NS, "span");
      label.textContent = `${wsNames.get(wsId) ?? wsId} (${rows.length})`;
      label.style.flex = "1 1 auto";

      const clearBtn = document.createElementNS(HTML_NS, "button");
      clearBtn.className = "zav-clear-all";
      clearBtn.textContent = "Forget all";
      clearBtn.title = `Permanently discard all ${rows.length} archived tabs in this workspace`;
      clearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Permanently forget all ${rows.length} archived tabs in "${wsNames.get(wsId) ?? wsId}"? This can't be undone.`)) return;
        clearBtn.disabled = true;
        await Promise.all(rows.map((r) => archiver.forget(r.id)));
        render(panel, panel.querySelector(".zav-search input")?.value ?? "");
      });

      header.append(chevron, label, clearBtn);
      header.addEventListener("click", () => {
        if (expandedGroups.has(wsId)) expandedGroups.delete(wsId);
        else expandedGroups.add(wsId);
        render(panel, panel.querySelector(".zav-search input")?.value ?? "");
      });
      list.appendChild(header);

      if (isExpanded) {
        let currentBucket = null;
        for (const record of rows) {
          const bucket = bucketLabel(record.archivedAt);
          if (bucket !== currentBucket) {
            currentBucket = bucket;
            const timeHeader = document.createElementNS(HTML_NS, "div");
            timeHeader.className = "zav-time-header";
            timeHeader.textContent = bucket;
            list.appendChild(timeHeader);
          }
          list.appendChild(makeRow(record));
        }
      }
    }
  }

  function install() {
    buildButton();
  }

  function show() {
    const panel = buildPanel();
    // Reuse the button install() already built; only build one here as a
    // fallback for calling show() directly without install() first. Rebuilding
    // unconditionally would tear down the button while its own click handler
    // (which called toggle() -> show()) is still on the call stack.
    const button = document.getElementById(BUTTON_ID) ?? buildButton();
    render(panel);
    panel.openPopup(button, "after_end", 6, 0, false, false);
  }

  function hide() {
    document.getElementById(PANEL_ID)?.hidePopup();
  }

  function toggle() {
    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.state !== "closed") hide();
    else show();
  }

  window.ZenTabArchive = window.ZenTabArchive || {};
  window.ZenTabArchive.view = { install, show, hide, toggle };
  install();
})();
