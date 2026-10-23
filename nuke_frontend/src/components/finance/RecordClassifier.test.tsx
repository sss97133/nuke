// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ classify: vi.fn(), categories: [] as { section: string; category: string; records: number }[], saved: 0 }));
vi.mock('../../lib/supabase', () => ({ supabase: { from() { const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: fixture.categories, error: null }) }; return q; } } }));
vi.mock('../../services/financialRecordClassification', async importOriginal => ({ ...await importOriginal<object>(), classifyRecords: fixture.classify }));
import RecordClassifier, { forgetAccountingCategories, type ClassifyTarget } from './RecordClassifier';
import { AccountingBookContext } from './AccountingBookContext';

const owner = '11111111-1111-4111-8111-111111111111';
const record = (key: string, extra = {}) => ({ record_kind: 'retained_bank_movement', local_id: `bank:${key}`, year: '2025', date: '2025-03-01', account: 'Checking', section: null, category: '', amount: '-12.50', currency: 'USD', description: `SHOP ${key}`, source_key: key.repeat(64), ...extra });
let node: HTMLDivElement, root: Root;
const changed = vi.fn();
const render = (targets: ClassifyTarget[], canCorrect = true) => root.render(<AccountingBookContext.Provider value={{ ownerId: owner, shared: true, canCorrect, liveRevision: '1' }}><RecordClassifier targets={targets} onChanged={changed} /></AccountingBookContext.Provider>);
const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!;
const press = async (text: string) => { await act(async () => button(text).click()); };
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  forgetAccountingCategories(); fixture.classify.mockReset(); changed.mockReset(); fixture.saved = 0;
  fixture.categories = [{ section: 'Expense', category: 'Tech & software subscriptions', records: 653 }, { section: 'Transfer', category: 'Transfer between own accounts', records: 758 }, { section: 'Expense', category: 'Car restoration — parts & materials', records: 462 }, { section: 'Owner', category: 'Personal - not deductible', records: 527 }];
  window.addEventListener('accounting-saved', () => { fixture.saved++; });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('offers the book’s sections and its most used categories, and saves one attributed classification', async () => {
  fixture.classify.mockResolvedValue({ saved: ['a'.repeat(64)], unchanged: [], conflicts: [], records: [{ ...record('a'), section: 'Expense', category: 'Car restoration — parts & materials', status: 'Reviewer classification', decision: 'Reviewer classification' }] });
  await act(async () => render([{ documentId: 'doc', record: record('a') }]));
  expect(node.textContent).toContain('Now Unclassified');
  expect([...node.querySelectorAll('[aria-label="Section"] button')].map(b => b.textContent)).toEqual(['Expense', 'Transfer', 'Owner']);
  expect(button('Save classification').disabled).toBe(true);
  await press('Expense');
  expect([...node.querySelectorAll('[aria-label="Most used categories"] button')].map(b => b.textContent)).toEqual(['Tech & software subscriptions', 'Car restoration — parts & materials']);
  await press('Car restoration — parts & materials');
  await press('Save classification');
  expect(fixture.classify).toHaveBeenCalledWith(owner, 'doc', [{ source_key: 'a'.repeat(64), section: null, category: '' }], { section: 'Expense', category: 'Car restoration — parts & materials', note: '' });
  expect(node.querySelector('[role="status"]')?.textContent).toBe('Saved as Expense · Car restoration — parts & materials. Everyone on this book sees it now.');
  expect(changed.mock.calls[0][0][0].record).toMatchObject({ section: 'Expense', category: 'Car restoration — parts & materials', status: 'Reviewer classification' });
  expect(fixture.saved).toBeGreaterThan(0);
});

it('shows another reviewer’s change and lets the reviewer keep theirs or apply theirs-as-seen', async () => {
  fixture.classify.mockResolvedValueOnce({ saved: [], unchanged: [], records: [], conflicts: [{ source_key: 'a'.repeat(64), section: 'Transfer', category: 'Transfer between own accounts' }] })
    .mockResolvedValueOnce({ saved: ['a'.repeat(64)], unchanged: [], conflicts: [], records: [{ ...record('a'), section: 'Expense', category: '' }] });
  await act(async () => render([{ documentId: 'doc', record: record('a') }]));
  await press('Expense'); await press('Save classification');
  expect(node.textContent).toContain('Another reviewer changed this record to Transfer · Transfer between own accounts while you were choosing.');
  expect(changed).not.toHaveBeenCalled();
  await press('Use mine');
  expect(fixture.classify.mock.calls[1][2]).toEqual([{ source_key: 'a'.repeat(64), section: 'Transfer', category: 'Transfer between own accounts' }]);
  expect(node.textContent).toContain('Saved as Expense.');
});

it('classifies a selection with one revision per source and summarizes the outcome', async () => {
  fixture.classify.mockImplementation(async (_owner: string, documentId: string, targets: { source_key: string }[]) => documentId === 'doc-1'
    ? { saved: targets.map(t => t.source_key), unchanged: [], conflicts: [], records: targets.map(t => ({ ...record(t.source_key[0]), section: 'Owner', category: 'Personal - not deductible' })) }
    : { saved: [], unchanged: [targets[0].source_key], conflicts: [], records: [] });
  await act(async () => render([{ documentId: 'doc-1', record: record('a') }, { documentId: 'doc-1', record: record('b') }, { documentId: 'doc-2', record: record('c') }]));
  expect(node.querySelector('h3')?.textContent).toBe('Classify 3 records');
  await press('Owner'); await press('Personal - not deductible'); await press('Classify 3 records');
  expect(fixture.classify).toHaveBeenCalledTimes(2);
  expect(fixture.classify.mock.calls[0][2]).toHaveLength(2);
  expect(node.querySelector('[role="status"]')?.textContent).toBe('Saved 2 records as Owner · Personal - not deductible. 1 already had this classification.');
  expect(changed.mock.calls[0][0]).toHaveLength(2);
});

it('review-only access never presents a save action', async () => {
  await act(async () => render([{ documentId: 'doc', record: record('a') }], false));
  expect(node.querySelector('fieldset')).toBeNull(); expect(node.textContent).toContain('Review access'); expect(fixture.classify).not.toHaveBeenCalled();
});
