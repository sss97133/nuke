// Every page built for the job loop, in the states a person reaches (signed out, signed in as each party, each Sign sheet
// open), with fixtures in the live readers' shapes. a11y.e2e.mjs runs axe-core on each.
import { persona } from './mockSupabase.mjs';
import { activityNotes, activityReaders } from './activityFixtures.mjs';
import { HASH, INSP, QUOTE, SCOPE_HASH, WO, emptyReader, header, inspection, invoices, jobPath, jobReaders, offers, operations, quotes, viewer } from './fixtures.mjs';

export const CUSTOMER = persona('00000000-0000-4000-b000-00000000c001', 'e2ebuyer');
export const TECH = persona('00000000-0000-4000-b000-00000000c002', 'e2etech');
export const SHOP = persona('00000000-0000-4000-b000-00000000c003', 'e2eshop');
const AS_OF = '2026-10-19T19:00:00Z';
const ORG = '00000000-0000-4000-a000-00000000e2ea';
const TOKEN = 'f'.repeat(64);

const notOnNuke = { state: 'not_on_nuke_yet', label: 'Not on Nuke yet', owners_active: 0, members_active: 0, claimed_via: [],
  claim: { writer: 'claim_organization', methods: ['domain_email', 'document'], domain: 'e2eparts.example', domain_email_rule: "your confirmed sign-in e-mail is at this website's domain" } };
const supplierNot = { organization: { kind: 'organization', organization_id: ORG, name: 'E2E Parts' }, profile_public: true, times: 3, last_on: '2026-01-23',
  label: 'paid for this before on Nuke (3 times)', kinds_matched: ['auto_parts'], on_nuke: notOnNuke, can_receive_requests: false };
const supplierClaimed = { organization: { kind: 'organization', organization_id: 'org-summit', name: 'Summit Racing' }, profile_public: true, times: 5, last_on: '2026-02-04',
  label: 'paid for this before on Nuke (5 times)', kinds_matched: ['auto_parts'], on_nuke: { state: 'claimed', label: 'Claimed on Nuke', offer_capable: true }, can_receive_requests: true };
const match = [{ input: 'skill', result: 'pass', reason: 'your record shows capability welding_tig' }, { input: 'tools', result: 'fail', reason: 'no claimed tool records', next: 'plan_b_supplier_needed' },
  { input: 'availability', result: 'unknown', reason: 'you have not set availability' }];
const openReqs = (v) => ({ as_of: AS_OF, next_after: null, viewer: v, coverage: { returned: 2, total_open: 2 }, contact: { action: 'contact_via_nuke', available: true },
  rows: [{ requirement_id: 'req-1', work_order_id: WO, requirement_kind: 'skill', description: 'TIG welding for stainless exhaust', display_title: 'E2E exhaust job',
    vehicle_label: header.vehicle_label, area_band: { city: 'Example City', state: 'NV' }, quote_state: { has_current_quote: true }, match, plan_b_suppliers: [supplierNot, supplierClaimed], candidates_listed: 1 },
  { requirement_id: 'req-2', work_order_id: WO, requirement_kind: 'facility', description: 'Vehicle lift', display_title: 'E2E exhaust job', vehicle_label: header.vehicle_label, match: [], plan_b_suppliers: [] }] });

const pub = (visibility, actions) => ({ work_order_id: WO, visibility, requirements: 2, listed_in_open_requirements: visibility === 'open', last_sign: { action: 'publish', signed_at: AS_OF },
  as_of: AS_OF, viewer: { party: actions.length > 0, actions } });
const publishOpen = { action: 'publish_work_order', rpc: 'publish_work_order', args: { p_work_order_id: WO, p_visibility: 'open' }, visibility: 'open', refused_reason: null,
  binds: ['your statement that this job is open'], does_not_bind: ['a price'] };
const resources = (v) => ({ ...emptyReader(v), coverage: { recorded_requirements: 1, requirements_with_candidates: 0, requirement_population: 'not_assessed', specification_population: 'not_assessed' },
  requirements: [{ id: 'req-1', requirement_kind: 'skill', description: 'TIG welding for stainless exhaust', confidence_score: 0.6 }],
  specifications: [{ id: 's1', specification_stage: 'requested', material_label: '304 stainless', process_label: 'tig' }], specification_comparisons: [] });
