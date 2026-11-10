// @vitest-environment jsdom
// The capture ledger: one get_capture_ledger read draws the days in the app's words; opening a day reads it once and
// shows each photo's state the way the capture app's ingest bar does; "Re-scan my library" is the one write and it is
// a request row, never an upload; a private frame never renders a thumbnail; nothing else leaves the page. Photo reading
// status is its own read (photo_reading_status), shown in the server's sentences, refreshed while the page is on screen,
// and shown as nothing when reading is off, the answer is empty or the read fails.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
import CaptureLedger, { stageLabel, summaryLine } from './CaptureLedger';

let root: Root, host: HTMLDivElement, serial = 0;
let requests: { method: string; url: URL; body: any }[];
let rescan: any = null;
let reading: unknown = null;                                         // what photo_reading_status answers
let readingFails: { status: number; body: unknown } | null = null;   // or the error it answers with
const json =(data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const firebird = { vehicle_id: '00000000-0000-0000-0000-0000000000b1', name: '1973 Pontiac Firebird' };
const ledger = () => ({ generated_at: '2026-11-07T20:00:00Z', tz: 'UTC', days_total: 2, rescan, last_rescan: null,
  days: [
    { day: '2026-11-04', taken: 4, on_vehicle: 2, unverified: 0, waiting: 0, held: 1, pulled: 0, private: 1, unsorted: 0, failed: 0, skipped: 2,
      vehicles: [{ ...firebird, n: 2 }], held_reasons: { no_clear_lead: 1 }, skip_reasons: { no_location: 2 } },
    { day: '2026-11-01', taken: 1, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 0, failed: 1, skipped: 0,
      vehicles: [], held_reasons: {}, skip_reasons: {} },
  ],
  totals: { taken: 5, on_vehicle: 2, unverified: 0, waiting: 0, held: 1, pulled: 0, private: 1, unsorted: 0, failed: 1, skipped: 2 } });
const day = () => ({ day: '2026-11-04', tz: 'UTC',
  frames: [
    { image_id: 'f1', taken_at: '2026-11-04T18:00:00Z', state: 'on_vehicle', reason: 'approved', vehicle_id: firebird.vehicle_id, vehicle: firebird.name, source: 'capture_relay_ios', file_name: 'IMG_5272.heic', thumb: 'https://photos.test/f1.jpg', set_key: null, candidates: null },
    { image_id: 'f2', taken_at: '2026-11-04T18:01:00Z', state: 'held', reason: 'no_clear_lead', vehicle_id: null, vehicle: null, source: 'capture_relay_ios', file_name: 'IMG_5273.heic', thumb: 'https://photos.test/f2.jpg', set_key: 'ios:a:A',
      candidates: [{ vehicle_id: firebird.vehicle_id, name: firebird.name, score: 1.92 }, { vehicle_id: 'b2', name: '1966 Ford Mustang', score: 0.4 }] },
    { image_id: 'f3', taken_at: '2026-11-04T18:02:00Z', state: 'private', reason: 'rejected_personal', vehicle_id: null, vehicle: null, source: 'photo_auto_sync', file_name: 'IMG_5274.heic', thumb: null, set_key: null, candidates: null },
  ],
  skipped: [{ asset_id: 'S1', reason: 'no_location', taken_at: '2026-11-04T19:00:00Z', decided_at: '2026-11-04T19:00:05Z', device: 'iPhone' }] });
// Made-up status payloads in the reader's shape. The page prints the sentences and never the bare numbers.
const moving = () => ({ as_of: '2026-11-07T20:28:00Z', state: 'moving', headline: 'Reading your photos',
  summary: '20 read in the last hour · on photos from March 2021', reasons: [] as string[],
  lines: ['20 read in the last hour, 77 in the last day.', 'Now on photos taken in March 2021. Your photos run from June 2019 to November 2026.',
    'Worked through 4,210 of 32,014 photos in date order.', '300 are with the reader now.'],
  photos_total: 32014, worked_through: 4210, read_since_start: 77, counting_since: '2026-11-05T17:00:00Z', could_not_read: 0, skipped: 0, retrying: 0,
  with_reader: 300, read_1h: 20, read_24h: 77, last_read_at: '2026-11-07T20:26:00Z', last_attempt_at: '2026-11-07T20:26:00Z',
  reading_from: '2021-03-14T19:00:00Z', library_from: '2019-06-02T16:00:00Z', library_to: '2026-11-06T23:00:00Z', library_walked_at: null,
  reader_checked_in_at: '2026-11-07T20:25:00Z' });
const stalledReason = 'The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.';
const stalled = () => ({ ...moving(), state: 'stalled', headline: 'Photo reading has stalled', summary: stalledReason, reasons: [stalledReason],
  lines: ['77 photos read since Nov 5. Readings made before then are not counted here.', '300 are with the reader now.'],
  read_1h: 0, last_read_at: '2026-11-07T17:20:00Z', last_attempt_at: '2026-11-07T17:20:00Z', reader_checked_in_at: '2026-11-07T17:25:00Z' });
const idle = () => ({ as_of: '2026-11-07T20:28:00Z', state: 'idle', headline: 'Photo reading is waiting', summary: 'Nothing is waiting right now.',
  reasons: [], lines: ['Nothing is waiting right now.'], photos_total: 32014 });
const off = () => ({ as_of: '2026-11-07T20:28:00Z', state: 'off', headline: 'Photo reading is not switched on for this account', summary: null,
  reasons: [], lines: [], photos_total: 12 });

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T20:30:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  requests = []; rescan = null; reading = null; readingFails = null;
  fixture.client = createClient('https://capture-ledger.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-ledger-${++serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, url, body });
      const endpoint = url.pathname.replace('/rest/v1/', '');
      const allowedRpc = ['get_capture_ledger', 'get_capture_ledger_day', 'request_capture_rescan', 'photo_reading_status'];
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && allowedRpc.some(name => endpoint === `rpc/${name}`))) {
        return json({ code: '42501', message: 'Synthetic transport denies every write and function' }, 403);
      }
      if (endpoint === 'rpc/get_capture_ledger') return json(ledger());
      if (endpoint === 'rpc/get_capture_ledger_day') return json(body?.p_day === '2026-11-04' ? day() : { day: body?.p_day, tz: 'UTC', frames: [], skipped: [] });
      if (endpoint === 'rpc/request_capture_rescan') { rescan = { id: 'r1', requested_at: '2026-11-07T20:30:00Z', acked_at: null, device: null, finished_at: null, result: null, reused: false }; return json(rescan); }
      if (endpoint === 'rpc/photo_reading_status') return readingFails ? json(readingFails.body, readingFails.status) : json(reading);
      return json([]);
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  Reflect.deleteProperty(document, 'visibilityState');
  expect(vi.getTimerCount()).toBe(0);                    // the status refresh stops with the page
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(requests.some(r => r.url.pathname.startsWith('/functions/') || r.url.pathname.startsWith('/storage/'))).toBe(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const reads = (name: string) => requests.filter(r => r.url.pathname.endsWith(`/rpc/${name}`));
async function show() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/capture/ledger']}><CaptureLedger /></MemoryRouter>));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  return host.textContent ?? '';
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text));
const block = () => host.querySelector('.cl-reading');
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setVisible = (visible: boolean) => act(async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
  document.dispatchEvent(new Event('visibilitychange'));
});

