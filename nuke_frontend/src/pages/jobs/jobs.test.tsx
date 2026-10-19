// @vitest-environment jsdom
// The job loop pages over fixtures shaped like the live readers (2026-10-19). Every RPC goes to a mock:
// no reader or writer reaches production from this file.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: null as null | { user: { id: string } },
}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ session: fixture.session }) }));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

import JobsBoard from './JobsBoard';
import WorkPage from './WorkPage';
import VehicleWorkCard from './VehicleWorkCard';
import { WorkPlanView } from './WorkPlanPanel';
import { PostedJobView } from './PostJobSheet';
import {
  NO_SHOP_RATE, hasContactDetails, matchReason, matchNext, offerArgs, openRequestsSentence, paymentLine, postArgs, targetHours,
  type OpenRequirementsRead, type PostedJob, type WorkPlan,
} from './jobsReaders';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WO = '11111111-1111-4111-8111-111111111111';
const REQ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_UID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROVIDER_UID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EMAIL = 'someone@example.com';

function board(signedIn: boolean): OpenRequirementsRead {
  const match = signedIn ? [
    { input: 'skill', result: 'unknown', reason: 'no evidenced identity bridge; capability records belong to work actors' },
    { input: 'tools', result: 'fail', next: 'plan_b_supplier_needed', reason: 'no claimed tool records' },
    { input: 'facility', result: 'pass', reason: 'not required for a skill requirement' },
    { input: 'area', result: 'pass', reason: 'same state and city' },
    { input: 'availability', result: 'unknown', reason: 'no standing availability is recorded yet' },
    { input: 'evidence_rung', result: 'fail', next: 'claim_provider_link', reason: 'no provider link claim' },
  ] : null;
  return {
    viewer: { context: signedIn ? 'provider' : 'visitor', slots: [], money_visible: false, contact_visible: false },
    as_of: '2026-10-19T19:00:00Z',
    rows: [
      { requirement_id: REQ_A, requirement_kind: 'skill', description: 'Rebuild the front brake calipers', work_order_id: WO,
        display_title: 'Front brakes', vehicle_label: { year: 1983, make: 'GMC', model: 'K2500', text: '1983 GMC K2500' },
        request_source_label: 'Requested on the web', area_band: { city: 'Boulder City', state: 'NV', basis: 'public vehicle city/state' },
        window: null, candidates_listed: 0, quote_state: { has_current_quote: false, quote_versions: 0, acceptance: null }, match },
      { requirement_id: REQ_B, requirement_kind: 'inspection', description: 'Inspect the vehicle against the checklist', work_order_id: WO,
        display_title: 'Front brakes', vehicle_label: { text: '1983 GMC K2500' }, area_band: null, window: null, candidates_listed: 1,
        quote_state: { has_current_quote: true, acceptance: 'accepted' }, match },
    ],
    next_after: null,
    coverage: { returned: 2, total_open: 2, not_assessed: ['candidate acceptance', 'distance', 'standing availability', 'price'] },
    contact: { action: 'contact_via_nuke', available: signedIn },
  };
}

function offersRead() {
  return {
    work_order_id: WO,
    requirements: [{ requirement_id: REQ_A, offers: [{ offer_id: 'o1', provider: { label: 'unnamed party', user_id: PROVIDER_UID }, note: `reach me at ${EMAIL}` }] }],
    viewer: { context: 'provider', party: false, actions: [
      { action: 'offer', rpc: 'offer_on_requirement', args: { p_requirement_id: REQ_A }, as: { offer_kind: 'individual', offer_rung: 'self_claim' } },
    ] },
  };
}

