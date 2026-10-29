// @vitest-environment jsdom
// The edge function is a mock client: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, SUPABASE_ANON_KEY: 'k', getSupabaseFunctionsUrl: () => 'http://x' }));
import ContributePage from './ContributePage';
import { deviceSummary } from '../vehicle-profile/ContributorIntakeCard';
import type { IntakeClient } from './intakeState';
import { bandText, readProgress } from './IntakeLadder';

const TOKEN = 't'.repeat(43);
const CARD = { invite_id: 'i1', vehicle: { year: 1973, make: 'Pontiac', model: 'Firebird', vin: 'TESTVIN0000000001' },
  contributor: { display_name: 'Test Builder', relationship: 'builder' },
  known_facts: [{ text: 'Cowl tag read', state: 'proven' }, { text: 'Cam unknown', state: 'open' }],
  questions: [{ key: 'q1', prompt: 'The block', hint: 'Where from?' }], round2: [{ key: 'r1', prompt: 'Rockers', group: 'Engine' }], documents_count: 2 };

let root: Root, host: HTMLDivElement;
const render = async (client: IntakeClient) => {
  await act(async () => { root.render(<MemoryRouter initialEntries={[`/contribute/${TOKEN}`]}><Routes><Route path="/contribute/:token" element={<ContributePage intake={client} />} /></Routes></MemoryRouter>); });
};
const setText = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(), get length() { return store.size; } } });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('ContributePage', () => {
  it('renders the car, the facts, the questions and the footer line', async () => {
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file: vi.fn() });
    expect(host.textContent).toContain('1973 Pontiac Firebird');
    expect(host.textContent).toContain('For Test Builder, the builder');
    expect(host.textContent).toContain('Cowl tag read');
    expect(host.textContent).toContain('2 already on file');
    expect(host.textContent).toContain('Answers through your link, from your phone');
    expect(host.querySelector('details')?.open).toBe(false);
  });

  it('unknown token shows one plain dead-link page', async () => {
    await render({ open: async () => ({ status: 404, body: { error: 'not_found' } }), answer: vi.fn(), file: vi.fn() });
    expect(host.textContent).toContain('This link does not open');
  });

  it('save on blur: failure keeps the text and offers retry; retry saves', async () => {
    const answer = vi.fn().mockResolvedValueOnce({ ok: false, body: null }).mockResolvedValueOnce({ ok: true, body: null });
    await render({ open: async () => ({ status: 200, body: CARD }), answer, file: vi.fn() });
    const ta = host.querySelector('textarea')!;
    await act(async () => { setText(ta, 'A 1970 455'); });
    await act(async () => { ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(answer).toHaveBeenCalledWith(TOKEN, 'q1', 'A 1970 455');
    expect(host.textContent).toContain('not saved, try again');
    expect(ta.value).toBe('A 1970 455');
    expect(localStorage.length).toBe(1);
    const retry = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('not saved'))!;
    await act(async () => { retry.click(); });
    expect(host.textContent).toContain('saved');
    expect(host.textContent).not.toContain('not saved');
    expect(localStorage.length).toBe(0);
  });

  it('a chosen file shows sending, then received', async () => {
    let finish: (v: { ok: boolean; duplicate: boolean; body: unknown }) => void = () => {};
    const file = vi.fn(() => new Promise<{ ok: boolean; duplicate: boolean; body: unknown }>(r => { finish = r; }));
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file });
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    const f = new File(['x'], 'receipt.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('sending…');
    await act(async () => { finish({ ok: true, duplicate: false, body: null }); });
    expect(host.textContent).toContain('received');
    expect(file).toHaveBeenCalledWith(TOKEN, f, 'receipt', null);
  });

  it('the picked label travels with the file', async () => {
    const file = vi.fn(async () => ({ ok: true, duplicate: false, body: null }));
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file });
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => { select.value = 'build photo'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain("public page");
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    const f = new File(['x'], 'shell.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(file).toHaveBeenCalledWith(TOKEN, f, 'build photo', null);
  });

  const BAND = (cls: string, n: number, low: number | null, high: number | null, lots: string[], few = false) => ({
    reader: 'evidence_rung_band_v1', as_of: '2026-10-29T19:58:54Z', n, too_few_to_tell: few, low, high, median: low !== null && high !== null ? (low + high) / 2 : null,
    interval: 'p25 to p75 of hammer prices', lot_ids: lots, class_counts: { sd: 8, base: 34, clone: 1, trans_am: 38 },
    params: { make: 'Pontiac', basis: 'hammer', class: cls, since: '2022-01-01', year_min: 1970, year_max: 1973 },
    reasoning: { rule: `sold lots of Pontiac firebird 1970-1973 since 2022-01-01, class ${cls}; band = p25 to p75 of hammer prices; too few to tell under 5 lots`, inputs: { n }, result: few ? 'too few' : `p25 ${low}, p75 ${high}` },
  });
  const LOTS = ['ae-1', 'ae-2', 'ae-3'];
  const PROGRESS = {
    rung: { key: 'r1', label: 'As the frames show it today', basis: 'Six 1970-73 Firebird clones sold 2024-26', band: BAND('base', 34, 26125, 56875, LOTS) },
    rungs: [{ key: 'r1', label: 'As the frames show it today', band: BAND('base', 34, 26125, 56875, LOTS) }, { key: 'r2', label: 'Engine numbers shot' },
      { key: 'r3', label: 'SD parts proven', band: BAND('clone', 1, null, null, ['ae-9'], true) }],
    proven: [{ key: 'vin', label: 'VIN plate' }], open: [{ key: 'pad', label: 'Engine pad stamp' }, { key: 'q1', label: 'The block' }], contradicted: [],
    next: [{ key: 'q1', label: 'The block', kind: 'question', question_key: 'q1' }, { key: 'pad', label: 'Engine pad stamp', kind: 'photo' }],
    last_change: null,
  };

  it('the car theme, its frames and the ladder come from the reply, nothing else', async () => {
    const card = { ...CARD, vehicle: { ...CARD.vehicle, id: 'v1', color: 'Buccaneer Red' },
      frames: [{ image_id: 'f1', url: 'https://cdn.example/f1.jpg', role: 'hero', caption: 'front 3/4' }, { image_id: 'f2', url: 'https://cdn.example/f2.jpg', role: 'emblem', caption: 'hood bird decal' },
        { image_id: 'bad', url: 'vehicle-photos/users/x/IMG_1.jpg', role: 'frame' }],
      progress: PROGRESS };
    await render({ open: async () => ({ status: 200, body: card }), answer: vi.fn(), file: vi.fn() });
    const article = host.querySelector('article.ct-page') as HTMLElement;
    expect(article.style.getPropertyValue('--accent')).toBe('#ef1707');
    expect(article.dataset.motif).toBe('hood-bars');
    expect(host.textContent).toContain('Buccaneer Red, code 75');
    const imgs = Array.from(host.querySelectorAll('.ct-hero img')).map(i => i.getAttribute('src'));
    expect(imgs).toEqual(['https://cdn.example/f1.jpg', 'https://cdn.example/f2.jpg']);
    expect(host.textContent).toContain('As the frames show it today: $26,125 to $56,875');
    expect(host.textContent).toContain('Six 1970-73 Firebird clones sold 2024-26');
    expect(host.textContent).toContain('1 proven · 2 open');
    expect(host.querySelectorAll('.ct-rung--reached').length).toBe(1);
    expect(host.querySelectorAll('.ct-next li').length).toBe(2);
  });

  it('no colour on the row means no accent and no swatch; no frames means no hero; no progress means no ladder', async () => {
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file: vi.fn() });
    const article = host.querySelector('article.ct-page') as HTMLElement;
    expect(article.style.getPropertyValue('--accent')).toBe('');
    expect(article.dataset.motif).toBe('hood-bars');
    expect(host.querySelector('.ct-hero')).toBeNull();
    expect(host.querySelector('.ct-ladder')).toBeNull();
    expect(host.textContent).not.toContain('$');
  });

  it('a number appears only beside its population in words; the class is named as what those lots sold for; too few shows n and no number', async () => {
    await render({ open: async () => ({ status: 200, body: { ...CARD, progress: PROGRESS } }), answer: vi.fn(), file: vi.fn() });
    const rungs = Array.from(host.querySelectorAll('.ct-rung')).map(r => r.textContent);
    expect(rungs[0]).toContain('what base lots sold for');
    expect(rungs[0]).toContain('$26,125 to $56,875');
    expect(rungs[0]).toContain('34 base 1970-73 Pontiac Firebird lots sold since Jan 2022, hammer, p25 to p75');
    expect(rungs[0]).toContain('as of Oct 29, 2026, evidence_rung_band_v1');
    expect(rungs[1]).toBe('Engine numbers shot');
    expect(rungs[2]).toContain('what clone lots sold for'); expect(rungs[2]).toContain('too few to tell');
    expect(rungs[2]).toContain('1 clone 1970-73 Pontiac Firebird lot sold since Jan 2022'); expect(rungs[2]).not.toContain('$');
    const now = host.querySelector('.ct-ladder__now')!;
    expect(now.querySelector('.ct-ladder__rung')?.textContent).toBe('As the frames show it today: $26,125 to $56,875');
    expect(now.querySelector('.ct-ladder__classes')?.textContent).toBe('lots by class since Jan 2022: Trans Am 38 · base 34 · SD 8 · clone 1');
    expect(Array.from(now.querySelectorAll('.ct-lots li')).map(l => l.textContent)).toEqual(LOTS);
    expect(now.querySelector('.ct-reasoning')?.textContent).toContain('class base; band = p25 to p75');
  });

  it('a rung carries no number without its band block, even when the row has band_low and band_high', async () => {
    const bare = { ...PROGRESS, rung: { key: 'r2', label: 'Engine numbers shot', band_low: 55000, band_high: 65000, basis: 'seeded' } };
    await render({ open: async () => ({ status: 200, body: { ...CARD, progress: bare } }), answer: vi.fn(), file: vi.fn() });
    expect(host.querySelector('.ct-ladder__rung')?.textContent).toBe('Engine numbers shot');
    expect(host.querySelector('.ct-ladder__now')?.textContent).not.toContain('$');
    expect(readProgress({ rung: { key: 'x', label: 'x', band: { ...BAND('base', 9, 1, 2, []), lot_ids: [] } }, rungs: [] })!.rung!.band).toBeNull();
    expect(bandText(readProgress({ rung: { key: 'x', label: 'x', band: { ...BAND('base', 34, 1, 2, LOTS), too_few_to_tell: true } }, rungs: [] })!.rung!.band)).toBe('too few to tell');
  });

  it('a photo named as one of the needed shots travels with that shot key', async () => {
    const file = vi.fn(async () => ({ ok: true, duplicate: false, body: null }));
    await render({ open: async () => ({ status: 200, body: { ...CARD, progress: PROGRESS } }), answer: vi.fn(), file });
    const shotSelect = host.querySelector('select[aria-label="Which shot this is"]') as HTMLSelectElement;
    expect(Array.from(shotSelect.options).map(o => o.textContent)).toEqual(['Not one of these', 'Engine pad stamp']);
    await act(async () => { shotSelect.value = 'pad'; shotSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    const f = new File(['x'], 'pad.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(file).toHaveBeenCalledWith(TOKEN, f, 'receipt', 'pad');
  });

  it('a saved answer carries the ladder after it and says what moved', async () => {
    const after = { ...PROGRESS, rung: { key: 'r2', label: 'Engine numbers shot', band: BAND('trans_am', 38, 49575, 95125, ['ae-4']) },
      proven: [...PROGRESS.proven, { key: 'q1', label: 'The block' }], open: [{ key: 'pad', label: 'Engine pad stamp' }],
      last_change: { at: '2026-10-29T20:00:00Z', what: 'q1', from_status: 'open', to_status: 'proven', moved_from: 'r1', moved_to: 'r2' } };
    const answer = vi.fn().mockResolvedValue({ ok: true, body: { observation_id: 'o1', progress: after } });
    await render({ open: async () => ({ status: 200, body: { ...CARD, progress: PROGRESS } }), answer, file: vi.fn() });
    const ta = host.querySelector('textarea')!;
    await act(async () => { setText(ta, 'A 1970 455'); });
    await act(async () => { ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(host.textContent).toContain('Engine numbers shot: $49,575 to $95,125');
    expect(host.textContent).toContain('what Trans Am lots sold for');
    expect(host.querySelector('.ct-moved')?.textContent).toBe('The block is now proven. The car moved from As the frames show it today to Engine numbers shot.');
    expect(host.querySelectorAll('.ct-rung--reached').length).toBe(2);
  });
});

describe('deviceSummary', () => {
  it('names the device without the address hash', () => {
    const s = deviceSummary({ user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iOS', screen: { w: 390, h: 844 }, timezone: 'America/Los_Angeles', ip_sha256: 'abc123' });
    expect(s).toBe('iPhone, iOS, 390×844, America/Los_Angeles');
    expect(deviceSummary(null)).toBe('device not recorded');
  });
});