it('draws the days from one ledger read, in the app\'s words', async () => {
  const text = await show();
  expect(reads('get_capture_ledger')).toHaveLength(1);
  expect(reads('get_capture_ledger')[0].body).toMatchObject({ p_tz: expect.any(String), p_to: null, p_limit: 400 });
  expect(text).toContain('5 photos · 2 on 1973 Pontiac Firebird · 1 held · 1 kept private · 2 skipped on the phone · 1 failed');
  expect(text).toContain('Wed, Nov 4, 2026');
  expect(text).toContain('2 on 1973 Pontiac Firebird');
  expect(text).toContain('1 held');
  expect(text).toContain('2 skipped');
  expect(text).toContain('1 failed');
  expect(reads('get_capture_ledger_day')).toHaveLength(0);
  expect(host.querySelector('.cl-bar--failed')).not.toBeNull();
});
it('opens a day with one read and shows each photo the way the phone does; a private frame has no thumbnail', async () => {
  await show();
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(reads('get_capture_ledger_day')).toHaveLength(1);
  expect(reads('get_capture_ledger_day')[0].body).toMatchObject({ p_day: '2026-11-04' });
  const text = host.textContent ?? '';
  expect(text).toContain('Added to 1973 Pontiac Firebird');
  expect(text).toContain('IMG_5272 ·');
  expect(text).toContain('Held: no clear match');
  expect(text).toContain('IMG_5273 · closest: 1973 Pontiac Firebird 1.9, 1966 Ford Mustang 0.4');
  expect(text).toContain('Kept private');
  expect(text).toContain('Skipped on the phone: no location on the photo');
  expect(host.querySelectorAll('img.cl-frame__thumb')).toHaveLength(2);
  expect(host.querySelector('.cl-frame--private img')).toBeNull();
  expect(host.querySelector<HTMLAnchorElement>('.cl-frame--on_vehicle a.cl-frame__open')?.getAttribute('href')).toBe(`/vehicle/${firebird.vehicle_id}?day=2026-11-04`);
  // closing and reopening never reads again
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  expect(reads('get_capture_ledger_day')).toHaveLength(1);
});
it('"Re-scan my library" writes one request and shows that the phone will pick it up', async () => {
  await show();
  await act(async () => button('Re-scan my library')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(reads('request_capture_rescan')).toHaveLength(1);
  expect(reads('request_capture_rescan')[0].body).toEqual({ p_from: null, p_source: 'web' });
  expect(host.textContent).toContain('Asked just now · it runs the next time the capture app opens on your phone.');
  expect(button('Re-scan requested')?.disabled).toBe(true);
  // the ledger read, the status read and the one request: nothing else is posted
  expect(requests.filter(r => r.method === 'POST').map(r => r.url.pathname.replace('/rest/v1/rpc/', '')).sort())
    .toEqual(['get_capture_ledger', 'photo_reading_status', 'request_capture_rescan']);
});
it('shows photo reading as moving, in the server\'s sentences, from its own read beside the ledger', async () => {
  reading = moving();
  const text = await show();
  expect(reads('photo_reading_status')).toHaveLength(1);
  expect(reads('photo_reading_status')[0].body).toEqual({ p_tz: expect.any(String) });
  // the ledger is asked first and exactly as before; the status read rides beside it
  expect(requests.map(r => r.url.pathname.replace('/rest/v1/rpc/', ''))).toEqual(['get_capture_ledger', 'photo_reading_status']);
  expect(text).toContain('5 photos · 2 on 1973 Pontiac Firebird');
  expect(block()?.classList.contains('cl-reading--moving')).toBe(true);
  // the headline, each line as given and when it was checked; the one-line summary is for a collapsed bar, not this block
  expect(block()?.textContent).toBe(['Reading your photos', ...moving().lines, 'checked 2m ago'].join(''));
  expect([...block()!.querySelectorAll('p')].map(p => p.textContent)).toEqual(['Reading your photos', ...moving().lines, 'checked 2m ago']);
  // the block sits above the day list
  expect(block()!.compareDocumentPosition(host.querySelector('.cl-days')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('shows photo reading as stalled with the reason, and tells moving, stalled and waiting apart by more than colour', async () => {
  reading = stalled();
  await show();
  expect(block()?.classList.contains('cl-reading--stalled')).toBe(true);
  expect([...block()!.querySelectorAll('p')].map(p => p.textContent)).toEqual(['Photo reading has stalled', stalledReason, ...stalled().lines, 'checked 2m ago']);
  const icons = new Set([block()!.querySelector('svg')!.innerHTML]);
  // the next refreshes, two minutes apart, bring a moving and then a waiting status: each has its own icon shape and words
  reading = { ...moving(), as_of: '2026-11-07T20:32:00Z' };
  await wait(120_000);
  expect(reads('photo_reading_status')).toHaveLength(2);
  expect(block()?.classList.contains('cl-reading--moving')).toBe(true);
  expect(block()?.textContent).toContain('Reading your photos');
  expect(block()?.textContent).not.toContain(stalledReason);
  expect(block()?.textContent).toContain('checked just now');
  icons.add(block()!.querySelector('svg')!.innerHTML);
  reading = { ...idle(), as_of: '2026-11-07T20:34:00Z' };
  await wait(120_000);
  expect(reads('photo_reading_status')).toHaveLength(3);
  expect(block()?.classList.contains('cl-reading--idle')).toBe(true);
  expect(block()?.textContent).toBe('Photo reading is waitingNothing is waiting right now.checked just now');
  icons.add(block()!.querySelector('svg')!.innerHTML);
  expect(icons.size).toBe(3);
  expect(reads('get_capture_ledger')).toHaveLength(1);
});
it.each([
  ['reading is not switched on for the account', () => { reading = off(); }],
  ['the answer is empty', () => { reading = null; }],
  ['the answer is not a status', () => { reading = { state: 'moving' }; }],
  ['the reader is not deployed yet', () => { readingFails = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.photo_reading_status(p_tz) in the schema cache' } }; }],
  ['the read is refused', () => { readingFails = { status: 403, body: { code: '42501', message: 'permission denied for function photo_reading_status' } }; }],
  ['the read fails', () => { readingFails = { status: 500, body: { code: '57014', message: 'canceling statement due to statement timeout' } }; }],
])('shows no photo reading block when %s, and the ledger is untouched', async (_name, arrange) => {
  const noise = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
  arrange();
  const text = await show();
  expect(reads('photo_reading_status')).toHaveLength(1);
  expect(block()).toBeNull();
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(text).toContain('5 photos · 2 on 1973 Pontiac Firebird');
  expect(text).toContain('Wed, Nov 4, 2026');
  for (const spy of noise) expect(spy).not.toHaveBeenCalled();
});
it('asks again every two minutes only while the page is on screen, and a failed refresh takes the block away until the next good one', async () => {
  reading = moving();
  await show();
  expect(block()).not.toBeNull();
  await wait(119_000);
  expect(reads('photo_reading_status')).toHaveLength(1);
  readingFails = { status: 500, body: { code: 'XX000', message: 'synthetic failure' } };
  await wait(1_000);
  expect(reads('photo_reading_status')).toHaveLength(2);
  expect(block()).toBeNull();
  readingFails = null;
  await wait(120_000);
  expect(reads('photo_reading_status')).toHaveLength(3);
  expect(block()).not.toBeNull();
  // hidden: nothing is asked, however long
  await setVisible(false);
  await wait(600_000);
  expect(reads('photo_reading_status')).toHaveLength(3);
  // back on screen with a read overdue: asked at once
  await setVisible(true);
  await wait(5);
  expect(reads('photo_reading_status')).toHaveLength(4);
  // a quick look away and back does not ask early; the next read keeps its two-minute place
  await setVisible(false);
  await setVisible(true);
  await wait(60_000);
  expect(reads('photo_reading_status')).toHaveLength(4);
  await wait(60_000);
  expect(reads('photo_reading_status')).toHaveLength(5);
  expect(reads('get_capture_ledger')).toHaveLength(1);
});
it('words: the app\'s stage labels', () => {
  const base = { image_id: 'x', taken_at: '2026-11-04T18:00:00Z', reason: null, vehicle_id: null, vehicle: null, source: null, file_name: null, thumb: null, set_key: null, candidates: null } as const;
  expect(stageLabel({ ...base, state: 'failed', reason: 'timeout' })).toBe("Didn't work: it took too long");
  expect(stageLabel({ ...base, state: 'unverified', vehicle: '1966 Ford Mustang' })).toBe('On 1966 Ford Mustang, not yet checked');
  expect(stageLabel({ ...base, state: 'waiting' })).toBe('Waiting on a check');
  expect(stageLabel({ ...base, state: 'held', reason: 'score_below_threshold' })).toBe('Held: not sure enough');
  expect(stageLabel({ ...base, state: 'held', reason: 'priors_only' })).toBe("Held: only the day's pattern pointed to it, nothing in the photo");
  expect(stageLabel({ ...base, state: 'unsorted' })).toBe('Not sorted yet');
  expect(summaryLine({ taken: 1, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 0, failed: 0, skipped: 0 }, [])).toBe('1 photo');
});
