/**
 * Shared helpers for listing URL normalization.
 *
 * Goal: produce a stable, comparable key for a listing URL across:
 * - http vs https
 * - www vs non-www
 * - trailing slashes
 * - querystring/hash variants
 *
 * This should match the DB-side normalization used for external_listings.listing_url_key.
 */

export function normalizeListingUrlKey(raw: string | null | undefined): string | null {
  const input = String(raw || '').trim();
  if (!input) return null;

  try {
    const u = new URL(input);
    u.hash = '';
    u.search = '';
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '').replace(/\/+$/, ''); // drop trailing slashes
    const key = `${host}${path}`.toLowerCase();
    return key || null;
  } catch {
    // Fallback for partial/invalid URLs
    const key = input
      .replace(/[?#].*$/, '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
      .trim();
    return key || null;
  }
}

