// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() }, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('../../services/financialEvidenceIntake', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/financialEvidenceIntake')>()), processFinancialDocument: fixture.process }));
import { LargeSumsList, PaperTotals } from './LargeSums';
import { gateYear, largeRow as row, largeYear as year, tier } from './__fixtures__/books';

// Synthetic values only (see __fixtures__/books.ts). The page prints what the database states.

let node: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.process.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const text = (el: Element | null) => el?.textContent ?? '';
const render = async (ui: React.ReactNode) => act(async () => root.render(<ol>{ui}</ol>));
const pickFile = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const rowEl = (n: number) => Array.from(node.querySelectorAll('.accounting-paper-row'))[n - 1] as HTMLElement;
const click = (el: Element | null) => act(async () => (el as HTMLButtonElement).click());
/** The button on a row that opens the panel that takes a file: any button whose words start with Add, apart from the panel's own submit. */
const addButton = (el: Element) => Array.from(el.querySelectorAll('button')).find(b => /^Add (the|a|another)\b/.test(b.textContent ?? '') ) as HTMLButtonElement | undefined;

it('lists the rows in the order the reader gives them (largest dollars first) with date, payee, amount and what each still needs in plain words', async () => {
  const rows = [row(1), row(2, { required_doc_kind: 'purchase_agreement', required_doc_rule: 'vehicle_deal' }), row(3, { missing_doc: false, proof_flag: 'no_payment_proof', required_doc_kind: null, required_doc_rule: null })];
  await render(<LargeSumsList y={year(rows)} readAt={Date.parse('2026-10-29T17:40:00Z')} onOpen={vi.fn()} onAttached={vi.fn()} />);
  const lines = Array.from(node.querySelectorAll('.accounting-paper-row')).map(el => text(el));
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('Jan 1, 2024 · Payee 1 — work 1');
  expect(lines[0]).toContain('Needs: Contractor invoice');
  expect(lines[0]).toContain('$4,900');
  expect(lines[1]).toContain('Needs: Purchase agreement or bill of sale');
  expect(lines[2]).toContain('Needs: A bank line: no statement line is linked to this row');
  expect(text(node)).toContain('2 rows need a document · 1 row needs a bank line · 0 rows rest on the filed return only');
  expect(text(node)).toContain('Live from v_books_large_sums, read Oct 29, 2026, 10:40 AM.');
});

