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
it.each(['private-error', 'wrong-org', 'unsafe-url', 'bad-count'])('keeps %s from turning into public testimony', async kind => {
  if (kind === 'private-error') fixture.response = { error: { message: 'PRIVATE_DETAIL' } };
  if (kind === 'wrong-org') fixture.response.data.organization_id = 'other-org';
  if (kind === 'unsafe-url') fixture.response.data.rows[0].targets[0].listing_url = 'javascript:alert(1)';
  if (kind === 'bad-count') fixture.response.data.rows[0].total_targets = -1;
  await render(); expect(container.textContent).toBe('Source target inventory unavailable.');
  expect(container.querySelector('a')).toBeNull();
});
