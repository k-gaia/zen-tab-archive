# Zen Tab Archive — Project Context

> Handoff doc. Read this first when resuming. It carries the full state of a
> design-and-prototyping effort now moving into a real project folder for
> implementation, plus how to run the dry-run scripts against a live Zen.

---

## What we're building

An **Arc-style automatic tab archiver for Zen Browser** (a Firefox fork).

Tabs that go idle for longer than a threshold are **archived** — moved out of
the tab strip into a **browsable, recoverable store** — rather than
hard-closed. The defining feature vs. a plain auto-close is **recovery**: a
tab you stopped using should be quietly tidied away *and still findable*, never
silently lost.

One-line framing: Firefox native is *"forget everything when I leave"*; this is
*"quietly tidy what I've clearly stopped using, and keep it findable."*

### How this differs from Firefox's native behaviour

- **Native "don't restore tabs" (`browser.startup.page = 0`) is a launch-time,
  all-or-nothing wipe.** Fires once at startup, blind to tab age. A guillotine,
  not a cleanup.
- **Native only acts at startup.** Leave Zen running a week and it never prunes.
  Ours runs **continuously** on a timer mid-session — tabs age out while you
  work. This is the Arc feel and the real behavioural difference.
- **In Zen the native wipe is broken for pins anyway** — pinned/essentials
  reopen regardless of the setting. Ours works at the tab level, not the session
  level, sidestepping this.
- **The deciding factor is the time check, not the closing.** Value is in
  "old AND untouched AND not deliberately kept" — three conditions native
  behaviour can't express — plus a fourth: it's recoverable.

---

## Delivery approach — SETTLED

**Chrome-context mod (userscript), NOT a WebExtension, NOT an upstream PR (yet).**

Why chrome-context over WebExtension:
- WebExtension is sandboxed — can't see Zen's workspace/essentials model, can't
  whitelist essentials properly, can't restore a tab to its origin workspace.
- WebExtension "recovery" is only the small rolling recently-closed buffer
  (~25 tabs, capped by `browser.sessionstore.max_tabs_undo`).
- Chrome context runs inside the browser window's own DOM: full UI control,
  can read/write profile files (`IOUtils`/`PathUtils`) or IndexedDB, can consume
  Zen's `--zen-*` CSS variables for native theming.
- Cost accepted: undocumented internals, breaks on Zen updates, "looks native"
  is manual work.

**Mod-first, upstream-later** (decided): iterate/publish as a mod first, raise
upstream interest only once something installable exists. Avoids their review
cycle + maintenance commitment while the design is unproven; restore-to-workspace
(the 80%) isn't cracked yet; a published mod with real users is a far stronger
upstream pitch than a proposal.

Delivery mechanism: **Sine / fx-autoconfig** userscript approach. Logic lives in
a `userChrome.js`-style script. Scaffolding to crib from:
- **Sine** mod framework
- **BibekBhusal0/zen-custom-js** — https://github.com/BibekBhusal0/zen-custom-js
  (handles JS-loading plumbing; DeepWiki mirror is the best internals ref)

---

## Key decisions & invariants — SETTLED

1. **`tab.lastAccessed` is the idle signal. The custom-timestamp "stamper" layer
   is DROPPED.** Validated on a real 55-tab profile: ages spread sensibly
   (2m → 29d), and a `pending:true` (unloaded) tab correctly read 5.6h / "recent"
   — proving unloaded tabs hold accurate timestamps and don't collapse to
   restore-time. (An earlier dev-profile run showing all tabs at 9.2d was a
   **batch-open confound** — opened at once, never touched — not an unloading
   problem.) No `TabSelect` listener, no custom tab values, no cold-start
   seeding. Read `lastAccessed` directly.

2. **Pinned tabs and essentials are a permanent exempt shelf.** Excluded from
   archiving entirely — the process only ever considers ordinary workspace tabs.
   (Confirmed: pins are a deliberate "keep" shelf, not loose save-for-later.
   Removed a planned essentials-vs-pinned threshold split.)

3. **`about:blank` / new-tab empties are excluded.**

4. **Guard ordering: check `essential` BEFORE `pinned`.** In Zen, essentials are
   *also* pinned, so checking pinned first mislabels essentials as pinned and the
   essential branch never fires. (Reporting bug in v1 — fix in v2.)

5. **The real 80% is restore-to-workspace** (through Zen's session store +
   workspace model), NOT the display. Sequence: timestamp source (done) →
   decide store → prove restore end-to-end for ONE tab → then UI.

---

## Zen internals reference (confirmed)

| Concept        | How to detect / manage |
|----------------|------------------------|
| Essential tab  | `zen-essential` attribute; max 12; globally visible; `gZenPinnedTabManager` / `nsZenPinnedTabManager` (`src/zen/tabs/ZenPinnedTabManager.mjs`) |
| Pinned tab     | Standard Firefox `.pinned`; workspace-specific |
| Workspace      | `zen-workspace-id` attribute; `gZenWorkspaces` |
| Unloaded tab   | `pending="true"` attribute |
| Folders        | `zen-folder` elements via `gZenFolders` (`src/zen/folders/ZenFolders.mjs`) |
| Sessions       | `SessionStore` (the route for restore) |

Attribute-dump one-liner (run on an essential tab to verify attributes match
your build):
```js
[...gBrowser.selectedTab.attributes].map(a => `${a.name}=${a.value}`)
```
If `gBrowser` is undefined in the Browser Console, set `devtools.chrome.enabled=true`
in about:config.

---

## Development tooling — running scripts against live Zen

Two ways to run the chrome-context dry-runs. Start with the MCP; fall back to the
harness if Zen won't cooperate or if automation skews the measurements.

### Option A — Mozilla firefox-devtools-mcp (off-the-shelf)

Lets Claude Code execute chrome-context ("privileged") scripts in a running Zen
via its `evaluate_privileged_script` tool, over Marionette. Zen is Gecko-based so
this *should* work, but it's built for Firefox — the first session is a spike to
confirm.

