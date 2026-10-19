// @vitest-environment jsdom
// Plan-B suppliers on /jobs, Best matches on a job page and the inspection call-to-action, over fixtures shaped
// like the live readers (2026-10-19). Every RPC goes to a mock: nothing here reaches production.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), session: null as null | { user: { id: string } } }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: fixture.session }) }));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

import JobsBoard from './JobsBoard';
import BestMatches from './BestMatches';
import InspectionCallout from './InspectionCallout';
import { ContactSheet } from './JobSheets';
import { clearPlanCache, matchReason, theirWords } from './jobsReaders';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WO = '11111111-1111-4111-8111-111111111111';
const REQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_PUBLIC = 'oooooooo-0000-4000-8000-000000000001';
const ORG_PRIVATE = 'oooooooo-0000-4000-8000-000000000002';
const PROFILE = 'pppppppp-0000-4000-8000-000000000001';

const inputs = [
  { input: 'skill', result: 'pass', reason: 'capability welding_tig is named in the requirement' },
  { input: 'tools', result: 'fail', next: 'plan_b_supplier_needed', reason: 'no claimed tool maps to welding.tig' },
  { input: 'facility', result: 'pass', reason: 'not required for a skill requirement' },
  { input: 'area', result: 'pass', reason: 'job city is within your 25-mile service area' },
  { input: 'availability', result: 'unknown', reason: 'no standing availability is recorded yet' },
  { input: 'evidence_rung', result: 'pass', reason: 'evidenced identity bridge' },
];

let root: Root | null = null;
let container: HTMLDivElement;
async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const names = () => fixture.rpc.mock.calls.map(c => c[0]);

