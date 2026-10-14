// Launches Zen headless with the test profile, runs one tier of checks in
// chrome context, and writes ci-results/<tier>.json. Exits non-zero if any
// check in the tier fails so the matrix job goes red.
//
// Usage: node ci/run-tier.mjs <critical|feature|cosmetic>

import { mkdirSync, writeFileSync } from "node:fs";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const tier = process.argv[2];
if (!["critical", "feature", "cosmetic"].includes(tier)) {
  throw new Error(`unknown tier: ${tier}`);
}

// Each check: runs in chrome context. Return truthy = pass, or throw/return
// a string = fail with that detail.
const CHECKS = {
  critical: [
    {
      name: "window.ZenTabArchive is populated",
      script: `return !!window.ZenTabArchive;`,
    },
    {
      name: "librarySection module attached",
      script: `return !!window.ZenTabArchive?.librarySection;`,
    },
    {
      name: "zen-library exists with a section registry",
      script: `const lib = document.querySelector("zen-library"); return !!lib && typeof lib.zenLibrarySections === "object";`,
    },
    {
      name: "_workspaceCache is a non-empty array",
      script: `const c = gZenWorkspaces._workspaceCache; return Array.isArray(c) && c.length > 0;`,
    },
    {
      name: "allStoredTabs getter returns a non-empty array",
      script: `const t = gZenWorkspaces.allStoredTabs; return Array.isArray(t) && t.length > 0;`,
    },
    {
      name: "active workspace has a <zen-workspace> element",
      script: `return !!document.getElementById(gZenWorkspaces.activeWorkspace);`,
    },
  ],
  feature: [
    {
      name: "archiver module exposes its public API",
      script: `const a = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");
        return ["list", "restore", "restoreMany", "forget", "forgetMany", "scanOnce", "retentionMs"].every((k) => typeof a[k] === "function");`,
    },
    {
      name: "restoreMany brings tabs back fresh and removes their records",
      script: `const a = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");
        const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const tabState = JSON.parse(SessionStore.getTabState(gBrowser.selectedTab));
        const id = "ci-restore-" + Date.now();
        await s.appendTab({ id, workspaceId: gZenWorkspaces.activeWorkspace, url: "about:blank", title: "ci",
          favicon: null, archivedAt: Date.now(), lastAccessedAt: 0, tabState: { ...tabState, lastAccessed: 1 } });
        const before = new Set(gBrowser.tabs);
        const n = await a.restoreMany([id]);
        const added = [...gBrowser.tabs].filter((t) => !before.has(t));
        const fresh = added.length === 1 && Date.now() - added[0].lastAccessed < 60000;
        const gone = !(await s.listTabs()).some((t) => t.id === id);
        for (const t of added) gBrowser.removeTab(t);
        return n === 1 && fresh && gone || JSON.stringify({ n, added: added.length, fresh, gone });`,
    },
    {
      name: "background-restored tabs load their page when selected",
      script: `const a = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");
        const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const URL = "about:robots";
        const waitFor = async (cond, ms = 10000) => {
          const end = Date.now() + ms;
          while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
          return false;
        };
        const original = gBrowser.selectedTab;
        const src = gBrowser.addTrustedTab(URL);
        gBrowser.selectedTab = src;
        await waitFor(() => src.linkedBrowser.currentURI.spec === URL);
        // Without a flush getTabState can return no history entries yet.
        const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
        await TabStateFlusher.flush(src.linkedBrowser);
        const tabState = JSON.parse(SessionStore.getTabState(src));
        if (!tabState.entries?.length) return "captured source state has no history entries";
        gBrowser.selectedTab = original;
        gBrowser.removeTab(src);

        const ids = [1, 2, 3].map((i) => "ci-bg-" + i + "-" + Date.now());
        for (const id of ids) {
          await s.appendTab({ id, workspaceId: gZenWorkspaces.activeWorkspace, url: URL, title: "ci",
            favicon: null, archivedAt: Date.now(), lastAccessedAt: 0, tabState });
        }
        const before = new Set(gBrowser.tabs);
        await a.restoreMany(ids);
        const added = [...gBrowser.tabs].filter((t) => !before.has(t));
        await new Promise((r) => setTimeout(r, 1000));
        const loaded = [];
        for (const t of added) {
          gBrowser.selectedTab = t;
          loaded.push(await waitFor(() => t.linkedBrowser.currentURI.spec === URL) ? "ok" : t.linkedBrowser.currentURI.spec);
        }
        gBrowser.selectedTab = original;
        for (const t of added) gBrowser.removeTab(t);
        return (added.length === 3 && loaded.every((x) => x === "ok")) || JSON.stringify({ added: added.length, loaded });`,
    },
    {
      name: "retention prune removes only expired records",
      script: `const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const base = { workspaceId: "ci-probe", url: "about:blank", title: "ci", favicon: null, lastAccessedAt: 0, tabState: {} };
        const oldId = "ci-old-" + Date.now(), newId = "ci-new-" + Date.now();
        await s.appendTab({ ...base, id: oldId, archivedAt: Date.now() - 40 * 864e5 });
        await s.appendTab({ ...base, id: newId, archivedAt: Date.now() });
        await s.pruneArchivedBefore(Date.now() - 30 * 864e5);
        const ids = (await s.listTabs()).map((t) => t.id);
        await s.removeTabs([oldId, newId]);
        return !ids.includes(oldId) && ids.includes(newId);`,
    },
    {
      name: "archive store round-trips a synthetic record",
      script: `const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const id = "ci-probe-" + Date.now();
        await s.appendTab({ id, workspaceId: "ci-probe", url: "about:blank", title: "ci", favicon: null,
          archivedAt: Date.now(), lastAccessedAt: Date.now(), tabState: {} });
        const found = (await s.listTabs()).some((t) => t.id === id);
        await s.removeTab(id);
        const gone = !(await s.listTabs()).some((t) => t.id === id);
        return found && gone;`,
    },
    {
      name: "library section renders a row for a workspace with records",
      script: `const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const wsId = gZenWorkspaces.activeWorkspace;
        const id = "ci-render-" + Date.now();
        await s.appendTab({ id, workspaceId: wsId, url: "about:blank", title: "ci render probe", favicon: null,
          archivedAt: Date.now(), lastAccessedAt: Date.now(), tabState: {} });
        const node = window.ZenTabArchive.librarySection.Section.render();
        await new Promise((r) => setTimeout(r, 300));
        node.querySelector(".zal-group-header")?.click(); // groups start collapsed
        await new Promise((r) => setTimeout(r, 300));
        const ok = node.textContent.includes("ci render probe");
        await s.removeTab(id);
        return ok;`,
    },
  ],
  cosmetic: [
    ...["--zen-colors-secondary", "--zen-border-radius", "--zen-squircle-value"].map((name) => ({
      name: `${name} resolves`,
      script: `return getComputedStyle(document.documentElement).getPropertyValue("${name}").trim() !== "";`,
    })),
    ...[
      "chrome://browser/skin/zen-icons/search-glass.svg",
      "chrome://browser/skin/zen-icons/circle-bars-filter.svg",
      "chrome://sine/content/zen-tab-archive/src/icons/archived-tabs.svg",
    ].map((src) => ({
      name: `${src.split("/").pop()} icon resolves`,
      async: true,
      script: `const done = arguments[arguments.length - 1];
        const img = new Image();
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = "${src}";`,
    })),
  ],
};

