// archiveStore.sys.mjs — persistence for archived tabs.
// A Sine "background script" (.sys.mjs, listed in theme.json's `scripts`) —
// loaded once via ChromeUtils.importESModule. Chrome-context ESM: uses the
// global IOUtils/PathUtils, no import needed.
//
// One JSON file in the profile dir. An in-memory cache is the single source
// of truth; every mutation persists through a serialized write queue, so the
// timer-driven auto-archiver and a future manual "archive now" action can't
// race each other into a corrupt read-modify-write.

const ARCHIVE_PATH = PathUtils.join(PathUtils.profileDir, "zen-tab-archive", "archive.json");
const SCHEMA_VERSION = 1;

let cache = null;       // { version, tabs: [...] } once loaded
let writeQueue = Promise.resolve(); // serializes persist() calls

function enqueueWrite(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

async function load() {
  if (cache) return cache;

  try {
    const text = await IOUtils.readUTF8(ARCHIVE_PATH);
    const parsed = JSON.parse(text);
    cache = { version: SCHEMA_VERSION, tabs: [], ...parsed };
  } catch (err) {
    if (err.name !== "NotFoundError") throw err;
    cache = { version: SCHEMA_VERSION, tabs: [] };
  }
  return cache;
}

async function persist() {
  return enqueueWrite(async () => {
    await IOUtils.makeDirectory(PathUtils.parent(ARCHIVE_PATH), {
      createAncestors: true,
      ignoreExisting: true,
    });
    await IOUtils.writeUTF8(ARCHIVE_PATH, JSON.stringify(cache, null, 2), {
      tmpPath: `${ARCHIVE_PATH}.tmp`,
    });
  });
}

/**
 * @param {object} record
 * @param {string} record.id            uuid
 * @param {string} record.workspaceId   zen-workspace-id to restore into
 * @param {string} record.url
 * @param {string} record.title
 * @param {string} [record.favicon]     data: URI
 * @param {number} record.archivedAt    epoch ms
 * @param {number} record.lastAccessedAt epoch ms, tab.lastAccessed at archive time
 * @param {object} record.tabState      SessionStore.getTabState(tab), parsed
 */
export async function appendTab(record) {
  await load();
  cache.tabs.push(record);
  await persist();
}

export async function removeTab(id) {
  await load();
  const before = cache.tabs.length;
  cache.tabs = cache.tabs.filter((t) => t.id !== id);
  if (cache.tabs.length === before) return false; // nothing removed
  await persist();
  return true;
}

// Removes several records in one write. Returns how many were removed.
export async function removeTabs(ids) {
  await load();
  const drop = new Set(ids);
  const before = cache.tabs.length;
  cache.tabs = cache.tabs.filter((t) => !drop.has(t.id));
  const removed = before - cache.tabs.length;
  if (removed) await persist();
  return removed;
}

// Drops every record archived before cutoffMs, in one write. Returns how
// many were removed.
export async function pruneArchivedBefore(cutoffMs) {
  await load();
  const before = cache.tabs.length;
  cache.tabs = cache.tabs.filter((t) => t.archivedAt >= cutoffMs);
  const removed = before - cache.tabs.length;
  if (removed) await persist();
  return removed;
}

export async function listTabs() {
  await load();
  return cache.tabs;
}
