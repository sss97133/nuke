// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, vehicle: {} as Record<string, unknown> }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (...args: any[]) => (fixture.client.from as any)(...args),
  rpc: (...args: any[]) => (fixture.client.rpc as any)(...args),
} }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle, auctionPulse: null }) }));
vi.mock('../stacks/VehicleCohort', () => ({ VehiclePerformance: () => null }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
import ProfileHeader from './ProfileHeader';

const vehicleId = '00000000-0000-0000-0000-0000000000a1';
const currentEvent = '00000000-0000-0000-0000-0000000000e1';
const otherEvent = '00000000-0000-0000-0000-0000000000e2';
const sourceUrl = 'https://www.mecum.com/lots/123456/current-sale/';
const currentVideo = 'CurrentVid1', otherVideo = 'OtherVideo2';
const broadcastSource = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4';
const profile = () => ({ vehicle_id: vehicleId, viewer: 'anon', read_at: '2026-10-18T09:00:00Z', sections: [{
  kind: 'masthead', identity_source: { year: 1966, make: 'Ford', model: 'Mustang' }, year: 1966, make: 'Ford', model: 'Mustang',
  price: { value: 24000, unit: 'USD', source: { kind: 'listing', label: 'Mecum', method: 'sold', url: sourceUrl },
    observed_at: observedAt, trust: 0.9 }, priceLabel: 'Last recorded sale',
}] });
const presentation = (eventId = currentEvent, video = currentVideo, start = 125, outcome = 'unknown') => ({
  id: `synthetic-${eventId}-${video}-${start}`, vehicle_id: vehicleId, source_id: broadcastSource, is_superseded: false,
  structured_data: { property: 'broadcast_lot_presentation',
    media: { video_id: video, start_seconds: start, end_seconds: start + 50, span_semantics: 'overlay_visible_interval', relation: 'screen_display' },
    value: { lot: 'S138', displayed_outcome: outcome },
    event_context: { auction_house: 'mecum', auction: eventId === currentEvent ? 'Current sale' : 'Other sale', lot: 'S138',
      matched_event: { table: 'auction_events', id: eventId }, resolution_status: 'scoped_event_match' },
  },
});
let root: Root, host: HTMLDivElement, queryClient: QueryClient;
let auctionRows: any[], eventRows: any[], presentations: any[], observationError: boolean;
let observedAt: string | null, observationPayload: unknown, clientNumber = 0;
let requests: { method: string; path: string; query: Record<string, string>; body: unknown }[];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  requests = []; observationError = false; observationPayload = undefined; observedAt = '2026-09-21T00:00:00Z';
  auctionRows = [{ id: currentEvent, vehicle_id: vehicleId, lot_number: 'S138', source_url: sourceUrl }];
  eventRows = []; presentations = [];
  fixture.vehicle = { id: vehicleId, year: 1966, make: 'Ford', model: 'Mustang', listing_kind: 'vehicle' };
  const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/rest/v1/rpc/vehicle_profile_read' && method === 'POST') return json(profile());
    if (method !== 'GET') throw new Error(`Unexpected mutation: ${method} ${url.pathname}`);
    const table = url.pathname.replace('/rest/v1/', '');
    let rows: any[];
    if (table === 'auction_events') rows = auctionRows;
    else if (table === 'vehicle_events') rows = eventRows;
    else if (table === 'vehicle_observations') {
      if (observationError) return json({ code: '57014', message: 'synthetic observation read failure' }, 500);
      if (observationPayload !== undefined) return json(observationPayload);
      rows = presentations;
    } else throw new Error(`Unexpected reader: ${url.pathname}`);
    rows = rows.filter(row => row.vehicle_id === url.searchParams.get('vehicle_id')?.replace(/^eq\./, ''));
    if (table === 'vehicle_observations') rows = rows.filter(row => row.source_id === broadcastSource && !row.is_superseded);
    const fields = url.searchParams.get('select')!.split(',');
    return json(rows.map(row => Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]]))));
  };
  fixture.client = createClient('https://broadcast-header.test', 'synthetic-anon', {
    auth: { storageKey: `synthetic-broadcast-${++clientNumber}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport },
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  host = document.createElement('div'); host.className = 'vehicle-profile-page'; document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); queryClient.clear(); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function openRecording() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter><ProfileHeader /></MemoryRouter></QueryClientProvider>));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => (host.querySelector('button.k-claim__value') as HTMLButtonElement).click());
  expect(host.querySelector('button.k-claim__value')?.textContent).toBe('$24,000');
  expect(document.querySelector('a.k-claim__link')?.getAttribute('href')).toBe(sourceUrl);
  expect(document.body.textContent).toContain(observedAt ? 'Sep 21, 2026' : 'unknown date');
  expect(document.body.textContent).toContain('Mecum · sold');
  expect(document.body.textContent).toContain('90%');
  expect(document.body.textContent).toContain('Lot S138');
  await act(async () => (document.querySelector('[aria-label="Watch sale moment"]') as HTMLButtonElement).click());
  const read = requests.find(r => r.path.endsWith('/vehicle_observations'))!;
  expect(read.query).toMatchObject({ vehicle_id: `eq.${vehicleId}`, source_id: `eq.${broadcastSource}`,
    'structured_data->>property': 'eq.broadcast_lot_presentation', is_superseded: 'eq.false', limit: '20' });
  expect(requests.find(r => r.path.endsWith('/rpc/vehicle_profile_read'))?.body).toEqual({ p_vehicle_id: vehicleId });
  expect(requests).toHaveLength(4);
  return document.querySelector('iframe')?.getAttribute('src') ?? null;
}
const embed = (video: string, start: number) => `https://www.youtube.com/embed/${video}?autoplay=1&rel=0&start=${start}&end=${start + 50}`;
it('keeps a single exact matched-event clip useful in the actual price citation', async () => {
  presentations = [presentation()]; expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it('fills the missing offset when the exact episode already names the same broadcast', async () => {
  auctionRows[0].broadcast_video_url = `https://www.youtube.com/watch?v=${currentVideo}`;
  presentations = [presentation()];
  expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it.each(['video', 'seek'])('withholds conflicting direct and matched presentation %s', async kind => {
  auctionRows[0] = { ...auctionRows[0], broadcast_video_url: `https://www.youtube.com/watch?v=${currentVideo}`,
    broadcast_timestamp_start: 125, broadcast_timestamp_end: 175 };
  presentations = [presentation(currentEvent, kind === 'video' ? otherVideo : currentVideo, 900)];
  expect(await openRecording()).toBeNull();
});
it('does not attach an explicitly different matched sale sharing vehicle and nominal lot', async () => {
  presentations = [presentation(otherEvent, otherVideo)]; expect(await openRecording()).toBeNull();
});
it('does not prefer another sale merely because its overlay says SOLD', async () => {
  presentations = [presentation(), presentation(otherEvent, otherVideo, 900, 'sold')];
  expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it.each(['video', 'seek'])('withholds disputed same-episode %s instead of choosing its first row', async kind => {
  presentations = [presentation(), presentation(currentEvent, kind === 'video' ? otherVideo : currentVideo, 900)];
  expect(await openRecording()).toBeNull();
});
it('keeps duplicate agreeing captures useful', async () => {
  presentations = [presentation(), presentation()]; expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it.each(['none', 'lot', 'vehicle', 'withdrawn', 'error'])('does not attach an unavailable or unbound clip (%s)', async kind => {
  if (kind !== 'none') presentations = [presentation()];
  if (kind === 'lot') presentations[0].structured_data.value.lot = 'S139';
  if (kind === 'vehicle') presentations[0].vehicle_id = '00000000-0000-0000-0000-0000000000a2';
  if (kind === 'withdrawn') presentations[0].is_superseded = true;
  if (kind === 'error') observationError = true;
  expect(await openRecording()).toBeNull();
});
it('keeps an independently recorded exact auction clip instead of replacing it with broadcast rows', async () => {
  auctionRows[0] = { ...auctionRows[0], broadcast_video_url: `https://www.youtube.com/watch?v=${currentVideo}`,
    broadcast_timestamp_start: 125, broadcast_timestamp_end: 175 };
  presentations = [presentation(otherEvent, otherVideo, 900, 'sold')];
  expect(await openRecording()).toBe(embed(currentVideo, 125));
});

it.each(['missing', 'table', 'id', 'resolution', 'missing-status', 'sale-text-only'])('does not infer episode binding from %s context', async kind => {
  const row = presentation();
  const context: any = row.structured_data.event_context;
  if (kind === 'missing') delete context.matched_event;
  if (kind === 'table') context.matched_event.table = 'vehicles';
  if (kind === 'id') context.matched_event.id = null;
  if (kind === 'resolution') context.resolution_status = 'rejected';
  if (kind === 'missing-status') delete context.resolution_status;
  if (kind === 'sale-text-only') { delete context.matched_event; context.auction = 'Current sale'; }
  presentations = [row]; expect(await openRecording()).toBeNull();
});
it('keeps an exact vehicle_events binding useful without borrowing auction table identity', async () => {
  auctionRows = [];
  eventRows = [{ id: currentEvent, vehicle_id: vehicleId, source_url: sourceUrl, metadata: { lot_number: 'S138', auction_name: 'Current sale' } }];
  const row = presentation(); row.structured_data.event_context.matched_event.table = 'vehicle_events'; presentations = [row];
  expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it('does not equate the same ID from a different event table', async () => {
  const row = presentation(); row.structured_data.event_context.matched_event.table = 'vehicle_events'; presentations = [row];
  expect(await openRecording()).toBeNull();
});
it.each([
  'https://foreign.test/mecum.com/lots/123456/current-sale/',
  `${sourceUrl}?episode=other`, `${sourceUrl}#other`,
])('does not bind an event from another source identity (%s)', async wrongSource => {
  auctionRows.push({ id: otherEvent, vehicle_id: vehicleId, lot_number: 'S138', source_url: wrongSource });
  presentations = [presentation(otherEvent, otherVideo)]; expect(await openRecording()).toBeNull();
});
it('preserves existing numeric Mecum source aliases for exact event binding', async () => {
  auctionRows[0].source_url = 'https://mecum.com/lots/FL24-123456/current-sale/';
  presentations = [presentation()]; expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it('keeps identical locators useful when displayed outcomes differ', async () => {
  presentations = [presentation(), presentation(currentEvent, currentVideo, 125, 'sold')];
  expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it('keeps a zero start and missing end without inventing an interval', async () => {
  const row = presentation(currentEvent, currentVideo, 0); delete (row.structured_data.media as any).end_seconds;
  presentations = [row]; expect(await openRecording()).toBe(`https://www.youtube.com/embed/${currentVideo}?autoplay=1&rel=0`);
});
it('withholds disputed end offsets and preserves agreed lot and auction context', async () => {
  eventRows = [{ id: 'synthetic-context-event', vehicle_id: vehicleId, source_url: sourceUrl, metadata: { lot_number: 'S138', auction_name: 'Current sale' } }];
  const second = presentation(); second.structured_data.media.end_seconds = 225;
  presentations = [presentation(), second]; expect(await openRecording()).toBeNull();
  expect(document.body.textContent).toContain('Current sale');
  expect(document.body.textContent).toContain('Additional lot provenance conflicts; disputed context withheld.');
});
it('keeps exact direct recording support when the additive observation reader fails', async () => {
  auctionRows[0] = { ...auctionRows[0], broadcast_video_url: `https://www.youtube.com/watch?v=${currentVideo}`,
    broadcast_timestamp_start: 125, broadcast_timestamp_end: 175 };
  observationError = true; expect(await openRecording()).toBe(embed(currentVideo, 125));
});

it('keeps an unknown canonical observation clock unknown when a bound clip exists', async () => {
  observedAt = null; presentations = [presentation()]; expect(await openRecording()).toBe(embed(currentVideo, 125));
});
it.each([null, { unexpected: true }])('ignores malformed presentation response %s without losing canonical context', async payload => {
  observationPayload = payload; expect(await openRecording()).toBeNull();
});
it('uses existing per-field consensus when one agreeing recording has no end', async () => {
  const row = presentation(); delete (row.structured_data.media as any).end_seconds;
  presentations = [row, presentation()]; expect(await openRecording()).toBe(embed(currentVideo, 125));
});
