// archiveSidebar.uc.js — inline per-workspace archive view. Appends a
// "ghost tabs" section directly into each <zen-workspace> element, right
// where that workspace's own tabs are, instead of a separate popup. This is
// the per-workspace counterpart to archiveView.uc.js's cross-workspace
// popup — both stay: this for "ambient glance + restore in the workspace
// I'm already in", the popup for "show me everything, every workspace".
//
// A Sine "window script" (.uc.js, listed in theme.json's `scripts`) — Sine
// loads this via Services.scriptloader.loadSubScriptWithOptions with
// target: <browser window>, once per browser window, so gBrowser/
// gZenWorkspaces/document/setInterval are real bare globals here (unlike
// this file's earlier dev-only .mjs incarnation, which needed
// Services.wm.getMostRecentWindow since ES modules get their own
// module-global scope, not a window's).
//
// Confirmed via probe-workspace-element.js against a real profile:
//   <zen-workspace id="{uuid}">
//     <zen-workspace-collapsible-pins>       (essentials/pins UI, untouched)
//     <vbox class="...zen-current-workspace-indicator...">
//     <arrowscrollbox class="workspace-arrowscrollbox">  <- real tabs live
//       (contains pinnedTabsContainer + tabsContainer, NOT direct children
//        of <zen-workspace> -- el.tabsContainer is nested inside this)
//     <vbox class="zen-workspace-empty-space">   <- flexible filler, last
//   </zen-workspace>
// We insert our section as the LAST child, after zen-workspace-empty-space,
// so that flex-grow filler shrinks to fill whatever room is left above us --
// pinning the archive section to the actual bottom of the sidebar rather
// than sitting right under the last real tab with a gap of empty space
// below it. The section itself uses flex-direction: column-reverse so the
// collapsed header stays pinned at that bottom edge and the row list
// expands UPWARD when opened, instead of downward off the bottom of the
// sidebar. Confirmed via harmless append+remove test that <zen-workspace>
// tolerates an extra child; we never touch
// tabsContainer/pinnedTabsContainer/arrowscrollbox, which is what Zen's own
// drag/reorder/count logic actually reads.
//
// Inactive workspaces are moved off-screen via `transform` on the whole
// <zen-workspace> element (confirmed), so a child of ours hides/shows with
// workspace switches automatically -- no extra visibility logic needed.

