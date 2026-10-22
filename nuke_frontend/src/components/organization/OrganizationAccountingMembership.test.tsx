// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: { id: 'fixture-user' } as { id: string } | null,
  context: { can_review: false, membership_id: null, status: null, role: null } as Record<string, unknown>,
  calls: [] as Array<{ name: string; args: unknown }>,
  reads: 0,
  navigate: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: false }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: async (name: string, args: unknown) => {
    fixture.calls.push({ name, args });
    return { data: name === 'accounting_membership_context' ? fixture.context : {}, error: null };
  },
  from: () => {
    fixture.reads++;
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'order']) q[name] = () => q;
    q.limit = async () => ({ data: [{ id: 'fixture-membership', user_id: 'fixture-applicant', status: 'pending', end_date: null }], error: null });
    return q;
  },
} }));
import OrganizationAccountingMembership from './OrganizationAccountingMembership';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = { id: 'fixture-user' };
  fixture.context = { can_review: false, membership_id: null, status: null, role: null };
  fixture.calls = [];
  fixture.reads = 0;
  fixture.navigate.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<OrganizationAccountingMembership organizationId="fixture-org" />));
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it('requires explicit request and never reads other members for an applicant', async () => {
  await render();
  expect(fixture.calls.map(c => c.name)).toEqual(['accounting_membership_context']);
  expect(fixture.reads).toBe(0);
  await click('Request Accounting membership');
  expect(fixture.calls).toContainEqual({ name: 'request_accounting_membership', args: { p_organization_id: 'fixture-org' } });
});
it('uses server authority for owner review and never gives a manager approval controls', async () => {
  fixture.context = { can_review: false, membership_id: 'fixture-manager', role: 'manager', status: 'active' };
  await render();
  expect(host.textContent).not.toContain('Approve Accounting role');
  expect(fixture.reads).toBe(0);
  fixture.context = { ...fixture.context, can_review: true };
  await click('Refresh membership');
  await click('Approve Accounting role');
  expect(fixture.calls).toContainEqual({ name: 'review_accounting_membership', args: { p_membership_id: 'fixture-membership', p_action: 'approve' } });
});
it('preserves organization context through login without a write', async () => {
  fixture.user = null;
  await render();
  await click('Sign in to request membership');
  expect(fixture.calls).toEqual([]);
  expect(fixture.navigate).toHaveBeenCalledWith('/login?returnUrl=%2Forg%2Ffixture-org%3Ftab%3Dcontributors');
});
it('removes account membership information on logout', async () => {
  fixture.context = { can_review: true, membership_id: 'fixture-owner', role: 'owner', status: 'active' };
  await render();
  expect(host.textContent).toContain('fixture-applicant');
  fixture.user = null;
  await render();
  expect(host.textContent).not.toContain('fixture-applicant');
});
