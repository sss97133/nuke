// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic-viewer' }, loading: false }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, functions: { invoke: fixture.invoke } } }));
import JobPage from './JobPage';

const WO = '00000000-0000-4000-a000-0000000000aa';
const header = { work_order_id: WO, display_title: 'Synthetic job', vehicle_id: 'v1', as_of: '2026-10-19T19:00:00Z' };
const WRITERS = ['issue_work_order_quote', 'record_work_order_payment', 'attest_work_completion', 'accept_work_completion', 'issue_change_order'];

function path(viewer: object, completion: object = {}) {
  return { ...header, viewer, stages: {
    intake: { state: 'recorded' }, terms: { state: 'partial' },
    completion: { state: 'absent', customer_acceptance: 'not_established', scope_basis: { basis: 'scope_snapshot', scope_hash: 'h'.repeat(64) }, ...completion },
    accounting: { state: 'withheld' },
  } };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.readers = {};
  fixture.rpc.mockReset();
  fixture.invoke.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve(
    WRITERS.includes(name) ? { data: { ok: true, version: 1 }, error: null }
      : name in fixture.readers ? { data: fixture.readers[name], error: null } : { data: { ...header, viewer: { context: 'visitor' } }, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/jobs/${WO}`]}><Routes><Route path="/jobs/:workOrderId" element={<JobPage />} /></Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement | undefined;
const writerCalls = () => fixture.rpc.mock.calls.filter(([n]) => WRITERS.includes(n));
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('sheets appear only when the server offers the step', () => {
  it('shows no sheet launcher to a visitor', async () => {
    fixture.readers.work_order_job_path_read = path({ context: 'visitor', slots: [], actions: [] });
    await render();
    for (const t of ['Issue a quote', 'Mark the work done', 'Record a payment', 'Pay by card']) expect(button(t)).toBeUndefined();
  });
});

describe('issue quote', () => {
  it('opens from issuer_actions and sends exactly the built args after confirm', async () => {
    const shop = { context: 'provider', slots: ['org_owner'], party: true, actions: [],
      issuer_actions: [{ action: 'issue_quote', rpc: 'issue_work_order_quote', args: { p_work_order_id: WO, p_supersedes_quote_id: null }, release_conditions_vocabulary: ['customer_completion_sign'] }] };
    fixture.readers.work_order_job_path_read = path({ context: 'provider', slots: ['org_owner'], actions: [] });
    fixture.readers.work_order_quotes_read = { ...header, viewer: shop, acceptance: { state: 'not_accepted' }, coverage: {} };
    fixture.readers.work_order_operations_read = { ...header, operations: [{ id: 'op1', description: 'Fabricate headers', quote_ref: { ref_kind: 'operation', ref_id: 'op1' } }] };
    await render();
    await act(async () => button('Issue a quote')!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Signing says');
    expect(dialog.textContent).toContain('That the work is booked');
    await act(async () => setValue(dialog.querySelector('input[aria-label="Line 1 amount"]') as HTMLInputElement, '1200'));
    expect(writerCalls()).toHaveLength(0);
    await act(async () => button('Issue quote')!.click());
    expect(writerCalls()).toEqual([['issue_work_order_quote', { p_work_order_id: WO, p_supersedes_quote_id: null, p_deposit: null, p_valid_until: null, p_release_conditions: null,
      p_lines: [{ ref_kind: 'operation', ref_id: 'op1', description: 'Fabricate headers', pricing_basis: 'flat', amount: 1200, currency: 'USD' }] }]]);
    expect(document.body.textContent).toContain('Quote issued');
  });
});

describe('completion and payment', () => {
  it('lets the job’s technician mark the work done, pinned to the scope hash', async () => {
    const tech = { context: 'provider', slots: ['performer'], party: true, actions: [{ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } }] };
    fixture.readers.work_order_job_path_read = path({ context: 'provider', slots: ['performer'], actions: [] });
    fixture.readers.work_order_invoices_read = { ...header, viewer: tech, invoices: [], payments: [] };
    await render();
    await act(async () => button('Mark the work done')!.click());
    await act(async () => button('Mark done')!.click());
    expect(writerCalls()).toEqual([['attest_work_completion', { p_work_order_id: WO, p_scope_hash: 'h'.repeat(64), p_note: null, p_evidence: null }]]);
  });

  it('records "I paid" for the customer with the money note and the invoice currency', async () => {
    const customer = { context: 'client', slots: ['customer'], party: true, money_visible: true,
      actions: [{ action: 'record_payment', rpc: 'record_work_order_payment', args: { p_invoice_id: 'inv-1' }, as: 'payer' }] };
    fixture.readers.work_order_job_path_read = path({ context: 'client', slots: ['customer'], actions: [] });
    fixture.readers.work_order_invoices_read = { ...header, viewer: customer, current_invoice_id: 'inv-1', payments: [],
      invoices: [{ invoice_id: 'inv-1', version: 1, current: true, currency: 'USD', total: 500, lines: [] }] };
    await render();
    await act(async () => button('Record a payment')!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('I paid');
    expect(dialog.textContent).toContain("Nuke records payments; it doesn't move money.");
    await act(async () => setValue(dialog.querySelector('input[aria-label="Payment amount"]') as HTMLInputElement, '500'));
    await act(async () => button('Record payment')!.click());
    const [[name, args]] = writerCalls();
    expect(name).toBe('record_work_order_payment');
    expect(args).toMatchObject({ p_invoice_id: 'inv-1', p_amount: 500, p_currency: 'USD', p_method: 'bank_transfer', p_reference: null });
  });

  it('pays by card through the checkout function and opens only a Stripe page', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    fixture.invoke.mockResolvedValue({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, error: null });
    fixture.readers.work_order_job_path_read = path({ context: 'client', slots: ['customer'],
      actions: [{ action: 'pay_invoice', kind: 'pay_invoice', function: 'create-work-order-invoice-checkout', args: { work_order_id: WO }, amount: 80.25, currency: 'USD' }] });
    await render();
    expect(host.textContent).toContain('$80.25');
    await act(async () => button('Pay by card')!.click());
    expect(fixture.invoke).toHaveBeenCalledWith('create-work-order-invoice-checkout', { body: { work_order_id: WO } });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
    assign.mockReset();
    fixture.invoke.mockResolvedValue({ data: { checkout_url: 'https://evil.test/pay' }, error: null });
    await act(async () => button('Pay by card')!.click());
    expect(assign).not.toHaveBeenCalled();
  });
});
