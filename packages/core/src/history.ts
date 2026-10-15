import type { Sample } from '@panodash/widget-sdk';

/**
 * Local time-series store in IndexedDB. Works in both the new-tab page and
 * the background service worker; nothing ever leaves the machine.
 */

const DB_NAME = 'panodash-history';
/** Pre-rebrand database name; migrated into DB_NAME on first open. */
const LEGACY_DB_NAME = 'panorama-history';
const STORE = 'samples';
export const DEFAULT_RETENTION_DAYS = 365;

/** Skip recording if the last sample is this recent — dedupes page-load
 *  refreshes against the background poller. */
const MIN_SAMPLE_GAP_MS = 4 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { autoIncrement: true });
      store.createIndex('byWidgetTime', ['widgetId', 't']);
      store.createIndex('byTime', 't');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-time copy of samples recorded under the pre-rebrand database name.
 * Only runs when the new database is still empty, so a re-entrant call
 * (page + background worker racing on first open) can at worst no-op.
 */
async function migrateLegacyHistory(db: IDBDatabase): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  const names = (await indexedDB.databases()).map((d) => d.name);
  if (!names.includes(LEGACY_DB_NAME)) return;

  const existing = await requestValue(
    db.transaction(STORE, 'readonly').objectStore(STORE).count(),
  );
  if (existing === 0) {
    const legacy = await openRaw(LEGACY_DB_NAME);
    try {
      const rows = (await requestValue(
        legacy.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
      )) as Sample[];
      if (rows.length > 0) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const s of rows) store.add(s);
        await txDone(tx);
      }
    } finally {
      legacy.close();
    }
  }
  indexedDB.deleteDatabase(LEGACY_DB_NAME);
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openRaw(DB_NAME).then(async (db) => {
    try {
      await migrateLegacyHistory(db);
    } catch {
      // Migration is best-effort; never block the store over it.
    }
    return db;
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestValue<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addSample(
  widgetId: string,
  value: number,
  t = Date.now(),
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add({ widgetId, t, value } satisfies Sample);
  await txDone(tx);
}

/** Bulk insert (CSV import) — one transaction for the whole batch. */
export async function addSamples(
  widgetId: string,
  rows: { t: number; value: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const row of rows) {
    store.add({ widgetId, t: row.t, value: row.value } satisfies Sample);
  }
  await txDone(tx);
}

/** Record a sample unless one for this widget is more recent than the gap. */
export async function recordSample(
  widgetId: string,
  value: number,
  t = Date.now(),
): Promise<boolean> {
  const last = await getLastSample(widgetId);
  if (last && t - last.t < MIN_SAMPLE_GAP_MS) return false;
  await addSample(widgetId, value, t);
  return true;
}

export async function getLastSample(widgetId: string): Promise<Sample | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('byWidgetTime');
  const range = IDBKeyRange.bound([widgetId, -Infinity], [widgetId, Infinity]);
  const cursor = await requestValue(index.openCursor(range, 'prev'));
  return cursor ? (cursor.value as Sample) : undefined;
}

/** Samples for one widget, oldest first, optionally since a timestamp. */
export async function getSamples(widgetId: string, since = 0): Promise<Sample[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('byWidgetTime');
  const range = IDBKeyRange.bound([widgetId, since], [widgetId, Infinity]);
  return requestValue(index.getAll(range)) as Promise<Sample[]>;
}

function drainCursor(
  req: IDBRequest<IDBCursorWithValue | null>,
  fn: (cursor: IDBCursorWithValue) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      fn(cursor);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteWidgetSamples(widgetId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('byWidgetTime');
  const range = IDBKeyRange.bound([widgetId, -Infinity], [widgetId, Infinity]);
  await drainCursor(index.openCursor(range), (c) => c.delete());
  await txDone(tx);
}

/** Drop samples older than the retention window. */
export async function pruneSamples(retentionDays = DEFAULT_RETENTION_DAYS): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('byTime');
  await drainCursor(index.openCursor(IDBKeyRange.upperBound(cutoff)), (c) => c.delete());
  await txDone(tx);
}

export async function exportAllSamples(): Promise<Sample[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return requestValue(tx.objectStore(STORE).getAll()) as Promise<Sample[]>;
}

export async function importSamples(samples: Sample[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const s of samples) {
    if (typeof s?.widgetId === 'string' && typeof s.t === 'number' && typeof s.value === 'number') {
      store.add({ widgetId: s.widgetId, t: s.t, value: s.value });
    }
  }
  await txDone(tx);
}
