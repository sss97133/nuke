// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ response: {} as any, invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: fixture.invoke } } }));
import OrganizationSourceTargets from './OrganizationSourceTargets';
let root: Root, container: HTMLDivElement;
const id = '11111111-1111-1111-1111-111111111111';
const clock = '2026-02-11T14:11:13Z';
async function render() { await act(async () => root.render(<OrganizationSourceTargets organizationId={id} />)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.response = { data: { contract: 'organization_targets_v1', organization_id: id, status: 'measured',
    measured_at: '2026-10-10T17:00:00Z', complete: true, rows: [{ source_slug: 'synthetic', display_name: 'Synthetic Source',
      total_targets: 100, targets: [{ listing_url: 'https://source.example/lot/1', first_discovered_at: clock, last_seen_at: clock }] }] } };
  fixture.invoke.mockReset(); fixture.invoke.mockImplementation(() => Promise.resolve(fixture.response));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('shows public targets with their discovery clocks and no verification claim', async () => {
  await render();
  expect(fixture.invoke.mock.calls[0][0]).toBe(`db-stats?organization_targets=${id}`);
  expect(fixture.invoke.mock.calls[0][1].method).toBe('GET');
  expect(container.textContent).toContain('100 known target URLs');
  expect(container.textContent).toContain('does not prove extraction, a verified vehicle or a sale');
  expect(container.textContent).toContain(new Date(clock).toLocaleString());
  expect(container.querySelector('a')?.href).toBe('https://source.example/lot/1');
  expect(container.textContent).toContain('bounded sample, unranked');
});
it('hides the inventory shell for private, missing or unrelated organization sources', async () => {
  fixture.response.data.rows = []; await render(); expect(container.textContent).toBe('');
});
it('shows qualified listing activity even without sitemap targets, preserving unknowns and separate currencies', async () => {
  fixture.response.data.rows = [];
  fixture.response.data.listing_activity = { status: 'measured', rows: [{
    contract: 'listing_activity_v1', calculated_at: clock, total_listings: 11, input_rows: 17,
    total_sold: 5, total_unsold: 1, active_listings: 1, unknown_outcomes: 4,
    unresolved_identity_rows: 1, unpriced_sold: 3, unknown_currency_sold: 1,
    identity_conflicts: 1, outcome_conflicts: 1, amount_conflicts: 2, sell_through_rate: null,
    latest_input_created_at: clock, latest_input_extracted_at: clock, currencies_complete: true,
    currencies: [{ currency: 'USD', total: 10, listings: 1 }, { currency: 'GBP', total: 20, listings: 1 }],
  }] };
  await render();
  expect(container.textContent).toContain('11 attributed listing episodes');
  expect(container.textContent).toContain('4 unresolved outcomes');
  expect(container.textContent).toContain('Sell-through unmeasured');
  expect(container.textContent).toContain('USD 10'); expect(container.textContent).toContain('GBP 20');
  expect(container.textContent).toContain('1 records lack listing identity');
  expect(container.textContent).toContain('Sale amounts do not establish company revenue');
  expect(container.textContent).not.toContain('known target URLs');
});
it.each([{}, { status: 'measured' }, { status: 'measured', rows: [{ contract: 'legacy' }] }])(
  'keeps unavailable or unqualified activity from becoming testimony', async activity => {
    fixture.response.data.listing_activity = activity;
    await render();
    expect(container.textContent).not.toContain('attributed listing episodes');
    expect(container.textContent).toContain('100 known target URLs');
  });
it.each(['private-error', 'wrong-org', 'unsafe-url', 'bad-count'])('keeps %s from turning into public testimony', async kind => {
  if (kind === 'private-error') fixture.response = { error: { message: 'PRIVATE_DETAIL' } };
  if (kind === 'wrong-org') fixture.response.data.organization_id = 'other-org';
  if (kind === 'unsafe-url') fixture.response.data.rows[0].targets[0].listing_url = 'javascript:alert(1)';
  if (kind === 'bad-count') fixture.response.data.rows[0].total_targets = -1;
  await render(); expect(container.textContent).toBe('Source target inventory unavailable.');
  expect(container.querySelector('a')).toBeNull();
});
