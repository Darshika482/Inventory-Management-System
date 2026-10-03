/**
 * Pages open at once with the copy of their lists saved on this phone, then
 * swap in the fresh copy from the server when it arrives.
 */

let writeSerial = 0;

/** Called after every save to the database (see runDb). */
export function noteDbWrite(): void {
  writeSerial++;
}

export interface LocalStore<T> {
  read: () => T | null | Promise<T | null>;
  write: (value: T) => void;
}

/** A download that started before a save may have missed it: fetch again, this often at most. */
const MAX_REFETCH = 3;

/**
 * Shows the saved copy straight away (if there is one), then the fresh data,
 * which is saved for next time. Resolves 'copy' when only the saved copy
 * could be shown (no internet); rejects only when there is nothing to show.
 */
export async function loadLocalFirst<T>(
  store: LocalStore<T>,
  fetcher: () => Promise<T>,
  show: (data: T, fresh: boolean) => void
): Promise<'fresh' | 'copy'> {
  let copy: T | null = null;
  try {
    copy = await store.read();
  } catch {
    copy = null;
  }
  if (copy !== null) show(copy, false);

  try {
    for (let attempt = 0; ; attempt++) {
      const serial = writeSerial;
      const data = await fetcher();
      if (serial !== writeSerial && attempt < MAX_REFETCH) continue;
      store.write(data);
      show(data, true);
      return 'fresh';
    }
  } catch (err) {
    if (copy === null) throw err;
    return 'copy';
  }
}

// --- Saved copies in IndexedDB (room for far more than localStorage, and
// reading them never freezes the screen) ---

const DB_NAME = 'akshay-local-copies';
const STORE_NAME = 'lists';
const memory = new Map<string, unknown>();
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      // Private mode or an old browser: pages just wait for the internet.
      resolve(null);
    }
  });
  return opening;
}

async function readCopy<T>(key: string): Promise<T | null> {
  if (memory.has(key)) return memory.get(key) as T;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value = (request.result ?? null) as T | null;
        if (value !== null && !memory.has(key)) memory.set(key, value);
        resolve((memory.get(key) as T | undefined) ?? value);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeCopy<T>(key: string, value: T): void {
  memory.set(key, value);
  void openDb().then((db) => {
    try {
      db?.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
    } catch {
      // Storage full: the page will just wait for the internet next time.
    }
  });
}

/** A copy kept on this phone (in memory too, so going back to a page is instant). */
export function localCopy<T>(key: string): LocalStore<T> {
  return { read: () => readCopy<T>(key), write: (value) => writeCopy(key, value) };
}

/** On sign-out: the next person on this phone must not see the owner's lists. */
export function clearLocalCopies(): void {
  memory.clear();
  void openDb().then((db) => {
    try {
      db?.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
    } catch {
      // Nothing saved, nothing to clear.
    }
  });
}

/** Shown when a page could only show its saved copy. */
export const SAVED_COPY_NOTE = 'No internet. Showing the copy saved on this phone.';
