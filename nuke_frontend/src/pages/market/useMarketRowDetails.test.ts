import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ parents: [] as any[], events: [] as any[], eventError: null as unknown, calls: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const q: any = { then: (fn: any) => Promise.resolve({ data: table === 'vehicles' ? fixture.parents : fixture.events,
    error: table === 'vehicle_events' ? fixture.eventError : null }).then(fn) };
  for (const method of ['select', 'in', 'eq', 'is', 'or', 'limit']) q[method] = (...args: any[]) => {
    fixture.calls.push([table, method, ...args]); return q;
  };
  return q;
} } }));
import { readMarketRowDetails, selectRowFacts, vehicleIdentity } from './useMarketRowDetails';
const url = 'https://bringatrailer.com/listing/fixture/';
beforeEach(() => {
  fixture.parents = [{ id: 'a', listing_url: url, state: 'CA', zip_code: '90210', listing_location_source: 'bat' }];
  fixture.events = [{ id: 'event', vehicle_id: 'a', source_url: url, bid_count: 24, watcher_count: 432,
    last_bid_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:01:00Z' }];
  fixture.eventError = null; fixture.calls = [];
});
describe('source-gated market row metadata', () => {
  it('uses exact listing membership and repeats public eligibility on child reads', async () => {
    const read = await readMarketRowDetails([{ id: 'a', listingUrl: url }]);
    expect(read.get('a')).toMatchObject({ location: 'CA · 90210', bidCount: 24, watchers: 432 });
    expect(fixture.calls).toContainEqual(['vehicles', 'eq', 'is_public', true]);
    expect(fixture.calls).toContainEqual(['vehicle_events', 'eq', 'vehicles.is_public', true]);
    expect(fixture.calls).toContainEqual(['vehicle_events', 'is', 'vehicles.deleted_at', null]);
    expect(fixture.calls).toContainEqual(['vehicle_events', 'in', 'source_url', [url.slice(0, -1), url]]);
  });
  it('refuses relistings and denied parents without child calls', async () => {
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: `${url}-2/` }])).size).toBe(0);
    expect(fixture.calls.some(c => c[0] === 'vehicle_events')).toBe(false);
    fixture.parents = []; fixture.calls = [];
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: url }])).size).toBe(0);
    expect(fixture.calls.some(c => c[0] === 'vehicle_events')).toBe(false);
  });
  it('does not turn default zeros, venue locations or duplicate episode states into measurements', async () => {
    fixture.parents[0].listing_location_source = 'bj_event';
    fixture.events[0].bid_count = 0; fixture.events[0].watcher_count = 0;
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: url }])).get('a')).toMatchObject({ location: null, bidCount: null, watchers: null });
    fixture.events.push({ ...fixture.events[0], id: 'duplicate', bid_count: 80 });
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: url }])).get('a')?.bidCount).toBeNull();
  });
  it('uses the exact active episode bid and never presents an ended price as a current bid', async () => {
    fixture.events[0].current_price = 27000; fixture.events[0].event_status = 'active';
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: url }])).get('a')?.currentBid).toBe(27000);
    fixture.events[0].event_status = 'sold';
    expect((await readMarketRowDetails([{ id: 'a', listingUrl: url }])).get('a')?.currentBid).toBeNull();
  });
  it('preserves location on a metrics failure and bounds the metadata page', async () => {
    fixture.eventError = new Error('read failed');
    const read = await readMarketRowDetails(Array.from({ length: 40 }, (_, i) => ({ id: i === 0 ? 'a' : String(i), listingUrl: url })));
    expect(read.get('a')).toMatchObject({ location: 'CA · 90210', bidCount: null });
    expect(fixture.calls.find(c => c[0] === 'vehicles' && c[1] === 'in')[3]).toHaveLength(24);
  });
});
describe('deterministic vehicle fact selection', () => {
  it('prioritizes conflicts, then supported powertrain and suppresses repeated identity and engine synonyms', () => {
    const facts = selectRowFacts([
      { field: 'color', value: 'Red', rooted: true },
      { field: 'body_style', value: 'Coupe', rooted: true },
      { field: 'engine_size', value: '5.0L V8', rooted: true },
      { field: 'engine_type', value: '5.0L V8', rooted: true },
      { field: 'transmission', value: 'Automatic', reported_conflict: true, source_observation_id: 'evidence' },
    ], '2004 BMW M3 Coupe');
    expect(facts.map(f => [f.field, f.value])).toEqual([
      ['transmission', 'Automatic'], ['engine_type', '5.0L V8'], ['color', 'Red'],
    ]);
    expect(facts[0].conflict).toBe(true);
  });
  it('withholds unsupported specs and unitless mileage, but retains attributed reports', () => {
    expect(selectRowFacts([{ field: 'transmission', value: '6-speed manual' },
      { field: 'mileage', value: 13000, rooted: true }, { field: 'color', value: 'undefined', rooted: true },
      { field: 'engine_size', reported_value: '2,100cc flat-four', source_observation_id: 'source' }], 'Replica'))
      .toMatchObject([{ label: 'Listed engine', value: '2,100cc flat-four', observationId: 'source' }]);
    expect(vehicleIdentity({ year: 2004, make: 'BMW', model: 'M3' })).toBe('2004 BMW M3');
    expect(vehicleIdentity({ year: null, make: 'NO MAKE', model: null })).toBe('Vehicle identity unrecorded');
  });
});