Setup (assumes Node.js + Claude Code already installed):

1. **Quit Zen completely** (fully exit — not just close the window, or the flag
   is ignored).
2. **Relaunch Zen with Marionette** from a terminal (opens your normal
   session/profile, exposes Marionette on port 2828):
   ```bash
   # Linux
   zen --marionette
   # macOS
   /Applications/Zen\ Browser.app/Contents/MacOS/zen --marionette
   # Windows (PowerShell)
   & "C:\Program Files\Zen Browser\zen.exe" --marionette
   ```
3. **Add the MCP server** (chrome-context eval on, system access granted):
   ```bash
   claude mcp add --transport stdio \
     --env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 \
     firefox-devtools \
     -- npx -y @mozilla/firefox-devtools-mcp@latest --connect-existing --enable-privileged-context
   ```
   `--connect-existing` attaches to your running Zen (real profile, real tabs)
   instead of launching a fresh one. `--enable-privileged-context` enables the
   chrome-context eval, which requires `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`.
   (If npx can't find it, drop the scope: `firefox-devtools-mcp@latest`.)
4. **Confirm connected:** `claude mcp list`, or `/mcp` inside a session.
5. **Probe chrome context — the Zen gate.** Have Claude run a privileged script
   of just `gBrowser.tabs.length`. A number = chrome context works, proceed.
   An error = Zen isn't exposing privileged Marionette access; switch to
   Option B.
6. **Run the dry-run:** point Claude Code at `dryrun/v2.js`, eval in privileged
   context.

**Caveats that matter:**
- **Verify on Zen first** (step 5). Marionette is core Gecko so it's likely
  present, but the fork honouring `--marionette` + `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS`
  is unconfirmed.
- **Automation may perturb the exact signal we're measuring.** Running under
  Marionette applies test `RecommendedPreferences` and sets
  `navigator.webdriver=true`; this can alter tab-unloading / session behaviour —
  i.e. the `pending`/`lastAccessed` behaviour the whole project depends on.
  **Cross-check once:** run the dry-run through the MCP AND hand-pasted into
  Ctrl+Shift+J in a normal (non-Marionette) session, confirm the `pending` and
  `idle` columns agree. If they diverge, tune thresholds from the hand-pasted
  numbers — that's the honest read.
- **Security:** `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` + privileged eval is genuine
  system-level access. Don't leave Marionette on during normal browsing (it also
  trips bot-detection on some sites). Treat it as a deliberate dev-session toggle.

### Option B — self-rolled file-watch harness (measurement-safe fallback)

A tiny userChrome.js dev mod that watches a file in the profile dir, evals its
contents in chrome context, and writes results to a second file. Claude Code gets
the same write-script-see-output loop, but Zen stays in its **normal** state — no
automation prefs, no signal skew. Costs a small DIY build. Use this if Option A's
step-5 probe fails, or if the cross-check shows automation is skewing the idle
signal.

### Unchanged either way

Claude Code owns the files/git and writes/iterates the scripts, but the scripts
run in Zen — via the MCP, the harness, or you pasting into Ctrl+Shift+J. The
test loop itself doesn't change.

---

## Current prototype state

Both dry-run scripts exist in `dryrun/` (v1.js baseline, v2.js current) and have
been run against a real live profile (31 tabs, not the earlier 55-tab profile —
different device/session). v2 is **validated**: essential now correctly reports
`essential` instead of `pinned` (guard-order fix confirmed), `about:blank`
correctly reports `empty` and is excluded, pending/unloaded tabs still show sane
spread-out idle ages (3.0d–147.1d, no collapse-to-restore-time), and the
continuous `setInterval` loop runs cleanly. 19 of 31 flagged as would-archive —
higher proportion than the earlier 18/55 run, but explained by this profile
simply having more long-stale tabs (several 70–147d idle), not a logic issue.

Knobs live at the top of `dryrun/v2.js`:
```js
const THRESHOLD_HOURS = 24;   // archive ordinary tabs idle longer than this
const SKIP_PINNED     = true; // permanent shelf
const SKIP_ESSENTIALS = true; // zen-essential, permanent shelf
```

Note: v1/v2 read `gBrowser.tabs` = current window only. Multi-window is a
deliberate later concern, not an oversight.

**Tooling decision:** skipping the firefox-devtools-mcp / Marionette route
(Option A) for now — not worth the setup cost, and it risks perturbing the
exact `lastAccessed`/`pending` signal the project depends on (Marionette sets
`navigator.webdriver=true` and applies automation prefs). Hand-pasting into the
Browser Console (Ctrl+Shift+J) is working fine. Revisit only if manual
copy-paste becomes the iteration bottleneck.

**Archive store built:** `src/archiveStore.mjs`. One JSON file at
`<profile>/zen-tab-archive/archive.json`, in-memory cache as source of truth,
writes serialized through a promise-chain queue (`enqueueWrite`) — designed in
now, not deferred, because Arc's own UX (confirmed: it supports **manual**
archive via right-click, in addition to its own idle-timer auto-archive) means
our archiver will have a second writer soon too, and retrofitting a queue later
would mean redoing this. Record schema:
```js
{
  id,              // uuid, stable key for undo/UI/search
  workspaceId,     // zen-workspace-id — what makes restore-to-workspace possible
  url,
  title,
  favicon,         // data: URI, optional — keeps export self-contained
  archivedAt,      // epoch ms — drives "grouped by time" in the archive UI
  lastAccessedAt,  // epoch ms, tab.lastAccessed at archive time (audit/debug)
  tabState,        // SessionStore.getTabState(tab), parsed — NOT just url/title;
                   // this is what preserves scroll/form-data/back-forward history
                   // on restore instead of a bare re-navigate
}
```
API: `appendTab(record)`, `removeTab(id)`, `listTabs()`. Not yet wired to
anything — no code calls `appendTab` yet (no archiver loop, no manual-archive
action). Not yet tested against a live profile.

---

## Multi-workspace archiving — confirmed architecture

Critical, non-obvious discovery made while testing the restore PoC live:

- **`gBrowser.tabs` is scoped to the ACTIVE workspace only** (plus
  globally-visible essentials). A different workspace's ordinary tabs are not
  hidden/filtered — they are simply **absent** from `gBrowser.tabs` until you
  switch to that workspace. (Early dry-run tables that appeared to show two
  workspaces at once were actually essentials + whichever single workspace was
  active at scan time — a misread, not evidence of cross-workspace visibility.)
- **`gZenWorkspaces._allStoredTabs` is the real superset**: a flat array of
  every `<tab>` DOM element across every workspace, always current, regardless
  of which workspace is active. `_workspaceCache` is the array of workspace
  metadata (`uuid`, `name`, `icon`) — five workspaces confirmed on the test
  profile: Home, dev, jobs 👔, server 🌐, flat.
- **Archiving (`gBrowser.removeTab`) needs NO workspace switch.** Confirmed
  live: pulling a tab element from `_allStoredTabs` (belonging to a workspace
  that is NOT active) and calling `zenRestorePoc.archive()` on it directly
  removed it cleanly, with the active workspace unchanged throughout.
- **Restoring (`gBrowser.addTab`) DOES need a workspace switch first** —
  confirmed live both directions: a new tab always inherits whichever
  workspace is currently active, so `gZenWorkspaces.changeWorkspaceWithID(id)`
  must run before `addTab` for the tab to land back in its origin workspace.
  This is fine UX-wise — switching at the moment you restore something is the
  one time you actually want to see it reappear.

**Net result: the background archiver can silently sweep ALL workspaces**
(scan via `_allStoredTabs`, remove via `removeTab`, no switching, no visible
disruption) — the original "continuous, mid-session, across the whole
browser" vision from the top of this doc is fully buildable, no compromise.
Restore is the only operation that visibly jumps you to a workspace, which is
correct/expected.

`dryrun/v3.js` supersedes v2 as the reference dry-run: scans
`_allStoredTabs` instead of `gBrowser.tabs`, giving a true all-workspace idle
picture (workspace names resolved via `_workspaceCache`). v2 stays as
historical baseline; v1 as the original.

---

## The real archiver — `src/archiver.mjs`

Built this session, **not yet run live**. Merges v3's scan logic (all-workspace,
via `_allStoredTabs`, same skip rules/order) with real `archiveStore.mjs`
calls — this replaces the manual `zenRestorePoc.archive()` workflow entirely.

- Promoted out of `dryrun/` into `src/` deliberately: this is mod logic being
  tested live, not a dry run. `archiveStore.mjs` and `archiver.mjs` are
  siblings; `archiver.mjs` imports the store via a plain relative
  `import * as store from "./archiveStore.mjs"` (works fine under the
  `resource://` substitution scheme).
- `scanOnce()` — one pass: builds the same record shape as the PoC (now
  including `favicon` via `tab.getAttribute("image")`, previously stubbed
  null), `appendTab`s it, `removeTab`s the real tab. Per-tab try/catch so one
  bad tab can't kill the scan. Guarded by an `isScanning` flag against
  re-entrant timer overlap.
- `start()` / `stop()` — arms/disarms the 5-min `setInterval`. `start()` also
  runs one scan immediately.
- `restore(id)` / `list()` — same as the PoC, re-exported for console/undo use
  until real UI exists.
- **`skipPermitUnload: true` — deliberate.** This runs unattended on a timer;
  a blocking "leave page?" modal firing on a tab the user isn't looking at is
  worse than silently archiving it, and nothing is actually lost —
  `SessionStore.getTabState` captures form data too, so `restore()` brings it
  back intact. (We don't have confirmed knowledge of what Arc itself does
  here — this is our own reasoning, not a copied behaviour.)

Loader: `dryrun/load-archiver.js` — console bootstrap only (sets the
`resource://` substitution, imports `archiver.mjs`, assigns
`window.zenArchiver`). Does **not** auto-start; run `zenArchiver.start()` by
hand for the first live test since it actually closes tabs. Will be replaced
by a real fx-autoconfig/Sine loader at packaging time (step 6).

**Live-tested and validated** — against an isolated **copy** of the real
profile (see "Testing against a disposable profile copy" below), not the
live daily-driver one. First real run: 448 tabs scanned, 396 archived, 0
failed, across all 5 workspaces in one pass. Findings from digging into the
result:
- **Fixed a real bug found immediately**: the first version referenced
  `gBrowser`/`gZenWorkspaces`/`SessionStore`/`setInterval`/`clearInterval` as
  bare globals, which threw (`setInterval is not defined`,
  `gZenWorkspaces is not defined`) — because `archiver.mjs` runs as an ESM
  module (`ChromeUtils.importESModule`), which gets its own privileged
  module-global scope, **not** the browser chrome window's scope. Those all
  live on the window object. Fixed via `getWin()` →
  `Services.wm.getMostRecentWindow("navigator:browser")`, threading `win`
  through every function that needs it. (`archiveStore.mjs` never hit this
  since it only touches true globals `IOUtils`/`PathUtils`.)
- **Investigated an apparent duplicate/count anomaly (396 → 398 → 400) and
  ruled out a bug.** Grouping archived records by URL found 6 "duplicate"
  groups — but each has distinct `id`s and distinct `archivedAt` timestamps
  seconds apart within the *same* scan pass, meaning they're genuinely
  separate tabs open to the same URL (e.g. 3 reddit.com tabs), not
  double-archiving. The 398/400 growth is explained by (a) 2 leftover
  records already sitting in `archive.json` from earlier `restore-poc.js`
  testing, carried into the profile copy, and (b) a couple of tabs crossing
  the 24h threshold in a later scan cycle — the timer working as intended.
- **Restore does not get re-archived.** Restored a tab (IKEA listing) after
  the bulk run; checked later and it never reappeared in the archive store,
  confirming `SessionStore.setTabState` on restore doesn't clobber
  `lastAccessed` with the old archived-at-time value (a real risk that was
  worth ruling out — a naive restore could otherwise make a tab look
  immediately idle again and get silently re-archived next cycle).