const bookings = (v) => ({ ...emptyReader(v), reservations: [{ reservation_id: 'res-1', asset: { asset_id: 'asset-1', kind: 'lift', label: 'Lift A', capacity: 1 },
  shop: { kind: 'organization', name: 'E2E Garage' }, window: { from: '2030-01-07T16:00:00Z', until: '2030-01-08T01:00:00Z' }, state: 'confirmed' }], coverage: { reservations: 1, visibility: 'parties see terms' } });
const evidence = (v, actions = []) => ({ ...emptyReader(v), viewer: { ...v, actions }, attachments: [{ attachment_id: 'att-1', attached_at: AS_OF, attribution: 'authenticated_sign',
  attached_by: { kind: 'user', handle: 'e2etech', role: 'performer' }, operation: { operation_id: 'op-1', line_number: 1, task_description: 'Fabricate long tube headers' },
  images: [{ image_id: 'img-1', image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', captured_at: AS_OF }], images_withheld: 1 }] });
const richReaders = (v, extra = {}) => jobReaders(v, {
  work_order_job_path_read: jobPath(v), work_order_quotes_read: quotes(v), work_order_offers_read: offers(v), work_order_resources_read: resources(v),
  work_order_facility_reservations_read: bookings(v), work_order_inspection_read: inspection(v), work_order_evidence_read: evidence(v),
  work_order_invoices_read: invoices(v), work_order_publication_read: pub('open', []), ...extra });

const profile = (context) => ({ as_of: AS_OF, viewer: { context, slots: [] }, money: 'not_reported',
  subject: { kind: 'user', handle: 'e2etech', profile_id: TECH.id, city: 'Example City', state: 'NV', member_since: '2025-09-07T00:00:00Z' },
  claims: { account: { profession: 'mechanic', expertise_areas: ['square_body_restoration'] }, actor_records: [{ specialties: ['welding'] }] },
  capabilities: { items: [{ capability_type: 'welding_tig', strength: 'corroborating', derivation: 'evidence_fold', evidence_count: 2, basis_counts: { direct: 0, corroborating: 2, against: 0 }, last_demonstrated: '2026-03-15' }] },
  tools: { seen_in_frame: { occurrences: 10, frames_analyzed: 50, frames_with_tools: 8, images_scanned: 50, images_eligible: 50, top_labels: [{ label: 'two-post lift', occurrences: 7 }] },
    claimed_owned: { user_tools: [{ category: 'Pliers', records: 2 }], tool_inventory: [] }, co_signed: { supporting_attestations: 0 } },
  facilities: [{ relation_kind: 'ownership', name: 'E2E Garage', role: 'owner', relation: { state: 'live' } }],
  vouched_for_by: { items: [{ vouch_id: 'v1', voucher: { kind: 'user', handle: 'e2eshop' }, kinds: ['supervision'], scope: 'Supervised welding', vouched_at: AS_OF, is_mine: false, actions: [] }] },
  identity_bridge: { state: 'evidenced' },
  work_record: { days: { signed_work_days: 3, days_with_capture: 20, capture_span_hours: { value: 40 }, first_day: '2025-01-01', last_day: '2026-06-20' },
    jobs: { jobs: 1, by_role: { performer: 1 }, completion: { recorded: 1, status_only: 0, absent: 0 } } },
  contact: { action: 'contact_via_nuke', available: context !== 'self', request: { context_kind: 'profile', context_id: TECH.id, recipient_user_id: TECH.id } } });
const providerReaders = (context) => ({ provider_profile_read: profile(context), my_contact_requests: { incoming: [], outgoing: [], limits: { requests_per_day: 10, requests_sent_last_day: 2 } },
  provider_job_record_read: { as_of: AS_OF, coverage: { returned: 1, total_for_subject: 1 }, next_after: null, rows: [{ work_order_id: WO, display_title: 'E2E exhaust job',
    vehicle_label: header.vehicle_label, subject_roles: ['performer'], operation_kinds: { fabricate: 2 }, stage_states: { intake: 'recorded', execution: 'recorded', accounting: 'withheld' }, dates: {} }] },
  provider_productivity_read: { as_of: AS_OF, range: { from: '2026-07-21', to: '2026-10-19' }, totals: { days_with_activity: 2 }, days: [{ day: '2026-10-15', image_evidence: 3, signed: {} }], day_rate_jobs: [] },
  my_vouches_read: { as_of: AS_OF, items: [] } });

const queue = { as_of: AS_OF, viewer: viewer('self'), coverage: { returned: 1, total: 1 }, items: [{ kind: 'facility_reservation_to_confirm', ref_id: 'res-1', work_order_id: WO,
  display_title: 'E2E exhaust job', vehicle_label: header.vehicle_label, clock: { requested_at: AS_OF, from: '2030-01-07T16:00:00Z', until: '2030-01-08T01:00:00Z' },
  summary: { asset: { asset_id: 'asset-1', kind: 'lift', label: 'Lift A', capacity: 1 }, organization: { kind: 'organization', name: 'E2E Garage' }, requester_role: 'customer',
    requested_by: { kind: 'user', handle: 'e2ebuyer' }, capacity_free: true },
  sign: { rpc: 'confirm_facility_reservation', args_hint: { p_reservation_id: 'res-1', p_hash: 'e'.repeat(64) }, binds: ['one capacity slot'], does_not_bind: ['payment'] } }] };
const myWork = { as_of: AS_OF, coverage: { returned: 1, total_for_viewer: 1 }, next_after: null, rows: [{ work_order_id: WO, display_title: 'E2E exhaust job', slots: ['customer'],
  vehicle_label: header.vehicle_label, stage_states: { intake: 'recorded', terms: 'partial' }, first_gap: { stage: 'terms', gap: 'no_approval_clock' } }] };

const inbox = { as_of: AS_OF, limits: { requests_per_day: 10, requests_sent_last_day: 0 },
  incoming: [{ request_id: 'req-c1', direction: 'incoming', status: 'pending', created_at: AS_OF, message: 'Could you weld stainless headers next week?',
    counterpart: { kind: 'user', handle: 'e2ebuyer' }, recipient_kind: 'user', context: { kind: 'profile', label: null }, thread: { messages: 0 }, actions: ['respond_contact_request'] }],
  outgoing: [{ request_id: 'req-c2', direction: 'outgoing', status: 'accepted', created_at: AS_OF, counterpart: { kind: 'user', handle: 'e2eshop' }, context: { kind: 'work_order', label: 'E2E exhaust job' },
    thread: { messages: 1 }, actions: ['post_contact_message', 'withdraw_contact_request'] }] };
const thread = { as_of: AS_OF, can_post: true, request: { request_id: 'req-c2', direction: 'outgoing', status: 'accepted', counterpart: { kind: 'user', handle: 'e2eshop' }, recipient_kind: 'user', message: 'Hello' },
  messages: [{ message_id: 'm1', author: { kind: 'you' }, body: 'Are you free Friday?', created_at: AS_OF }] };

const facility = { organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, as_of: AS_OF, members: [], members_unnamed: 0, on_nuke: notOnNuke,
  assets_by_kind: [{ kind: 'lift', capacity_total: 1, assets: [{ asset_id: 'asset-1', label: 'Lift A', capacity: 1, busy: [] }] }], licenses: [], coverage: { declared_assets: 1 },
  work_recorded_on_nuke: { records: 3, first_on: '2024-05-12', last_on: '2026-02-04', by_source: { receipts: 3 }, kinds: [{ supply_kind: 'auto_parts', times: 3, first_on: '2024-05-12', last_on: '2026-02-04' }] } };
const business = { id: ORG, business_name: 'E2E Parts', is_public: true, created_at: '2025-01-01T00:00:00Z' };
const redeemed = { invite_id: 'inv-1', organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, on_nuke: notOnNuke,
  claim: { writer: 'claim_organization', args: { p_organization_id: ORG }, domain_email_qualifies: true, methods: ['domain_email', 'document'] },
  requirement: { requirement_id: 'req-1', work_order_id: WO, kind: 'skill', description: 'TIG welding for stainless exhaust', still_open: true } };
const statement = { as_of: AS_OF, viewer: viewer('visitor'), vehicle: { year: 1983, make: 'GMC', model: 'K2500', text: '1983 GMC K2500 Sierra Classic' },
  shop: { name: 'E2E Garage', city: 'Example City', state: 'NV' }, coverage: { work_orders: 1 }, totals: { parts: 420, labor: 390, subtotal: 810, goodwill: 0, payments: null, balance: null },
  contact: { action: 'contact_via_nuke', available: false }, work_orders: [{ id: WO, title: 'E2E exhaust job', status: 'in_progress', created_at: AS_OF, slots: [], payments: null,
    parts: [{ id: 'p1', part_name: 'Borla S-Type muffler', quantity: 2, unit_price: 210, total_price: 420 }], labor: [{ id: 'l1', task_name: 'Install exhaust', hours: 3, hourly_rate: 130, total_cost: 390 }],
    parts_total: 420, labor_total: 390, comped_value: 0 }] };
const market = { as_of: AS_OF, history_basis: 'daily', rules: {}, trust: { owner_delegated_signs: 1, owner_delegated_signs_last_30_days: 1, open_exposures_known: 0 },
  demand: { jobs: 3, published: { open: 1, unset: 2, invite_only: 0 }, new_requests: { published_open_last_7_days: 1 }, open_requirements: 2, open_requirements_by_kind: { skill: 1, facility: 1 } },
  supply: { provider_population: 1, accounts_with_evidenced_provider_links: 1, verified_claimant_organizations: 0, organizations_with_supply_evidence: 2, supply_organizations_claimable: { not_on_nuke_yet: 2, by_domain_email: 2, document_only: 0 } },
  matching: { open_requirements: 2, with_plan_b_supplier: 1, with_evidenced_candidate: 0, with_reachable_plan_b_supplier: 0, with_no_provider_considered: 1, unknown_for_all: { availability: 2 } },
  flow: { counts: { offers: 1 }, step_hours: {} },
  history: [{ date: '2026-10-18', open_requirements: 1, with_plan_b_supplier: 0 }, { date: '2026-10-19', open_requirements: 2, with_plan_b_supplier: 1 }] };

const open = (name) => async (page) => { await page.getByRole('button', { name, exact: true }).first().click(); await page.getByRole('dialog').waitFor(); };

const cust = viewer('client', ['customer']);
const prov = viewer('provider', ['performer']);
const customerReaders = (extra = {}) => richReaders(cust, {
  work_order_job_path_read: jobPath(viewer('client', ['customer'], [{ action: 'reserve_facility', rpc: 'reserve_facility', as: 'customer', args: { p_work_order_id: WO },
    facilities: [{ kind: 'organization', name: 'E2E Garage', organization_id: 'org-e2e' }], binds: ['a request for one asset'], does_not_bind: ['payment'] }]),
    { provider_attestation: { completion_id: 'comp-1', completion_hash: 'c'.repeat(64), signed_at: AS_OF } }),
  work_order_quotes_read: quotes(viewer('client', ['customer'], [{ action: 'accept_quote', rpc: 'accept_work_order_quote', args: { p_quote_id: QUOTE, p_quote_hash: HASH } }])),
  work_order_invoices_read: invoices(viewer('client', ['customer'], [{ action: 'record_payment', rpc: 'record_work_order_payment', args: { p_invoice_id: 'inv-1' }, as: 'payer' }]), { payments: [] }),
  work_order_publication_read: pub('not_published', [publishOpen]),
  facility_read: facility, open_requirements_read: openReqs(cust), ...extra });
const providerJobReaders = richReaders(prov, {
  work_order_quotes_read: { ...quotes(prov, { accepted: true }), viewer: { ...prov, prices_visible: true, actions: [], issuer_actions: [
    { action: 'issue_change_order', rpc: 'issue_change_order', args: { p_work_order_id: WO, p_base_quote_id: QUOTE } }] } },
  work_order_invoices_read: invoices(viewer('provider', ['performer'], [{ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } }])),
  work_order_inspection_read: inspection(viewer('provider', ['inspector'], [{ action: 'record_findings', rpc: 'record_inspection_findings', args: { p_inspection_work_order_id: INSP } }])),
  work_order_evidence_read: evidence(prov, [{ action: 'attach_evidence', rpc: 'attach_job_evidence', args: { p_work_order_id: WO } }]),
  job_evidence_candidates_read: { items: [{ image_id: 'img-9', work_order_id: WO, captured_at: AS_OF, image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }], coverage: { not_attachable_excluded: 1 } },
  work_order_job_path_read: jobPath(prov) });
const shopReaders = richReaders(viewer('org_member', ['org_owner']), {
  work_order_offers_read: offers(viewer('org_member', ['org_owner'], [{ action: 'cosign_provider', rpc: 'cosign_provider', args: { p_work_order_id: WO, p_offer_id: 'offer-1' },
    acting_for: [{ kind: 'organization', name: 'E2E Garage', p_cut: { organization_id: 'org-e2e' } }] }])),
  work_order_inspection_read: inspection(viewer('client', ['vehicle_access'], [{ action: 'grant_inspection_access', rpc: 'grant_inspection_access', args: { p_inspection_work_order_id: INSP },
    binds: ['your permission'], does_not_bind: ['payment'] }])),
  work_order_quotes_read: { ...quotes(viewer('org_member', ['org_owner'])), current_quote: null, history: [], viewer: { ...viewer('org_member', ['org_owner']), prices_visible: true, actions: [],
    issuer_actions: [{ action: 'issue_quote', rpc: 'issue_work_order_quote', args: { p_work_order_id: WO, p_supersedes_quote_id: null }, release_conditions_vocabulary: ['customer_completion_sign'] }] } },
  work_order_operations_read: operations });

/** { name, path, who, readers, tables, ready (text or role to wait for), act (opens a sheet), scope (CSS) } */
export const STATES = [
  { name: '/jobs visitor', path: '/jobs', readers: { open_requirements_read: openReqs(viewer('visitor')) }, ready: 'Open requests' },
  { name: '/jobs customer', path: '/jobs', who: CUSTOMER, readers: { open_requirements_read: openReqs(cust), my_work_orders: myWork, work_order_offers_read: offers(cust) }, ready: 'Open requests' },
  { name: '/jobs/:id visitor (all sections)', path: `/jobs/${WO}`, readers: richReaders(viewer('visitor')), ready: 'Invoice and payment' },
  { name: '/jobs/:id customer', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Backup suppliers' },
  { name: '/jobs/:id accept quote (inline sign)', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Accept quote',
    act: async (page) => { await page.getByRole('button', { name: 'Review and sign' }).first().click(); await page.getByText('It does not say').first().waitFor(); } },
  { name: 'sheet: publish', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Publish: open to technicians', act: open('Publish: open to technicians') },
  { name: 'sheet: confirm done', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Confirm the work is done', act: open('Confirm the work is done') },
  { name: 'sheet: record payment', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Record a payment', act: open('Record a payment') },
  { name: 'sheet: book a bay', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Book a bay', act: open('Book a bay') },
  { name: 'sheet: invite to offer', path: `/jobs/${WO}`, who: CUSTOMER, readers: customerReaders(), ready: 'Invite to offer', act: open('Invite to offer') },
  { name: 'sheet: issue quote', path: `/jobs/${WO}`, who: SHOP, readers: shopReaders, ready: 'Issue a quote', act: open('Issue a quote') },
  { name: 'sheet: co-sign', path: `/jobs/${WO}`, who: SHOP, readers: shopReaders, ready: 'Co-sign this technician', act: open('Co-sign this technician') },
  { name: 'sheet: grant inspection access', path: `/jobs/${WO}`, who: SHOP, readers: shopReaders, ready: 'Let an inspector see your car', act: open('Let an inspector see your car') },
  { name: 'sheet: change order', path: `/jobs/${WO}`, who: TECH, readers: providerJobReaders, ready: 'Issue a change order', act: open('Issue a change order') },
  { name: 'sheet: mark done', path: `/jobs/${WO}`, who: TECH, readers: providerJobReaders, ready: 'Mark the work done', act: open('Mark the work done') },
  { name: 'sheet: issue invoice', path: `/jobs/${WO}`, who: TECH, readers: providerJobReaders, ready: 'Issue an invoice', act: open('Issue an invoice') },
  { name: 'sheet: record findings', path: `/jobs/${WO}`, who: TECH, readers: providerJobReaders, ready: 'Record inspection findings', act: open('Record inspection findings') },
  { name: 'sheet: attach evidence', path: `/jobs/${WO}`, who: TECH, readers: providerJobReaders, ready: 'Attach photos to this job', act: open('Attach photos to this job') },
  { name: '/providers/:handle visitor', path: '/providers/e2etech', tables: { profiles: [{ id: TECH.id }] }, readers: providerReaders('visitor'), ready: 'What the record shows' },
  { name: '/providers/:handle signed-in + vouch sheet', path: '/providers/e2etech', who: CUSTOMER, tables: { profiles: [{ id: TECH.id }] }, readers: providerReaders('visitor'), ready: 'Vouch for this person', act: open('Vouch for this person') },
  { name: '/providers/:handle self', path: '/providers/e2etech', who: TECH, tables: { profiles: [{ id: TECH.id }] }, readers: providerReaders('self'), ready: 'Your shops' },
  { name: '/work', path: '/work', who: SHOP, readers: { my_signature_queue: queue, my_work_orders: myWork }, ready: 'Jobs', readyRole: 'heading' },
  { name: '/work records', path: '/work', who: SHOP, readers: { my_signature_queue: queue, my_work_orders: myWork }, ready: 'Review records',
    act: async (page) => { await page.getByRole('button', { name: 'Review records', exact: true }).click(); } },
  { name: '/work confirm booking sheet', path: '/work', who: SHOP, readers: { my_signature_queue: queue, my_work_orders: myWork }, ready: 'Review records',
    act: async (page) => { await page.getByRole('button', { name: 'Review records', exact: true }).click(); await open('Confirm booking')(page); } },
  ...[0, 1, 2, 3, 4].map(i => ({ name: `/work/setup step ${i + 1}`, path: '/work/setup', who: TECH, tables: { profiles: [{ username: 'e2etech', is_public: true, profession: 'mechanic', expertise_areas: [] }] },
    readers: { my_suggested_provider_links: { items: [], coverage: { returned: 0 } }, provider_profile_read: profile('self') }, ready: 'Records that may be yours',
    act: async (page) => { await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button').nth(i).click(); } })),
  { name: '/work/market', path: '/work/market', readers: { job_market_health_read: market }, ready: 'Jobs moving' },
  { name: '/messages', path: '/messages', who: TECH, readers: { my_contact_requests: inbox }, ready: 'Incoming' },
  { name: '/messages accept sheet', path: '/messages', who: TECH, readers: { my_contact_requests: inbox }, ready: 'Incoming', act: open('Accept') },
  { name: '/messages/:id thread', path: '/messages/req-c2', who: TECH, readers: { contact_thread_read: thread }, ready: 'Conversation with @e2eshop' },
  { name: '/org/:id claim sheet', path: `/org/${ORG}`, who: CUSTOMER, tables: { businesses: [business] }, readers: { facility_read: facility }, ready: 'Claim this business',
    act: open('Claim this business'), scope: '[aria-label="This business on Nuke"], [role="dialog"]' },
  { name: '/org/:id invite sheet', path: `/org/${ORG}?requirement=req-1`, who: CUSTOMER, tables: { businesses: [business] }, readers: { facility_read: facility }, ready: 'Invite them',
    act: open('Invite them'), scope: '[aria-label="This business on Nuke"], [role="dialog"]' },
  { name: '/supplier-invite/:token signed out', path: `/supplier-invite/${TOKEN}`, readers: {}, ready: 'You were invited to Nuke' },
  { name: '/supplier-invite/:token redeemed + claim sheet', path: `/supplier-invite/${TOKEN}`, who: SHOP, readers: { redeem_supplier_invite: redeemed }, ready: 'Open the invite',
    act: async (page) => { await page.getByRole('button', { name: 'Open the invite' }).click(); await page.getByRole('button', { name: 'Claim E2E Parts' }).click(); await page.getByRole('dialog').waitFor(); } },
  { name: 'statement page', path: `/work-orders/statement?work_order_id=${WO}`, readers: { work_order_statement_read: statement }, ready: 'Install exhaust' },
  // Header activity indicator (signed in), panel open: the header is outside the default scope, so audit the button and panel.
  { name: 'header activity panel', path: '/work', who: CUSTOMER, readers: activityReaders(), tables: { user_notifications: activityNotes },
    ready: 'Jobs', readyRole: 'heading',
    act: async (page) => { await page.getByRole('button', { name: /^Activity / }).click(); await page.getByRole('region', { name: 'Activity' }).waitFor(); },
    scope: '.activity' },
];

export { SCOPE_HASH };
