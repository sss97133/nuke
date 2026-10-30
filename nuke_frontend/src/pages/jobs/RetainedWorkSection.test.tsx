// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import { RetainedWorkSection } from './RetainedWorkSection';
import type { RetainedWorkRead } from './jobsReaders';

const row = (id: string) => ({ source_observation_id: id, source_id: 'source-1', source_pointer: '/structured_data/item',
  item: `Build item ${id}`, category: 'transmission', document_label: 'Original build log', document_row: Number(id),
  billing_column: 'Done', execution_state: 'not_established_by_billing_entry', observed_at: null, ingested_at: null });
const initial = (): RetainedWorkRead => ({ visibility: 'included', scope_entries: [row('1')], next_after_source_id: '1',
  coverage: { returned: 1, total_source_entries: 2, population: 'retained source rows' },
  responsibility_reports: [{ binding_id: 'binding-1', provider_actor_id: 'actor-1', provider_label: 'Technician', client_label: 'Client',
    source_observation_id: 'report-1', reported_at: '2026-07-15T00:00:00Z', payment_state: 'paid_in_full',
    delivery_state: 'reported_owed', assurance: 'retained_owner_report_not_sign' }] });
let host: HTMLDivElement, root: Root;
const clickMore = async () => { await act(async () => host.querySelector('button')!.click()); };
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(data = initial()) { await act(async () => root.render(<RetainedWorkSection workOrderId="job-1" initial={data} />)); }

it('shows paid plus delivery owed, original scope and its source without inventing completed work', async () => {
  await render();
  expect(host.textContent).toContain('Technician owes Client delivery');
  expect(host.textContent).toContain('payment reported settled');
  expect(host.textContent).toContain('Billing: Done');
  expect(host.textContent).toContain('Physical progress not established');
  expect(host.textContent).toContain('Original build log');
  expect(host.textContent).toContain('report-1');
  expect(host.querySelector('#retained-work')).not.toBeNull();
});

it('uses the server cursor and accesses every source row, preserving document provenance', async () => {
  fixture.rpc.mockResolvedValue({ data: { ...initial(), scope_entries: [row('2')], next_after_source_id: null }, error: null });
  await render(); await clickMore();
  expect(fixture.rpc).toHaveBeenCalledWith('work_order_retained_sources_read', { p_work_order_id: 'job-1', p_after_source_id: '1', p_limit: 25 });
  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.textContent).toContain('Build item 2'); expect(host.querySelector('button')).toBeNull();
});

it('prevents duplicate page requests and leaves a failed page retryable', async () => {
  let resolve!: (value: unknown) => void;
  fixture.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); await act(async () => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
  expect(fixture.rpc).toHaveBeenCalledOnce();
  await act(async () => resolve({ data: null, error: { message: 'Source read unavailable' } }));
  expect(host.textContent).toContain('Source read unavailable'); expect(host.querySelector('button')!.disabled).toBe(false);
  expect(host.querySelectorAll('li')).toHaveLength(1);
});

it('does not retain private data when the server withholds the next read', async () => {
  fixture.rpc.mockResolvedValue({ data: { visibility: 'withheld' }, error: null });
  await render(); await clickMore(); expect(host.textContent).toBe('');
});
