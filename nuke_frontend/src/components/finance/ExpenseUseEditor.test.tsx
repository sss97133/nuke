// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ read: vi.fn(), invoke: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke }, from: fixture.from, rpc: fixture.rpc } }));
vi.mock('../../services/financialExpenseUse', async importOriginal => ({ ...await importOriginal<object>(), readExpenseSnapshot: fixture.read }));
import ExpenseUseEditor from './ExpenseUseEditor';
import { AccountingBookContext } from './AccountingBookContext';
const key = 'a'.repeat(64), owner = '11111111-1111-4111-8111-111111111111';
const record = { record_kind: 'retained_ledger_decision', local_id: 'expense', year: '2025', date: null, account: 'Checking', section: 'Expense', category: 'Supplies', amount: '100.00', currency: 'USD', source_key: key };
const snapshot = (runId = owner, use: any = null) => ({ document: { owner_id: owner, content_sha256: 'b'.repeat(64), storage_path: `${owner}/source.csv`, source_filename: 'source.csv', source_kind: 'bank_export' }, fields: [{ field_key: 'source', value_raw: 'Retained', value_type: 'text', value_normalized: { value: 'Retained', evidence: { quote: 'Original' } } }], lines: [{ attributes: { accounting_record: record } }], record, runId, use });
let node: HTMLDivElement, root: Root;
const render = (revision: string, canCorrect = true, shown: any = record) => root.render(<AccountingBookContext.Provider value={{ ownerId: owner, shared: true, canCorrect, liveRevision: revision }}><ExpenseUseEditor documentId={owner} record={shown} onSaved={() => {}} /></AccountingBookContext.Provider>);
const change = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.read.mockReset(); fixture.invoke.mockReset(); fixture.from.mockReset(); fixture.rpc.mockReset(); fixture.read.mockResolvedValue(snapshot()); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
it('preserves a dirty draft and blocks saving when another reviewer changes its source', async () => {
  await act(async () => render('one'));
  await change(node.querySelector('select')!, 'shop');
  await change(node.querySelector('input')!, '40');
  await change(node.querySelector('textarea')!, 'Shared shop supplies');
  fixture.read.mockResolvedValue(snapshot('22222222-2222-4222-8222-222222222222'));
  await act(async () => render('two'));
  expect(node.textContent).toContain('Your unsaved draft is preserved');
  expect(node.querySelector('input')!.value).toBe('40');
  expect([...node.querySelectorAll('button')].find(b => b.textContent === 'Save use assignment')!.disabled).toBe(true);
  expect(fixture.invoke).not.toHaveBeenCalled();
});
it('submits a partial assignment through the existing attributed correction writer and reads it back', async () => {
  await act(async () => render('one'));
  await change(node.querySelector('select')!, 'shop'); await change(node.querySelector('input')!, '40'); await change(node.querySelector('textarea')!, 'Shared shop supplies');
  fixture.invoke.mockResolvedValue({ data: { data: { expense_posted: false } }, error: null });
  fixture.read.mockResolvedValue(snapshot('22222222-2222-4222-8222-222222222222', { source_key: key, use_type: 'shop', destination_label: 'Shop', vehicle_id: null, allocated_amount: '40.000000', unallocated_amount: '60.000000', basis: 'Shared shop supplies' }));
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Save use assignment')!.click());
  const request = fixture.invoke.mock.calls[0][1].body;
  expect(request.action).toBe('correct'); expect(request.owner_user_id).toBe(owner); expect(request.revision.supersedes_run_id).toBe(owner);
  expect(request.revision.fields.at(-1).value_normalized.unallocated_amount).toBe('60.000000');
  expect(node.textContent).toContain('Saved to the shared ledger');
});
it('assigns an expense to a NUKE activity without asking for a vehicle', async () => {
  await act(async () => render('one'));
  await change(node.querySelector('select')!, 'software');
  expect(node.querySelectorAll('select')).toHaveLength(1);
  await change(node.querySelector('input')!, '100'); await change(node.querySelector('textarea')!, 'Hosting for the Nuke platform');
  fixture.invoke.mockResolvedValue({ data: { data: { expense_posted: false } }, error: null });
  fixture.read.mockResolvedValue(snapshot('22222222-2222-4222-8222-222222222222', { source_key: key, use_type: 'software', destination_label: 'NUKE software development', vehicle_id: null, allocated_amount: '100.000000', unallocated_amount: '0.000000', basis: 'Hosting for the Nuke platform' }));
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Save use assignment')!.click());
  expect(fixture.invoke.mock.calls[0][1].body.revision.fields.at(-1).value_normalized).toMatchObject({ use_type: 'software', destination_label: 'NUKE software development', vehicle_id: null, unallocated_amount: '0.000000' });
  expect(node.textContent).toContain('Saved to the shared ledger');
});
it('review-only access never presents a save action', async () => {
  await act(async () => render('one', false));
  expect(node.querySelector('fieldset')).toBeNull(); expect(node.textContent).toContain('Review access'); expect(fixture.invoke).not.toHaveBeenCalled();
});
it('suggests the vehicles photographed around the purchase as context; a photo date alone never fills the reason', async () => {
  const blazer = '33333333-3333-4333-8333-333333333333', mustang = '44444444-4444-4444-8444-444444444444';
  const query: any = { select: () => query, or: () => query, is: () => query, order: () => query,
    limit: () => Promise.resolve({ data: [{ id: blazer, year: 1977, make: 'Chevrolet', model: 'Blazer', vin: null }, { id: mustang, year: 1966, make: 'Ford', model: 'Mustang', vin: '6R07C219593' },
      { id: '55555555-5555-4555-8555-555555555555', year: 1971, make: 'Ford', model: 'Bronco', vin: null }], error: null }) };
  fixture.from.mockReturnValue(query);
  fixture.rpc.mockResolvedValue({ data: [{ vehicle_id: blazer, photo_days: ['2024-06-10', '2024-06-12'], images: 41 }, { vehicle_id: mustang, photo_days: ['2024-06-13'], images: 7 }], error: null });
  const dated = { ...record, date: '2024-06-11' };
  fixture.read.mockResolvedValue({ ...snapshot(), record: dated, lines: [{ attributes: { accounting_record: dated } }] });
  await act(async () => render('one', true, dated));
  await change(node.querySelector('select')!, 'vehicle');
  expect(fixture.rpc).toHaveBeenCalledWith('accounting_vehicle_photo_days', { p_owner_id: owner, p_date: '2024-06-11' });
  expect(node.textContent).toContain('Photographed around Jun 11');
  const chip = [...node.querySelectorAll('button')].find(b => b.textContent?.includes('Blazer'))!;
  expect(chip.textContent).toBe('1977 Chevrolet Blazer · 2 days');
  // Profiles that share a year, make and model are told apart by their VIN tail; a vehicle not photographed gets no chip.
  expect([...node.querySelectorAll('button')].find(b => b.textContent?.includes('Mustang'))!.textContent).toBe('1966 Ford Mustang …219593 · 1 day');
  expect([...node.querySelectorAll('button')].some(b => b.textContent?.includes('Bronco'))).toBe(false);
  await act(async () => chip.click());
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(node.querySelectorAll('select')[1].value).toBe(blazer);
  // Owner rule: never the date alone. The chip selects the vehicle; the reviewer writes what ties it.
  expect(node.querySelector('textarea')!.value).toBe('');
  expect(node.textContent).toContain('Photo dates are context only');
  await change(node.querySelectorAll('input')[1] as HTMLInputElement, '100');
  const saveButton = () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Save use assignment')!;
  expect(saveButton().disabled).toBe(true);
  await change(node.querySelector('textarea')!, 'Work order names this Blazer');
  expect(saveButton().disabled).toBe(false);
  fixture.invoke.mockResolvedValue({ data: { data: { expense_posted: false } }, error: null });
  await act(async () => saveButton().click());
  expect(fixture.invoke.mock.calls[0][1].body.revision.fields.at(-1).value_normalized).toMatchObject({ use_type: 'vehicle', vehicle_id: blazer, destination_label: '1977 Chevrolet Blazer VIN not recorded', basis: 'Work order names this Blazer' });
});
it('asks for no suggestions when the expense has no date', async () => {
  const query: any = { select: () => query, or: () => query, is: () => query, order: () => query, limit: () => Promise.resolve({ data: [], error: null }) };
  fixture.from.mockReturnValue(query);
  await act(async () => render('one'));
  await change(node.querySelector('select')!, 'vehicle');
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain('Photographed around');
});
it('finds a vehicle by its full VIN although the label shows only the last six characters', async () => {
  const roadster = '66666666-6666-4666-8666-666666666666';
  const query: any = { select: () => query, or: () => query, is: () => query, order: () => query,
    limit: () => Promise.resolve({ data: [{ id: roadster, year: 1932, make: 'Ford', model: 'Hot Rod', vin: 'AZ370615' },
      { id: '77777777-7777-4777-8777-777777777777', year: 1977, make: 'Chevrolet', model: 'Blazer', vin: 'CKR187F127263' }], error: null }) };
  fixture.from.mockReturnValue(query);
  await act(async () => render('one'));
  await change(node.querySelector('select')!, 'vehicle');
  await change(node.querySelector('input[type="search"]') as HTMLInputElement, 'AZ370615');
  const options = [...node.querySelectorAll('select')[1].querySelectorAll('option')].map(o => o.value).filter(Boolean);
  expect(options).toEqual([roadster]);
});
