/**
 * Platform-native listing key for vehicles.source_listing_key.
 *
 * Format: '<platform>:<native id>', the id exactly as the platform prints it (case preserved). It is the identity of
 * a listing; a URL is only one spelling of it (slug, www, case, query string all vary and
 * vehicles_canonicalize_discovery_url lowercases the stored URL). Mirror of the SQL function
 * public.hagerty_listing_key(text); keep the two in step (supabase/sql/test_hagerty_listing_key.sql).
 */

const HAGERTY_URL =
  /^https?:\/\/(?:www\.)?hagerty\.com\/marketplace\/(?:auction|listing)\/(?:[^/?#]+\/)*([^/?#]+)\/?(?:[?#].*)?$/i;
const HAGERTY_ID = /^[A-Za-z0-9]{20,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'hagerty:<id>' for a Hagerty Marketplace auction URL, else null. UUID ids are lowercased (canonical form). */
export function hagertyListingKey(rawUrl: string | null | undefined): string | null {
  const m = HAGERTY_URL.exec(String(rawUrl ?? '').trim());
  if (!m) return null;
  const id = m[1];
  if (UUID.test(id)) return `hagerty:${id.toLowerCase()}`;
  if (HAGERTY_ID.test(id)) return `hagerty:${id}`;
  return null;
}

/**
 * True when the key's id still carries Hagerty's original casing: it has an uppercase letter or is a UUID. An
 * all-lowercase 20-24 char id is a lowercased copy (case lost, e.g. from a canonicalized URL) and must not be used as an
 * identity key.
 */
export function isCaseSafeListingKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const id = key.slice(key.indexOf(':') + 1);
  return UUID.test(id) || /[A-Z]/.test(id);
}

// deno-lint-ignore no-explicit-any
type Db = any;

export type HagertyMatch = { id: string; matchedBy: 'listing_key' | 'legacy_url' };

/**
 * The live vehicle for a Hagerty listing key. First by source_listing_key (indexed, unique per live vehicle). Unless
 * keyOnly, then the legacy way: a not-yet-keyed Hagerty vehicle whose lowercased discovery_url ends in the same id
 * (case-insensitive, any slug), earliest first; the caller writes the key onto it. Returns null when none.
 */
export async function findHagertyVehicleId(
  db: Db,
  key: string,
  opts: { keyOnly?: boolean } = {},
): Promise<HagertyMatch | null> {
  const byKey = await db.from('vehicles').select('id').eq('source_listing_key', key).is('deleted_at', null).limit(1);
  if (byKey.error) throw new Error(`listing key lookup failed: ${byKey.error.message}`);
  if (byKey.data?.[0]?.id) return { id: byKey.data[0].id, matchedBy: 'listing_key' };
  if (opts.keyOnly) return null;
  const nativeId = key.slice(key.indexOf(':') + 1);
  if (!/^[A-Za-z0-9-]+$/.test(nativeId)) return null;
  const legacy = await db.from('vehicles').select('id')
    .eq('discovery_source', 'hagerty').is('deleted_at', null).is('source_listing_key', null)
    .ilike('discovery_url', `%/${nativeId}`).order('created_at', { ascending: true }).limit(1);
  if (legacy.error) throw new Error(`legacy listing lookup failed: ${legacy.error.message}`);
  return legacy.data?.[0]?.id ? { id: legacy.data[0].id, matchedBy: 'legacy_url' } : null;
}
