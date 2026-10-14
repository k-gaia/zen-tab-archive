import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeGlobals, freshImport, ARCHIVE_PATH } from "./helpers/chrome.mjs";

const rec = (id, archivedAt = 1000) => ({ id, archivedAt, workspaceId: "ws", url: "https://x.test/", tabState: {} });

let fs;
let store;

async function setup(files) {
  ({ fs } = installChromeGlobals({ files }));
  store = await freshImport("../../src/archiveStore.sys.mjs");
}

describe("archiveStore", () => {
  beforeEach(() => setup());

  test("starts empty when there is no archive file", async () => {
    assert.deepEqual(await store.listTabs(), []);
  });

  test("loads an existing archive file", async () => {
    await setup({ [ARCHIVE_PATH]: JSON.stringify({ version: 1, tabs: [rec("a")] }) });
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["a"]);
  });

  test("fills in a missing tabs array from an old file", async () => {
    await setup({ [ARCHIVE_PATH]: JSON.stringify({ version: 1 }) });
    assert.deepEqual(await store.listTabs(), []);
  });

  test("surfaces read errors other than a missing file", async () => {
    fs.readError = new Error("permission denied");
    await assert.rejects(store.listTabs(), /permission denied/);
  });

  test("only reads the file once", async () => {
    await store.listTabs();
    fs.readError = new Error("should not be read again");
    await store.listTabs();
  });

  test("appendTab persists the record atomically", async () => {
    await store.appendTab(rec("a"));
    const [write] = fs.writes;
    assert.equal(write.path, ARCHIVE_PATH);
    assert.equal(write.opts.tmpPath, `${ARCHIVE_PATH}.tmp`);
    assert.deepEqual(fs.dirs[0], { path: "/profile/zen-tab-archive", opts: { createAncestors: true, ignoreExisting: true } });
    assert.deepEqual(JSON.parse(fs.files.get(ARCHIVE_PATH)).tabs.map((t) => t.id), ["a"]);
  });

  test("removeTab removes a record and reports whether it found one", async () => {
    await store.appendTab(rec("a"));
    await store.appendTab(rec("b"));
    assert.equal(await store.removeTab("a"), true);
    assert.equal(await store.removeTab("missing"), false);
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["b"]);
    assert.equal(fs.writes.length, 3, "no write when nothing was removed");
  });

  test("removeTabs removes several records in one write", async () => {
    for (const id of ["a", "b", "c"]) await store.appendTab(rec(id));
    const before = fs.writes.length;
    assert.equal(await store.removeTabs(["a", "c", "missing"]), 2);
    assert.equal(fs.writes.length, before + 1);
    assert.equal(await store.removeTabs(["missing"]), 0);
    assert.equal(fs.writes.length, before + 1, "no write when nothing was removed");
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["b"]);
  });

  test("pruneArchivedBefore drops only records older than the cutoff", async () => {
    await store.appendTab(rec("old", 100));
    await store.appendTab(rec("edge", 500));
    await store.appendTab(rec("new", 900));
    const before = fs.writes.length;
    assert.equal(await store.pruneArchivedBefore(500), 1);
    assert.equal(fs.writes.length, before + 1);
    assert.equal(await store.pruneArchivedBefore(500), 0);
    assert.equal(fs.writes.length, before + 1, "no write when nothing expired");
    assert.deepEqual((await store.listTabs()).map((t) => t.id), ["edge", "new"]);
  });

  test("a failed write doesn't block later writes", async () => {
    fs.failNextWrite = true;
    await assert.rejects(store.appendTab(rec("a")), /disk full/);
    await store.appendTab(rec("b"));
    assert.deepEqual(JSON.parse(fs.files.get(ARCHIVE_PATH)).tabs.map((t) => t.id), ["a", "b"]);
  });
});
