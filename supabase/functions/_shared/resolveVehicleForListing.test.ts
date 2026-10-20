import { resolveExistingVehicleId } from './resolveVehicleForListing.ts';

const url = 'https://www.goodingco.com/lot/1970-example-coupe';
const options = { url, platform: 'gooding', requireExactListingUrl: true };
type Row = Record<string, string | null>;
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
async function refuses(action: () => Promise<unknown>, message: string) {
  try { await action(); } catch (error) {
    if (!String((error as Error).message).includes(message)) throw error;
    return;
  }
  throw new Error(`Expected refusal: ${message}`);
}
// SQL ILIKE wildcards, including escaped literals; fixtures contain no live data.
function ilike(pattern: string): RegExp {
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') expression += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (char === '%') expression += '.*';
    else if (char === '_') expression += '.';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`, 'i');
}
function database(vehicles: Row[] = [], events: Row[] = [], failure?: { table: string; message: string }) {
  const reads: { table: string; limit?: number; pattern?: string; signal?: AbortSignal }[] = [];
  return {
    reads,
    from(table: string) {
      const read: typeof reads[number] = { table }; reads.push(read);
      let rows = table === 'vehicles' ? vehicles : events;
      const result = () => ({ data: rows.slice(0, read.limit), error: failure?.table === table ? new Error(failure.message) : null });
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: string) { rows = rows.filter(row => row[column] === value); return query; },
        in(column: string, values: string[]) { rows = rows.filter(row => values.includes(row[column] ?? '')); return query; },
        ilike(column: string, pattern: string) { read.pattern = pattern; rows = rows.filter(row => ilike(pattern).test(row[column] ?? '')); return query; },
        limit(value: number) { read.limit = value; return query; },
        abortSignal(value: AbortSignal) { read.signal = value; return query; },
        maybeSingle() { const reply = result(); return Promise.resolve({ ...reply, data: reply.data[0] ?? null,
          error: reply.error ?? (reply.data.length > 1 ? Object.assign(new Error('multiple rows'), { code: 'PGRST116' }) : null) }); },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  };
}

Deno.test('Gooding refuses a longer different lot slug that merely shares the requested prefix', async () => {
  const db = database([{ id: 'other-car', discovery_url: `${url}-special-5` }]);
  equal(await resolveExistingVehicleId(db, { ...options,
    discoveryUrlIlikePattern: '%goodingco.com/lot/1970-example-coupe%', // Former Gooding caller's prefix.
  }), { vehicleId: null });
  equal(db.reads[1].limit, 51);
});

Deno.test('Gooding keeps scheme, www, case, trailing slash, query and hash aliases of the whole listing', async () => {
  for (const alias of [url, url + '/', url + '/?ref=fixture#photos', url + '?ref=fixture', url + '#photos',
    'http://goodingco.com/lot/1970-example-coupe', 'https://GOODINGCO.com/LOT/1970-EXAMPLE-COUPE/']) {
    const db = database([{ id: 'same-car', discovery_url: alias }, { id: 'other-car', discovery_url: `${url}-special-5` }]);
    equal(await resolveExistingVehicleId(db, { ...options, url: url + '/?incoming=fixture' }), { vehicleId: 'same-car' });
    equal(db.reads[0].signal === db.reads[1].signal, true);
    equal(db.reads[1].signal instanceof AbortSignal, true);
  }
});

Deno.test('Gooding rejects lookalike hosts, nested paths, credentials and alternate ports', async () => {
  const db = database([
    { id: 'host', discovery_url: 'https://notgoodingco.com/lot/1970-example-coupe' },
    { id: 'nested', discovery_url: url + '/another-lot' },
    { id: 'credentials', discovery_url: url.replace('https://', 'https://user@') },
    { id: 'port', discovery_url: url.replace('.com/', '.com:8443/') },
  ]);
  equal(await resolveExistingVehicleId(db, options), { vehicleId: null });
});

Deno.test('a canonical URL hit does not hide a conflicting query alias on another vehicle', async () => {
  const db = database([{ id: 'first-car', discovery_url: url }, { id: 'second-car', discovery_url: url + '?ref=fixture' }]);
  await refuses(() => resolveExistingVehicleId(db, options), 'Ambiguous listing URL aliases');
});

Deno.test('candidate exhaustion refuses even when the first candidate is an exact match', async () => {
  const rows = [{ id: 'same-car', discovery_url: url }, ...Array.from({ length: 50 }, (_, i) => ({ id: `sibling-${i}`, discovery_url: `${url}-${i}` }))];
  await refuses(() => resolveExistingVehicleId(database(rows), options), 'candidate limit reached');
  equal(await resolveExistingVehicleId(database(rows.slice(0, 50)), options), { vehicleId: 'same-car' });
});

Deno.test('event or alias query failure never becomes an unmatched result or an accepted partial match', async () => {
  for (const table of ['vehicle_events', 'vehicles']) {
    const db = database([{ id: 'same-car', discovery_url: url }], [], { table, message: 'reader unavailable' });
    await refuses(() => resolveExistingVehicleId(db, options), 'reader unavailable');
    equal(db.reads.length, table === 'vehicle_events' ? 1 : 2);
  }
});

Deno.test('ambiguous existing event keys refuse; an existing single event binding remains authoritative', async () => {
  const event = { source_platform: 'gooding', source_listing_id: 'goodingco.com/lot/1970-example-coupe', vehicle_id: 'retained-parent' };
  await refuses(() => resolveExistingVehicleId(database([], [event, { ...event, vehicle_id: 'other-parent' }]), options), 'multiple rows');
  const db = database([], [event]);
  equal(await resolveExistingVehicleId(db, options), { vehicleId: 'retained-parent' });
  equal(db.reads.length, 1); // Prevents new prefix joins; does not repair an already incorrect event binding.
  equal(db.reads[0].limit, 2);
});

Deno.test('literal URL wildcards are escaped in the candidate query', async () => {
  const literalUrl = 'https://goodingco.com/lot/example_100%25';
  const db = database([{ id: 'literal', discovery_url: literalUrl }, { id: 'wildcard-neighbor', discovery_url: 'https://goodingco.com/lot/exampleX100suffix' }]);
  equal(await resolveExistingVehicleId(db, { ...options, url: literalUrl }), { vehicleId: 'literal' });
  equal(db.reads[1].pattern, '%goodingco.com/lot/example\\_100\\%25%');
});

Deno.test('invalid strict URLs refuse before querying; a complete successful miss remains unmatched', async () => {
  for (const invalid of ['not-a-url', 'ftp://goodingco.com/lot/example', 'https://user@goodingco.com/lot/example']) {
    const db = database();
    await refuses(() => resolveExistingVehicleId(db, { ...options, url: invalid }), 'Invalid listing URL');
    equal(db.reads.length, 0);
  }
  equal(await resolveExistingVehicleId(database(), options), { vehicleId: null });
});

Deno.test('Bonhams opt-out preserves lot-ID matching across alternate slug paths', async () => {
  const db = database([{ id: 'bonhams-car', discovery_url: 'https://www.bonhams.com/auction/12345/lot/67/older-slug/' }]);
  equal(await resolveExistingVehicleId(db, { url: 'https://bonhams.com/auction/12345/lot/67/newer-slug/', platform: 'bonhams',
    discoveryUrlIlikePattern: '%bonhams.com/auction/12345/lot/67/%' }), { vehicleId: 'bonhams-car' });
  equal(db.reads.at(-1)?.limit, 1);
});

Deno.test('a merged-away duplicate keeping its copy of the lot episode does not make the lot ambiguous', async () => {
  const key = 'goodingco.com/lot/1970-example-coupe';
  const db = database(
    [{ id: 'live-car', status: 'active', deleted_at: null, discovery_url: url }, { id: 'merged-car', status: 'merged', deleted_at: null, discovery_url: url.replace('www.', '') }],
    [{ vehicle_id: 'live-car', source_platform: 'gooding', source_listing_id: key }, { vehicle_id: 'merged-car', source_platform: 'gooding', source_listing_id: key }]);
  equal(await resolveExistingVehicleId(db, options), { vehicleId: 'live-car' });
});

Deno.test('two live vehicles on one lot stay refused', async () => {
  const key = 'goodingco.com/lot/1970-example-coupe';
  const db = database(
    [{ id: 'car-a', status: 'active', deleted_at: null }, { id: 'car-b', status: 'active', deleted_at: null }],
    [{ vehicle_id: 'car-a', source_platform: 'gooding', source_listing_id: key }, { vehicle_id: 'car-b', source_platform: 'gooding', source_listing_id: key }]);
  await refuses(() => resolveExistingVehicleId(db, options), 'multiple rows');
});

Deno.test('a merged-away alias URL does not make the exact listing ambiguous', async () => {
  const db = database([{ id: 'live-car', status: 'active', deleted_at: null, discovery_url: url }, { id: 'merged-car', status: 'merged', deleted_at: null, discovery_url: url.replace('www.', '') }]);
  equal(await resolveExistingVehicleId(db, options), { vehicleId: 'live-car' });
});
