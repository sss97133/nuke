// @vitest-environment jsdom
// Every writer here is a mock: no test calls a production writer.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ data: {} as Record<string, unknown>, errors: {} as Record<string, unknown>, rpc: vi.fn(), user: null as null | { id: string } }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: null, loading: false }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import OrganizationOnNuke from './OrganizationOnNuke';
import SupplierInvitePage from './SupplierInvitePage';
import { claimArgs } from './claimDrafts';

const ORG = 'd1559a33-0000-4000-a000-000000000001';
const REQ = 'aaaaaaaa-0000-4000-a000-000000000002';
const TOKEN = 'f'.repeat(64);
const onNuke = { state: 'not_on_nuke_yet', label: 'Not on Nuke yet', owners_active: 0, members_active: 0, claimed_via: [],
  claim: { writer: 'claim_organization', methods: ['domain_email', 'document'], domain: 'e2eparts.example', domain_email_rule: "your confirmed sign-in e-mail is at this website's domain" } };
const facility = { organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, as_of: '2026-10-19T19:00:00Z', members: [], members_unnamed: 0,
  assets_by_kind: [], licenses: [], coverage: { declared_assets: 0 }, on_nuke: onNuke,
  work_recorded_on_nuke: { records: 3, first_on: '2024-05-12', last_on: '2026-02-04', kinds: [{ supply_kind: 'auto_parts', times: 3, first_on: '2024-05-12', last_on: '2026-02-04' }] } };

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.user = { id: 'u-1' };
  fixture.errors = {};
  fixture.data = { facility_read: facility,
    claim_organization: { organization_id: ORG, state: 'claimed', method: 'domain_email', role: 'owner', domain: 'e2eparts.example', email_returned: false },
    create_supplier_invite: { available: true, token: TOKEN, share_path: `/supplier-invite/${TOKEN}`, expires_at: '2026-11-02T19:00:00Z', single_use: true, sent_by_nuke: false },
    redeem_supplier_invite: { invite_id: 'i1', organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, on_nuke: onNuke,
      claim: { writer: 'claim_organization', args: { p_organization_id: ORG }, domain_email_qualifies: true, methods: ['domain_email', 'document'] },
      requirement: { requirement_id: REQ, work_order_id: 'wo-1', kind: 'skill', description: 'Exhaust repair and fabrication', still_open: true }, membership_changed: false, email_returned: false } };
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation((name: string) => Promise.resolve(name in fixture.errors ? { data: null, error: fixture.errors[name] } : { data: fixture.data[name] ?? null, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (path: string) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/org/:orgId" element={<OrganizationOnNuke organizationId={ORG} />} />
    <Route path="/supplier-invite/:token" element={<SupplierInvitePage />} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const button = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent === t) as HTMLButtonElement | undefined;
const writes = () => fixture.rpc.mock.calls.filter(([n]) => ['claim_organization', 'create_supplier_invite', 'redeem_supplier_invite'].includes(n));

describe('claimArgs', () => {
  it('sends no evidence for a domain claim and an https document for a document claim', () => {
    expect(claimArgs(ORG, 'domain_email', '', '')).toEqual({ ok: true, args: { p_organization_id: ORG, p_method: 'domain_email', p_evidence: null } });
    expect(claimArgs(ORG, 'document', 'tax_id', 'https://files.example/doc.pdf')).toEqual({ ok: true,
      args: { p_organization_id: ORG, p_method: 'document', p_evidence: { verification_type: 'tax_id', document_url: 'https://files.example/doc.pdf' } } });
    expect(claimArgs(ORG, 'document', 'tax_id', 'http://files.example/doc.pdf').ok).toBe(false);
    expect(claimArgs(ORG, 'document', 'selfie', 'https://x.example').ok).toBe(false);
  });
});

describe('claiming a business from its page', () => {
  it('offers the claim to a signed-in visitor of an unclaimed business and claims by domain after confirm', async () => {
    await render(`/org/${ORG}`);
    expect(host.textContent).toContain('Is this your business? Claim it');
    expect(host.textContent).toContain('Not on Nuke yet');
    await act(async () => button('Claim this business')!.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('e2eparts.example');
    expect(dialog.textContent).toContain('never shows or stores it');
    expect(writes()).toHaveLength(0);
    await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Claim this business')!.click());
    expect(writes()).toEqual([['claim_organization', { p_organization_id: ORG, p_method: 'domain_email', p_evidence: null }]]);
    expect(document.body.textContent).toContain('Claimed. You run E2E Parts on Nuke');
  });

  it('asks a signed-out visitor to sign in, and shows no claim on a claimed business', async () => {
    fixture.user = null;
    await render(`/org/${ORG}`);
    expect(host.textContent).toContain('Sign in to claim it.');
    expect(button('Claim this business')).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(host);
    fixture.user = { id: 'u-1' };
    fixture.data.facility_read = { ...facility, on_nuke: { state: 'claimed', label: 'Claimed on Nuke', owners_active: 1, members_active: 1 } };
    await render(`/org/${ORG}`);
    expect(host.textContent).toContain('Claimed on Nuke');
    expect(host.textContent).not.toContain('Is this your business?');
  });
});

describe('inviting a business that is not on Nuke', () => {
  it('creates a link for the customer to share, from a page opened for one need', async () => {
    await render(`/org/${ORG}?requirement=${REQ}`);
    expect(host.textContent).toContain('Not on Nuke yet — invite them');
    await act(async () => button('Invite them')!.click());
    expect(document.body.textContent).toContain('That Nuke contacts them: Nuke sends nothing');
    await act(async () => button('Create invite link')!.click());
    expect(writes()).toEqual([['create_supplier_invite', { p_organization_id: ORG, p_requirement_id: REQ }]]);
    const link = document.querySelector('input[aria-label="Invite link"]') as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/supplier-invite/${TOKEN}`);
    expect(document.body.textContent).toContain('Share this link with E2E Parts yourself');
  });
});

describe('SupplierInvitePage', () => {
  it('asks for sign-in and redeems nothing while signed out', async () => {
    fixture.user = null;
    await render(`/supplier-invite/${TOKEN}`);
    expect(host.textContent).toContain('Sign up or sign in');
    expect(writes()).toHaveLength(0);
  });

  it('redeems only on Open, then shows the need and claims in one step when the domain qualifies', async () => {
    await render(`/supplier-invite/${TOKEN}`);
    expect(writes()).toHaveLength(0);
    await act(async () => button('Open the invite')!.click());
    expect(writes()).toEqual([['redeem_supplier_invite', { p_token: TOKEN }]]);
    expect(host.textContent).toContain('Exhaust repair and fabrication');
    expect(host.textContent).toContain('you can claim it in one step');
    await act(async () => button('Claim E2E Parts')!.click());
    await act(async () => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Claim this business')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(writes()[1]).toEqual(['claim_organization', { p_organization_id: ORG, p_method: 'domain_email', p_evidence: null }]);
  });

  it('explains a used or expired invite in plain words', async () => {
    fixture.errors.redeem_supplier_invite = { message: 'This invite was already used' };
    await render(`/supplier-invite/${TOKEN}`);
    await act(async () => button('Open the invite')!.click());
    expect(host.textContent).toContain('This invite was already used');
  });
});