it('only a row a file can answer offers to add one: not a missing bank line, not the asset register', async () => {
  const rows = [row(1), row(2, { missing_doc: false, proof_flag: 'no_payment_proof', required_doc_kind: null, required_doc_rule: null }),
    row(3, { required_doc_kind: 'register_asset', required_doc_rule: 'depreciation' }), row(4, { missing_doc: false, proof_flag: 'filed_return_only', required_doc_kind: null, required_doc_rule: null })];
  await render(<LargeSumsList y={year(rows)} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  const offers = [1, 2, 3, 4].map(n => addButton(rowEl(n))?.textContent ?? null);
  expect(offers).toEqual(['Add the invoice', null, null, 'Add a document']);
  await render(<LargeSumsList y={year([row(5, { required_doc_kind: 'purchase_agreement', required_doc_rule: 'vehicle_deal' }), row(6, { required_doc_kind: 'receipt_or_order', required_doc_rule: 'parts_supplies' }), row(7, { required_doc_kind: 'lease_or_ruling', required_doc_rule: 'rent' })])} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  expect([1, 2, 3].map(n => addButton(rowEl(n))?.textContent)).toEqual(['Add the purchase agreement', 'Add the receipt', 'Add the lease']);
});

it('opens a row\'s evidence from its title, with the document and the record the dialog needs', async () => {
  const onOpen = vi.fn(); const r = row(1);
  await render(<LargeSumsList y={year([r])} readAt={null} onOpen={onOpen} onAttached={vi.fn()} />);
  await click(rowEl(1).querySelector('.accounting-link-button'));
  expect(onOpen).toHaveBeenCalledWith('doc-1', r.record);
});

it('shows the first ten rows and the rest on request', async () => {
  const rows = Array.from({ length: 14 }, (_, i) => row(i + 1));
  await render(<LargeSumsList y={year(rows)} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  expect(node.querySelectorAll('.accounting-paper-row')).toHaveLength(10);
  expect(text(node)).toContain('Show all 14 rows');
  await click(Array.from(node.querySelectorAll('button')).find(b => b.textContent?.startsWith('Show all')) ?? null);
  expect(node.querySelectorAll('.accounting-paper-row')).toHaveLength(14);
  expect(text(node)).toContain('Show the largest 10 only');
});

it('a year with nothing flagged says so and lists no row', async () => {
  await render(<LargeSumsList y={year([], { flagged_n: 0, missing_doc_n: 0 })} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  expect(text(node)).toContain('No large sum is flagged for 2024.');
  expect(node.querySelectorAll('.accounting-paper-row')).toHaveLength(0);
});

it('adding the paper: nothing is sent until the file is chosen and the button is pressed; the row\'s year, record and the owner\'s words travel as the link target', async () => {
  fixture.process.mockResolvedValue({ documentId: 'new-doc', status: 'blocked', reused: false, readback: {}, linked: { field_key: 'supports_record_x', already: false } });
  const onAttached = vi.fn(); const r = row(1);
  await render(<LargeSumsList y={year([r])} readAt={null} onOpen={vi.fn()} onAttached={onAttached} />);
  await click(addButton(rowEl(1))!);
  const panel = rowEl(1).querySelector('.accounting-paper-attach')!;
  expect(text(panel)).toContain('This row needs: Contractor invoice.');
  expect(text(panel)).toContain('never a document with a Social Security number');
  expect(Array.from(panel.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Invoice', 'Agreement', 'Contract', 'Work order', 'Text message thread', 'Email thread']);
  expect(text(panel)).toContain('A screenshot of the text or email thread that states the work and the price counts as the agreement.');
  const submit = Array.from(panel.querySelectorAll('button')).find(b => b.textContent === 'Add to this row') as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(fixture.process).not.toHaveBeenCalled();
  const file = new File(['x'], 'invoice-1.pdf', { type: 'application/pdf' });
  await pickFile(panel.querySelector('input[type="file"]') as HTMLInputElement, file);
  expect(fixture.process).not.toHaveBeenCalled();
  await act(async () => { const select = panel.querySelector('select') as HTMLSelectElement; select.value = 'Contract'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(submit);
  expect(fixture.process).toHaveBeenCalledOnce();
  const [sent, , target] = fixture.process.mock.calls[0];
  expect(sent).toBe(file);
  expect(target).toEqual({ year: '2024', local_id: 'L1', source_key: r.record.source_key, decision_document_id: 'doc-1', doc_kind: 'Contract', required_doc_kind: 'invoice_or_agreement' });
  expect(text(panel)).toContain('Added. The file is stored privately and pointed at this row.');
  expect(text(panel)).toContain('Document received, link pending');
  expect(onAttached).toHaveBeenCalledOnce();
});

it('shows the stage while the file is added, and the writer\'s refusal in words; the row and the file stay for another try', async () => {
  let fail!: (e: Error) => void;
  fixture.process.mockImplementation((_f: File, stage: (s: string) => void) => { stage('uploading'); return new Promise((_ok, no) => { fail = no; }); });
  await render(<LargeSumsList y={year([row(1)])} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  await click(addButton(rowEl(1))!);
  const panel = rowEl(1).querySelector('.accounting-paper-attach')!;
  await pickFile(panel.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
  await click(Array.from(panel.querySelectorAll('button')).find(b => b.textContent === 'Add to this row')!);
  expect(text(panel)).toContain('a.pdf: Uploading it privately…');
  expect((panel.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
  await act(async () => { fail(new Error('The private upload failed. Retry this file to continue.')); });
  expect(panel.querySelector('[role="alert"]')?.textContent).toBe('The private upload failed. Retry this file to continue.');
  expect(rowEl(1)).not.toBeNull();
  expect((Array.from(panel.querySelectorAll('button')).find(b => b.textContent === 'Add to this row') as HTMLButtonElement).disabled).toBe(false);
});

it('a document already attached to a row shows beside it, says what it is, and says the row waits for the books agent; the row is never marked done', async () => {
  const attached = [{ document_id: 'new-doc', filename: 'invoice-1.pdf', doc_kind: 'Invoice', ref: 'Invoice: invoice-1.pdf (sha256 abc)', attached_at: '2026-10-29T19:12:00Z' }];
  await render(<LargeSumsList y={year([row(1, { attached })])} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  expect(text(rowEl(1))).toContain('Invoice · invoice-1.pdf · attached Oct 29, 2026, 12:12 PM');
  expect(text(rowEl(1))).toContain('Document received, link pending: it is linked to this row when the books agent cites it, and the row stays on the list until then.');
  expect(text(rowEl(1))).toContain('Needs: Contractor invoice');
  expect(addButton(rowEl(1))?.textContent).toBe('Add another');
});

// ── the two totals ───────────────────────────────────────────────────────────────────────────────────────────────────────

it('prints the two totals from the live readers, each with its denominator, its rule and the view it is read from', async () => {
  const t = tier('2024', { no_pay_no_ruling_usd: 9000.4, deduction_usd: 150000.4 });
  await render(<PaperTotals y={gateYear(2024)} sums={{ phase: 'ready', data: year([row(1)], { missing_doc_n: 11, missing_doc_usd: 36000.4, head_n: 40, head_usd: 120000.4 }) }} tier={{ phase: 'ready', data: t }} />);
  const items = Array.from(node.querySelectorAll('.accounting-close-item')).map(el => text(el));
  expect(items[0]).toContain('No bank line, no owner ruling, no rule');
  expect(items[0]).toContain('$9,000 of $150,000 in deductions, net of credits');
  expect(items[0]).toContain('Rule R10 part b, read live from v_books_audit_tier_years');
  expect(items[1]).toContain('Large deductions missing their document');
  expect(items[1]).toContain('$36,000 of $120,000 in the 40 largest deductions');
  expect(items[1]).toContain('This counts missing paper.');
  expect(items[1]).toContain('Rule R12, read live from v_books_large_sums');
  expect(text(node)).not.toContain('gate run');
  expect(Array.from(node.querySelectorAll('.accounting-paper-total')).map(el => el.getAttribute('data-tone'))).toEqual(['bad', 'bad']);
});

it('a total in flight says so and states no number; one that failed says so and states none either', async () => {
  await render(<PaperTotals y={gateYear(2024)} />);
  expect(text(node)).toContain('Reading…');
  expect(text(node)).not.toMatch(/\$\d/);
  await render(<PaperTotals y={gateYear(2024)} sums={{ phase: 'error', data: undefined }} tier={{ phase: 'ready', data: tier('2024', { no_pay_no_ruling_usd: 0 }) }} />);
  const items = Array.from(node.querySelectorAll('.accounting-close-item')).map(el => text(el));
  expect(items[0]).toContain('$0 of $1,000 in deductions, net of credits');
  expect(node.querySelector('.accounting-paper-total')!.getAttribute('data-tone')).toBe('good');
  expect(items[1]).toContain('Could not load');
  expect(items[1]).not.toMatch(/\$\d/);
});

it('the dollars with no bank line, ruling or rule open the deductions behind them in the office\'s row list; a total of nothing, and the rows already listed below, are not buttons', async () => {
  const onDrill = vi.fn();
  const live = { phase: 'ready' as const, data: year([row(1)]) };
  await render(<PaperTotals y={gateYear(2024)} sums={live} tier={{ phase: 'ready', data: tier('2024', { no_pay_no_ruling_usd: 9000 }) }} onDrill={onDrill} />);
  const buttons = Array.from(node.querySelectorAll('button.accounting-close-item__button'));
  expect(buttons).toHaveLength(1);
  expect(text(buttons[0])).toContain('No bank line, no owner ruling, no rule');
  expect(text(buttons[0])).toContain('open the deductions behind it');
  await click(buttons[0]);
  expect(onDrill).toHaveBeenCalledWith({ year: '2024', item: 'no_pay_no_ruling', label: 'No bank line, no owner ruling, no rule' });
  // nothing counted: a pass, not a door
  await render(<PaperTotals y={gateYear(2024)} sums={live} tier={{ phase: 'ready', data: tier('2024', { no_pay_no_ruling_usd: 0 }) }} onDrill={onDrill} />);
  expect(node.querySelectorAll('button.accounting-close-item__button')).toHaveLength(0);
  // no handler, no door
  await render(<PaperTotals y={gateYear(2024)} sums={live} tier={{ phase: 'ready', data: tier('2024', { no_pay_no_ruling_usd: 9000 }) }} />);
  expect(node.querySelectorAll('button.accounting-close-item__button')).toHaveLength(0);
});

it('the paper row is the office\'s one row: the same classes as a row of Finish your taxes, an action beside the amount, and the open panel below it', async () => {
  await render(<LargeSumsList y={year([row(1)])} readAt={null} onOpen={vi.fn()} onAttached={vi.fn()} />);
  const li = rowEl(1);
  expect(li.tagName).toBe('LI');
  expect(li.classList.contains('accounting-close-item')).toBe(true);
  const line = li.querySelector(':scope > .accounting-close-item__button')!;
  expect(Array.from(line.children).map(c => c.className)).toEqual(['accounting-close-item__main', 'k-measure accounting-close-item__amount', '']);
  expect(line.children[2].textContent).toBe('Add the invoice');
  await click(addButton(li)!);
  expect(li.querySelector(':scope > .accounting-paper-attach')).not.toBeNull(); // below the line, inside the row
});
