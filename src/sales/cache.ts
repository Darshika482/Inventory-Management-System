/**
 * Last copy of the shop lists (items, categories, customers, settings) kept on
 * the phone, so the New Sale screen still opens when the internet drops.
 * Full offline support (Phase 5) builds on this.
 */

const PREFIX = 'shop_cache_';

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the screen just needs the internet next time.
  }
}

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Fetches fresh data and keeps a copy. When the fetch fails and a copy
 * exists, returns the copy instead (marked `fromCache`).
 */
export async function loadWithCache<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await fetcher();
    writeCache(key, data);
    return { data, fromCache: false };
  } catch (err) {
    const cached = readCache<T>(key);
    if (cached !== null) return { data: cached, fromCache: true };
    throw err;
  }
}
