// @vitest-environment jsdom
// The capture ledger: one get_capture_ledger read draws the days in the app's words; opening a day reads it once and
// shows each photo's state the way the capture app's ingest bar does; "Re-scan my library" is the one write and it is
// a request row, never an upload; a private frame never renders a thumbnail; nothing else leaves the page.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, user: { id: '00000000-0000-0000-0000-0000000000a1' } as { id: string } | null }));
vi.mock('../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: null, loading: false }) }));
import CaptureLedger, { ARM_MS, FILE_FAILED, FILE_REFUSED, NONE_MOVED, dayItems, filedLine, liveLine, stageLabel, summaryLine } from './CaptureLedger';

let root: Root, host: HTMLDivElement, serial = 0;
let requests: { method: string; url: URL; body: any }[];
let rescan: any = null;
// the synthetic writer: which photos have been filed, what attribute_image_session answers, whether the read of his
// vehicles fails, which rows it holds, and (when set) a reply to wait on
let filed: Map<string, string>;
let attributeReply: (ids: string[]) => Promise<Response> | Response;
let garageFails = false;
let mine: ReturnType<typeof ownRows>;
let vehiclesReply: (() => Promise<Response>) | null = null;
// how many get_capture_ledger reads answer before the rest fail (the totals re-read after a File)
let ledgerOk = Infinity;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const firebird = { vehicle_id: '00000000-0000-0000-0000-0000000000b1', name: '1973 Pontiac Firebird' };
const mustang = { vehicle_id: '00000000-0000-0000-0000-0000000000b2', name: '1966 Ford Mustang' };
const k10 = { vehicle_id: '00000000-0000-0000-0000-0000000000b3', name: '1979 Chevrolet K10' };
// his vehicles as the vehicles table answers the page's read: the five selected columns, last updated first
const ownRows = () => [
  { id: firebird.vehicle_id, year: 1973, make: 'Pontiac', model: 'Firebird', primary_image_url: 'https://photos.test/g-firebird.jpg' },
  { id: k10.vehicle_id, year: 1979, make: 'Chevrolet', model: 'K10', primary_image_url: null },
  { id: mustang.vehicle_id, year: 1966, make: 'Ford', model: 'Mustang', primary_image_url: 'https://photos.test/g-mustang.jpg' },
  // an unresolved record: the read's make filter leaves it out, as the phone's picker does
  { id: '00000000-0000-0000-0000-0000000000b9', year: null, make: 'UNRESOLVED', model: null, primary_image_url: null },
];
const VEHICLES_SELECT = 'id,year,make,model,primary_image_url';
const nameOf = (id: string) => [firebird, mustang, k10].find(v => v.vehicle_id === id)?.name ?? null;
const ledger = () => ({ generated_at: '2026-11-07T20:00:00Z', tz: 'UTC', days_total: 2, rescan, last_rescan: null,
  days: [
    { day: '2026-11-04', taken: 4, on_vehicle: 2, unverified: 0, waiting: 0, held: 1, pulled: 0, private: 1, unsorted: 0, failed: 0, skipped: 2,
      vehicles: [{ ...firebird, n: 2 }], held_reasons: { no_clear_lead: 1 }, skip_reasons: { no_location: 2 } },
    { day: '2026-11-01', taken: 1, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 0, failed: 1, skipped: 0,
      vehicles: [], held_reasons: {}, skip_reasons: {} },
  ],
  totals: { taken: 5, on_vehicle: 2, unverified: 0, waiting: 0, held: 1, pulled: 0, private: 1, unsorted: 0, failed: 1, skipped: 2 } });
// Made-up photos. Set A (f2, f4) and set B (f5) are held sets; f6 is held with no set; a filed photo reads as on_vehicle.
// Set B's closest cars: his Mustang with no name from the reader, and a Toyota that is not one of his vehicles.
const setA = [{ vehicle_id: firebird.vehicle_id, name: firebird.name, score: 1.92 }, { vehicle_id: mustang.vehicle_id, name: mustang.name, score: 0.4 }];
const setB = [{ vehicle_id: mustang.vehicle_id, name: null, score: 0.87 }, { vehicle_id: '00000000-0000-0000-0000-0000000000c9', name: '1985 Toyota Pickup', score: 0.31 }];
const held = (id: string, at: string, set: string | null, reason: string, candidates: unknown, thumb: string | null) => filed.has(id)
  ? { image_id: id, taken_at: at, state: 'on_vehicle', reason: 'approved', vehicle_id: filed.get(id), vehicle: nameOf(filed.get(id)!), source: 'capture_relay_ios', file_name: `${id}.heic`, thumb, set_key: set, candidates: null }
  : { image_id: id, taken_at: at, state: 'held', reason, vehicle_id: null, vehicle: null, source: 'capture_relay_ios', file_name: id === 'f2' ? 'IMG_5273.heic' : `${id}.heic`, thumb, set_key: set, candidates };
// f1's thumbnail is the phone's original file in storage; the row draws it through the render endpoint
const F1_THUMB = 'https://capture-ledger.test/storage/v1/object/public/vehicle-images/u/IMG_5272.heic';
const day = () => ({ day: '2026-11-04', tz: 'UTC',
  frames: [
    { image_id: 'f1', taken_at: '2026-11-04T18:00:00Z', state: 'on_vehicle', reason: 'approved', vehicle_id: firebird.vehicle_id, vehicle: firebird.name, source: 'capture_relay_ios', file_name: 'IMG_5272.heic', thumb: F1_THUMB, set_key: null, candidates: null },
    held('f2', '2026-11-04T18:01:00Z', 'ios:a:A', 'no_clear_lead', setA, 'https://photos.test/f2.jpg'),
    { image_id: 'f3', taken_at: '2026-11-04T18:02:00Z', state: 'private', reason: 'rejected_personal', vehicle_id: null, vehicle: null, source: 'photo_auto_sync', file_name: 'IMG_5274.heic', thumb: null, set_key: null, candidates: null },
    held('f4', '2026-11-04T18:03:00Z', 'ios:a:A', 'no_clear_lead', setA, null),
    held('f5', '2026-11-04T18:10:00Z', 'ios:b:B', 'score_below_threshold', setB, 'https://photos.test/f5.jpg'),
    held('f6', '2026-11-04T18:20:00Z', null, 'priors_only', null, 'https://photos.test/f6.jpg'),
  ],
  skipped: [{ asset_id: 'S1', reason: 'no_location', taken_at: '2026-11-04T19:00:00Z', decided_at: '2026-11-04T19:00:05Z', device: 'iPhone' }] });

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T20:30:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  requests = []; rescan = null; filed = new Map(); garageFails = false; ledgerOk = Infinity; mine = ownRows(); vehiclesReply = null;
  fixture.user = { id: '00000000-0000-0000-0000-0000000000a1' };
  attributeReply = ids => json(ids.length);
  fixture.client = createClient('https://capture-ledger.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-ledger-${++serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, url, body });
      const endpoint = url.pathname.replace('/rest/v1/', '');
      const allowedRpc = ['get_capture_ledger', 'get_capture_ledger_day', 'request_capture_rescan', 'attribute_image_session'];
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && allowedRpc.some(name => endpoint === `rpc/${name}`))) {
        return json({ code: '42501', message: 'Synthetic transport denies every write and function' }, 403);
      }
      if (endpoint === 'rpc/get_capture_ledger') return ledgerOk-- > 0 ? json(ledger()) : json({ code: '57014', message: 'synthetic totals failure' }, 500);
      if (endpoint === 'rpc/get_capture_ledger_day') return json(body?.p_day === '2026-11-04' ? day() : { day: body?.p_day, tz: 'UTC', frames: [], skipped: [] });
      if (endpoint === 'vehicles' && method === 'GET') {
        if (vehiclesReply) return vehiclesReply();
        if (garageFails) return json({ code: 'XX000', message: 'synthetic vehicles failure' }, 500);
        // the table applies the make filter the way PostgREST would, so a read without it would offer the unresolved record
        const neq = url.searchParams.get('make')?.match(/^neq\.(.*)$/)?.[1];
        return json(mine.filter(r => neq === undefined || (r.make !== null && r.make !== neq)));
      }
      if (endpoint === 'rpc/attribute_image_session') {
        const reply = await attributeReply(body.p_image_ids);
        if (reply.ok) { const n = await reply.clone().json(); for (const id of body.p_image_ids.slice(0, n)) filed.set(id, body.p_vehicle_id); }
        return reply;
      }
      if (endpoint === 'rpc/request_capture_rescan') { rescan = { id: 'r1', requested_at: '2026-11-07T20:30:00Z', acked_at: null, device: null, finished_at: null, result: null, reused: false }; return json(rescan); }
      return json([]);
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(requests.some(r => r.url.pathname.startsWith('/functions/') || r.url.pathname.startsWith('/storage/'))).toBe(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const reads = (name: string) => requests.filter(r => r.url.pathname.endsWith(`/rpc/${name}`));
const vehicleReads = () => requests.filter(r => r.url.pathname === '/rest/v1/vehicles');
async function show() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/capture/ledger']}><CaptureLedger /></MemoryRouter>));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  return host.textContent ?? '';
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text));

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
  expect(text).toContain("Held: only the day's pattern pointed to it, nothing in the photo");
  expect(text).not.toContain('IMG_5273 ·');
  expect(text).toContain('Kept private');
  expect(text).toContain('Skipped on the phone: no location on the photo');
  expect(host.querySelectorAll('.cl-frame img.cl-frame__thumb')).toHaveLength(2);
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
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(2);
});
it('words: the app\'s stage labels', () => {
  const base = { image_id: 'x', taken_at: '2026-11-04T18:00:00Z', reason: null, vehicle_id: null, vehicle: null, source: null, file_name: null, thumb: null, set_key: null, candidates: null } as const;
  expect(stageLabel({ ...base, state: 'failed', reason: 'timeout' })).toBe("Didn't work: it took too long");
  expect(stageLabel({ ...base, state: 'unverified', vehicle: '1966 Ford Mustang' })).toBe('On 1966 Ford Mustang, not yet checked');
  expect(stageLabel({ ...base, state: 'waiting' })).toBe('Waiting on a check');
  expect(stageLabel({ ...base, state: 'held', reason: 'score_below_threshold' })).toBe('Held: not sure enough');
  expect(stageLabel({ ...base, state: 'held', reason: 'priors_only' })).toBe("Held: only the day's pattern pointed to it, nothing in the photo");
  expect(stageLabel({ ...base, state: 'unsorted' })).toBe('Not sorted yet');
  expect(stageLabel({ ...base, state: 'duplicate', vehicle: '1966 Ford Mustang' })).toBe('Copy of a photo on 1966 Ford Mustang');
  expect(summaryLine({ taken: 3, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 1, failed: 0, duplicate: 2, skipped: 0 }, [])).toBe('3 photos · 1 not sorted yet · 2 copies of filed photos');
  expect(summaryLine({ taken: 1, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 0, failed: 0, skipped: 0 }, [])).toBe('1 photo');
  // a held row names its closest cars without a score
  expect(liveLine({ ...base, state: 'held', file_name: 'IMG_1.heic', candidates: [{ vehicle_id: 'v', name: '1966 Ford Mustang', score: 0.4 }] })).toBe('IMG_1 · closest: 1966 Ford Mustang');
  expect(filedLine(6, 6, '1979 Chevrolet K10')).toBe('Filed 6 photos to 1979 Chevrolet K10.');
  expect(filedLine(4, 6, '1979 Chevrolet K10', 2)).toBe('Filed 4 of 6 to 1979 Chevrolet K10. 2 photos still wait below.');
  expect(filedLine(4, 6, '1979 Chevrolet K10', 1)).toBe("Filed 4 of 6 to 1979 Chevrolet K10. 1 photo still waits below. 1 was already filed or couldn't be filed.");
  expect(filedLine(4, 6, '1979 Chevrolet K10', 0)).toBe("Filed 4 of 6 to 1979 Chevrolet K10. 2 were already filed or couldn't be filed.");
  expect(filedLine(4, 6, '1979 Chevrolet K10')).toBe("Filed 4 of 6 to 1979 Chevrolet K10. The others were already filed or couldn't be filed.");
});