function plan(): WorkPlan & Record<string, unknown> {
  return {
    as_of: '2026-10-19T19:00:00Z', vehicle_id: 'v1', record_label: '1970 Chevrolet K5 Blazer', listing_url: 'https://bringatrailer.com/listing/x',
    vehicle_label: { text: '1970 Chevrolet K5 Blazer' },
    identity: {
      fields: {
        year: { status: 'agree', values: [{ source: 'record', raw: '1970' }, { source: 'listing_text', raw: '1970' }] },
        model: { status: 'conflict', values: [{ source: 'record', raw: 'LX450' }, { source: 'vin_decode', raw: 'LX' }] },
      },
      conflicts: ['model'], unresolved_specificity: [], vin_decode: { state: 'not_applicable_vin_absent_or_not_17' },
    },
    claims: [{ claim_id: 'c1', kind: 'defect_or_condition', text: 'The gauges are inoperative.', excerpt_status: 'exact_excerpt_in_listing_text',
      verbatim_excerpt: { quote: ' The gauges are inoperative.' }, source: { source_url: 'https://www.bringatrailer.com/listing/x' },
      clocks: { event_at: null, recorded_at: null }, confidence: { value: null, basis: 'lexical_candidate_unscored' } }],
    candidate_operations: [{ operation_id: 'op:gauges', keyword_entry_id: 'gauges', system: 'electrical',
      targets: [{ code: 'ELEC-GAUGES', name: 'Gauge cluster R&R', state: 'resolved', hours: { min: null, typical: 2, max: null }, label: 'seed_uncalibrated' }] }],
    parts: [{ term: 'gauge', fitment: 'text_match_unverified', rows: [{ catalog_part_id: 'p1', part_number: 'GA-1', name: 'Gauge cluster', price_current: 189, currency: 'USD' }] }],
    ppi_checklist: [{ item_id: 'ppi:c1', question: 'Check the gauges.' }],
    inspection_scope: { inspection_type: 'pre_purchase', listing_url: 'https://bringatrailer.com/listing/x', ppi_checklist: [{ item_id: 'ppi:c1', question: 'Check the gauges.' }] },
    operation_coverage: { eligible_claims: 1, matched_claims: 1 },
    model_calls: 0, database_writes: 0,
    // The reader returns resolve_labor_rate() as-is; the page must never show it.
    rate: { state: 'as_returned', value: { rate: 160, source: 'spitball', sample_median: 155 } },
  };
}

let root: Root | null = null;
let container: HTMLDivElement;

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

function rpcNames(): string[] { return fixture.rpc.mock.calls.map(c => c[0]); }

