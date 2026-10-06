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
      name: "view and sidebar modules attached",
      script: `return !!(window.ZenTabArchive?.view && window.ZenTabArchive?.sidebar);`,
    },
    {
      name: "sidebar foot toolbar exists",
      script: `return !!document.getElementById("zen-sidebar-foot-buttons");`,
    },
    {
      name: "_workspaceCache is a non-empty array",
      script: `const c = gZenWorkspaces._workspaceCache; return Array.isArray(c) && c.length > 0;`,
    },
    {
      name: "_allStoredTabs is present",
      script: `return Array.isArray(gZenWorkspaces._allStoredTabs) || gZenWorkspaces._allStoredTabs instanceof Object;`,
    },
    {
      name: "active workspace has a <zen-workspace> element",
      script: `return !!document.getElementById(gZenWorkspaces.activeWorkspace);`,
    },
  ],
  feature: [
    {
      name: "archiver module exposes list/restore/forget/scanOnce",
      script: `const a = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");
        return ["list", "restore", "forget", "scanOnce"].every((k) => typeof a[k] === "function");`,
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
      name: "sidebar renders a section for a workspace with records",
      script: `const a = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiver.sys.mjs");
        const s = ChromeUtils.importESModule("chrome://sine/content/zen-tab-archive/src/archiveStore.sys.mjs");
        const wsId = gZenWorkspaces.activeWorkspace;
        const id = "ci-render-" + Date.now();
        await s.appendTab({ id, workspaceId: wsId, url: "about:blank", title: "ci render probe", favicon: null,
          archivedAt: Date.now(), lastAccessedAt: Date.now(), tabState: {} });
        window.ZenTabArchive.sidebar.refreshAll();
        await new Promise((r) => setTimeout(r, 300));
        const section = document.getElementById(wsId)?.querySelector(".zen-archive-ghost-section");
        const ok = !!section && section.style.display !== "none";
        await s.removeTab(id);
        return ok;`,
    },
  ],
  cosmetic: [
    {
      name: "--zen-colors-primary resolves",
      script: `return getComputedStyle(document.documentElement).getPropertyValue("--zen-colors-primary").trim() !== "";`,
    },
    {
      name: "--zen-border-radius resolves",
      script: `return getComputedStyle(document.documentElement).getPropertyValue("--zen-border-radius").trim() !== "";`,
    },
    {
      name: "--zen-squircle-value resolves",
      script: `return getComputedStyle(document.documentElement).getPropertyValue("--zen-squircle-value").trim() !== "";`,
    },
    {
      name: "history.svg icon resolves",
      async: true,
      script: `const done = arguments[arguments.length - 1];
        const img = new Image();
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = "chrome://browser/skin/zen-icons/history.svg";`,
    },
    {
      name: "trash.svg icon resolves",
      async: true,
      script: `const done = arguments[arguments.length - 1];
        const img = new Image();
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = "chrome://browser/skin/zen-icons/trash.svg";`,
    },
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
