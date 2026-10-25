// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import AccountingActivity, { activityWhat, ago, type Activity } from './AccountingActivity';
import { AccountingBookContext } from './AccountingBookContext';

const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = (extra: Partial<Activity>): Activity => ({ document_id: 'doc', source_filename: 'accounting-source-0241.csv', run_id: Math.random().toString(36), actor_user_id: owner, method: 'income-allocation', recorded_at: new Date(Date.now() - 180000).toISOString(), records_changed: 1, first_reading: false, ...extra });
let node: HTMLDivElement, root: Root;
const render = (revision: string, onOpen = vi.fn(), book = owner) => root.render(<AccountingBookContext.Provider value={{ ownerId: book, shared: true, canCorrect: true, liveRevision: revision }}><AccountingActivity people={{ [owner]: 'Skylar Williams', [me]: 'You' }} onOpen={onOpen} /></AccountingBookContext.Provider>);
beforeEach(() => { (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; fixture.rpc.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('says who changed what, how much and when, in words', () => {
  expect(activityWhat(row({ method: 'authenticated-record-classification', records_changed: 3 }))).toBe('classified 3 records');
  expect(activityWhat(row({ method: 'income-allocation', records_changed: 1 }))).toBe('changed 1 record · income allocation');
  expect(activityWhat(row({ method: 'jenny-receipt-context', records_changed: 0 }))).toBe('updated evidence · jenny receipt context');
  expect(activityWhat(row({ method: 'authenticated-expense-use-review', records_changed: 0 }))).toBe('assigned vehicle or shop use');
  expect(activityWhat(row({ first_reading: true, records_changed: 25 }))).toBe('added 25 records');
  const now = Date.parse('2026-10-23T10:00:00Z');
  expect(ago('2026-10-23T09:59:40Z', now)).toBe('just now'); expect(ago('2026-10-23T09:57:00Z', now)).toBe('3 min ago'); expect(ago('2026-10-23T07:00:00Z', now)).toBe('3 h ago');
});

it('shows the latest change, refreshes with the shared ledger, marks others’ new changes and opens their source', async () => {
  const open = vi.fn();
  fixture.rpc.mockResolvedValue({ data: [row({ actor_user_id: me, method: 'authenticated-record-classification', records_changed: 2 })], error: null });
  await act(async () => render('1', open));
  expect(fixture.rpc).toHaveBeenCalledWith('accounting_recent_activity', { p_owner_id: owner, p_limit: 20 });
  expect(node.querySelector('.accounting-activity-latest')?.textContent).toBe('Latest You classified 2 records · accounting-source-0241.csv · 3 min ago');
  expect(node.textContent).not.toContain('new');
  // A valid timestamp with an offset is still newer, even when its text sorts earlier.
  const later = new Date(Date.now() + 1000 - 7 * 3600000).toISOString().replace('Z', '-07:00');
  fixture.rpc.mockResolvedValue({ data: [row({ run_id: 'later', document_id: 'doc-2', recorded_at: later, source_filename: 'accounting-source-0127.csv' }), row({ actor_user_id: me })], error: null });
  await act(async () => render('2', open));
  expect(node.querySelector('.accounting-activity-latest')?.textContent).toContain('Skylar Williams changed 1 record · income allocation');
  expect(node.querySelector('summary')?.textContent).toBe('Recent changes 1 new');
  await act(async () => (node.querySelector('.accounting-activity-list button') as HTMLButtonElement).click());
  expect(open).toHaveBeenCalledWith('doc-2');
});

it('offers a manual retry after a timeout without requiring another ledger revision', async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } });
  await act(async () => render('1'));
  expect(node.querySelector('[role="status"]')?.textContent).toContain('Recent changes are unavailable right now.');
  let resolve!: (value: unknown) => void;
  fixture.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
  expect((node.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  expect(node.querySelector('button')?.textContent).toBe('Retrying…');
  await act(async () => resolve({ data: [row({})], error: null }));
  expect(node.querySelector('[role="status"]')).toBeNull();
  expect(node.querySelector('.accounting-activity-latest')?.textContent).toContain('Latest');
});

it('labels previously loaded changes when a refresh fails and recovers on retry', async () => {
  fixture.rpc.mockResolvedValueOnce({ data: [row({ source_filename: 'retained.csv' })], error: null }).mockRejectedValueOnce(new Error('offline'));
  await act(async () => render('1'));
  await act(async () => render('2'));
  expect(node.querySelector('[role="status"]')?.textContent).toContain('Showing the last loaded changes.');
  expect(node.querySelector('.accounting-activity-latest')?.textContent).toContain('Last loaded');
  expect(node.textContent).toContain('retained.csv');
  fixture.rpc.mockResolvedValueOnce({ data: [row({ source_filename: 'current.csv' })], error: null });
  await act(async () => (node.querySelector('[role="status"] button') as HTMLButtonElement).click());
  expect(node.querySelector('[role="status"]')).toBeNull();
  expect(node.textContent).toContain('current.csv');
  expect(node.textContent).not.toContain('retained.csv');
});

it('clears the old book and ignores its pending response when switching books', async () => {
  let resolveOld!: (value: unknown) => void;
  let resolveNew!: (value: unknown) => void;
  fixture.rpc.mockResolvedValueOnce({ data: [row({ source_filename: 'old-book.csv' })], error: null })
    .mockImplementationOnce(() => new Promise(done => { resolveOld = done; }))
    .mockImplementationOnce(() => new Promise(done => { resolveNew = done; }));
  await act(async () => render('1'));
  await act(async () => render('2'));
  await act(async () => render('2', vi.fn(), me));
  expect(node.textContent).toBe('Loading recent changes…');
  await act(async () => resolveOld({ data: [row({ source_filename: 'late-old-book.csv' })], error: null }));
  expect(node.textContent).toBe('Loading recent changes…');
  expect(fixture.rpc).toHaveBeenLastCalledWith('accounting_recent_activity', { p_owner_id: me, p_limit: 20 });
  await act(async () => resolveNew({ data: [], error: null }));
  expect(node.textContent).toBe('No recorded changes are visible for this book yet.');
});

it('clears a failed book and explains an empty successful feed', async () => {
  fixture.rpc.mockResolvedValueOnce({ data: null, error: new Error('unavailable') }).mockResolvedValueOnce({ data: [], error: null });
  await act(async () => render('1'));
  expect(node.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => render('1', vi.fn(), me));
  expect(node.textContent).toBe('No recorded changes are visible for this book yet.');
});
