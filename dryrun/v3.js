// dryrun/v3.js — Zen tab archiver, dry-run (true all-workspace coverage)
// Changes from v2:
//   Scans gZenWorkspaces._allStoredTabs instead of gBrowser.tabs. Confirmed:
//   gBrowser.tabs only contains the ACTIVE workspace's ordinary tabs plus
//   globally-visible essentials -- a non-active workspace's ordinary tabs are
//   simply absent from it. _allStoredTabs is the real superset: every tab,
//   every workspace, all the time, as live DOM elements (same objects
//   gBrowser.tabs would expose if you switched to that workspace) -- so this
//   is what lets the archiver DECIDE what's idle everywhere with zero
//   workspace-switching. (Removal is a separate question -- see
//   probe-remove-without-switch.js.)
//
// Everything else unchanged from v2: no stamper, essential-before-pinned
// guard order, skips about:blank/newtab/empty, continuous setInterval loop.
// Still logging only -- nothing is ever closed.
//
// Run: Ctrl+Shift+J -> paste -> Enter. If gBrowser is undefined, set
// devtools.chrome.enabled=true in about:config first.
//
// To STOP the loop: re-paste this script, or run:
//   clearInterval(window.__zenArchiveDryRun);

(() => {
  // ---- knobs ----
  const THRESHOLD_HOURS = 24;   // archive ordinary tabs idle longer than this
  const INTERVAL_MIN    = 5;    // how often to re-scan and log (minutes)
  const SKIP_PINNED     = true; // permanent shelf
  const SKIP_ESSENTIALS = true; // zen-essential, permanent shelf
  const SKIP_ACTIVE     = true; // currently selected tab
  const SKIP_AUDIBLE    = true; // tab currently playing sound
  // DRY RUN ONLY — nothing below ever closes a tab.

  const thresholdMs = THRESHOLD_HOURS * 3.6e6;
  const EMPTY_URLS = new Set(["about:blank", "about:newtab", "about:home", ""]);

  const wsNames = new Map(
    (gZenWorkspaces._workspaceCache ?? []).map((ws) => [ws.uuid, ws.name])
  );

  const fmtAge = (ms) => {
    if (!isFinite(ms) || ms < 0) return "unknown";
    const h = ms / 3.6e6;
    if (h < 1)  return `${Math.round(ms / 6e4)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };

  const scan = () => {
    const now = Date.now();
    const rows = [];
    const allTabs = gZenWorkspaces._allStoredTabs ?? gBrowser.tabs;

    for (const tab of allTabs) {
      const url   = tab.linkedBrowser?.currentURI?.spec ?? "";
      const last  = tab.lastAccessed || 0;        // ms epoch; 0 = never/unknown
      const idle  = last ? now - last : Infinity;

      const isActive    = tab.selected;
      const isEssential = tab.hasAttribute("zen-essential");
      const isPinned    = tab.pinned;
      const isAudible   = tab.hasAttribute("soundplaying");
      const isPending   = tab.getAttribute("pending") === "true"; // unloaded
      const isEmpty     = EMPTY_URLS.has(url);
      const wsId        = tab.getAttribute("zen-workspace-id") || "(none)";

      // Guard order matters: essential BEFORE pinned (essentials are pinned too).
      let keep = null;
      if      (SKIP_ACTIVE     && isActive)    keep = "active";
      else if (SKIP_ESSENTIALS && isEssential) keep = "essential";
      else if (SKIP_PINNED     && isPinned)    keep = "pinned";
      else if (SKIP_AUDIBLE    && isAudible)   keep = "audio";
      else if (isEmpty)                        keep = "empty";
      else if (!last)                          keep = "no-timestamp";
      else if (idle < thresholdMs)              keep = "recent";

      rows.push({
        archive:   keep === null,
        reason:    keep ?? "IDLE",
        idle:      fmtAge(idle),
        pending:   isPending,
        workspace: wsNames.get(wsId) ?? wsId,
        title:     (tab.label ?? "").slice(0, 35),
        url:       url.slice(0, 55),
      });
    }

    const hits = rows.filter(r => r.archive);
    const stamp = new Date().toLocaleTimeString();
    console.log(`%c[${stamp}] dry-run v3 (all workspaces) · ${THRESHOLD_HOURS}h threshold · ${rows.length} tabs · ${hits.length} would archive`,
                "font-weight:bold;color:#7aa2f7");
    console.table(rows);
    return hits.map(r => r.url);
  };

  if (window.__zenArchiveDryRun) {
    clearInterval(window.__zenArchiveDryRun);
    console.log("%c(cleared previous dry-run loop)", "color:#e0af68");
  }

  scan();
  window.__zenArchiveDryRun = setInterval(scan, INTERVAL_MIN * 6e4);
  console.log(`%cdry-run v3 loop armed · re-scanning every ${INTERVAL_MIN} min · clearInterval(window.__zenArchiveDryRun) to stop`,
              "color:#9ece6a");
})();