// ---- "Which vehicle?" for a held set ----
async function openDay() {
  await show();
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}
const blocks = () => [...host.querySelectorAll<HTMLElement>('section.cl-ask')];
const within = (el: Element, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
const choices = (el: Element) => [...el.querySelectorAll<HTMLButtonElement>('.cl-ask__choice')].map(b => b.textContent?.trim());
const writes = () => reads('attribute_image_session');
const settle = async () => act(async () => { await vi.advanceTimersByTimeAsync(5); });
// File arms ARM_MS after a pick; a tap before that does nothing
const tapFile = async (el: Element) => { await act(async () => { await vi.advanceTimersByTimeAsync(ARM_MS); }); await act(async () => within(el, 'File')!.click()); };

it('folds the held frames of one set into one question, the questions first; other rows keep their time order', async () => {
  await openDay();
  const list = host.querySelector('.cl-frames')!;
  const rows = [...list.children].map(li => li.querySelector('section.cl-ask') ? 'set'
    : (li.querySelector('.cl-frame')?.className.replace('cl-frame cl-frame--', '') ?? '?'));
  expect(rows).toEqual(['set', 'set', 'on_vehicle', 'private', 'held', 'skipped']);
  const [a, b] = blocks();
  expect(blocks()).toHaveLength(2);
  expect(a.querySelector('h2')?.textContent).toBe('Which vehicle?');
  // each photo is named apart from its neighbours, not only by the minute it was taken
  expect([...a.querySelectorAll('.cl-ask__photo')].map(p => p.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^IMG_5273, /), expect.stringMatching(/^f4, /)]);
  expect(a.textContent).toContain('2 photos ·');
  expect(a.textContent).toContain('Held: no clear match');
  expect(b.textContent).toContain('1 photo ·');
  expect(b.textContent).toContain('Held: not sure enough');
  expect(a.querySelectorAll('.cl-ask__photo')).toHaveLength(2);
  expect(b.querySelectorAll('.cl-ask__photo')).toHaveLength(1);
  // the photo with no thumbnail keeps the page's placeholder; every photo starts in
  expect(a.querySelectorAll('.cl-ask__photo img')).toHaveLength(1);
  expect([...a.querySelectorAll('.cl-ask__photo')].map(p => p.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
  // his vehicles are read once
  expect(vehicleReads()).toHaveLength(1);
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  await act(async () => button('Wed, Nov 4, 2026')!.click());
  await settle();
  expect(vehicleReads()).toHaveLength(1);
});
it('lists the closest cars in the reader\'s order, with their pictures and no score', async () => {
  await openDay();
  const [a, b] = blocks();
  expect(choices(a)).toEqual(['1973 Pontiac Firebird', '1966 Ford Mustang', 'Another vehicle']);
  // a candidate with no name takes the name from his vehicles; one that is not his is not a choice
  expect(choices(b)).toEqual(['1966 Ford Mustang', 'Another vehicle']);
  expect([...a.querySelectorAll('.cl-ask__choice img')].map(i => i.getAttribute('src'))).toEqual(['https://photos.test/g-firebird.jpg', 'https://photos.test/g-mustang.jpg']);
  expect(b.querySelectorAll('.cl-ask__choice img')).toHaveLength(1);
  for (const el of blocks()) expect(el.textContent).not.toMatch(/\d\.\d/);
  expect(host.textContent).not.toMatch(/1\.9|0\.4|0\.87|0\.31/);
});
it('picking a car writes nothing; File files the photos left in, then the day and the totals are read again', async () => {
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  expect(writes()).toHaveLength(0);
  expect(requests.filter(r => r.method !== 'GET' && !/get_capture_ledger/.test(r.url.pathname))).toHaveLength(0);
  const confirm = a.querySelector('.cl-ask__confirm')!;
  expect(confirm.previousElementSibling?.textContent).toBe('1973 Pontiac Firebird');
  expect(confirm.querySelector('[role="status"]')?.textContent).toBe('File 2 photos to 1973 Pontiac Firebird?');
  // leave the second photo out: dimmed, and the count follows
  const second = a.querySelectorAll<HTMLButtonElement>('.cl-ask__photo')[1];
  await act(async () => second.click());
  expect(second.getAttribute('aria-pressed')).toBe('false');
  expect(second.classList.contains('cl-ask__photo--out')).toBe(true);
  expect(a.querySelector('.cl-ask__confirm [role="status"]')?.textContent).toBe('File 1 photo to 1973 Pontiac Firebird?');
  // Cancel closes the line and writes nothing
  await act(async () => within(a, 'Cancel')!.click());
  expect(a.querySelector('.cl-ask__confirm')).toBeNull();
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  await tapFile(a);
  await settle();
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body).toEqual({ p_image_ids: ['f2'], p_vehicle_id: firebird.vehicle_id, p_reason: 'owner_ledger_answer' });
  expect(reads('get_capture_ledger_day')).toHaveLength(2);
  expect(reads('get_capture_ledger')).toHaveLength(2);
  const note = host.querySelector('.cl-filed[role="status"]');
  expect(note?.textContent).toBe('Filed 1 photo to 1973 Pontiac Firebird.');
  // the filed photo now reads as added; the photo left out still asks
  expect(host.querySelectorAll('.cl-frame--on_vehicle')).toHaveLength(2);
  expect(blocks()).toHaveLength(2);
  expect(blocks()[0].querySelectorAll('.cl-ask__photo')).toHaveLength(1);
  // what is still held asks again from the start: the photo is back in and the cars can be picked
  expect(blocks()[0].querySelector('.cl-ask__photo')?.getAttribute('aria-pressed')).toBe('true');
  expect(within(blocks()[0], '1966 Ford Mustang')?.disabled).toBe(false);
  expect(blocks()[0].querySelector('.cl-ask__confirm')).toBeNull();
});
it('a full answer clears the question and the result line stays', async () => {
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1966 Ford Mustang')!.click());
  await tapFile(a);
  await settle();
  expect(writes()[0].body).toEqual({ p_image_ids: ['f2', 'f4'], p_vehicle_id: mustang.vehicle_id, p_reason: 'owner_ledger_answer' });
  expect(blocks()).toHaveLength(1);
  expect(host.querySelector('.cl-filed')?.textContent).toBe('Filed 2 photos to 1966 Ford Mustang.');
  expect(host.textContent).toContain('Added to 1966 Ford Mustang');
});
it('a second tap while filing sends nothing; the controls wait and File reads as working', async () => {
  let release!: () => void;
  attributeReply = ids => new Promise<Response>(resolve => { release = () => resolve(json(ids.length)); });
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  // File is off for a moment after the pick: a tap that lands on it right away (a double tap) sends nothing
  const file = within(a, 'File')!;
  expect(file.disabled).toBe(true);
  await act(async () => file.click());
  expect(writes()).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(ARM_MS); });
  expect(file.disabled).toBe(false);
  await act(async () => { file.click(); file.click(); });
  await settle();
  expect(writes()).toHaveLength(1);
  const working = a.querySelector<HTMLButtonElement>('.cl-ask__confirm .cl-rescan__button')!;
  expect(working.textContent).toBe('Filing…');
  expect(working.disabled).toBe(true);
  expect(working.getAttribute('aria-busy')).toBe('true');
  await act(async () => working.click());
  expect(writes()).toHaveLength(1);
  expect([...a.querySelectorAll<HTMLButtonElement>('button')].every(b => b.disabled)).toBe(true);
  // the other set of the same day waits too, so two day reads never race
  expect([...blocks()[1].querySelectorAll<HTMLButtonElement>('button')].every(b => b.disabled)).toBe(true);
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(5); });
  expect(writes()).toHaveLength(1);
  expect(host.querySelector('.cl-filed')?.textContent).toBe('Filed 2 photos to 1973 Pontiac Firebird.');
});
it('fewer filed than sent says so in plain words', async () => {
  attributeReply = () => json(1);
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  await tapFile(a);
  await settle();
  expect(host.querySelector('.cl-filed')?.textContent).toBe('Filed 1 of 2 to 1973 Pontiac Firebird. 1 photo still waits below.');
  expect(blocks()[0].querySelectorAll('.cl-ask__photo')).toHaveLength(1);
});
it('a refusal keeps the question and says, inside the confirm line, that this car cannot take them', async () => {
  attributeReply = () => json({ code: '42501', message: 'attribute_image_session: you can only file your own photos onto a vehicle you can edit' }, 403);
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  await tapFile(a);
  await settle();
  expect(writes()).toHaveLength(1);
  expect(blocks()).toHaveLength(2);
  expect(blocks()[0].querySelector('.cl-ask__confirm .cl-ask__failure[role="alert"]')?.textContent).toBe(FILE_REFUSED);
  expect(host.textContent).not.toContain('attribute_image_session');
  expect(host.querySelector('.cl-filed')?.textContent).toBe('');
  expect(reads('get_capture_ledger_day')).toHaveLength(1);
  expect(reads('get_capture_ledger')).toHaveLength(1);
  // a refusal is permanent for that car: File waits for another pick, which clears it
  expect(within(blocks()[0], 'File')?.disabled).toBe(true);
  await act(async () => within(blocks()[0], '1966 Ford Mustang')!.click());
  expect(blocks()[0].querySelector('.cl-ask__failure')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(ARM_MS); });
  expect(within(blocks()[0], 'File')?.disabled).toBe(false);
});
it('"Another vehicle" lists every car with a filter, and a car from there files the same way', async () => {
  await openDay();
  const a = blocks()[0];
  const more = within(a, 'Another vehicle')!;
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await act(async () => more.click());
  expect(more.getAttribute('aria-expanded')).toBe('true');
  const list = a.querySelector('.cl-ask__all')!;
  expect(choices(list)).toEqual(['1973 Pontiac Firebird', '1979 Chevrolet K10', '1966 Ford Mustang']);
  const filter = list.querySelector<HTMLInputElement>('input')!;
  expect(filter.getAttribute('placeholder')).toBe('Year, make or model');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, 'k10');
    filter.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(choices(list)).toEqual(['1979 Chevrolet K10']);
  await act(async () => within(list, '1979 Chevrolet K10')!.click());
  expect(writes()).toHaveLength(0);
  expect(list.querySelector('.cl-ask__confirm [role="status"]')?.textContent).toBe('File 2 photos to 1979 Chevrolet K10?');
  await tapFile(list);
  await settle();
  expect(writes()[0].body).toEqual({ p_image_ids: ['f2', 'f4'], p_vehicle_id: k10.vehicle_id, p_reason: 'owner_ledger_answer' });
});
it('a failed read of his vehicles offers every named closest car, without pictures', async () => {
  garageFails = true;
  await openDay();
  expect(vehicleReads()).toHaveLength(1);
  const a = blocks()[0];
  expect(choices(a)).toEqual(['1973 Pontiac Firebird', '1966 Ford Mustang']);
  // which cars are his cannot be told: the named one is offered and the writer decides; the nameless one is left out
  expect(choices(blocks()[1])).toEqual(['1985 Toyota Pickup']);
  expect(host.textContent).not.toContain("can't take photos");
  expect(a.querySelectorAll('.cl-ask__choice img')).toHaveLength(0);
  expect(a.textContent).toContain("Couldn't read your other vehicles. Pick from the closest matches, or try again.");
  await act(async () => within(a, '1966 Ford Mustang')!.click());
  await tapFile(a);
  await settle();
  expect(writes()[0].body).toEqual({ p_image_ids: ['f2', 'f4'], p_vehicle_id: mustang.vehicle_id, p_reason: 'owner_ledger_answer' });
});
it('dayItems: a held frame with no set keeps its row; two sets make two questions', () => {
  const f = (id: string, state: string, set: string | null) => ({ image_id: id, taken_at: `2026-11-04T18:0${id.slice(1)}:00Z`, state, reason: null, vehicle_id: null, vehicle: null, source: null, file_name: null, thumb: null, set_key: set, candidates: null }) as any;
  const items = dayItems([f('f1', 'held', 'A'), f('f2', 'held', null), f('f3', 'held', 'B'), f('f4', 'held', 'A'), f('f5', 'on_vehicle', null)]);
  expect(items.map(i => i.kind === 'set' ? `set:${i.key}:${i.frames.map(x => x.image_id).join(',')}` : i.f.image_id)).toEqual(['set:A:f1,f4', 'set:B:f3', 'f2', 'f5']);
  // a filed frame that still carries its set key is a plain row
  expect(dayItems([f('f1', 'on_vehicle', 'A'), f('f2', 'held', 'A')]).map(i => i.kind)).toEqual(['set', 'frame']);
});
it('nothing filed is an error in the phone\'s words, not a Filed line; the day is read again, the totals are not', async () => {
  attributeReply = () => json(0);
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  await tapFile(a);
  await settle();
  expect(blocks()[0].querySelector('.cl-ask__failure')?.textContent).toBe(NONE_MOVED);
  expect(host.querySelector('.cl-filed')?.textContent).toBe('');
  expect(reads('get_capture_ledger_day')).toHaveLength(2);
  expect(reads('get_capture_ledger')).toHaveLength(1);
});
it('a dropped connection shows one plain line, never the transport\'s text, and reads the day again', async () => {
  attributeReply = () => Promise.reject(new TypeError('Failed to fetch'));
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1973 Pontiac Firebird')!.click());
  await tapFile(a);
  await settle();
  expect(blocks()[0].querySelector('.cl-ask__failure')?.textContent).toBe(FILE_FAILED);
  expect(host.textContent).not.toMatch(/TypeError|Failed to fetch/);
  expect(reads('get_capture_ledger_day')).toHaveLength(2);
  expect(within(blocks()[0], 'File')?.disabled).toBe(false);
});
it('a failed totals read after File keeps the days and the Filed line', async () => {
  ledgerOk = 1;
  await openDay();
  const a = blocks()[0];
  await act(async () => within(a, '1966 Ford Mustang')!.click());
  await tapFile(a);
  await settle();
  expect(reads('get_capture_ledger')).toHaveLength(2);
  expect(host.querySelector('.cl-filed')?.textContent).toBe('Filed 2 photos to 1966 Ford Mustang.');
  expect(host.textContent).toContain('Wed, Nov 4, 2026');
  expect(host.textContent).toContain('Added to 1966 Ford Mustang');
  expect(host.textContent).not.toContain("Couldn't read the ledger");
});
it('the picked car is marked in both lists, the confirm opens once, and Cancel gives focus back to the car', async () => {
  await openDay();
  const a = blocks()[0];
  const closest = within(a, '1973 Pontiac Firebird')!;
  await act(async () => closest.click());
  await act(async () => within(a, 'Another vehicle')!.click());
  const pressed = [...a.querySelectorAll<HTMLButtonElement>('.cl-ask__choice[aria-pressed="true"]')];
  expect(pressed.map(b => b.textContent?.trim())).toEqual(['1973 Pontiac Firebird', '1973 Pontiac Firebird']);
  expect(pressed.every(b => b.querySelector('.cl-ask__check'))).toBe(true);
  expect(a.querySelectorAll('.cl-ask__confirm')).toHaveLength(1);
  // the unresolved record is not offered (the read filters it out, as the phone's does)
  expect(choices(a.querySelector('.cl-ask__all')!)).toEqual(['1973 Pontiac Firebird', '1979 Chevrolet K10', '1966 Ford Mustang']);
  await act(async () => within(a, 'Cancel')!.click());
  expect(document.activeElement).toBe(closest);
  expect(writes()).toHaveLength(0);
});
it('a failed read of his vehicles can be tried again from the block', async () => {
  garageFails = true;
  await openDay();
  const b = blocks()[1];
  expect(within(b, 'Another vehicle')).toBeUndefined();
  garageFails = false;
  await act(async () => within(b, 'Try again')!.click());
  await settle();
  expect(vehicleReads()).toHaveLength(2);
  expect(within(blocks()[1], 'Another vehicle')).toBeDefined();
  expect(within(blocks()[1], 'Try again')).toBeUndefined();
});
it('signed out: his vehicles are never read and no car is offered', async () => {
  fixture.user = null;
  await openDay();
  expect(vehicleReads()).toHaveLength(0);
  expect(choices(blocks()[0])).toEqual([]);
  expect(within(blocks()[0], 'Another vehicle')).toBeUndefined();
});