beforeEach(() => {
  fixture.rpc.mockReset();
  fixture.session = null;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('plain words', () => {
  it('says a missing tool needs a backup supplier, never a rejection', () => {
    expect(matchNext('plan_b_supplier_needed')).toBe('needs a backup supplier');
    expect(matchReason({ input: 'tools', result: 'fail', reason: 'no claimed tool records' })).toBe('No tools in your records');
    expect(matchReason({ input: 'skill', result: 'pass', reason: 'capability welding_tig is named in the requirement' })).toBe('Your record shows welding tig');
    expect(matchReason({ input: 'facility', result: 'pass', reason: 'not required for a skill requirement' })).toBe('Not needed for this');
    // open_requirement_tools_input (reviewed tool key map, 2026-10-19)
    expect(matchReason({ input: 'tools', result: 'pass', reason: 'claimed tool maps to lift_two_post, welder_tig (claimed ownership, not physical verification)' }))
      .toBe('You said you own a tool for: lift two post, welder tig');
    expect(matchReason({ input: 'tools', result: 'pass', reason: 'claimed tool record named in the requirement: torch (claimed ownership, not physical verification)' }))
      .toBe('You said you own: torch');
    expect(matchReason({ input: 'tools', result: 'unknown', next: 'claim_tool_record', reason: 'seen in photos at your shop; not claimed as your tool' }))
      .toBe('Seen in photos at your shop, not claimed as your tool');
    expect(matchNext('claim_tool_record')).toBe('add it to your tools');
    expect(matchReason({ input: 'tools', result: 'fail', next: 'plan_b_supplier_needed', reason: 'no claimed tool maps to lift_two_post' })).toBe('No matching tool in your records');
  });

  it('states the reader total as an honest coverage line', () => {
    expect(openRequestsSentence(2)).toBe('2 open requests on Nuke right now');
    expect(openRequestsSentence(1)).toBe('1 open request on Nuke right now');
    expect(openRequestsSentence(0)).toBe('No open requests on Nuke right now');
  });

  it('gives hours as hours and never a price', () => {
    expect(targetHours({ hours: { min: 2, typical: 3, max: 6 } })).toBe('2–6 h');
    expect(targetHours({ hours: { min: null, typical: 2, max: null } })).toBe('about 2 h');
    expect(targetHours({ hours: null })).toBe('hours not stated');
  });

  it('builds the offer body only from the server action and validates each line', () => {
    const action = { action: 'offer', rpc: 'offer_on_requirement', args: { p_requirement_id: REQ_A } };
    const line = { description: 'Rebuild calipers', pricing_basis: 'hourly', amount: '95', currency: 'usd', quantity: '3' };
    expect(offerArgs({ action: 'withdraw_offer', args: {} }, [line], null, '')).toEqual({ error: "This job isn't taking offers from your account." });
    expect(offerArgs(action, [{ ...line, amount: '' }], null, '')).toEqual({ error: 'Each line needs an amount.' });
    expect(offerArgs(action, [line], null, '')).toEqual({ args: {
      p_requirement_id: REQ_A, p_available_from: null, p_available_until: null, p_note: null,
      p_terms: { lines: [{ description: 'Rebuild calipers', pricing_basis: 'hourly', amount: 95, currency: 'USD', unit: 'hour', quantity: 3 }] },
    } });
  });

  it('refuses contact details in a posted job, as the writer does', () => {
    expect(hasContactDetails(`call 702-555-0101`)).toBe(true);
    expect(hasContactDetails(EMAIL)).toBe(true);
    expect(hasContactDetails('Replace the front brake pads')).toBe(false);
    const action = { action: 'post_work_request', args: { p_vehicle_id: 'v1' } };
    expect(postArgs(action, `email ${EMAIL}`, null, 'open')).toEqual({ error: 'Take out phone numbers and emails. People reach you through Nuke.' });
    expect(postArgs(action, 'Replace the pads', null, 'invite_only')).toEqual({ args: {
      p_vehicle_id: 'v1', p_description: 'Replace the pads', p_image_ids: null, p_requested_operations: null, p_needed_by: null, p_visibility: 'invite_only',
    } });
  });
});

describe('JobsBoard', () => {
  it('shows open requests to a visitor with an honest coverage line, job links and no match or offer', async () => {
    fixture.rpc.mockImplementation(async (fn: string) => (fn === 'open_requirements_read' ? { data: board(false), error: null } : { data: null, error: { message: 'unexpected' } }));
    await render(<JobsBoard />);
    const text = container.textContent ?? '';
    expect(text).toContain('2 open requests on Nuke right now.');
    expect(text).toContain('Sign in to see how your record lines up.');
    expect(text).toContain('Rebuild the front brake calipers');
    expect(text).toContain('1983 GMC K2500 · Boulder City, NV · No quote yet');
    expect(text).toContain('Quote accepted');
    expect(container.querySelector(`a[href="/jobs/${WO}"]`)).not.toBeNull();
    expect(text).not.toContain('How you match');
    expect(text).not.toContain('Make an offer');
    expect(text).not.toContain('Contact via Nuke');
    expect(rpcNames()).toEqual(['open_requirements_read']);
  });

  it('shows a signed-in viewer the match in plain words and offers only where the server gives the action', async () => {
    fixture.session = { user: { id: PROVIDER_UID } };
    fixture.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'open_requirements_read') return { data: board(true), error: null };
      if (fn === 'work_order_offers_read') return { data: offersRead(), error: null };
      return { data: { offer_id: 'o2', duplicate: false }, error: null };
    });
    await render(<JobsBoard />);
    const text = container.textContent ?? '';
    expect(text).toContain('How you match');
    expect(text).toContain('Tools — No tools in your records · needs a backup supplier');
    expect(text).toContain('Technician profile — Not linked yet · link your technician profile');
    expect(text).not.toMatch(/reject|disqualif|ineligible/i);
    expect(text).toContain("There's no score, and nothing rules you out.");
    // One work order on the page: one offers read, and the offer button only on the requirement the action names.
    expect(rpcNames().filter(n => n === 'work_order_offers_read')).toHaveLength(1);
    const offerButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Make an offer');
    expect(offerButtons).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Contact via Nuke')).toHaveLength(2);

    // Privacy: the offering account's id and its private note never reach the page.
    expect(document.body.textContent).not.toContain(PROVIDER_UID);
    expect(document.body.textContent).not.toContain(EMAIL);

    await act(async () => { offerButtons[0].click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Linked by you, not yet backed by work');
    expect(dialog.textContent).toContain('Nothing is booked until the customer accepts');
    const send = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Send offer')!;
    await act(async () => { send.click(); });
    expect(dialog.textContent).toContain('Each line needs an amount.');
    expect(rpcNames()).not.toContain('offer_on_requirement');
  });
});

describe('WorkPlanView', () => {
  it('puts identity first, quotes claims with source and date, gives hours only and never the placeholder rate', async () => {
    await render(<WorkPlanView vehicleId="v1" plan={plan()} signedIn={false} />);
    const text = container.textContent ?? '';
    const sections = Array.from(container.querySelectorAll('section')).map(s => s.getAttribute('aria-label'));
    expect(sections.indexOf('Check the identity first')).toBeLessThan(sections.indexOf('What the listing claims'));
    expect(text).toContain('Model · Records disagree');
    expect(text).toContain('Nuke record: LX450 · VIN decode: LX');
    expect(text).toContain('“The gauges are inoperative.”');
    expect(text).toContain('quoted from bringatrailer.com · date not read · not scored');
    expect(text).toContain('about 2 h');
    expect(text).toContain('rough guide, not calibrated');
    expect(text).toContain(NO_SHOP_RATE);
    expect(text).toContain('Gauge cluster · GA-1 · unverified fit');
    expect(text).toContain('Check the gauges.');
    expect(text).toContain('Sign in to order an inspection');
    expect(text).not.toContain('160');
    expect(text).not.toContain('155');
    expect(text).not.toContain('189');
    expect(text).not.toContain('$');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it('orders an inspection with the reader scope only from the confirm button', async () => {
    fixture.rpc.mockResolvedValue({ data: { work_order_id: WO, duplicate: false, checklist_items: 1 }, error: null });
    await render(<WorkPlanView vehicleId="v1" plan={plan()} signedIn />);
    const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Order an inspection')!;
    await act(async () => { open.click(); });
    expect(fixture.rpc).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("The seller's permission or access to the vehicle");
    const confirm = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Order inspection')!;
    await act(async () => { confirm.click(); });
    expect(fixture.rpc).toHaveBeenCalledWith('request_inspection', {
      p_vehicle_id: 'v1', p_parent_work_order_id: null, p_scope: { ...plan().inspection_scope, request_source: 'web' },
    });
    expect(document.querySelector(`a[href="/jobs/${WO}"]`)).not.toBeNull();
  });
});

describe('PostedJobView', () => {
  it('shows suggested cost as hours only, with no placeholder dollars', async () => {
    // What post_work_request returns: cost and rate beside the hours. The page must use the hours only.
    const posted = {
      work_order_id: WO, visibility: 'open', listed_in_open_requirements: true,
      operations: [{ line_number: 1, text: 'Replace the front pads' }],
      requirements: [{ requirement_id: REQ_A, kind: 'skill', description: 'Replace the front pads' }],
      suggested_cost: { lines: [{ line_number: 1, text: 'Replace the front pads', hours: { low: 2, high: 3 }, cost: { low: 320, high: 480 }, state: 'estimated' }],
        total: { low: 320, high: 480, lines_estimated: 1, lines: 1 }, rate: 160, rate_label: 'placeholder' },
    } as unknown as PostedJob;
    await render(<PostedJobView posted={posted} />);
    const text = container.textContent ?? '';
    expect(text).toContain('about 2–3 h');
    expect(text).toContain(NO_SHOP_RATE);
    expect(container.querySelector(`a[href="/jobs/${WO}"]`)).not.toBeNull();
    for (const s of ['$', '320', '480', '160']) expect(text).not.toContain(s);
  });
});

describe('WorkPage', () => {
  const queue = {
    as_of: '2026-10-19T19:00:00Z',
    coverage: { returned: 3, total: 3 },
    items: [
      { kind: 'quote_to_accept', ref_id: 'q1', work_order_id: WO, display_title: 'Front brakes', vehicle_label: { text: '1983 GMC K2500' },
        clock: { issued_at: '2026-10-18T00:00:00Z' }, summary: { totals_by_currency: [{ currency: 'USD', total: 390, complete: true }] },
        sign: { rpc: 'accept_work_order_quote', binds: ['this exact quote version (lines, scope snapshot, deposit request) by its hash'], does_not_bind: ['payment or deposit collection'] } },
      { kind: 'invoice_payment_to_confirm', ref_id: 'p1', work_order_id: WO, display_title: 'Front brakes',
        summary: { amount: 390, currency: 'USD', method: 'card', visibility: 'parties_only' },
        sign: { binds: ['your statement, as payee, that this amount was received'], does_not_bind: ['moving, charging or releasing money'] } },
      { kind: 'offer_to_accept', ref_id: 'o1', work_order_id: WO, display_title: 'Front brakes',
        summary: { provider: { handle: 'tig_welder' }, amount: 777, currency: 'USD' }, sign: { binds: ['this provider'], does_not_bind: ['payment'] } },
    ],
  };
  const jobs = {
    as_of: '2026-10-19T19:00:00Z', next_after: null, coverage: { returned: 1, total_for_viewer: 1 },
    rows: [{ work_order_id: WO, display_title: 'Front brakes', slots: ['customer'], money_visible: false,
      stage_states: { intake: 'recorded', terms: 'absent' }, first_gap: { stage: 'plan', gap: 'no_operations' },
      customer_id: CUSTOMER_UID, payments: [{ amount: 555 }], balance_due: 444 }],
  };

  it('lists signature items with the server words and job links, and payments only on the payee item', async () => {
    fixture.rpc.mockImplementation(async (fn: string) => ({ data: fn === 'my_signature_queue' ? queue : jobs, error: null }));
    await render(<WorkPage />);
    const text = container.textContent ?? '';
    expect(rpcNames().sort()).toEqual(['my_signature_queue', 'my_work_orders']);
    expect(text).toContain('Quote to accept');
    expect(text).toContain('$390.00');
    expect(text).toContain('$390.00 reported paid by card');
    expect(text).toContain('this exact quote version (lines, scope snapshot, deposit request) by its hash');
    expect(text).toContain('payment or deposit collection');
    expect(container.querySelector('a[href="/providers/tig_welder"]')).not.toBeNull();
    expect(text).not.toContain('777');
    expect(text).toContain('You asked for this');
    expect(text).toContain('Next: Estimate — no operations listed yet');
    expect(text).not.toContain('555');
    expect(text).not.toContain('444');
    expect(text).not.toContain(CUSTOMER_UID);
    expect(container.querySelectorAll(`a[href="/jobs/${WO}"]`).length).toBeGreaterThanOrEqual(4);
  });

  it('hides a payment amount the server did not mark as the payee party item', () => {
    expect(paymentLine({ kind: 'invoice_payment_to_confirm', ref_id: 'x', summary: { amount: 10, currency: 'USD' } })).toBeNull();
    expect(paymentLine({ kind: 'quote_to_accept', ref_id: 'x', summary: { amount: 10, currency: 'USD', visibility: 'parties_only' } })).toBeNull();
  });
});

describe('VehicleWorkCard', () => {
  const read = (canPost: boolean) => ({
    as_of: '2026-10-19T19:00:00Z', vehicle_id: 'v1', vehicle_label: { text: '1983 GMC K2500' },
    viewer: { context: 'visitor', slots: [], money_visible: false,
      vehicle_access: { role: canPost ? 'owner' : 'none', can_post_work_request: canPost, can_request_inspection: canPost,
        post_work_request_reason: canPost ? null : 'sign_in', request_inspection_reason: canPost ? null : 'sign_in' },
      actions: canPost ? [{ action: 'post_work_request', rpc: 'post_work_request', args: { p_vehicle_id: 'v1', p_visibility: 'open' } }] : [] },
    rows: [{ work_order_id: WO, display_title: 'Front brakes', slots: [] }],
    coverage: { returned: 1, total_for_vehicle: 1 },
  });

  it('offers Post a job only when the reader says the viewer may post', async () => {
    fixture.rpc.mockResolvedValue({ data: read(false), error: null });
    await render(<VehicleWorkCard vehicleId="v1" vehicleTitle="1983 GMC K2500" signedIn={false} />);
    expect(container.textContent).toContain('Plan the work');
    expect(container.textContent).not.toContain('Post a job');
    expect(container.querySelector(`a[href="/jobs/${WO}"]`)).not.toBeNull();
    act(() => root?.unmount()); root = null;

    fixture.rpc.mockResolvedValue({ data: read(true), error: null });
    await render(<VehicleWorkCard vehicleId="v1" vehicleTitle="1983 GMC K2500" signedIn />);
    expect(container.textContent).toContain('Post a job');
    expect(rpcNames().every(n => n === 'vehicle_work_orders_read' || n === 'vehicle_work_publication_read')).toBe(true);
  });
});
