// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ read: null as unknown, rpc: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import OrganizationOnNuke from './OrganizationOnNuke';
import { ownerState } from './ownerState';

const ORG = 'd1559a33-0000-4000-a000-000000000001';
const read = {
  organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, as_of: '2026-10-19T19:00:00Z',
  viewer: { role: null, party: false, actions: [] },
  members: [{ kind: 'user', handle: 'shopowner2', relation: 'owner', weight: 2, name: 'Private Person', email: 'private@example.test' },
    { kind: 'user', handle: 'tech3', relation: 'member', weight: 1 }],
  members_unnamed: 2,
  on_nuke: { state: 'claimed', label: 'On Nuke', owners_active: 1, members_active: 2, claimed_via: ['domain_email'] },
  assets_by_kind: [{ kind: 'lift', capacity_total: 2, assets: [{ asset_id: 'a1', label: 'Lift A', capacity: 2, busy: [{ from: '2026-10-20T08:00:00Z', until: '2026-10-20T10:00:00Z' }] }] }],
  licenses: [{ license_type: 'automotive_repair', issuing_authority: 'NV DMV', expiration_date: '2027-06-30', is_active: true, verified: false, state: 'active' }],
  coverage: { declared_assets: 1, licenses: 1 },
  work_recorded_on_nuke: { records: 122, first_on: '2019-08-31', last_on: '2026-04-27', by_source: { receipts: 115, work_order_parts: 7 },
    kinds: [{ supply_kind: 'auto_parts', times: 122, first_on: '2019-08-31', last_on: '2026-04-27' }, { supply_kind: 'tools', times: 1, first_on: '2026-02-04', last_on: '2026-02-04' }] },
};

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.read = read;
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve(fixture.read ? { data: fixture.read, error: null } : { data: null, error: { message: 'Organization unavailable', code: '42501' } }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => {
  await act(async () => root.render(<MemoryRouter><OrganizationOnNuke organizationId={ORG} /></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

describe('OrganizationOnNuke', () => {
  it('shows supply kinds with times and dates, spaces, licences and who runs it, never amounts or private fields', async () => {
    await render();
    const text = host.textContent ?? '';
    expect(fixture.rpc).toHaveBeenCalledWith('facility_read', { p_organization_id: ORG });
    expect(text).toContain('Run on Nuke by @shopowner2');
    expect(text).toContain('@tech3');
    expect(text).toContain('Auto parts');
    expect(text).toContain('122 times · Aug 31, 2019 – Apr 27, 2026');
    expect(text).toContain('1 time · Feb 4, 2026');
    expect(text).toContain('receipts 115 · work order parts 7');
    expect(text).toContain('Lift A');
    expect(text).toContain('holds 2 · 1 booked window');
    expect(text).toContain('NV DMV');
    expect(text).toContain('Amounts and who paid are not shown.');
    for (const leak of ['$', 'Private Person', 'private@example.test']) expect(host.innerHTML).not.toContain(leak);
    expect(host.querySelector('a[href="/providers/tech3"]')).not.toBeNull();
  });

  it('renders nothing for an organization that is not public', async () => {
    fixture.read = null;
    await render();
    expect(host.textContent).toBe('');
  });

  it('states who runs it without inventing a claim', () => {
    expect(ownerState({ members: [], members_unnamed: 0 }).text).toBe('No one runs this business on Nuke yet');
    expect(ownerState({ members: [{ handle: 'm1', relation: 'member' }], members_unnamed: 1 }).text).toBe('No public owner on Nuke; 2 members');
    expect(ownerState({ members: [], members_unnamed: 0, on_nuke: { state: 'not_on_nuke_yet', label: 'Not on Nuke yet' } }).text).toBe('Not on Nuke yet: no one runs this business on Nuke');
  });
});
