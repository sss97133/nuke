// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), askAgent: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../components/agent/askAgent', () => ({ askAgent: fixture.askAgent }));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children }: any) => <a href={to}>{children}</a> }));
import BuildLedger from './BuildLedger';
import { bookCostKind } from './hooks/useBuildLedger';

const vehicle = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222', reviewer = '33333333-3333-4333-8333-333333333333';
const audit = [
  { observation_id: 'obs-documented', observed_at: '2024-06-02T00:00:00Z', content_text: 'Rotors', structured_data: { amount_usd: 100, direction: 'out', event_type: 'parts_purchase', attribution_tier: 'certain', evidence_tier: 'bank', counterparty: 'OREILLY' } },
  { observation_id: 'obs-stated', observed_at: '2024-06-03T00:00:00Z', content_text: 'Paint', structured_data: { amount_usd: 50, direction: 'out', event_type: 'labor_payment', attribution_tier: 'stated', evidence_tier: 'testimony', counterparty: 'Painter', needs_owner_confirmation: true, confirmation_question: 'Was the paint for this truck?' } },
];
const book = [
  { use_id: 'cell-1', book_owner_id: owner, document_id: 'doc-1', ledger_id: 'L-1', record_year: '2024', record_date: '2024-06-01', description: 'AUTOZONE #5724', account: 'Apple Card', category: 'Car restoration — parts & materials', allocated_amount: 40, book_amount: 40, currency: 'USD', basis: 'Receipt names this truck', assigned_by: owner, assigned_method: 'authenticated-expense-use-review', assigned_at: '2026-10-23T00:00:00Z' },
  { use_id: 'cell-2', book_owner_id: owner, document_id: 'doc-1', ledger_id: 'L-2', record_year: '2024', record_date: '2024-06-04', description: 'CLASSIC PARTS', account: 'Apple Card', category: 'Car restoration — parts & materials', allocated_amount: null, book_amount: 120, currency: 'USD', basis: 'Packing slip names this truck; shared items still to split', assigned_by: reviewer, assigned_method: 'jenny-use-correction', assigned_at: '2026-10-23T00:00:00Z' },
];
let node: HTMLDivElement, root: Root, client: QueryClient;
const respond = (auditRows: unknown, bookRows: unknown) => fixture.rpc.mockImplementation((name: string) =>
  Promise.resolve(name === 'get_vehicle_build_ledger' ? auditRows : name === 'accounting_vehicle_costs' ? bookRows : { data: null, error: { message: 'unexpected rpc' } }));
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><BuildLedger vehicleId={vehicle} /></QueryClientProvider>));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const buttons = (text: string) => [...node.querySelectorAll('button')].filter(b => b.textContent?.trim() === text);
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); fixture.askAgent.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('shows booked costs in their own section without changing the audit totals or confirmations', async () => {
  respond({ data: audit, error: null }, { data: book, error: null });
  await render();
  expect(fixture.rpc).toHaveBeenCalledWith('accounting_vehicle_costs', { p_vehicle_id: vehicle });
  const text = node.textContent!;
  expect(text).toContain('DRAFT · 2 ENTRIES · 2 BOOKED');
  expect(text).toContain('Documented$100.00'); // audit only: the booked 40.00 is not added
  expect(text).toContain('Stated / Pending$50.00');
  expect(text).toContain('1 entry needs confirmation.');
  expect(text).toContain('In the accounts');
  expect(text).toContain('Assigned in the accounts$40.00');
  expect(text).toContain('2 entries · 1 amount not set');
  expect(text).toContain('a purchase can appear both here and above');
  expect(text).toContain('AMOUNT NOT SET');
  expect(buttons('Answer')).toHaveLength(1); // only the audit entry that needs confirmation
});

it('keeps a booked row read-only: it shows the recorded reason and links to the accounts, never the agent', async () => {
  respond({ data: audit, error: null }, { data: book, error: null });
  await render();
  const row = [...node.querySelectorAll('span')].find(s => s.textContent?.includes('AUTOZONE #5724'))!;
  await act(async () => (row.closest('div') as HTMLDivElement).click());
  expect(node.textContent).toContain('Receipt names this truck');
  expect(node.textContent).toContain('Book owner · authenticated-expense-use-review');
  expect(node.querySelector('a')!.getAttribute('href')).toBe(`/accounting?book=${owner}&year=2024`);
  const unsplit = [...node.querySelectorAll('span')].find(s => s.textContent?.includes('CLASSIC PARTS'))!;
  await act(async () => (unsplit.closest('div') as HTMLDivElement).click());
  expect(node.textContent).toContain('Book reviewer · jenny-use-correction');
  expect(node.textContent).toContain('Booked expense$120.00');
  expect(fixture.askAgent).not.toHaveBeenCalled();
});

it('renders a vehicle that has only booked costs, without the audit draft', async () => {
  respond({ data: [], error: null }, { data: [book[0]], error: null });
  await render();
  const text = node.textContent!;
  expect(text).toContain('1 BOOKED');
  expect(text).not.toContain('DRAFT');
  expect(text).not.toContain('Documented');
  expect(text).toContain('Assigned in the accounts$40.00');
  expect(text).not.toContain('a purchase can appear both here and above');
});

it('shows today\'s ledger unchanged when the book read fails', async () => {
  respond({ data: audit, error: null }, { data: null, error: { message: 'permission denied' } });
  await render();
  const text = node.textContent!;
  expect(text).toContain('DRAFT · 2 ENTRIES');
  expect(text).not.toContain('BOOKED');
  expect(text).not.toContain('In the accounts');
  expect(text).toContain('Documented$100.00');
});

it('maps a book category to parts or labor only when it names exactly one', () => {
  expect(bookCostKind('Car restoration — parts & materials')).toBe('parts_purchase');
  expect(bookCostKind('Parts & materials (COGS)')).toBe('parts_purchase');
  expect(bookCostKind('Car restoration — labor (contractors)')).toBe('labor_payment');
  expect(bookCostKind('Car restoration — machining / subcontract labor')).toBe('labor_payment');
  expect(bookCostKind('Car restoration — painting & bodywork')).toBeNull();
  expect(bookCostKind('Parts and labour')).toBeNull();
  expect(bookCostKind(null)).toBeNull();
});