Bottom line: the real archiver is solid. `uncaught exception: Object
{ message }` noise seen alongside archiving (Sentry CORS-block errors,
`AbortError: Actor 'Conduits' destroyed`) is web-page/extension teardown
noise unrelated to our code — no stack trace into `archiver.mjs`, `0 failed`
on every scan.

### Testing against a disposable profile copy

Testing now happens against a **copy** of the real profile, never the live
one, so a bulk archive run can't touch daily-driver tabs. One-time setup used:
1. Grab the real profile's path: `PathUtils.profileDir` in its Browser
   Console.
2. Fully quit Zen (check Task Manager for lingering `zen.exe`).
3. `robocopy` the whole profile dir to a sibling folder (e.g.
   `10a741l4.archiver-test`).
4. Launch the copy as an independent instance:
   `zen.exe -profile "<copy path>" -no-remote` (`-no-remote` is required —
   without it Zen hands off to an already-running instance instead of
   opening separately).
5. Verify: `PathUtils.profileDir` in the new window should print the copy's
   path.

The copy is a frozen snapshot from copy-time — it does **not** stay in sync
with the real profile, and the real profile is untouched by anything run
against the copy. Archives persist in the copy's own
`zen-tab-archive/archive.json` regardless of restarting that instance.

---

## Roadmap (in order)

1. ~~v2 dry-run~~ — done, validated live. Superseded by v3 (all-workspace scan).
2. ~~Archive store design~~ — done: `src/archiveStore.mjs`, schema above.
3. ~~Restore-to-workspace PoC~~ — done and fully validated, including the
   multi-workspace architecture above. `dryrun/restore-poc.js` proves the
   whole loop: archive (any workspace, no switch) → store → restore (switches
   to origin workspace, recreates via `SessionStore.setTabState`).
4. ~~Wire the real archiver~~ — done: `src/archiver.mjs`, live-tested against
   a disposable profile copy (see above). 448 tabs → 396 archived in one
   pass across all 5 workspaces, 0 failed, restore confirmed stable (no
   re-archive-on-restore), apparent duplicates investigated and ruled out.
5. ~~UI~~ — done for now, two views built and iterated live (see below):
   `src/archiveView.mjs` (cross-workspace popup) and `src/archiveSidebar.mjs`
   (inline per-workspace ghost rows). **Note: the earlier "sidebar-section
   approach rejected as highest-effort" line in this roadmap was wrong** —
   turned out very doable once Zen's real DOM structure was sourced instead
   of guessed. Toast-with-undo at archive time not built yet — deferred,
   not blocking.
6. ~~Package as a real Sine mod~~ — done, installed and working end-to-end
   against the disposable test profile (see "Packaging — Sine mod" below).
   Publishing (Discussions posts etc.) still deliberately deferred per the
   "Deferred" section below.
