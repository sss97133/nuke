import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from } }));
import { readCapturedListings, sourceLink } from './useCapturedListings';

const vehicleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function row(id: string, vehicle_id: string | null = null, source_url = 'https://www.craigslist.org/view/d/fixture-listing/SyntheticShareToken0000') {
  return { id, vehicle_id, source_url, source_platform: 'craigslist', source_listing_id: '7000000000', current_price: 0,
    event_status: 'active', created_at: '2026-10-13T02:31:04.821+00:00', updated_at: '2026-10-13T02:32:00Z' };
}
function query(data: unknown[], error: Error | null = null) {
  const q: any = { then: (resolve: any) => Promise.resolve({ data, error }).then(resolve) };
  for (const name of ['select', 'in', 'eq', 'is', 'or', 'order', 'limit', 'abortSignal', 'lt']) q[name] = vi.fn(() => q);
  return q;
}
beforeEach(() => fixture.from.mockReset());
describe('public captured listing boundary', () => {
  it('preserves actual unresolved presentations but withholds hidden/missing linked parents and arbitrary URLs', async () => {
    const events = query([row('unresolved'), row('hidden', vehicleId), row('not-public-source', null, 'https://internal.example/private'), row('public', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')]);
    const vehicles = query([{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', year: null, make: null, model: null }]);
    fixture.from.mockImplementation((table: string) => table === 'vehicle_events' ? events : vehicles);
    const result = await readCapturedListings('craigslist');
    expect(result.items.map(r => r.id)).toEqual(['unresolved', 'public']);
    expect(result.items[0]).toMatchObject({ vehicle_id: null, vehicle: null, source_listing_id: '7000000000', current_price: 0 });
    expect(result.items[1].vehicle?.id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(vehicles.eq).toHaveBeenCalledWith('is_public', true);
    expect(vehicles.is).toHaveBeenCalledWith('deleted_at', null);
    expect(vehicles.or).toHaveBeenCalledWith('listing_kind.is.null,listing_kind.neq.non_vehicle_item');
    const fields = events.select.mock.calls[0][0].split(',');
    expect(fields).toContain('source_observed_at:metadata->>source_observed_at');
    expect(fields).not.toContain('metadata');
    expect(fields.join(',')).not.toMatch(/contact|seller|snapshot|observation_id/);
  });
  it('advances bounded source-scoped cursor even when an entire scanned page is withheld', async () => {
    const events = query(Array.from({ length: 51 }, (_, i) => row(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, vehicleId)));
    fixture.from.mockImplementation((table: string) => table === 'vehicle_events' ? events : query([]));
    const first = await readCapturedListings('craigslist');
    expect(first.items).toEqual([]); expect(first.next?.id).toBe('00000049-0000-0000-0000-000000000000');
    await readCapturedListings('craigslist', first.next);
    expect(events.in).toHaveBeenCalledWith('source_platform', ['craigslist']);
    expect(events.limit).toHaveBeenCalledWith(51);
    expect(events.or.mock.calls.at(-1)[0]).toContain('id.lt.00000049-0000-0000-0000-000000000000');
  });
  it('does not turn failed parent eligibility checks into unresolved rows or successful emptiness', async () => {
    fixture.from.mockImplementation((table: string) => table === 'vehicle_events' ? query([row('linked', vehicleId)]) : query([], new Error('reader unavailable')));
    await expect(readCapturedListings()).rejects.toThrow('reader unavailable');
  });
  it('retains the explicit source clock separately from later processing clocks, and never substitutes for missing or invalid testimony', async () => {
    const values = ['2026-10-12T01:02:03.456Z', null, undefined, '', 'not-a-clock', '2026-02-30T01:02:03Z', '2026-10-12T24:00:00Z', 0, { private: 'value' }];
    fixture.from.mockReturnValue(query(values.map((value, i) => ({ ...row(`clock-${i}`), source_observed_at: value }))));
    const page = await readCapturedListings('craigslist');
    expect(page.items.map(r => r.source_observed_at)).toEqual([values[0], ...values.slice(1).map(() => null)]);
    expect(page.items[0].created_at).toBe('2026-10-13T02:31:04.821+00:00');
    expect(page.items[0].updated_at).toBe('2026-10-13T02:32:00Z');
  });
  it('rejects credential URLs, hostile domains and non-listing Facebook URLs', () => {
    for (const url of ['javascript:alert(1)', 'https://craigslist.org.attacker.example/123.html', 'https://user:secret@craigslist.org/123.html']) expect(sourceLink('craigslist', url)).toBeNull();
    expect(sourceLink('facebook_marketplace', 'https://www.facebook.com/messages/123')).toBeNull();
    expect(sourceLink('facebook_marketplace', 'https://www.facebook.com/marketplace/item/123456/')).toContain('/item/123456/');
  });
  it('retains records with unknown landing clocks at the end of cursor traversal', async () => {
    const events = query([{ ...row('unknown-clock'), created_at: null }]); fixture.from.mockReturnValue(events);
    const result = await readCapturedListings('craigslist', { at: null, id: vehicleId });
    expect(result.items[0].created_at).toBeNull();
    expect(events.order).toHaveBeenCalledWith('created_at', { ascending: false, nullsFirst: false });
    expect(events.is).toHaveBeenCalledWith('created_at', null); expect(events.lt).toHaveBeenCalledWith('id', vehicleId);
  });
  it('qualifies unresolved rows against actual supported listing paths and intake aliases', () => {
    const listings = [
      ['ksl', 'https://cars.ksl.com/listing/10662354'], ['bring_a_trailer', 'https://bringatrailer.com/listing/1990-mazda-miata/'],
      ['cars_and_bids', 'https://carsandbids.com/auctions/9X1kJq3p/1990-mazda-miata'],
      ['mecum', 'https://www.mecum.com/lots/1177355/2005-hummer-h2'],
      ['barrett_jackson', 'https://www.barrett-jackson.com/2026-columbus/docket/vehicle/1951-plymouth-cranbrook-300183'],
    ];
    for (const [platform, url] of listings) expect(sourceLink(platform, url)).toBe(url);
    expect(sourceLink('cars_and_bids', 'https://carsandbids.com/auctions/9X1kJq3p/')).toContain('/auctions/9X1kJq3p/');
    for (const platform of ['ksl', 'bat', 'cars_and_bids', 'mecum', 'barrett_jackson']) {
      const host = { ksl: 'cars.ksl.com', bat: 'bringatrailer.com', cars_and_bids: 'carsandbids.com', mecum: 'mecum.com', barrett_jackson: 'barrett-jackson.com' }[platform];
      for (const path of ['/account', '/login', '/redirect?token=secret']) expect(sourceLink(platform, `https://${host}${path}`)).toBeNull();
    }
    expect(sourceLink('ksl', 'https://cars.ksl.com:8443/listing/10662354')).toBeNull();
    expect(sourceLink('ksl', 'https://cars.ksl.com/listing/10662354?token=secret')).toBeNull();
  });
  it('reads current and retained intake aliases through one source filter', async () => {
    const events = query([]); fixture.from.mockReturnValue(events);
    await readCapturedListings('bat'); expect(events.in).toHaveBeenCalledWith('source_platform', ['bat', 'bring_a_trailer']);
    await readCapturedListings('barrett_jackson'); expect(events.in).toHaveBeenCalledWith('source_platform', ['barrett_jackson', 'barrettjackson']);
  });
});
