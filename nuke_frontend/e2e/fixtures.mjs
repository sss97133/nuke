// Reader answers in the live shapes (work_order_*_read, my_signature_queue, my_contact_requests, provider_profile_read,
// facility_read, job_evidence_candidates_read; read 2026-10-19). Synthetic ids and handles only.
export const WO = '00000000-0000-4000-a000-00000000e2e1';
export const INSP = '00000000-0000-4000-a000-00000000e2e2';
export const QUOTE = '00000000-0000-4000-a000-00000000e2e3';
export const HASH = 'a'.repeat(64);
export const SCOPE_HASH = 'b'.repeat(64);
export const COMPLETION_HASH = 'c'.repeat(64);
const AS_OF = '2026-10-19T19:00:00Z';

export const header = {
  work_order_id: WO, vehicle_id: '00000000-0000-4000-a000-00000000e2e9', as_of: AS_OF,
  display_title: 'E2E exhaust job', display_title_basis: 'title', request_source_label: 'Requested on the web',
  vehicle_label: { year: 1983, make: 'GMC', model: 'K2500', trim: 'Sierra Classic', text: '1983 GMC K2500 Sierra Classic' },
};

export function viewer(context, slots = [], actions = [], extra = {}) {
  const party = slots.length > 0;
  return { context, slots, actions, party, money_visible: party, contact_visible: false, decided_from: 'auth.uid()', identity_bridge: 'none', ...extra };
}

export function jobPath(v, completion = {}) {
  return { ...header, viewer: v, state_basis: 'presence of existing owner records and clocks; not verified truth', payment_authorized: false,
    coverage: { stages_reported: 7, population: 'one work order' },
    stages: {
      intake: { state: 'recorded', gaps: [], inconsistencies: [], created_at: '2026-10-01T00:00:00Z', scope_stated: true, vehicle_bound: true },
      inspection: { state: 'partial', gaps: [], inconsistencies: [], inspection_jobs: 1 },
      plan: { state: 'partial', gaps: ['operations_without_requirements'], inconsistencies: [], operations: 1 },
      terms: { state: 'partial', gaps: ['no_approval_clock'], inconsistencies: [], customer_acceptance: 'not_established' },
      execution: { state: 'absent', gaps: ['no_start_clock'], inconsistencies: [] },
      completion: { state: 'absent', gaps: ['no_provider_completion_attestation'], inconsistencies: [], customer_acceptance: 'not_established',
        scope_basis: { basis: 'accepted_quote', quote_id: QUOTE, scope_hash: SCOPE_HASH }, provider_attestation: null, ...completion },
      accounting: v.party
        ? { state: 'partial', gaps: ['invoice_balance_open'], inconsistencies: [] }
        : { state: 'withheld', gaps: [], inconsistencies: [], visibility: 'parties_only', disbursement: 'not_performed' },
    } };
}

export const operations = { ...header, viewer: viewer('visitor'), coverage: { operations: 1, parts: 1, labor: 1, prices: 'open; recorded line prices, not payments' },
  operations: [{ id: 'op-1', line_number: 1, task_type: 'fabricate', status: 'pending', description: 'Fabricate long tube headers',
    quote_ref: { ref_kind: 'operation', ref_id: 'op-1' }, requirements: [], specifications: [] }],
  parts: [{ id: 'part-1', part_name: 'Borla S-Type muffler', quantity: 2, unit_price: 210, total_price: 420, is_comped: false, quote_ref: { ref_kind: 'part', ref_id: 'part-1' } }],
  labor: [{ id: 'lab-1', task_name: 'Install exhaust', hours: 3, hourly_rate: 130, total_cost: 390, is_comped: false, quote_ref: { ref_kind: 'labor', ref_id: 'lab-1' } }] };

