// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ readers: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import { PlanBList } from './MatchList';
import JobSuppliers from './JobSuppliers';
import type { PlanBSupplier } from './jobsReaders';

const REQ = 'aaaaaaaa-0000-4000-a000-000000000001';
const WO = 'bbbbbbbb-0000-4000-a000-000000000001';
const notOnNuke: PlanBSupplier = { organization: { organization_id: 'org-1', name: 'Champion Cooling' }, profile_public: true, times: 3, last_on: '2026-01-23',
  kinds_matched: ['cooling_parts'], on_nuke: { state: 'not_on_nuke_yet', label: 'Not on Nuke yet' }, can_receive_requests: false };
const claimed: PlanBSupplier = { organization: { organization_id: 'org-2', name: 'Summit Racing' }, profile_public: true, times: 5, last_on: '2026-02-04',
  kinds_matched: ['auto_parts'], on_nuke: { state: 'claimed', label: 'Claimed on Nuke', offer_capable: true }, can_receive_requests: true };

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.readers = {};
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve(name in fixture.readers ? { data: fixture.readers[name], error: null } : { data: { request_id: 'r1' }, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: React.ReactElement) => {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const button = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent === t) as HTMLButtonElement | undefined;

describe('backup supplier rows', () => {
  it('link the job’s customer to the invite flow for a business not on Nuke', async () => {
    await render(<PlanBList suppliers={[notOnNuke]} requirementId={REQ} inviter />);
    const invite = host.querySelector(`a[href="/org/org-1?requirement=${REQ}"]`);
    expect(invite?.textContent).toBe('Not on Nuke yet — invite them');
    expect(host.querySelector('a[href="/org/org-1"]')?.textContent).toBe('Champion Cooling');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it('tell anyone else only that the business is not on Nuke yet', async () => {
    await render(<PlanBList suppliers={[notOnNuke]} requirementId={REQ} />);
    expect(host.textContent).toContain('Not on Nuke yet');
    expect(host.querySelector('a[href*="requirement="]')).toBeNull();
  });

  it('badge a claimed business and invite it to offer through Contact via Nuke after confirm', async () => {
    await render(<PlanBList suppliers={[claimed]} requirementId={REQ} inviter />);
    expect(host.textContent).toContain('Claimed on Nuke');
    await act(async () => button('Invite to offer')!.click());
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Your contact details, or theirs');
    await act(async () => button('Send invitation')!.click());
    expect(fixture.rpc).toHaveBeenCalledWith('request_contact', { p_context_kind: 'requirement', p_context_id: REQ,
      p_message: 'Would you make an offer on this need? The details are on the job page.', p_recipient_user_id: null, p_recipient_actor_id: null, p_recipient_organization_id: 'org-2' });
  });

  it('offer no invitation to a claimed business the server says cannot receive requests, nor to a non-customer', async () => {
    await render(<PlanBList suppliers={[{ ...claimed, can_receive_requests: false }]} requirementId={REQ} inviter />);
    expect(button('Invite to offer')).toBeUndefined();
    await render(<PlanBList suppliers={[claimed]} requirementId={REQ} />);
    expect(button('Invite to offer')).toBeUndefined();
    expect(host.textContent).toContain('Claimed on Nuke');
  });
});

describe('JobSuppliers', () => {
  it('lists this job’s open requests with backup suppliers, from the open requirements reader', async () => {
    fixture.readers.open_requirements_read = { as_of: '2026-10-19T19:00:00Z', next_after: null, coverage: { returned: 2, total_open: 2 }, viewer: {},
      rows: [{ requirement_id: REQ, work_order_id: WO, requirement_kind: 'skill', description: 'Radiator recore', plan_b_suppliers: [notOnNuke] },
        { requirement_id: 'other', work_order_id: 'another-job', requirement_kind: 'tool', description: 'Not this job', plan_b_suppliers: [claimed] }] };
    await render(<JobSuppliers workOrderId={WO} />);
    expect(host.textContent).toContain('Radiator recore');
    expect(host.textContent).not.toContain('Not this job');
    expect(host.querySelector(`a[href="/org/org-1?requirement=${REQ}"]`)).not.toBeNull();
  });

  it('renders nothing when no request on this job has a backup supplier', async () => {
    fixture.readers.open_requirements_read = { as_of: '2026-10-19T19:00:00Z', next_after: null, coverage: {}, viewer: {}, rows: [] };
    await render(<JobSuppliers workOrderId={WO} />);
    expect(host.textContent).toBe('');
  });
});
