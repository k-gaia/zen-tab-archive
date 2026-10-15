# Zen Tab Archive

Arc-style automatic tab archiving for [Zen Browser](https://zen-browser.app), as a [Sine](https://github.com/CosmoCreeper/Sine) mod.

Tabs you haven't looked at for a while are moved out of your tab strip into an archive instead of piling up or being closed. Every archived tab can be brought back into the workspace it came from, with its history, scroll position and form data intact.

## Features

- **Automatic archiving across every workspace.** Tabs idle longer than a threshold (24 hours by default) are archived, including tabs in workspaces you aren't currently in. Pinned tabs, Essentials, the active tab and tabs playing audio are never archived.
- **An "Archived Tabs" section in Zen's Library**, grouped by workspace, with search and a "when archived" filter (today / this week / this month).
- **Restore exactly as it was.** Restoring a tab recreates it from its saved session state in its original workspace and container.
- **Multi-select and bulk actions.** Select several tabs and restore or forget them in one go. Bulk restores happen in the background, without switching workspace.
- **Keyboard navigation** throughout the Archived Tabs section (see below).
- **Automatic clean-up.** Archived tabs are deleted after 30 days by default, and each one shows how long it has left.
- **A brief summary on startup.** If tabs were archived since you last started Zen, a small Zen toast says how many, with a button to view them. Nothing is shown if nothing was archived.

## Requirements

- Zen Browser 1.23b or later (tested on 1.23.2b).
- [Sine](https://github.com/CosmoCreeper/Sine) installed in your Zen profile.

## Installation

1. In Zen's settings, open **Sine Mods** and add this mod from its GitHub repository: `k-gaia/zen-tab-archive`.
2. Sine only runs scripts from mods outside its marketplace if you allow it. Open `about:config` and set `sine.allow-unsafe-js` to `true`.
3. Restart Zen.

The first scan runs once Zen has finished restoring your session, so on a long-lived profile the first pass may archive a lot of tabs at once. They are all in **Library → Archived Tabs**.

## Settings

These appear on the mod's page in Zen's settings:

| Setting | Default | Notes |
| --- | --- | --- |
| Archive tabs idle longer than this many hours | 24 | |
| Delete archived tabs after this many days | 30 | `0` keeps them forever |
| Re-scan every this many minutes | 5 | Takes effect after a restart |
| Never archive a tab that's currently playing audio | On | |
| Show a short summary when Zen starts if tabs were archived | On | |

Pinned tabs, Essentials and the active tab can also be made archivable in `about:config` (`uc.zen-tab-archive.skip-pinned`, `skip-essentials` and `skip-active`; all default to `true`).

## Using the Archived Tabs section

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Select a tab | Click | Space |
| Add or remove a tab from the selection | Ctrl-click (Cmd-click on macOS) | Space |
| Select a range | Shift-click | Shift+↑ / Shift+↓ |
| Select everything visible | | Ctrl+A (Cmd+A) |
| Restore and switch to a tab | Double-click, or the row's **Restore** | Enter |
| Restore the selection in the background | **Restore** in the selection bar | Enter |
| Forget (permanently delete) | The row's **Forget**, or **Forget** in the selection bar | Delete or Backspace |
| Move between tabs and workspace groups | | ↑ / ↓, Home / End |
| Open or close a workspace group | Click its header | → / ←, Enter or Space on the header |
| Jump from the search box into the list | | ↓ |

A selection only ever includes tabs you can see: collapsing a group or filtering removes hidden tabs from it. Esc closes the Library, so use the selection bar's **✕** to clear a selection.

## Privacy

Everything stays on your machine. Archived tabs are stored in your Zen profile at `zen-tab-archive/archive.json`, and the mod makes no network requests of its own.

## Compatibility

The mod depends on parts of Zen that aren't a public API, so a Zen update can break it. A [scheduled GitHub Actions job](.github/workflows/zen-compat.yml) installs the mod into the latest Zen release every week, checks that it still works, and opens an issue labelled by severity if it doesn't.

## Development

The mod itself needs no build step: Sine loads the files in `src/` directly.

```sh
npm install
npm test           # unit tests
npm run coverage   # unit tests, failing below 100% coverage
```

The unit tests run the mod's code under Node against fakes of the Firefox and Zen APIs it uses (and [jsdom](https://github.com/jsdom/jsdom) for the Library section). The compatibility checks in `ci/` drive a real headless Zen instead.

| File | Role |
| --- | --- |
| `src/archiver.sys.mjs` | Scans for idle tabs, archives, restores and forgets them, and applies retention |
| `src/archiveStore.sys.mjs` | Persists the archive to a JSON file in the profile |
| `src/archiveLibrarySection.uc.js` | The Archived Tabs section in Zen's Library |
| `theme.json`, `preferences.json` | Sine's mod manifest and settings |
