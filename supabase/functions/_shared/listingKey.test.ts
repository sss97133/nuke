import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { findHagertyVehicleId, hagertyListingKey, isCaseSafeListingKey } from './listingKey.ts';

Deno.test('hagertyListingKey keeps the id case and ignores host, slug, query and slash', () => {
  const id = '2qNtqutlbqCk0DwL0ePQNb';
  const want = `hagerty:${id}`;
  assertEquals(hagertyListingKey(`https://www.hagerty.com/marketplace/auction/1912-buick-model-43-touring/${id}`), want);
  assertEquals(hagertyListingKey(`https://hagerty.com/marketplace/auction/other-slug/${id}/?utm=1#x`), want);
  assertEquals(hagertyListingKey(`http://HAGERTY.com/marketplace/auction/1920-Packard-Twin-Six%20Touring/Wd8YkMRPFQJ8rgdvav03T`), 'hagerty:Wd8YkMRPFQJ8rgdvav03T');
});

Deno.test('hagertyListingKey handles uuid ids and rejects non-listing urls', () => {
  assertEquals(
    hagertyListingKey('https://www.hagerty.com/marketplace/auction/1927-Packard-Six-526/E7DDD260-B431-47C3-A4A5-A5EEEAA7953B'),
    'hagerty:e7ddd260-b431-47c3-a4a5-a5eeeaa7953b',
  );
  assertEquals(hagertyListingKey('https://www.hagerty.com/marketplace/auction/slug-only'), null);
  assertEquals(hagertyListingKey('https://bringatrailer.com/listing/x/2qNtqutlbqCk0DwL0ePQNb'), null);
  assertEquals(hagertyListingKey(null), null);
  assertEquals(hagertyListingKey(''), null);
});

Deno.test('isCaseSafeListingKey flags lowercased ids', () => {
  assertEquals(isCaseSafeListingKey('hagerty:2qNtqutlbqCk0DwL0ePQNb'), true);
  assertEquals(isCaseSafeListingKey('hagerty:2qntqutlbqck0dwl0epqnb'), false);
  assertEquals(isCaseSafeListingKey('hagerty:e7ddd260-b431-47c3-a4a5-a5eeeaa7953b'), true);
  assertEquals(isCaseSafeListingKey(null), false);
});

// Minimal supabase-js query-builder stub: records filters, resolves rows by which filters were set.
function stubDb(rows: { keyed?: string | null; legacy?: string | null }) {
  const calls: string[] = [];
  const db = {
    from(_t: string) {
      const f: Record<string, unknown> = {};
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { f[c] = v; return b; },
        is: (c: string, v: unknown) => { f[c + ' is'] = v; return b; },
        ilike: (c: string, v: unknown) => { f[c + ' ilike'] = v; return b; },
        order: () => b,
        limit: () => {
          calls.push(JSON.stringify(f));
          const id = 'source_listing_key' in f ? rows.keyed : rows.legacy;
          return Promise.resolve({ data: id ? [{ id }] : [], error: null });
        },
      };
      return b;
    },
  };
  return { db, calls };
}

Deno.test('findHagertyVehicleId prefers the key, falls back to the legacy url, honours keyOnly', async () => {
  const key = 'hagerty:2qNtqutlbqCk0DwL0ePQNb';
  let s = stubDb({ keyed: 'v-key', legacy: 'v-legacy' });
  assertEquals(await findHagertyVehicleId(s.db, key), { id: 'v-key', matchedBy: 'listing_key' });
  assertEquals(s.calls.length, 1);
  s = stubDb({ keyed: null, legacy: 'v-legacy' });
  assertEquals(await findHagertyVehicleId(s.db, key), { id: 'v-legacy', matchedBy: 'legacy_url' });
  assertEquals(JSON.parse(s.calls[1])['discovery_url ilike'], '%/2qNtqutlbqCk0DwL0ePQNb');
  s = stubDb({ keyed: null, legacy: 'v-legacy' });
  assertEquals(await findHagertyVehicleId(s.db, key, { keyOnly: true }), null);
  s = stubDb({ keyed: null, legacy: null });
  assertEquals(await findHagertyVehicleId(s.db, key), null);
});