async function waitForMod(driver, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await driver.executeScript(`return !!window.ZenTabArchive;`);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// executeScript doesn't await promises, so every check goes through
// executeAsyncScript and reports back via the done callback. Checks marked
// async already call done themselves (icon loads); the rest get wrapped.
function wrapForAsync(check) {
  if (check.async) return check.script;
  return `const done = arguments[arguments.length - 1];
    (async () => {
      try { done(await (async () => { ${check.script} })()); }
      catch (e) { done("threw: " + e.message); }
    })();`;
}

async function runCheck(driver, check) {
  try {
    const result = await driver.executeAsyncScript(wrapForAsync(check));
    if (result === true) return { name: check.name, ok: true };
    return { name: check.name, ok: false, detail: String(result) };
  } catch (err) {
    return { name: check.name, ok: false, detail: err.message };
  }
}

const driverService = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH ?? "geckodriver");
const options = new firefox.Options()
  .setBinary(process.env.ZEN_BIN)
  .setProfile(process.env.PROFILE_DIR)
  .addArguments("-headless", "-no-remote");

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(options)
  .setFirefoxService(driverService)
  .build();

const results = [];
try {
  await driver.setContext(firefox.Context.CHROME);
  await driver.manage().setTimeouts({ script: 60_000 });

  const ready = await waitForMod(driver);
  if (!ready) {
    results.push({ name: "mod loaded within 90s", ok: false, detail: "window.ZenTabArchive never appeared" });
  } else {
    for (const check of CHECKS[tier]) {
      results.push(await runCheck(driver, check));
    }
  }
} catch (err) {
  results.push({ name: "driver session", ok: false, detail: err.message });
} finally {
  await driver.quit();
}

mkdirSync("ci-results", { recursive: true });
const failed = results.filter((r) => !r.ok);
writeFileSync(
  `ci-results/${tier}.json`,
  JSON.stringify({ tier, zenTag: process.env.ZEN_TAG, ok: failed.length === 0, results }, null, 2),
);

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
process.exit(failed.length === 0 ? 0 : 1);
