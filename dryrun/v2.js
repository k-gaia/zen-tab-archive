// dryrun/v2.js — Zen tab archiver, dry-run (continuous)
// Changes from v1:
//   1. Reads tab.lastAccessed directly (stamper layer stays dropped — validated
//      reliable on the 55-tab real profile, incl. a pending tab reading 5.6h).
//   2. Guard order fixed: `essential` is tested BEFORE `pinned`, because in Zen
//      essentials are also pinned. Pinned + essential are BOTH permanent-exempt.
//   3. Skips about:blank / about:newtab / about:home / empty-URL tabs.
//   4. Continuous setInterval loop: re-scans on a timer so you can watch tabs
//      age out mid-session. Still logging only — nothing is ever closed.
//
// Run: Ctrl+Shift+J → paste → Enter. If gBrowser is undefined, set
// devtools.chrome.enabled=true in about:config first.
//
// To STOP the loop: re-paste this script (it clears the previous loop first),
// or run:  clearInterval(window.__zenArchiveDryRun);

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

    for (const tab of gBrowser.tabs) {
      const url   = tab.linkedBrowser?.currentURI?.spec ?? "";
      const last  = tab.lastAccessed || 0;        // ms epoch; 0 = never/unknown
      const idle  = last ? now - last : Infinity;

      const isActive    = tab.selected;
      const isEssential = tab.hasAttribute("zen-essential");
      const isPinned    = tab.pinned;
      const isAudible   = tab.hasAttribute("soundplaying");
      const isPending   = tab.getAttribute("pending") === "true"; // unloaded
      const isEmpty     = EMPTY_URLS.has(url);

      // Guard order matters: essential BEFORE pinned (essentials are pinned too).
      let keep = null;
      if      (SKIP_ACTIVE     && isActive)    keep = "active";
      else if (SKIP_ESSENTIALS && isEssential) keep = "essential";
      else if (SKIP_PINNED     && isPinned)    keep = "pinned";
      else if (SKIP_AUDIBLE    && isAudible)   keep = "audio";
      else if (isEmpty)                        keep = "empty";
      else if (!last)                          keep = "no-timestamp";
      else if (idle < thresholdMs)             keep = "recent";

      rows.push({
        archive: keep === null,
        reason:  keep ?? "IDLE",
        idle:    fmtAge(idle),
        pending: isPending,
        ws:      tab.getAttribute("zen-workspace-id") || "(none)",
        title:   (tab.label ?? "").slice(0, 35),
        url:     url.slice(0, 55),
      });
    }

    const hits = rows.filter(r => r.archive);
    const stamp = new Date().toLocaleTimeString();
    console.log(`%c[${stamp}] dry-run · ${THRESHOLD_HOURS}h threshold · ${gBrowser.tabs.length} tabs · ${hits.length} would archive`,
                "font-weight:bold;color:#7aa2f7");
    console.table(rows);
    return hits.map(r => r.url);
  };

  // Clear any previous loop so re-pasting doesn't stack timers.
  if (window.__zenArchiveDryRun) {
    clearInterval(window.__zenArchiveDryRun);
    console.log("%c(cleared previous dry-run loop)", "color:#e0af68");
  }

  scan(); // run once immediately
  window.__zenArchiveDryRun = setInterval(scan, INTERVAL_MIN * 6e4);
  console.log(`%cdry-run loop armed · re-scanning every ${INTERVAL_MIN} min · clearInterval(window.__zenArchiveDryRun) to stop`,
              "color:#9ece6a");
})();