(() => {
  // Sine serves each mod's files under chrome://sine/content/<mod-id>/...
  // (matching the real disk layout: chrome/sine-mods/<mod-id>/src/...) --
  // the mod id prefix is required, confirmed after "Failed to load
  // chrome://sine/content/src/archiver.sys.mjs" errors from omitting it.
  const archiver = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const SECTION_CLASS = "zen-archive-ghost-section";
  const STYLE_ID = "zen-archive-ghost-style";
  const POLL_MS = 30_000; // periodic refresh so newly-archived tabs show up without a manual trigger
  const VISIBLE_ROWS = 8; // how many archived rows show before the arrowscrollbox's own arrows take over
  const ROW_HEIGHT = 40; // matches a real tab's footprint (36px pill + 2px margin, confirmed via probe-tab-style.js)

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

  // Sizes below are copied from a real <tab> element's computed styles
  // (confirmed via probe-tab-style.js): 40px total row footprint (36px pill +
  // 2px margin), 14px border-radius, 16px/4px-radius icon with ~10px right
  // margin, 8px horizontal content padding, 14px label text -- so the ghost
  // rows read as "the same tabs, just faded" rather than a smaller/different
  // custom list.
  const CSS = `
    .${SECTION_CLASS} {
      display: flex;
      flex-direction: column-reverse;
      margin-top: 2px;
    }
    /* Header reuses .zag-row's real-tab sizing (via class="zag-header
       zag-row") so it reads as a tab-like button, same as "+ New Tab" --
       this just adds the click affordance and keeps it from fading like the
       archived rows do (it's a live control, not a ghost). */
    .zag-header {
      cursor: pointer;
      opacity: 0.85;
    }
    .zag-header:hover { opacity: 1; }
    .zag-row {
      position: relative;
      display: flex;
      align-items: center;
      height: 36px;
      margin: 2px;
      padding: 0 8px;
      border-radius: 14px;
      opacity: 0.55;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .zag-row:hover { opacity: 1; background: color-mix(in srgb, AccentColor 15%, transparent); }
    /* Quick shrink-and-fade before a row actually leaves the DOM on restore/
       forget, instead of vanishing instantly when the list gets torn down and
       rebuilt. Extra specificity (.zag-list .zag-row.zag-removing) so it wins
       over the :hover rule above regardless of source order -- you're almost
       always hovering when you click the action that triggers this. */
    .zag-list .zag-row.zag-removing {
      opacity: 0;
      transform: scale(0.85);
      pointer-events: none;
    }
    .zag-favicon { width: 16px; height: 16px; flex: 0 0 auto; margin-right: 10px; border-radius: 4px; background: ThreeDShadow; }
    .zag-title { flex: 1 1 auto; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Actions float on top of the title instead of reserving flex space --
       a normal flex sibling would shrink the title (and visibly shift the
       text) even while opacity:0, since opacity doesn't remove layout space.
       Real tabs do the same: the close button overlaps the label on hover,
       it doesn't push it. The title fades out under the buttons on hover so
       the overlap reads cleanly instead of looking abruptly clipped. */
    .zag-actions {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .zag-row:hover .zag-actions { opacity: 1; }
    .zag-row:hover .zag-title {
      mask-image: linear-gradient(to left, transparent 0, transparent 48px, black 64px);
    }
    .zag-actions button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
    }
    .zag-actions button:hover { background: color-mix(in srgb, AccentColor 25%, ButtonFace); }
    /* Blur at the top/bottom edges of the visible window instead of a hard
       clip line, so rows scrolling in/out via the arrowscrollbox's arrow
       buttons ease in rather than appearing/disappearing abruptly.
       backdrop-filter rather than a color-gradient overlay -- tried that
       first, but the workspace's actual visible background turned out to be
       painted by something other than background-color (computed
       backgroundColor came back fully transparent, rgba(0,0,0,0), even
       though the sidebar clearly isn't -- consistent with Zen's gradient
       theme system painting it via a pseudo-element or separate layer), so a
       "fade to the workspace's color" gradient had no real color to fade to.
       backdrop-filter blurs whatever is actually behind it regardless of how
       it's painted, so it doesn't need to know the color at all -- and it's
       also just the effect that was actually asked for. The mask-image
       tapers the blur itself from full at the edge to none toward the
       middle, so it reads as a soft blur rather than a hard-edged blurred
       strip. Plain overlay divs (not mask-image on the arrowscrollbox host
       itself) because that didn't visibly affect arrowscrollbox's native
       scrolled content when tried directly on it. */
    .zag-list-wrap { position: relative; }
    .zag-fade-top, .zag-fade-bottom {
      position: absolute;
      left: 0;
      right: 0;
      height: 16px;
      pointer-events: none;
      z-index: 1;
      backdrop-filter: blur(3px);
    }
    .zag-fade-top {
      top: 0;
      mask-image: linear-gradient(to bottom, black, transparent);
    }
    .zag-fade-bottom {
      bottom: 0;
      mask-image: linear-gradient(to top, black, transparent);
    }
  `;

  function ensureStyle() {
    // Always overwrite rather than "if it exists, leave it" -- cheap
    // insurance against a leftover style tag from a previous load blocking
    // CSS changes from ever reaching the page.
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElementNS(HTML_NS, "style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  // Workspace ids the user has expanded. Collapsed by default -- same
  // reasoning as the popup, only more so: sidebar space is tight.
  const expandedWorkspaces = new Set();

  function buildSection(workspaceEl) {
    workspaceEl.querySelector(`:scope > .${SECTION_CLASS}`)?.remove();

    const section = document.createElementNS(HTML_NS, "div");
    section.className = SECTION_CLASS;

    // Styled to match a real tab row (same class as "+ New Tab") rather than
    // a plain divider label -- icon + text, no separate chevron.
    const header = document.createElementNS(HTML_NS, "div");
    header.className = "zag-header zag-row";
    const icon = document.createElementNS(HTML_NS, "img");
    icon.className = "zag-favicon";
    icon.src = "chrome://browser/skin/zen-icons/history.svg";
    const label = document.createElementNS(HTML_NS, "div");
    label.className = "zag-title";

    // Reuses the same hover-reveal overlay pattern as row actions (.zag-actions
    // is already styled to float over .zag-title rather than push it, since
    // the header also carries class="zag-row").
    const actions = document.createElementNS(HTML_NS, "div");
    actions.className = "zag-actions";
    const clearBtn = document.createElementNS(HTML_NS, "button");
    clearBtn.textContent = "🗑";
    clearBtn.className = "zag-clear-all";
    actions.appendChild(clearBtn);

    header.append(icon, label, actions);

    // A real XUL arrowscrollbox -- the exact element Zen's own tab list uses
    // for scrolling -- instead of a plain overflow:auto div. Gives native
    // click-to-scroll-one-row arrow buttons at the ends and no visible
    // scrollbar, matching how the real tab strip above it behaves, rather
    // than inventing our own scroll UI.
    const list = document.createXULElement("arrowscrollbox");
    list.setAttribute("orient", "vertical");
    list.className = "zag-list";

    const listWrap = document.createElementNS(HTML_NS, "div");
    listWrap.className = "zag-list-wrap";
    const fadeTop = document.createElementNS(HTML_NS, "div");
    fadeTop.className = "zag-fade-top";
    const fadeBottom = document.createElementNS(HTML_NS, "div");
    fadeBottom.className = "zag-fade-bottom";
    listWrap.append(list, fadeTop, fadeBottom);

    section.append(header, listWrap);

    // Append as the true last child (after zen-workspace-empty-space, not
    // before it) so the flex-grow filler shrinks to fill whatever room is
    // left ABOVE us, pinning this section to the actual bottom of the
    // sidebar instead of sitting right under the last real tab with a big
    // gap of empty space below it.
    workspaceEl.appendChild(section);
    return section;
  }

  async function renderSection(workspaceEl, wsId) {
    // Always rebuild+reposition rather than reusing an existing section --
    // cheap insurance against a node left over from a previous load (mod
    // update, dev force-reload) staying wherever it originally landed.
    const section = buildSection(workspaceEl);

    const records = (await archiver.list())
      .filter((r) => r.workspaceId === wsId)
      .sort((a, b) => b.archivedAt - a.archivedAt);

    if (records.length === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const isExpanded = expandedWorkspaces.has(wsId);
    const header = section.querySelector(".zag-header");
    header.querySelector(".zag-title").textContent = `Archived Tabs (${records.length})`;
    header.onclick = () => {
      if (expandedWorkspaces.has(wsId)) expandedWorkspaces.delete(wsId);
      else expandedWorkspaces.add(wsId);
      renderSection(workspaceEl, wsId);
    };

    const clearBtn = header.querySelector(".zag-clear-all");
    clearBtn.title = `Permanently discard all ${records.length} archived tabs in this workspace`;
    clearBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Permanently forget all ${records.length} archived tabs in this workspace? This can't be undone.`)) return;
      clearBtn.disabled = true;
      await Promise.all(records.map((r) => archiver.forget(r.id)));
      renderSection(workspaceEl, wsId);
    };

    const list = section.querySelector(".zag-list");
    list.textContent = "";

    const fadeTop = section.querySelector(".zag-fade-top");
    const fadeBottom = section.querySelector(".zag-fade-bottom");
    const overflowing = isExpanded && records.length > VISIBLE_ROWS;
    fadeTop.style.display = fadeBottom.style.display = overflowing ? "" : "none";

    if (!isExpanded) return;

    // Show roughly VISIBLE_ROWS at a time -- the arrowscrollbox's own arrow
    // buttons reveal the rest, rather than growing the sidebar or scrolling
    // via a visible scrollbar. Not exact: arrowscrollbox's native arrow chrome
    // is stateful (e.g. the "up" arrow disappears entirely at scrolledtostart)
    // so top/bottom insets aren't equal and can't be reliably pre-measured --
    // a fixed height sized a bit under the naive N*ROW_HEIGHT guarantees no
    // row ever gets partially clipped, at the cost of sometimes showing one
    // fewer full row than VISIBLE_ROWS.
    const shownRows = Math.min(records.length, VISIBLE_ROWS);
    list.style.height = shownRows > 0 ? `${shownRows * ROW_HEIGHT - 24}px` : "0px";

    for (const record of records) {
      const row = document.createElementNS(HTML_NS, "div");
      row.className = "zag-row";

      const icon = document.createElementNS(HTML_NS, "img");
      icon.className = "zag-favicon";
      if (record.favicon) icon.src = record.favicon;

      const title = document.createElementNS(HTML_NS, "div");
      title.className = "zag-title";
      title.textContent = record.title || record.url;
      title.title = `${record.url}\n${hostOf(record.url)} · ${fmtRelative(record.archivedAt)}`;

      const actions = document.createElementNS(HTML_NS, "div");
      actions.className = "zag-actions";

      // Play the .zag-removing shrink-and-fade transition (180ms, matches
      // .zag-row's transition duration) before the actual store mutation and
      // list rebuild, instead of the row vanishing instantly.
      const animateOut = () =>
        new Promise((resolve) => {
          row.classList.add("zag-removing");
          setTimeout(resolve, 180);
        });

      const restoreBtn = document.createElementNS(HTML_NS, "button");
      restoreBtn.textContent = "+";
      restoreBtn.title = "Restore";
      restoreBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        restoreBtn.disabled = true;
        await animateOut();
        await archiver.restore(record.id);
        refreshAll();
      });

      const forgetBtn = document.createElementNS(HTML_NS, "button");
      forgetBtn.textContent = "✕";
      forgetBtn.title = "Forget (permanently discard)";
      forgetBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        forgetBtn.disabled = true;
        await animateOut();
        await archiver.forget(record.id);
        refreshAll();
      });

      actions.append(restoreBtn, forgetBtn);
      row.append(icon, title, actions);
      list.appendChild(row);
    }
  }

  function refreshAll() {
    for (const ws of gZenWorkspaces._workspaceCache ?? []) {
      const el = document.getElementById(ws.uuid);
      if (el) renderSection(el, ws.uuid);
    }
  }

  // The poll timer's handle lives on the window, not a plain closure
  // variable -- cheap insurance in case this script is ever re-injected
  // into a window that's still open (mod update, dev force-reload) without
  // the window itself reloading, so a stale timer can still be found and
  // cancelled rather than orphaned. See CONTEXT.md for the full failure
  // mode this avoided during dev (multiple zombie timers stomping on each
  // other's DOM output every time they fired).
  const POLL_TIMER_KEY = "__zenArchiveSidebarPollTimer";

  function install() {
    ensureStyle();
    refreshAll();

    if (window[POLL_TIMER_KEY]) clearInterval(window[POLL_TIMER_KEY]);
    window[POLL_TIMER_KEY] = setInterval(refreshAll, POLL_MS);
  }

  function uninstall() {
    if (window[POLL_TIMER_KEY]) {
      clearInterval(window[POLL_TIMER_KEY]);
      window[POLL_TIMER_KEY] = null;
    }
    for (const el of document.querySelectorAll(`.${SECTION_CLASS}`)) el.remove();
  }

  window.ZenTabArchive = window.ZenTabArchive || {};
  window.ZenTabArchive.sidebar = { install, uninstall, refreshAll };
  install();
})();
