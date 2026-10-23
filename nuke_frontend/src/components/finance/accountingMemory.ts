/** The Accounting screen's remembered choices (active book, year): the URL first, then this browser's storage.
 *  Storage can be missing or blocked; then the choice holds for this visit only. Nothing here is testimony. */
const STORAGE_PREFIX = 'accounting.';

export function remembered(key: 'book' | 'year'): string {
  try {
    return new URLSearchParams(window.location.search).get(key) || window.localStorage.getItem(STORAGE_PREFIX + key) || '';
  } catch { return ''; }
}

export function remember(key: 'book' | 'year', value: string): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + key, value); else window.localStorage.removeItem(STORAGE_PREFIX + key);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url);
  } catch { /* storage or history unavailable: the choice still applies to this visit */ }
}
