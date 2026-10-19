// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import JobPage from './JobPage';

const WO = '00000000-0000-4000-a000-0000000000aa';
const visitor = { context: 'visitor', slots: [], actions: [], money_visible: false, party: false };
const header = { work_order_id: WO, display_title: 'Synthetic exhaust job', vehicle_id: '00000000-0000-4000-a000-0000000000bb',
  vehicle_label: { year: 1983, make: 'GMC', model: 'K2500', text: '1983 GMC K2500' }, request_source_label: 'Requested on the web', as_of: '2026-10-19T19:00:00Z' };

function path(viewer: object) {
  return { ...header, viewer, stages: {
    intake: { state: 'recorded', gaps: [], inconsistencies: [], created_at: '2026-03-19T15:31:54Z', scope_stated: true,
      customer_email: 'private@example.test', customer_phone: '555-0100' },
    inspection: { state: 'absent', gaps: ['no_inspection_requirement'], inconsistencies: [] },
    plan: { state: 'partial', gaps: ['operations_without_requirements'], inconsistencies: [], operations: 3 },
    terms: { state: 'partial', gaps: ['no_approval_clock'], inconsistencies: [] },
    execution: { state: 'recorded', gaps: [], inconsistencies: [] },
    completion: { state: 'status_only', gaps: [], inconsistencies: ['done_status_without_completion_clock'] },
    accounting: { state: 'withheld', gaps: [], inconsistencies: [], visibility: 'parties_only' },
  } };
}

function invoices(viewer: object, payments: unknown) {
  return { ...header, viewer, current_invoice_id: 'inv-1', payments, reconciliation: { state: 'open', balance_due: 777.77, currency: 'USD' },
    invoices: [{ invoice_id: 'inv-1', version: 1, current: true, currency: 'USD', total: 1590, issued_at: '2026-04-01T00:00:00Z',
      issuer: { kind: 'user', handle: 'mechanic1', name: 'Private Person' }, lines: [{ line: 1, description: 'Header fabrication', line_total: 1590 }] }] };
}