// ---- the car list is the phone's list ----
it('reads his vehicles the phone\'s way, live records only: five columns, his by user or owner, unresolved, removed and merged-away left out, last updated first', async () => {
  await openDay();
  expect(vehicleReads()).toHaveLength(1);
  const r = vehicleReads()[0];
  expect(r.method).toBe('GET');
  expect(Object.fromEntries(r.url.searchParams)).toEqual({
    select: VEHICLES_SELECT,
    or: '(user_id.eq.00000000-0000-0000-0000-0000000000a1,owner_id.eq.00000000-0000-0000-0000-0000000000a1)',
    make: 'neq.UNRESOLVED',
    deleted_at: 'is.null',
    merged_into_vehicle_id: 'is.null',
    order: 'updated_at.desc',
  });
  // no other reader of the garage is asked
  expect(requests.some(q => /get_user_garage/.test(q.url.pathname))).toBe(false);
});
it('a closest car that is not one of his vehicles is a muted line, not a button and not focusable', async () => {
  await openDay();
  const b = blocks()[1];
  const line = [...b.querySelectorAll<HTMLElement>('.cl-ask__choices > li')].find(li => li.textContent?.includes('Toyota'))!;
  expect(line.textContent).toBe("Closest, but can't take photos (merged, removed or not linked to your account): 1985 Toyota Pickup.");
  expect(line.querySelector('button, a, input, [tabindex]')).toBeNull();
  expect([...b.querySelectorAll('button')].some(x => x.textContent?.includes('Toyota'))).toBe(false);
  // it sits under "Closest matches", after the car he can pick
  expect(b.textContent).toContain('Closest matches');
  expect(choices(b)).toEqual(['1966 Ford Mustang', 'Another vehicle']);
  // his own car keeps its list closed: there is a closest car to tap
  expect(within(b, 'Another vehicle')!.getAttribute('aria-expanded')).toBe('false');
  expect(b.querySelector('.cl-ask__all')).toBeNull();
});
it('when no closest car can be tapped, his vehicles are listed open, without scrolling the page', async () => {
  mine = ownRows().filter(r => r.id !== mustang.vehicle_id);
  const scrolled = vi.fn();
  (Element.prototype as any).scrollIntoView = scrolled;
  try {
    await openDay();
    const b = blocks()[1];
    // the nameless candidate that is not his renders nothing; the named one is the muted line
    expect(b.querySelectorAll('.cl-ask__choices > li > .cl-ask__hint')).toHaveLength(1);
    expect(b.textContent).not.toContain('Mustang');
    expect(within(b, 'Another vehicle')!.getAttribute('aria-expanded')).toBe('true');
    expect(choices(b.querySelector('.cl-ask__all')!)).toEqual(['1973 Pontiac Firebird', '1979 Chevrolet K10']);
    // set A still has its closest cars, so its list stays closed
    expect(blocks()[0].querySelector('.cl-ask__all')).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    // he can close it
    await act(async () => within(b, 'Another vehicle')!.click());
    expect(b.querySelector('.cl-ask__all')).toBeNull();
  } finally { delete (Element.prototype as any).scrollIntoView; }
});
it('while his vehicles are being read, no closest car is a button', async () => {
  let release!: () => void;
  vehiclesReply = () => new Promise<Response>(resolve => { release = () => resolve(json(mine.filter(r => r.make !== 'UNRESOLVED'))); });
  await openDay();
  for (const b of blocks()) {
    expect(b.querySelectorAll('.cl-ask__choice:not(.cl-ask__more)')).toHaveLength(0);
    expect(b.querySelector('[role="status"]')?.textContent).toBe('Reading your vehicles…');
    expect(b.textContent).not.toMatch(/Firebird|Mustang|Toyota/);
  }
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(5); });
  expect(choices(blocks()[0])).toEqual(['1973 Pontiac Firebird', '1966 Ford Mustang', 'Another vehicle']);
  expect(host.textContent).not.toContain('Reading your vehicles');
});
it('a row thumbnail is drawn through the render endpoint, not the original file', async () => {
  await openDay();
  const src = host.querySelector('.cl-frame--on_vehicle img.cl-frame__thumb')?.getAttribute('src');
  expect(src).toBe('https://capture-ledger.test/storage/v1/render/image/public/vehicle-images/u/IMG_5272.heic?width=150&quality=75&resize=contain');
  // a thumbnail outside storage is drawn as it is; a missing one keeps its icon
  expect(host.querySelector('.cl-frame--held img.cl-frame__thumb')?.getAttribute('src')).toBe('https://photos.test/f6.jpg');
  expect(host.querySelector('.cl-frame--private svg')).not.toBeNull();
});