export function quotes(v, { accepted = false } = {}) {
  return { ...header, viewer: { ...v, prices_visible: true, issuer_actions: v.issuer_actions ?? [] },
    coverage: { quote_versions: 1, versions_with_current_source: 1, prices: 'open' }, history: [{ quote_id: QUOTE, version: 1, state: 'current', observed_at: AS_OF }],
    acceptance: accepted ? { state: 'accepted', quote_id: QUOTE, quote_version: 1, signed_at: AS_OF, accepted_by_viewer: false } : { state: 'not_accepted' },
    release_conditions: { current: null, accepted: null, declared_by: 'platform_standard' },
    current_quote: { quote_id: QUOTE, version: 1, quote_hash: HASH, quoting_party: { kind: 'user', handle: 'e2etech' }, expired: false,
      lines: [{ ref_kind: 'operation', ref_id: 'op-1', description: 'Fabricate long tube headers', pricing_basis: 'flat', amount: 1200, currency: 'USD' },
        { ref_kind: 'labor', ref_id: 'lab-1', description: 'Install exhaust', pricing_basis: 'hourly', amount: 130, currency: 'USD', unit: 'hour', quantity: 3 }],
      totals_by_currency: [{ currency: 'USD', total: 1590, complete: true }], release_conditions: null } };
}

export function invoices(v, { withInvoice = true, payments = [] } = {}) {
  return { ...header, viewer: v, money_moved: false, disbursement: 'not_performed',
    coverage: { invoice_versions: withInvoice ? 1 : 0 }, current_invoice_id: withInvoice ? 'inv-1' : null,
    invoices: withInvoice ? [{ invoice_id: 'inv-1', version: 1, current: true, status: 'open', currency: 'USD', total: 1590, issued_at: AS_OF,
      issuer: { kind: 'user', handle: 'e2etech' }, lines: [{ line: 1, description: 'Fabricate long tube headers', amount: 1200, line_total: 1200 },
        { line: 2, description: 'Install exhaust', amount: 130, quantity: 3, line_total: 390 }] }] : [],
    payments, reconciliation: v.party ? { state: 'unpaid', currency: 'USD', balance_due: 1590 } : null,
    payments_visibility: v.party ? 'shown_to_party' : 'withheld_not_party' };
}

export function offers(v) {
  return { ...header, viewer: v, coverage: { requirements: 1, current_offers: 1 }, accepted_providers: [], accepted_cosigners: [],
    requirements: [{ requirement_id: 'req-1', requirement_kind: 'skill', description: 'TIG welding for stainless exhaust',
      offers: [{ offer_id: 'offer-1', offer_hash: 'd'.repeat(64), terms_hash: 'd'.repeat(64), offer_kind: 'individual', offer_rung: 'work_evidence',
        provider: { kind: 'user', handle: 'e2etech' }, terms: { lines: [{ description: 'TIG weld headers', pricing_basis: 'day_rate', amount: 600, currency: 'USD', unit: 'day', quantity: 2 }] },
        acceptance: { state: 'not_accepted' }, co_signs: [] }] }] };
}

export function inspection(v) {
  return { ...header, role: 'parent', viewer: v, coverage: { inspections: 1, with_findings: 0 },
    inspections: [{ work_order_id: INSP, inspection_type: 'pre_purchase', requested_at: AS_OF, requested_by: { kind: 'user', handle: 'e2ebuyer' }, state: 'requested',
      checklist: [{ item_id: 'frame', question: 'Is the frame straight and free of repairs?', system: 'undercarriage' },
        { item_id: 'rust', question: 'Any rust through on cab corners?', system: 'body' }],
      current_report: null, seller_permission: { state: 'not_established' } }] };
}

export const emptyReader = (v = viewer('visitor')) => ({ ...header, viewer: v, coverage: {} });

/** Every job reader for one viewer; pass overrides per test. */
export function jobReaders(v, overrides = {}) {
  return {
    work_order_job_path_read: jobPath(v),
    work_order_operations_read: operations,
    work_order_resources_read: { ...emptyReader(v), requirements: [], specifications: [] },
    work_order_offers_read: { ...emptyReader(v), requirements: [], accepted_providers: [] },
    work_order_quotes_read: { ...emptyReader(v), history: [], current_quote: null, acceptance: { state: 'not_accepted' } },
    work_order_facility_reservations_read: { ...emptyReader(v), reservations: [] },
    work_order_inspection_read: { ...emptyReader(v), inspections: [] },
    work_order_evidence_read: { ...emptyReader(v), attachments: [] },
    work_order_invoices_read: invoices(v, { withInvoice: false }),
    ...overrides,
  };
}