function quotes(viewer: object) {
  return { ...header, viewer, coverage: { quote_versions: 1, versions_with_current_source: 1 },
    acceptance: { state: 'not_accepted' }, release_conditions: { declared_by: 'platform_standard' },
    current_quote: { quote_id: 'q-1', version: 1, quote_hash: 'h'.repeat(64), quoting_party: { kind: 'organization', name: 'Example Shop' },
      lines: [{ ref_kind: 'labor', description: 'Fabricate headers', pricing_basis: 'hourly', amount: 150, currency: 'USD', quantity: 8 }],
      totals_by_currency: [{ currency: 'USD', total: 1200, complete: true }], release_conditions: [{ kind: 'customer_completion_sign' }] } };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.readers = {};
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve(
    name in fixture.readers ? { data: fixture.readers[name], error: null } : { data: { ...header, viewer: visitor }, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/jobs/${WO}`]}><Routes><Route path="/jobs/:workOrderId" element={<JobPage />} /></Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe('JobPage for a visitor', () => {
  it('renders the header, the seven-stage rail, gaps and conflicts in trade language', async () => {
    fixture.readers.work_order_job_path_read = path(visitor);
    await render();
    const text = host.textContent ?? '';
    expect(host.querySelector('h1')?.textContent).toBe('Synthetic exhaust job');
    expect(text).toContain('1983 GMC K2500');
    expect(host.querySelectorAll('.job-rail__cell')).toHaveLength(7);
    for (const title of ['Request', 'Inspection', 'Plan & estimate', 'Quote & terms', 'Work', 'Completion', 'Invoice & payment']) expect(text).toContain(title);
    expect(text).toContain("What's missing");
    expect(text).toContain('No inspection requested');
    expect(text).toContain('Quote not accepted yet');
    expect(text).toContain('Marked done, but no completion date');
    expect(host.querySelector('.job-rail__cell--conflicting')).not.toBeNull();
    expect(text).toContain('Payments are shown to the people on this job');
    expect(text).toContain('2 of 7 stages recorded');
  });

  it('renders no personal contact field or private name, even when a reader sends one', async () => {
    fixture.readers.work_order_job_path_read = path(visitor);
    fixture.readers.work_order_invoices_read = invoices(visitor, null);
    await render();
    const html = host.innerHTML;
    for (const leak of ['private@example.test', '555-0100', 'Private Person']) expect(html).not.toContain(leak);
    expect(host.textContent).toContain('@mechanic1');
  });

  it('hides payments and balances from a non-party even when the reader sent them', async () => {
    fixture.readers.work_order_job_path_read = path(visitor);
    fixture.readers.work_order_invoices_read = invoices(visitor, [{ witness_side: 'payee', amount: 812.34, currency: 'USD', paid_at: '2026-04-02T00:00:00Z' }]);
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('$1,590.00');
    expect(text).not.toContain('812.34');
    expect(text).not.toContain('777.77');
    expect(text).toContain('Payments and balances are shown to the people on this job.');
  });

  it('shows payments to a party the server opened money for', async () => {
    const party = { ...visitor, context: 'client', slots: ['customer'], money_visible: true, party: true };
    fixture.readers.work_order_job_path_read = path(party);
    fixture.readers.work_order_invoices_read = invoices(party, [{ witness_side: 'payee', amount: 812.34, currency: 'USD', paid_at: '2026-04-02T00:00:00Z' }]);
    await render();
    expect(host.textContent).toContain('$812.34');
    expect(host.textContent).toContain('$777.77');
  });

  it('explains an unavailable job instead of rendering an empty page', async () => {
    fixture.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'Work order unavailable', code: 'P0001' } }));
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Job unavailable');
    expect(host.textContent).toContain("This isn't public, or it doesn't exist.");
  });
});

describe('Sign actions', () => {
  it('offers no action to a visitor', async () => {
    fixture.readers.work_order_job_path_read = path(visitor);
    fixture.readers.work_order_quotes_read = quotes(visitor);
    await render();
    expect(host.querySelector('.job-sign')).toBeNull();
    expect(host.textContent).toContain('Fabricate headers');
    expect(host.textContent).toContain('$150.00 / hour × 8');
  });

  it('accepts a quote only after review and confirm, passing back exactly the server arguments', async () => {
    const customer = { ...visitor, context: 'client', slots: ['customer'], party: true,
      actions: [{ action: 'accept_quote', rpc: 'accept_work_order_quote', args: { p_quote_id: 'q-1', p_quote_hash: 'h'.repeat(64) } }] };
    fixture.readers.work_order_job_path_read = path({ ...visitor, context: 'client', slots: ['customer'], party: true });
    fixture.readers.work_order_quotes_read = quotes(customer);
    fixture.readers.accept_work_order_quote = { quote_version: 1 };
    await render();
    const sign = host.querySelector('.job-sign') as HTMLElement;
    expect(sign.textContent).toContain('Accept quote');
    expect(fixture.rpc).not.toHaveBeenCalledWith('accept_work_order_quote', expect.anything());
    await act(async () => (sign.querySelector('button') as HTMLButtonElement).click());
    expect(sign.textContent).toContain('Signing says');
    expect(sign.textContent).toContain('It does not say');
    expect(sign.textContent).toContain('No money moves');
    const confirm = [...sign.querySelectorAll('button')].find(b => b.textContent?.startsWith('Sign:')) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(fixture.rpc).toHaveBeenCalledWith('accept_work_order_quote', { p_quote_id: 'q-1', p_quote_hash: 'h'.repeat(64) });
  });

  it('sends steps that need the signer’s own input to the app', async () => {
    const provider = { ...visitor, context: 'provider', slots: ['performer'], party: true,
      actions: [{ action: 'record_payment', rpc: 'record_work_order_payment', args: { p_invoice_id: 'inv-1' } }] };
    fixture.readers.work_order_job_path_read = path(provider);
    fixture.readers.work_order_invoices_read = invoices(provider, []);
    await render();
    expect(host.textContent).toContain('Open the Nuke app to do this');
    expect([...host.querySelectorAll('.job-sign button')]).toHaveLength(0);
  });
});