beforeEach(() => { fixture.rpc.mockReset(); fixture.session = null; clearPlanCache(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('match words', () => {
  it('reads the service-area and availability inputs in plain words, and in the third person for a job owner', () => {
    expect(matchReason({ input: 'area', result: 'pass', reason: 'job city is within your 25-mile service area' })).toBe('Within your 25-mile service area');
    expect(matchReason({ input: 'area', result: 'pass', reason: 'same state as your service area (distance not computed)' })).toBe('Same state as your service area (distance not worked out)');
    expect(matchReason({ input: 'area', result: 'pass', reason: 'same state and city' })).toBe('Same city');
    expect(matchReason({ input: 'availability', result: 'pass', reason: 'standing availability (self-claimed) falls inside the job window' })).toBe('Your hours fall inside the job window');
    expect(matchReason({ input: 'availability', result: 'fail', reason: 'no declared availability inside the job window' })).toBe("Your hours don't cover the job window");
    expect(matchReason({ input: 'skill', result: 'pass', reason: 'evidence-derived capability welding_tig covers this requirement' })).toBe('Your work record shows welding tig');
    expect(matchReason({ input: 'skill', result: 'unknown', reason: 'only evidence against paint_refinish for this requirement' })).toBe('Only evidence against so far (paint refinish)');
    expect(theirWords("You haven't set availability yet")).toBe("They haven't set availability yet");
    expect(theirWords('Linked by you, not yet backed by work')).toBe('Linked by them, not yet backed by work');
    expect(theirWords('No tools in your records')).toBe('No tools in their records');
  });
});

describe('JobsBoard plan-B suppliers and few-requests help', () => {
  it('lists backup suppliers with counts and links only public organizations, never amounts', async () => {
    fixture.session = { user: { id: 'viewer' } };
    fixture.rpc.mockImplementation(async (fn: string) => fn === 'open_requirements_read' ? { error: null, data: {
      viewer: { context: 'provider' }, as_of: '2026-10-19T20:00:00Z', next_after: null, contact: { available: false },
      coverage: { returned: 1, total_open: 1 },
      rows: [{ requirement_id: REQ, requirement_kind: 'skill', description: 'Paint touch-up on the door', work_order_id: WO, display_title: 'Pre-delivery',
        match: null, plan_b_suppliers: [
          { organization: { organization_id: ORG_PUBLIC, name: 'CTI Industrial Supply' }, profile_public: true, times: 3, last_on: '2024-05-12', kinds_matched: ['paint_materials'], amount: 999 },
          { organization: { organization_id: ORG_PRIVATE, name: 'AutoZone' }, profile_public: false, times: 1, last_on: '2021-11-08' },
        ] }],
    } } : { error: null, data: { viewer: { actions: [] } } });
    await render(<JobsBoard />);
    const text = container.textContent ?? '';
    expect(text).toContain('CTI Industrial Supply — Paid for this before on Nuke (3 times), last May 12, 2024');
    expect(text).toContain('AutoZone — Paid for this before on Nuke (1 time)');
    expect(container.querySelector(`a[href="/org/${ORG_PUBLIC}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/org/${ORG_PRIVATE}"]`)).toBeNull();
    expect(text).not.toContain('999');
    expect(text).not.toContain('$');
    expect(text).toContain('How jobs appear here');
    expect(container.querySelector('a[href="/vehicle/list"]')?.textContent).toBe('Post a job from one of your vehicles');
  });
});

describe('BestMatches', () => {
  const matches = {
    as_of: '2026-10-19T20:00:00Z', work_order_id: WO,
    coverage: { requirements: 1, providers_considered: 7, providers_returned: 2 },
    providers: [
      { rank: 1, provider: { kind: 'user', profile_id: PROFILE, handle: 'tigwelder' }, listed_because: ['evidenced_link'], link_state: 'evidenced',
        passed: 4, failed: 1, unknown: 1, inputs_total: 6, contact: { writer: 'request_contact', recipient_user_id: PROFILE },
        requirements: [{ requirement_id: REQ, requirement_kind: 'skill', description: 'Weld the exhaust', passed: 4, inputs }] },
      { rank: 2, provider: { kind: 'user', label: 'unnamed party' }, listed_because: ['organization_member'], link_state: 'none',
        passed: 2, failed: 2, unknown: 2, inputs_total: 6, contact: null,
        requirements: [{ requirement_id: REQ, requirement_kind: 'skill', description: 'Weld the exhaust', passed: 2, inputs }] },
    ],
  };

  it('ranks by passed checks, shows every input in plain words and invites only from the confirm button', async () => {
    fixture.rpc.mockImplementation(async (fn: string) => fn === 'work_order_provider_matches_read' ? { data: matches, error: null } : { data: { request_id: 'r1' }, error: null });
    await render(<BestMatches workOrderId={WO} />);
    const text = container.textContent ?? '';
    expect(text).toContain('2 of 7 providers considered');
    expect(text).toContain('#1');
    expect(text).toContain('4 of 6 checks pass · 1 not yet · 1 unknown · listed as technician link backed by work');
    expect(text).toContain('Skill — Their record shows welding tig');
    expect(text).toContain('Tools — No matching tool in their records · needs a backup supplier');
    expect(text).toContain('Area — Within their 25-mile service area');
    expect(text).toContain("Availability — They haven't set availability yet");
    expect(text).toContain('Technician profile — Linked and backed by their work');
    expect(text).toContain('Unnamed party');
    expect(text).not.toContain(PROFILE);
    expect(container.querySelector('a[href="/providers/tigwelder"]')).not.toBeNull();
    const invites = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Invite to offer');
    expect(invites).toHaveLength(1);
    await act(async () => { invites[0].click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('That they are assigned or booked');
    expect(names()).toEqual(['work_order_provider_matches_read']);
    const send = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Send invitation')!;
    await act(async () => { send.click(); });
    expect(fixture.rpc).toHaveBeenLastCalledWith('request_contact', {
      p_context_kind: 'requirement', p_context_id: REQ, p_message: 'Would you make an offer on this job? It needs: Weld the exhaust',
      p_recipient_user_id: PROFILE, p_recipient_actor_id: null, p_recipient_organization_id: null,
    });
    expect(document.body.textContent).toContain('Nobody was assigned');
  });

  it('renders nothing when the reader refuses the viewer', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Work order unavailable' } });
    await render(<BestMatches workOrderId={WO} />);
    expect(container.textContent).toBe('');
  });
});

describe('InspectionCallout', () => {
  const plan = (items: number) => ({ data: {
    as_of: '2026-10-19T20:00:00Z', vehicle_id: 'v1', vehicle_label: { text: '1970 Chevrolet K5 Blazer' }, listing_url: null,
    identity: { fields: {}, conflicts: [], unresolved_specificity: [] }, claims: [], candidate_operations: [], parts: [],
    ppi_checklist: Array.from({ length: items }, (_, i) => ({ item_id: `ppi:${i}`, question: `Check item ${i}` })),
    inspection_scope: { inspection_type: 'pre_purchase', ppi_checklist: [] }, operation_coverage: { eligible_claims: 0, matched_claims: 0 },
    rate: { value: { rate: 160 } },
  }, error: null });

  it('invites a visitor to get the car inspected when the plan has checklist items, with no rate', async () => {
    fixture.rpc.mockResolvedValue(plan(3));
    await render(<InspectionCallout vehicleId="v1" signedIn={false} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Get this car inspected before you buy');
    expect(text).toContain('A pre-purchase inspection answers 3 questions from this listing');
    expect(text).toContain('Sign in to order one.');
    const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'See what an inspection checks')!;
    await act(async () => { open.click(); });
    expect(container.textContent).toContain('Check item 2');
    expect(container.textContent).toContain('Sign in to order an inspection');
    expect(container.textContent).not.toContain('160');
    expect(names()).toEqual(['listing_work_plan_read']);
  });

  it('stays empty when the plan has no checklist items or is refused', async () => {
    fixture.rpc.mockResolvedValue(plan(0));
    await render(<InspectionCallout vehicleId="v2" signedIn />);
    expect(container.textContent).toBe('');
    act(() => root?.unmount()); root = null;
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'Vehicle unavailable' } });
    await render(<InspectionCallout vehicleId="v3" signedIn />);
    expect(container.textContent).toBe('');
  });
});

describe('ContactSheet', () => {
  it('shows its confirm step before anything is sent (regression: a false done value hid it)', async () => {
    fixture.rpc.mockResolvedValue({ data: { request_id: 'r1' }, error: null });
    await render(<ContactSheet requirementId={REQ} contextLabel="Skill on Pre-delivery" onClose={() => {}} />);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Signing says');
    expect(Array.from(dialog.querySelectorAll('button')).some(b => b.textContent === 'Send request')).toBe(true);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