7. ~~UI polish pass #2~~ — done, driven by live screenshot feedback against
   the installed Sine mod (not the console-loader dev loop). Real Zen design
   tokens throughout (`--zen-colors-*`, `--zen-border-radius`/
   `--zen-squircle-value`, `corner-shape: superellipse()`) instead of
   generic system colors; hover-reveal row actions with an overlay+mask-fade
   pattern (popup and sidebar both); time-bucket grouping
   (Today/Yesterday/This week/This month/Older) in the popup; per-workspace
   "forget all" bulk action in both views; desaturated favicons that wake to
   full color on hover; a real fixed-icon treatment (CSS mask +
   `background-color: currentColor`, not a plain `<img src="...svg">`,
   which doesn't get the automatic tinting XUL toolbarbutton icons get) for
   the header icon and clear-all button; and — after three failed
   approaches — a working per-row edge blur/fade in the sidebar (see
   "Sidebar edge blur" below for the full story, it's a good one).
8. **CI: tiered compatibility checks against new Zen releases** — scaffold
   built and pushed (`.github/workflows/zen-compat.yml`, `ci/`), **not yet
   run**. Triggered weekly and via Actions → "Zen compatibility canary" →
   Run workflow. Unverified: the driver layer (geckodriver driving a headless
   Zen binary in chrome context) is the riskiest piece and will need
   iteration on the first real run. See "CI design notes" below.

### Packaging — Sine mod

The project is now a real installable [Sine](https://github.com/CosmoCreeper/Sine)
mod, not just console-pasted dev scripts. Repo:
https://github.com/k-gaia/zen-tab-archive (public — required, see below).

**File layout changed to match Sine's real format** (confirmed from Sine's
own source, `manager.sys.mjs`/`utils.sys.mjs`, not guessed):
- `theme.json` (repo root) — the manifest: id/name/version/description,
  `preferences: "preferences.json"`, and `scripts` — a flat object keyed by
  path, e.g. `"src/archiver.sys.mjs": {}`. Leaf keys ending `.sys.mjs` are
  **background modules**, loaded once via `ChromeUtils.importESModule`.
  Leaf keys ending `.uc.js`/`.uc.mjs` are **window scripts**, loaded **per
  browser window** via `Services.scriptloader.loadSubScriptWithOptions`,
  which means they run directly in that window's own scope — `gBrowser`,
  `document`, `gZenWorkspaces`, `setInterval` are real bare globals there,
  no `getWin()` needed. (The `modules` field in theme.json is unrelated —
  it's for declaring *other Sine mods* as dependencies, not your own files;
  confirmed by reading `installMod`'s recursive call on `newThemeData.modules`.)
- `preferences.json` (repo root) — declarative settings shown in Zen's
  native preferences UI. Array of `{type, label, property, ...}`; `property`
  is a real about:config pref string (convention: `uc.<mod-id>.<key>`).
  Types confirmed from the wiki: checkbox/string/text/separator, plus
  `size`/`border`/`margin`/`conditions`/`operator`/`restart` modifiers.
- `src/archiveStore.mjs` → `src/archiveStore.sys.mjs`, `src/archiver.mjs` →
  `src/archiver.sys.mjs` — renamed only, unchanged behavior, still resolve
  a window via `getWin()` since they're background modules.
- `src/archiveView.mjs` → `src/archiveView.uc.js`, `src/archiveSidebar.mjs`
  → `src/archiveSidebar.uc.js` — converted from ESM (`export function`) to
  plain scripts that attach to `window.ZenTabArchive.view` /
  `window.ZenTabArchive.sidebar`. All `win.`/`getWin()` threading removed —
  real bare globals now that they run in actual window scope.
- `archiver.sys.mjs`'s knobs (threshold-hours, interval-minutes,
  skip-pinned/essentials/active/audible) are now real about:config prefs
  under `uc.zen-tab-archive.*`, read live via `Services.prefs.get*Pref` with
  fallback defaults — bound to `preferences.json` entries. Re-read every
  scan (no restart needed) except interval-minutes, which only takes effect
  on the next `start()` — marked `restart: true`.
- `archiver.sys.mjs` now **self-starts** on load (see bottom of the file)
  instead of requiring a manual `start()` call — that was a dev-time safety
  gate (it actually closes tabs), not appropriate once this is a real
  installed mod. Handles both possible load orderings (Sine loads
  background modules before per-window scripts, possibly before any browser
  window exists): starts immediately if a window already exists, otherwise
  waits for `browser-delayed-startup-finished`.

**Real installation, done live** (manual method from Sine's own docs,
`sineorg/docs/src/installation.md` — not the "automatic" installer, to
avoid running an unknown downloaded .exe):
1. Bootloader `program.zip` (from `sineorg/bootloader` releases) extracted
   into `C:\Program Files\Zen Browser\` — the **shared program install**,
   requires admin elevation (had the user run this step themselves).
   Adds `config.js` (hooked in via `general.config.filename`/
   `general.config.sandbox_enabled` prefs from `defaults/pref/config-prefs.js`,
   the classic Firefox AutoConfig mechanism) + `defaults/`. By itself this
   does nothing to any profile — inert without step 2.
2. Bootloader `profile.zip` + Sine's own `engine.zip` (from `CosmoCreeper/Sine`
   releases) extracted into the **test profile's own** `chrome/` folder —
   scoped to just the disposable test profile, never the real one.
3. `about:support` → "Clear Startup Cache" + full restart.
4. In Sine Mods settings (a real new "Sine Mods" section appears, confirmed
   via screenshot — a marketplace UI with an "add your own locally from a
   GitHub repo" field), typed `k-gaia/zen-tab-archive` → Install.

**Real bugs found and fixed during this** (none of these were guessable in
advance — each needed a live repro):
- **Private repos silently don't work.** Sine's `installMod` fetches
  `theme.json` via `raw.githubusercontent.com`, and separately downloads
  the whole repo as a zip via `codeload.github.com/.../zip/<branch>` — both
  need unauthenticated public access. A private repo just 404s, and Sine's
  error handling doesn't surface this clearly (Install button just greys
  out with no console error) — confirmed via `curl -sI` on the raw URL
  before/after flipping the repo to public (404 → 200). **Fix: made the
  repo public** (contains no secrets — checked before every commit).
- **`sine.allow-unsafe-js` gate.** Scripts from non-store mods (anything
  installed via the "local GitHub repo" field, i.e. everything we'd ever
  do) don't execute at all unless this about:config pref is set to `true` —
  `utils.getScripts()` silently filters them out
  (`mod.enabled && (allowUnsafeJS || mod.origin === "store")`). The mod
  installs and registers in `mods.json` fine either way; only the actual JS
  execution is gated. No error, just an empty resolved-scripts list —
  diagnosed by importing Sine's own `utils.sys.mjs` directly in the console
  and calling `getScripts()` ourselves (`dryrun/probe-mod-scripts.js`) to
  see what it actually resolved.
- **Wrong chrome:// path (our bug, not Sine's).** Hardcoded
  `chrome://sine/content/src/archiver.sys.mjs` in both `.uc.js` files —
  missing the mod-id path segment. Sine serves each mod's files under
  `chrome://sine/content/<mod-id>/...`, matching the real disk layout
  (`chrome/sine-mods/<mod-id>/src/...`). Surfaced as
  `Error: Failed to load chrome://sine/content/src/archiver.sys.mjs` once
  the allow-unsafe-js gate was cleared. Fixed to
  `chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs`.
- **No in-place update in this Sine version's UI** — only "Remove mod" and
  re-install from the same GitHub field. That's the actual dev loop for now:
  push a fix → remove mod → re-install → (fully restart, not just a new
  window, to be safe) → re-check.
- **`window.manager`/`window.ZenTabArchive` don't populate on an
  already-open window** — both are set by a "new window created" observer
  inside Sine/our own scripts, so an already-open window never gets them
  retroactively. Always check on a *newly opened* window or after a full
  restart, not the window you were already in when something loaded.

Confirmed fully working end-to-end after all of the above:
`window.ZenTabArchive` → `{ view: {...}, sidebar: {...} }` on a fresh
window, matching the real API.

### UI — built and validated live

**`src/archiveView.mjs`** — cross-workspace popup, "show me everything."
Privileged XUL `<panel>` appended directly into the chrome document (not a
tab/webpage), toggled via a real toolbarbutton added into
`#zen-sidebar-foot-buttons` (Zen's own sidebar-bottom toolbar, confirmed via
source — see below). Rows grouped by workspace via `_workspaceCache`
name/icon, search box, per-row Restore/Forget. Loader: `dryrun/load-archive-view.js`.

**`src/archiveSidebar.mjs`** — inline per-workspace ghost rows, "ambient
glance in the workspace I'm already in." Appends a collapsed-by-default
"Archived Tabs (N)" section directly into each `<zen-workspace>` element,
styled to match a real tab row exactly (sizes confirmed via
`probe-tab-style.js`: 40px footprint, 14px radius, 16px icon). Loader:
`dryrun/load-archive-sidebar.js`.

Key findings from building it:
- **Sourced Zen's actual GitHub repo instead of guessing DOM structure** —
  `zen-browser/desktop`, `dev` branch. Confirmed via
  `src/browser/base/content/zen-sidebar-icons.inc.xhtml`:
  `#zen-sidebar-foot-buttons` toolbar contains (in order) the expand-sidebar
  button, `#zen-workspaces-button` (workspace switcher), `#zen-create-new-button`
  ("+" menu). Confirmed via `src/browser/base/content/zen-panels/popups.inc`:
  `#zenWorkspaceMoreActions` is the existing right-click "more actions" menu
  on a workspace — a ready-made hook for a future per-workspace context-menu
  entry, not yet used.
- **`<zen-workspace id="{uuid}">` structure** (confirmed via
  `probe-workspace-element.js` against a real profile — varies by how heavily
  used the workspace is, light ones showed 4 children, a heavy one showed
  the same 4 plus more): `<zen-workspace-collapsible-pins>`, a
  `zen-current-workspace-indicator` vbox, `<arrowscrollbox
  class="workspace-arrowscrollbox">` (real tabs — `tabsContainer`/
  `pinnedTabsContainer` are nested INSIDE this, not direct children of
  `<zen-workspace>`), then `<vbox class="zen-workspace-empty-space">`
  (flex-grow filler, last). We append our section as the true last child,
  AFTER the empty-space filler, so it shrinks to fill the gap above us —
  pins the section to the actual bottom of the sidebar. The section uses
  `flex-direction: column-reverse` so the collapsed header stays pinned at
  that bottom edge and the row list expands UPWARD when opened.
- **Inactive workspaces move off-screen via `transform`** on the whole
  `<zen-workspace>` element (not a `hidden` attribute) — confirmed, so a
  child of ours hides/shows with workspace switches for free.
- **The stale-reload bug bit repeatedly during this build**, in three
  different forms, all the same root cause: re-pasting a loader creates a
  *new, isolated* `ChromeUtils.importESModule` instance with fresh
  module-scope state that can't see or cancel anything the *previous*
  instance set up.
  1. A leftover DOM node (button/panel) built by an old instance keeps its
     OLD event listeners bound to the OLD closure forever, even after
     reloading — fixed by always tearing down and rebuilding rather than
     "reuse if it exists."
  2. A leftover `<style>` tag blocks CSS changes from ever reaching the page
     on reload, even though the JS refreshes fine — same fix.
  3. **The nastiest one**: `setInterval` timer handles stored in
     module-scope `let` variables orphan on every reload — the new
     instance's `if (timer) clearInterval(timer)` guard is checking ITS OWN
     fresh `null`, not the old instance's timer, so old polling loops never
     actually stop. Multiple zombie timers end up running concurrently, each
     rebuilding the UI with whatever (possibly outdated) code it was loaded
     with, stomping on each other every time they fire — looks like the UI
     randomly reverting to old behavior. **Fix applied in both
     `archiver.mjs` and `archiveSidebar.mjs`: store the timer handle as a
     property on the `window` object itself** (persists across reloads),
     not in module-scope state. Already-orphaned timers from before the fix
     can't be cancelled after the fact (no reference to their IDs) — only a
     full browser restart clears them.
- **Known rough edge, left unfixed for now**: the archived-rows list (a real
  XUL `arrowscrollbox`, same element Zen's own tab strip uses, chosen so
  scrolling matches the native feel) still occasionally clips the last
  visible row by a few pixels when a workspace has many archived tabs.
  Root cause understood: arrowscrollbox renders its up/down arrow buttons as
  native anonymous content (confirmed not queryable — `.scrollbutton-up`/
  `-down` and anything with "scroll"/"button" in its class all return
  nothing), and that chrome is *stateful* (the "up" arrow has zero size at
  `scrolledtostart`), so top/bottom insets aren't equal and can't be
  reliably pre-measured or padded for generically. Tried: CSS `mask-image`
  on the arrowscrollbox directly (no visible effect — likely doesn't apply
  to its native-painted scrolled content), measuring the first row's offset
  and doubling it as padding (wrong — insets aren't symmetric), undersizing
  the box by a fixed safety margin (reduced but didn't eliminate it). Not
  investigated further — revisit if it's ever actually annoying rather than
  cosmetic.
- **The scroll-edge blur/fade** went through four real iterations before
  landing on a working approach — see "Sidebar edge blur — the full story"
  below. The overlay-div + `backdrop-filter` approach described in earlier
  versions of this doc is **retired**; current approach blurs+fades each
  row directly, driven by scroll position.
- **Restore/forget play a quick shrink-and-fade transition** before the row
  actually leaves the DOM (`.zag-removing` class + a `180ms` delay before
  the real store mutation + list rebuild), instead of vanishing instantly.

### UI polish pass #2 — real Zen tokens, driven by live screenshots

Done after the mod was actually installed via Sine — this round was
diagnosed and fixed against the real running mod (edit → sync file directly
into `chrome/sine-mods/zen-tab-archive/src/` → new window to hot-reload
`.uc.js` changes), not the old console-loader dev loop, which no longer
applies once Sine owns loading.

- **Real Zen design tokens**, sourced from Zen's own stylesheets
  (`src/zen/common/styles/zen-theme.css`, `zen-buttons.css`,
  `zen-popup.css` in the `zen-browser/desktop` repo — not guessed):
  `--zen-colors-primary/secondary/tertiary`, `--zen-colors-hover-bg`,
  `--zen-colors-input-bg`, `--zen-colors-border`, `--zen-border-radius`
  scaled by `--zen-squircle-value` (their real corner-shape system — they
  use `corner-shape: superellipse()` for true squircles, which we adopted
  too), and an oklch-derived `--zen-accent-button-color`/
  `-background`. The popup's own `<panel type="arrow">` already inherited
  Zen's native `--panel-background-color`/`--panel-border-radius` for
  free; the old CSS was overriding all of it with generic system colors
  (`Canvas`/`ButtonFace`/`AccentColor`/`ThreeDShadow`) on our own inner
  content, which is what made it look like a dialog dropped on top of Zen
  rather than part of it.
- **Hover-reveal row actions** in both views now (popup used to always show
  Restore/Forget) — actions float over the title via `position: absolute`
  + a `mask-image` fade on the title, same overlay-not-push pattern proven
  in the sidebar earlier, applied to the popup too.
- **Time-bucket grouping** (Today/Yesterday/This week/This month/Older)
  within each workspace group in the popup — a flat newest-first list of a
  few hundred rows was hard to scan.
- **Per-workspace "forget all"** in both views, gated behind a native
  `confirm()` since it's irreversible and can wipe hundreds at once.
- **Desaturated favicons** (`filter: grayscale(0.45) brightness(0.9)`,
  full color on hover) — a colorful favicon still visually "pops" even
  under the row's own ghost opacity, since color saturation and opacity
  aren't the same visual axis. Applied to both views.
- **Real icon-button treatment, the hard way.** First attempt used an
  emoji (🗑) for the sidebar's clear-all button — emoji glyphs render as
  their own fixed-color bitmap icon that ignores `color`/`background`
  entirely, which read as "broken theming" but was really just the wrong
  technique. Second attempt swapped to a CSS-masked `trash.svg` +
  `background-color: currentColor` — the *right* idea (this is genuinely
  how you make an SVG icon tint like a native one, since a plain
  `<img src="...svg">` just renders whatever color is baked into the file
  and never gets the `currentColor` treatment a XUL toolbarbutton's
  `image` attribute gets automatically), but it came out invisible.
  Diagnosed live (`dryrun/probe-clear-all-icon.js`,
  `probe-sidebar-overlay-issues.js`): `computed backgroundColor` was
  `rgba(0,0,0,0)` despite being set explicitly, because `.zag-actions
  button { background: transparent }` (class + type selector, specificity
  0-1-1) was silently beating a bare `.zag-clear-all` rule (0-1-0),
  regardless of source order — the mask itself had been resolving
  correctly the whole time. Fixed by scoping to `.zag-actions
  .zag-clear-all` (0-2-0). Same mask technique fixed the sidebar header's
  `history.svg` icon too, which had the identical root cause (plain
  `<img>`, not currentColor-tinted) — new `.zag-header-icon` class, kept
  separate from `.zag-favicon` (real per-tab favicon images, which must
  render their own actual colors, never masked).
- **Popup's Restore button**: tonal treatment (soft accent-tinted
  background + accent-colored text) instead of a solid full-saturation
  fill — a solid fill clashed when the button's own hue was close to the
  workspace's own accent hue (a green button read as harsh on a
  green-themed workspace); a soft tint reads as integrated across any
  workspace color instead of just some.

### Sidebar edge blur — the full story

Four real iterations, worth recording in full since each one taught
something and the failure modes weren't guessable in advance:

1. **Overlay divs + `backdrop-filter: blur()` on top of the
   arrowscrollbox.** Worked, barely — rated "can see the blur for the
   first time" as a real improvement once the CSS specificity/positioning
   was sorted, but stayed too subtle even at `blur(6px)`.
2. **Added a `light-dark()`-aware gradient scrim under the blur**, to give
   a guaranteed-visible fade regardless of whether the blur was really
   sampling the native widget's content correctly. Rated **worse** than
   blur alone — reverted immediately rather than keep tuning a change that
   made things worse.
3. **`contain: paint` on the wrapping div**, after live feedback ("the
   screenshot literally shows the blur escaping the sidebar's edge") that
   directly contradicted a `getBoundingClientRect()`-based claim that
   nothing could be overflowing. That contradiction was the useful part:
   `getBoundingClientRect()` measures an element's **layout box**, but
   `backdrop-filter`'s blur **paints outside that box by design** (a blur
   is a convolution that spreads pixels beyond the exact edge) — matching
   rects never actually disproved visible paint bleed, it just wasn't the
   right thing to measure. `contain: paint` is the explicit CSS
   containment for *painted* output, not just content (`overflow: hidden`
   alone doesn't reliably clip filter effects). Didn't fully fix it: the
   overlay still spatially overlapped the arrowscrollbox's native up/down
   arrow buttons, by construction (both occupy the same top:0/bottom:0
   edge zone of the same box) — no amount of containment changes that.
4. **Retired the overlay approach entirely.** Blurs+fades each `.zag-row`
   directly instead, via `updateEdgeBlur()` driven by the arrowscrollbox's
   own `scroll` event — computes each row's distance from the visible
   list's top/bottom edge and applies `filter: blur()` + inline `opacity`
   proportional to that distance. Since it's our own row elements, not a
   separate layer trying to sample/composite against native widget
   content, it sidesteps the entire class of problem the first three
   attempts kept hitting. Confirmed live that `scroll` events do fire for
   arrowscrollbox's native arrow-button clicks, not just the wheel.
   Tuned twice more from there: linear ramping left a faint sliver right
   at the true edge (opacity/blur amount only hit their max exactly at
   distance 0), fixed with an eased curve (`raw ** 0.6`, plus an extra 1.3×
   multiplier on the opacity falloff specifically) so both reach "fully
   faded" well before the true edge instead of exactly at it; `FADE_ZONE`
   widened 24px → 40px → 56px for a bigger, more gradual transition.

### CI design notes (discussion stage, not built)

Concern raised: this mod hard-depends on Zen's undocumented internals
(`#zen-sidebar-foot-buttons`, `<zen-workspace>` child structure,
`gZenWorkspaces._allStoredTabs`/`_workspaceCache`, specific `--zen-*` CSS
custom properties, `chrome://browser/skin/zen-icons/*.svg` paths) that can
change without notice on any Zen release, and Sine pulls `theme.json` live
from `main` on every install/update — so there's no obvious way to stop a
user on an older Zen from getting a build that assumes newer internals.

Direction settled on so far: not a traditional test suite, but a
**tiered-severity canary CI job** —
1. **Critical/smoke tier** — does the mod load at all: `window.ZenTabArchive`
   populates, archiver self-starts, the DOM anchors we hard-depend on
   exist. Failure = dead for every user on that Zen version.
2. **Feature-regression tier** — narrower checks that specific things still
   work: restore actually restores content, forget actually removes from
   the store, sidebar renders correctly grouped. Failure = partial
   breakage.
3. **Cosmetic-drift tier** — do the specific `--zen-*` variables and icon
   paths we reference still exist. Failure = probably still works, might
   look wrong.

Mechanism: separate GitHub Actions **jobs** per tier (so job-level status
in GitHub's own UI already communicates severity at a glance) inside a
workflow triggered on a schedule and/or Zen release tags, running headless
Zen + Marionette. Note this reuses Marionette automation, which was
deliberately avoided earlier in this project for the archiver's *own*
idle-timing logic (risks skewing the real `lastAccessed`/`pending` signal)
— that objection doesn't apply here, since these checks are structural
("did Zen rename something we depend on"), not measuring real idle
behavior. On failure, auto-file (or update) a GitHub Issue labeled by
tier (`severity:critical`/`severity:minor`) rather than leaving a red X in
Actions that's easy to miss — a triageable backlog instead of scrollback.

Open question, not yet researched: whether Sine's `theme.json` format
supports declaring a compatible-Zen-version range or pinning at all — if
not, there's no clean way to gate a broken build from reaching users
regardless of how good the CI signal is, which matters for how much this
is worth building before the mod is actually published.

**Resolved, the hard way: Sine doesn't gate anything, confirmed from its own
source.** Neither `manager.sys.mjs` nor `utils.sys.mjs` reads a Zen version
or the `fork` field at all — `theme.json`'s `fork: ["zen"]` (which Nebula
and other mods declare) is purely documentation; Sine ignores it. So there
genuinely is no way to stop a user on an old Zen from getting a build that
assumes newer internals — the canary + a human-readable `tested-zen` field
is the only real lever, which is what's in `theme.json` now.

**The scoping already caught something real.** `include: [".*"]` is Sine's
default for `.uc.js` scripts, meaning ours were loading into every chrome
window, not just the main browser — confirmed by checking Nebula's own
`theme.json`, which scopes its script to
`chrome://browser/content/browser.xhtml`. Ours now does the same. Never
confirmed whether this was actually throwing in e.g. the Library window
before the fix, but the risk was real regardless (`buildButton()` throws
if `#zen-sidebar-foot-buttons` doesn't exist).

**Lived through exactly the compatibility problem this whole CI idea is
for, on Zen 1.23b.** The in-app updater moved the real profile and the test
profile from 1.22.3b to 1.23b (a release that also shipped a brand-new
native "Zen Mods" system, CSS/prefs-only, no JS — see below). After the
update, Sine's own settings page vanished — a known, still-open upstream
bug ([CosmoCreeper/Sine#675](https://github.com/CosmoCreeper/Sine/issues/675),
same symptom, no fix documented there). Our installed Sine engine was
`v2.3.3` (stable, May); the newest available is the `v2.3.4.1c`
**pre-release** (25 August), whose changelog claims it "resolves #564", a
startup mod-loading reliability bug. Swapped just the engine (`chrome/JS/`
only — confirmed via the release zip's contents that it doesn't touch
`sine-mods/` or the bootloader's `utils/`) into the test profile, old
engine backed up alongside it rather than deleted. **Confirmed working**:
Sine loads, our mod's changes show, no problems reported. CI's
`SINE_ENGINE_TAG` bumped to `v2.3.4.1c` to match. No Sine release yet
explicitly claims 1.23b support — this was found and verified live, not
documented anywhere upstream.

**Zen 1.23b's native "Zen Mods" system is CSS/prefs-only, not a Sine
replacement.** Confirmed from `ZenMods.mjs` source: a mod folder
contributes `chrome.css`/`content.css` and `preferences.json`-driven CSS
variables or show/hide toggles — no JavaScript execution at all. Since
archiving and the UI injection are both JS, native mods can't host this
project; Sine (or an equivalent loader) stays a hard requirement, not a
choice.

**Idea floated, parked for now: a Library section.** Zen 1.23b also
shipped a new Library feature (confirmed `src/zen/library/`, a LIT
component `<zen-library>` with sections for History/Downloads/Boosts/
Media/Spaces). No public registration API — `zenLibrarySections` is a
plain hardcoded object in the component, so adding our own section would
mean reaching into a live component instance and injecting a key, same
category of move as everything else in this project, but on the *newest*
and least-proven internal surface we'd have touched yet. Parked until
Sine-on-1.23b and the canary are both solid, which (per above) just
became true — worth revisiting.

### Deferred (do NOT do yet)
- **Post on Zen Discussions #5414** (and maybe #2326) flagging the mod as built
  and available to try, to raise upstream interest — **only once the mod is
  published and installable.** Lands as a demo, not a proposal.
  - #2326 "Auto-closing tabs after specified times / renaming tabs" —
    https://github.com/zen-browser/desktop/discussions/2326
  - #5414 "Auto-closing inactive tabs" (more active) —
    https://github.com/zen-browser/desktop/discussions/5414

---

## Working notes / gotchas

- **Generic tab extensions malfunction in Zen** (Tab Wrangler, Auto Tab Discard,
  Dustman): Zen's activity/unloading resets their inactivity timers — the core
  complaint in #5414. Reading `lastAccessed` directly sidesteps this. One
  purpose-built add-on exists ("Zen Auto-Close Tabs", AMO, June 2026) — unofficial,
  closes-only, no archive.
- **A part-filled Navy recruitment form** was among the 18 would-archive tabs on
  the real profile. Poster child for archive-with-recovery over hard-close —
  silently losing it is exactly the "punishing" failure to avoid.

---

## Suggested repo layout

```
zen-tab-archive/
├── CONTEXT.md            # this file
├── src/                  # the mod / userscript(s)
├── dryrun/               # console dry-run scripts (v1.js, v2.js, …)
└── notes/                # captured console output / test runs
```

`git init` now so restore-to-workspace experiments are revertible.
