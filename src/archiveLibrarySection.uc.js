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
//   - No shadow DOM (confirmed createRenderRoot() { return this; } in
//     Zen's own ZenLibrarySearchSection.mjs) -- light DOM, so plain global
//     CSS works here the same as the popup and sidebar.
//
// Each built-in section is ITSELF the custom element its own static
// render(library) mounts (e.g. ZenLibraryBoostsSection both describes how
// to mount <zen-library-boosts-section> AND implements it as a LitElement).
// We follow the same pattern.
//
// Section.label is a Fluent l10n id (confirmed: Zen's own sections use ids
// like "library-history-section-title", resolved via data-l10n-id in
// <zen-library>'s own template) -- not plain text. We ship our own .ftl and
// register it with document.l10n.addResourceIds(), the real Fluent
// mechanism for this, rather than fighting the shared template with a
// workaround.

(() => {
  const { html } = ChromeUtils.importESModule("chrome://global/content/vendor/lit.all.mjs");
  const { MozLitElement } = ChromeUtils.importESModule("chrome://global/content/lit-utils.mjs");
  const archiver = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");

  const FTL_PATH = "chrome://sine/content/zen-tab-archive/src/locale/zen-tab-archive.ftl";
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
    const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  class ZenArchiveLibrarySection extends MozLitElement {
    static id = SECTION_ID;
    static label = "zen-tab-archive-library-section-title";

    static render(library) {
      return html`
        <zen-archive-library-section
          class="zen-library-section"
          data-section="${SECTION_ID}"
          .library=${library}
        ></zen-archive-library-section>
      `;
    }

    createRenderRoot() {
      return this;
    }

    constructor() {
      super();
      this.records = [];
      this.filter = "";
      this.expandedGroups = new Set();
    }

    connectedCallback() {
      super.connectedCallback();
      this.refresh();
    }

    async refresh() {
      this.records = (await archiver.list()).sort((a, b) => b.archivedAt - a.archivedAt);
    }

    #toggleGroup(wsId) {
      if (this.expandedGroups.has(wsId)) this.expandedGroups.delete(wsId);
      else this.expandedGroups.add(wsId);
      this.requestUpdate();
    }

    async #restore(id) {
      await archiver.restore(id);
      await this.refresh();
    }

    async #forget(id) {
      await archiver.forget(id);
      await this.refresh();
    }

    async #forgetAll(wsId, rows) {
      if (!confirm(`Permanently forget all ${rows.length} archived tabs in this workspace? This can't be undone.`)) return;
      await Promise.all(rows.map((r) => archiver.forget(r.id)));
      await this.refresh();
    }

    #row(record) {
      return html`
        <div class="zal-row">
          <img class="zal-favicon" src=${record.favicon || ""} />
          <div class="zal-meta">
            <div class="zal-title">${record.title || record.url}</div>
            <div class="zal-sub">${hostOf(record.url)} · ${fmtRelative(record.archivedAt)}</div>
          </div>
          <div class="zal-actions">
            <button class="zal-restore" @click=${() => this.#restore(record.id)}>Restore</button>
            <button class="zal-forget" @click=${() => this.#forget(record.id)}>Forget</button>
          </div>
        </div>
      `;
    }

    render() {
      const q = this.filter.trim().toLowerCase();
      const filtered = q
        ? this.records.filter((r) => (r.title || "").toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
        : this.records;

      const wsNames = new Map(
        (gZenWorkspaces._workspaceCache ?? []).map((ws) => [ws.uuid, `${ws.icon ?? ""} ${ws.name}`.trim()])
      );

      const groups = new Map();
      for (const r of filtered) {
        const key = r.workspaceId || "(unknown)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      return html`
        <div class="zal-root">
          <div class="zal-search">
            <input
              type="search"
              placeholder="Search archived tabs…"
              .value=${this.filter}
              @input=${(e) => { this.filter = e.target.value; }}
            />
          </div>
          <div class="zal-list">
            ${filtered.length === 0
              ? html`<div class="zal-empty">${this.records.length === 0 ? "No archived tabs yet." : "No matches."}</div>`
              : [...groups].map(([wsId, rows]) => {
                  const isExpanded = this.expandedGroups.has(wsId);
                  return html`
                    <div class="zal-group-header" @click=${() => this.#toggleGroup(wsId)}>
                      <span class="zal-chevron">${isExpanded ? "▾" : "▸"}</span>
                      <span>${wsNames.get(wsId) ?? wsId} (${rows.length})</span>
                      <button
                        class="zal-clear-all"
                        title="Permanently discard all ${rows.length} archived tabs in this workspace"
                        @click=${(e) => { e.stopPropagation(); this.#forgetAll(wsId, rows); }}
                      >Forget all</button>
                    </div>
                    ${isExpanded ? rows.map((r) => this.#row(r)) : ""}
                  `;
                })}
          </div>
        </div>
      `;
    }
  }
  customElements.define("zen-archive-library-section", ZenArchiveLibrarySection);

  // <zen-library> is permanent in the DOM (confirmed live), so this should
  // find it immediately -- the retry is cheap insurance in case this script
  // runs before it's been inserted for some reason.
  function install() {
    ensureStyle();
    document.l10n?.addResourceIds([FTL_PATH]);

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
