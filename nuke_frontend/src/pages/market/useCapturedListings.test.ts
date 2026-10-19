import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
const fixture = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: fixture.from } }));
import { readCapturedListings, sourceLink } from './useCapturedListings';

const vehicleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function row(id: string, vehicle_id: string | null = null, source_url = 'https://www.craigslist.org/view/d/fixture-listing/SyntheticShareToken0000') {
  return { id, vehicle_id, source_url, source_platform: 'craigslist', source_listing_id: '7000000000', current_price: 0,
    event_status: 'active', created_at: '2026-10-13T02:31:04.821+00:00', updated_at: '2026-10-13T02:32:00Z' };
}
function query(data: unknown[], error: Error | null = null) {
  const q: any = { then: (resolve: any) => Promise.resolve({
    data: q.is.mock.calls.some(([column, value]: unknown[]) => column === 'created_at' && value === null)
      ? data.filter((row: any) => row.created_at === null) : data, error,
  }).then(resolve) };
  for (const name of ['select', 'in', 'eq', 'is', 'not', 'or', 'order', 'limit', 'abortSignal', 'lt', 'lte']) q[name] = vi.fn(() => q);
  return q;
}

// Execute the real client's serialized filters against a retained fixture. The
// expected traversal below is computed independently as one NULLS LAST ordering.
function serveEvents(rows: Array<Omit<ReturnType<typeof row>, 'created_at'> & { created_at: string | null }>) {
  const requests: URL[] = [];
  const client = createClient('https://fixture.supabase.co', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); requests.push(url);
      const params = url.searchParams;
      let data = [...rows];
      const sources = params.get('source_platform')!.slice(4, -1).split(',');
      data = data.filter(row => sources.includes(row.source_platform));
      for (const filter of params.getAll('created_at')) {
        if (filter === 'not.is.null') data = data.filter(row => row.created_at !== null);
        else if (filter === 'is.null') data = data.filter(row => row.created_at === null);
        else if (filter.startsWith('lte.')) data = data.filter(row => row.created_at !== null && Date.parse(row.created_at) <= Date.parse(filter.slice(4)));
        else throw new Error(`Unsupported fixture date filter: ${filter}`);
      }
      const or = params.get('or');
      if (or) {
        const at = /created_at\.lt\.([^,]+)/.exec(or)![1];
        const id = /id\.lt\.([a-f0-9-]+)/.exec(or)![1];
        data = data.filter(row => row.created_at === null ? or.includes('created_at.is.null')
          : Date.parse(row.created_at) < Date.parse(at) || (Date.parse(row.created_at) === Date.parse(at) && row.id < id));
      }
      const id = params.get('id');
      if (id) data = data.filter(row => row.id < id.slice(3));
      const orders = params.get('order')!.split(',');
      data.sort((a, b) => {
        for (const order of orders) {
          if (order.startsWith('created_at.')) {
            if (a.created_at === null && b.created_at !== null) return order.endsWith('nullsfirst') ? -1 : 1;
            if (b.created_at === null && a.created_at !== null) return order.endsWith('nullsfirst') ? 1 : -1;
            const delta = Date.parse(b.created_at!) - Date.parse(a.created_at!);
            if (delta) return delta;
          } else if (a.id !== b.id) return a.id < b.id ? 1 : -1;
        }
        return 0;
      });
      return new Response(JSON.stringify(data.slice(0, Number(params.get('limit')))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  fixture.from.mockImplementation((table: string) => client.from(table));
  return requests;
}
beforeEach(() => { fixture.from.mockReset(); });
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
    expect(events.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(events.not).not.toHaveBeenCalled();
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
  it.each([0, 1, 49, 50, 51, 80])('preserves every row across tied dates and the null tail with %i dated rows', async datedCount => {
    const records = Array.from({ length: datedCount + 67 }, (_, i) => ({
      ...row(`${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`),
      created_at: i >= datedCount ? null : i < datedCount - 3 ? '2026-10-13T02:00:00Z' : '2026-10-12T02:00:00Z',
    }));
    const requests = serveEvents([...records].reverse());
    const expected = [...records].sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at === null ? 1 : b.created_at === null ? -1 : Date.parse(b.created_at) - Date.parse(a.created_at);
      return a.id < b.id ? 1 : -1;
    });
    let cursor: Parameters<typeof readCapturedListings>[1];
    const seen: string[] = [];
    do {
      const page = await readCapturedListings('craigslist', cursor);
      seen.push(...page.items.map(row => row.id)); cursor = page.next;
      expect(seen.length).toBeLessThanOrEqual(records.length);
    } while (cursor);
    expect(seen).toEqual(expected.map(row => row.id));
    expect(requests.every(url => Number(url.searchParams.get('limit')) <= 51)).toBe(true);
    const datedReads = requests.filter(url => url.searchParams.getAll('created_at').includes('not.is.null'));
    expect(datedReads.length).toBeGreaterThan(0);
    expect(datedReads.every(url => url.searchParams.get('order') === 'created_at.desc.nullsfirst,id.desc')).toBe(true);
    for (const url of datedReads.filter(url => url.searchParams.has('or'))) {
      expect(url.searchParams.getAll('created_at').some(filter => filter.startsWith('lte.'))).toBe(true);
      expect(url.searchParams.get('or')).not.toContain('created_at.is.null');
    }
  });
  it('rejects a failed undated tail instead of claiming a complete dated page', async () => {
    const dated = query([row('dated')]);
    const undated = query([], new Error('undated reader unavailable'));
    fixture.from.mockReturnValueOnce(dated).mockReturnValueOnce(undated);
    await expect(readCapturedListings('craigslist')).rejects.toThrow('undated reader unavailable');
    expect(undated.limit).toHaveBeenCalledWith(50);
    expect(undated.abortSignal.mock.calls[0][0]).toBe(dated.abortSignal.mock.calls[0][0]);
  });
});
