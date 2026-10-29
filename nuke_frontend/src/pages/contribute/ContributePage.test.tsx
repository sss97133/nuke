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
    const answer = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
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
    let finish: (v: { ok: boolean; duplicate: boolean }) => void = () => {};
    const file = vi.fn(() => new Promise<{ ok: boolean; duplicate: boolean }>(r => { finish = r; }));
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file });
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    const f = new File(['x'], 'receipt.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('sending…');
    await act(async () => { finish({ ok: true, duplicate: false }); });
    expect(host.textContent).toContain('received');
    expect(file).toHaveBeenCalledWith(TOKEN, f, 'receipt');
  });

  it('the picked label travels with the file', async () => {
    const file = vi.fn(async () => ({ ok: true, duplicate: false }));
    await render({ open: async () => ({ status: 200, body: CARD }), answer: vi.fn(), file });
    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => { select.value = 'build photo'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain("public page");
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    const f = new File(['x'], 'shell.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(file).toHaveBeenCalledWith(TOKEN, f, 'build photo');
  });
});

describe('deviceSummary', () => {
  it('names the device without the address hash', () => {
    const s = deviceSummary({ user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iOS', screen: { w: 390, h: 844 }, timezone: 'America/Los_Angeles', ip_sha256: 'abc123' });
    expect(s).toBe('iPhone, iOS, 390×844, America/Los_Angeles');
    expect(deviceSummary(null)).toBe('device not recorded');
  });
});
