// dryrun/v1.js — Zen tab archiver, dry-run BASELINE
// Verbatim from the first real-profile run (18 of 55 flagged).
// Kept as the baseline so the diff to v2 documents the design decisions in code.
//
// KNOWN ISSUES (fixed in v2, do not "fix" here — this file is the record):
//   - guard order checks `pinned` before `essential`; in Zen essentials are
//     also pinned, so essentials get mislabelled `pinned` and never show
//     `essential`.
//   - does not skip about:blank / newtab empties.
//   - no continuous timer loop (single snapshot only).
//
// Run: Ctrl+Shift+J → paste → Enter. If gBrowser is undefined, set
// devtools.chrome.enabled=true in about:config first. Closes nothing.

(() => {
  // ---- knobs ----
  const THRESHOLD_HOURS = 24;   // archive tabs idle longer than this
  const SKIP_PINNED     = true; // workspace-specific pinned tabs
  const SKIP_ESSENTIALS = true; // zen-essential (globally visible)
  const SKIP_ACTIVE     = true; // currently selected tab
  const SKIP_AUDIBLE    = true; // tab currently playing sound
  // DRY RUN ONLY — nothing below ever closes a tab.

  const now = Date.now();
  const thresholdMs = THRESHOLD_HOURS * 3.6e6;
  const fmtAge = (ms) => {
    if (!isFinite(ms) || ms < 0) return "unknown";
    const h = ms / 3.6e6;
    if (h < 1)  return `${Math.round(ms / 6e4)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };

  const rows = [];
  for (const tab of gBrowser.tabs) {
    const url   = tab.linkedBrowser?.currentURI?.spec ?? "(no browser)";
    const last  = tab.lastAccessed || 0;          // ms epoch; 0 = never/unknown
    const idle  = last ? now - last : Infinity;

    const isActive    = tab.selected;
    const isPinned    = tab.pinned;
    const isEssential = tab.hasAttribute("zen-essential");
    const isAudible   = tab.hasAttribute("soundplaying");
    const isPending   = tab.getAttribute("pending") === "true"; // unloaded

    let keep = null;
    if      (SKIP_ACTIVE     && isActive)    keep = "active";
    else if (SKIP_PINNED     && isPinned)    keep = "pinned";
    else if (SKIP_ESSENTIALS && isEssential) keep = "essential";
    else if (SKIP_AUDIBLE    && isAudible)   keep = "audio";
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
  console.log(`%cdry-run · ${THRESHOLD_HOURS}h threshold · ${gBrowser.tabs.length} tabs · ${hits.length} would archive`,
              "font-weight:bold;color:#7aa2f7");
  console.table(rows);
  return hits.map(r => r.url);
})();
