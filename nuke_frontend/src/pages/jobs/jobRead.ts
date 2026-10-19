// The job readers' answers, read the way the server sends them, and the words a person reads.
//
// A job is a quote on its way to a receipt: estimate → quote (revisions) → acceptance → work order →
// change order → completion → invoice → payment → receipt. work_order_job_path_read measures one
// work_orders header across seven stages; the sibling open readers (operations, resources, offers,
// quotes, facility reservations, inspection, evidence, invoices) fill in each stage. Decoding is
// tolerant: an unknown state or action reads as itself, never as a rung it was not given.
//
// Two things are withheld here whatever a reader sends: personal contact fields never render (people
// reach each other through a Contact via Nuke request), and payment or balance amounts render only
// when the reader's viewer.money_visible is literally true. Prices, rates and costs are open.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const obj = (v: unknown): JsonObject | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null);
export const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const strings = (v: unknown): string[] => arr(v).map(str).filter((s): s is string => s !== null);

// MARK: - Stages

export type StageKey = 'intake' | 'inspection' | 'plan' | 'terms' | 'execution' | 'completion' | 'accounting';

export const STAGES: Array<{ key: StageKey; title: string; short: string }> = [
  { key: 'intake', title: 'Request', short: 'Request' },
  { key: 'inspection', title: 'Inspection', short: 'Inspection' },
  { key: 'plan', title: 'Plan & estimate', short: 'Estimate' },
  { key: 'terms', title: 'Quote & terms', short: 'Quote' },
  { key: 'execution', title: 'Work', short: 'Work' },
  { key: 'completion', title: 'Completion', short: 'Done' },
  { key: 'accounting', title: 'Invoice & payment', short: 'Payment' },
];

/** The trust ladder a stage can reach. `proven` is reserved for authenticated signatures; no stage state reaches it. */
export type Rung = 'proven' | 'attributed' | 'pending' | 'recorded' | 'conflicting';

/** recorded → attributed, partial → pending, status_only → recorded (dim), any inconsistency → conflicting. */
export function stageRung(state: string | null | undefined, hasInconsistency: boolean): Rung | null {
  if (hasInconsistency) return 'conflicting';
  switch (state) {
    case 'recorded': return 'attributed';
    case 'partial': return 'pending';
    case 'status_only': return 'recorded';
    case 'absent': case 'withheld': case null: case undefined: return null;
    default: return 'recorded';
  }
}

export const RUNG_WORD: Record<Rung, string> = {
  proven: 'Signed through Nuke',
  attributed: 'Attributed',
  pending: 'Pending',
  recorded: 'Recorded only',
  conflicting: 'Records disagree',
};

/** The state as a full value line: honest about what is and is not verified. */
export function stateLine(state: string | null | undefined): string {
  switch (state) {
    case 'recorded': return 'Recorded — not yet verified';
    case 'partial': return 'In progress';
    case 'status_only': return 'Marked, but no record behind it';
    case 'absent': return 'Not started';
    case 'withheld': return 'Payments are shown to the people on this job';
    case null: case undefined: return 'Not reported';
    default: return sentence(state);
  }
}

export type Stage = { key: StageKey; state: string | null; gaps: string[]; inconsistencies: string[]; raw: JsonObject };

export function parseStages(path: JsonObject | null): Stage[] {
  const stages = obj(path?.stages);
  return STAGES.map(({ key }) => {
    const s = obj(stages?.[key]);
    return { key, state: str(s?.state), gaps: strings(s?.gaps), inconsistencies: strings(s?.inconsistencies), raw: s ?? {} };
  });
}

// MARK: - Words

export function sentence(code: string): string {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const GAPS: Record<string, string> = {
  no_vehicle: 'No vehicle attached',
  no_scope: 'No description of the work',
  no_inspection_requirement: 'No inspection requested',
  inspection_performer_unresolved: 'No inspector found yet',
  no_operations: 'No operations planned',
  operations_without_requirements: 'Some operations have no requirements',
  parts_without_operation_link: "Some parts aren't tied to an operation",
  conflicting_specification: 'Specifications disagree',
  no_approval_clock: 'Quote not accepted yet',
  no_assignment: 'No technician assigned',
  no_schedule_window: 'No schedule set',
  no_start_clock: 'No start date',
  no_operation_record: 'No work logged',
  no_status_history: 'No status history',
  no_payment_record: 'No payment recorded',
  no_payout_record: 'No payout recorded',
  change_order_pending: 'A change order is waiting for acceptance',
  provider_acceptance_withheld: 'A provider acceptance is on hold',
  no_provider_completion_attestation: "Technician hasn't marked it done",
  no_customer_completion_acceptance: "Customer hasn't confirmed it's done",
  completion_attestation_withheld_scope_changed: 'The work changed since it was marked done',
  no_invoice: 'No invoice yet',
  invoice_balance_open: 'Invoice not fully paid',
  payment_reported_by_payer_unconfirmed: "A reported payment isn't confirmed yet",
};

const CONFLICTS: Record<string, string> = {
  assignment_accepted_status_without_clock: 'Marked accepted, but no acceptance date',
  assignment_completed_status_without_clock: 'Assignment marked complete, but no completion date',
  done_status_without_completion_clock: 'Marked done, but no completion date',
  paid_status_without_payment_record: 'Marked paid, but no payment recorded',
  payments_without_vehicle: 'Payments recorded without a vehicle',
};

const WITHHELD_REASONS: Record<string, string> = {
  acceptance_source_withdrawn: 'the acceptance was withdrawn',
  quote_source_withdrawn: 'the quote was withdrawn',
  quote_superseded: 'a newer quote replaced the accepted one',
  signer_no_longer_customer: 'the person who accepted is no longer the customer',
  scope_changed_since_quote: 'the work changed since the quote',
};

export function acceptanceOnHold(reason: string | null): string {
  if (!reason) return 'Acceptance on hold';
  return 'Acceptance on hold: ' + (WITHHELD_REASONS[reason] ?? sentence(reason).toLowerCase());
}

export function gapText(code: string): string {
  if (code.startsWith('acceptance_withheld_')) return acceptanceOnHold(code.slice('acceptance_withheld_'.length));
  return GAPS[code] ?? sentence(code);
}

export const conflictText = (code: string): string => CONFLICTS[code] ?? sentence(code);

const FACTS: Record<string, string> = {
  vehicle_bound: 'Vehicle attached',
  scope_stated: 'Work described',
  created_at: 'Requested',
  inspection_requirements: 'Inspections requested',
  inspection_jobs: 'Inspection jobs',
  inspection_jobs_with_findings: 'Inspections with findings',
  findings_clock: 'Findings recorded',
  with_performer_candidate: 'Inspections with a candidate inspector',
  operations: 'Operations',
  operations_with_requirements: 'Operations with requirements',
  requirements: 'Requirements',
  requirements_with_candidates: 'Requirements with a candidate',
  requirements_with_offers: 'Requirements with offers',
  requirements_with_accepted_provider: 'Requirements with an accepted provider',
  specifications: 'Specifications',
  conflicting_specifications: 'Specifications that disagree',
  parts: 'Parts',
  parts_with_operation_code: 'Parts tied to an operation',
  parts_by_status: 'Parts by status',
  labor_rows: 'Labor lines',
  labor_rows_with_hours: 'Labor lines with hours',
  labor_rows_ai_estimated: 'Labor lines estimated automatically',
  operations_from_scope_text: 'Operations read from the job description',
  operations_pending: 'Operations not started',
  executable: 'Ready to start',
  quote_clock: 'Quoted',
  estimate_recorded: 'Estimate on record',
  approval_clock: 'Quote accepted',
  quote_versions: 'Quote versions',
  accepted_providers: 'Providers accepted',
  approval_signer: 'Accepted by',
  schedule_window_recorded: 'Schedule set',
  assignments: 'Technicians assigned',
  assignments_by_status: 'Assignments by status',
  assignments_with_accept_clock: 'Assignments accepted (dated)',
  provider_acceptance_clock: 'Provider accepted',
  provider_acceptances_withheld: 'Provider acceptances on hold',
  customer_acceptance: 'Customer acceptance',
  start_clock: 'Work started',
  component_events: 'Operations logged',
  operations_complete_status: 'Operations marked complete',
  assignments_started: 'Assignments started',
  measured_usage: 'Measured usage',
  status: 'Status',
  completion_clock: 'Completed',
  status_history_rows: 'Status changes on record',
  attestations_withheld: 'Done marks on hold',
  acceptances_withheld: 'Confirmations on hold',
  labor_value_calculated: 'Labor value calculated',
  cost_allocated: 'Cost allocated',
  disbursement: 'Paid out',
};

/** Reader bookkeeping that means nothing to a person, or that carries ids or hashes: never shown. */
const HIDDEN_FACTS = new Set(['source_scope', 'current_quote', 'quote_clock_basis', 'approval_clock_basis', 'stored_approval_clock',
  'visibility', 'basis', 'provider_attestation', 'customer_acceptance_sign', 'scope_basis', 'state_basis', 'invoice',
  'reconciliation', 'release', 'retained_testimony', 'attached_evidence', 'start_sign', 'change_order', 'seller_permission',
  'inspection_job_role', 'request_source']);

/** Personal contact fields. Never rendered: contact happens through a platform request. */
export function isContactKey(key: string): boolean {
  const k = key.toLowerCase();
  return ['email', 'phone', 'address', 'contact', 'legal_name', 'full_name', 'first_name', 'last_name'].some(t => k.includes(t));
}

/** Money actually moved or owed between parties. Prices, rates and costs are open; these are not. */
export function isPaymentKey(key: string): boolean {
  const k = key.toLowerCase();
  return ['amount_paid', 'paid_amount', 'payment_amount', 'payout_amount', 'balance', 'owed', 'refund', 'amount_received',
    'deposit_paid', 'payments_total', 'confirmed_received', 'payer_reported', 'overpaid'].some(t => k.includes(t));
}

/** A uuid or a content hash: never primary text. */
export function isIdentifier(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^[0-9a-f]{40,64}$/.test(s);
}

/** "Oct 19, 2026" for a clock; null when it does not parse. */
export function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A reader value in plain words. Ids and hashes read "On record"; clocks read as days. */
export function plainValue(v: Json | undefined): string {
  if (v === null || v === undefined) return 'Not on record';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (typeof v === 'string') {
    if (v === 'not_assessed') return 'Not assessed yet';
    if (v === 'not_established') return 'Not established yet';
    if (v === 'not_performed') return 'Not yet';
    if (isIdentifier(v)) return 'On record';
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && day(v)) return day(v) as string;
    return v.includes('_') ? sentence(v) : v;
  }
  if (Array.isArray(v)) return v.length === 0 ? 'None' : v.map(plainValue).join(', ');
  const keys = Object.keys(v).sort().filter(k => !k.endsWith('_id') && !k.endsWith('_hash') && k !== 'basis' && !isContactKey(k) && !isPaymentKey(k));
  if (keys.length === 0) return 'None';
  return keys.map(k => `${sentence(k).toLowerCase()} ${plainValue(v[k])}`).join(' · ');
}

function factValue(key: string, v: Json): string {
  if (key === 'approval_signer') {
    const o = obj(v);
    if (!o) return 'Not accepted yet';
    const role = str(o.role) ? slotWord(o.role as string) : 'customer';
    return o.basis === 'authenticated_sign' ? `The ${role}, signed through Nuke` : `The ${role}`;
  }
  if (key === 'customer_acceptance') {
    if (v === 'signed' || v === 'established') return 'Signed';
    if (v === 'withheld') return 'On hold';
  }
  return plainValue(v);
}

/** A stage's facts a person can read: curated keys first, then the rest; no ids, hashes, contact or payment keys. */
export function stageFacts(stage: Stage): Array<{ key: string; label: string; value: string }> {
  return Object.keys(stage.raw)
    .filter(k => !['state', 'gaps', 'inconsistencies'].includes(k) && !HIDDEN_FACTS.has(k)
      && !k.endsWith('_id') && !k.endsWith('_hash') && !isContactKey(k) && !isPaymentKey(k))
    .sort((a, b) => Number(!(a in FACTS)) - Number(!(b in FACTS)) || a.localeCompare(b))
    .map(k => ({ key: k, label: FACTS[k] ?? sentence(k), value: factValue(k, stage.raw[k]) }));
}

const SLOTS: Record<string, string> = {
  customer: 'customer', org_owner: 'shop owner', shop_owner: 'shop owner', vehicle_access: 'has access to this vehicle',
  admin: 'Nuke admin', performer: 'technician', inspector: 'inspector', tool_supplier: 'tool supplier', facility: 'shop',
  co_signer: 'co-signer', cosigner: 'co-signer',
};
export const slotWord = (s: string): string => SLOTS[s] ?? sentence(s).toLowerCase();

export function viewingAs(viewer: Viewer | null): string {
  if (viewer && viewer.slots.length > 0) return viewer.slots.map(slotWord).join(' · ');
  switch (viewer?.context) {
    case 'client': return 'customer';
    case 'provider': return 'provider';
    case 'org_member': return 'shop member';
    case 'admin': return 'Nuke admin';
    case 'self': return 'you';
    default: return 'visitor';
  }
}

// MARK: - People and vehicles

/** "@handle", an organization's name, "You", or "Unnamed party". A private person's name is never read. */
export function personLabel(p: unknown): string {
  const o = obj(p);
  if (!o) return 'Unnamed party';
  if (o.kind === 'you') return 'You';
  const handle = str(o.handle);
  if (handle) return '@' + handle;
  const name = str(o.name);
  if (o.kind === 'organization' && name) return name;
  return 'Unnamed party';
}

/** The provider page a person can be opened at; only public handles have one. */
export function personHref(p: unknown): string | null {
  const handle = str(obj(p)?.handle);
  return handle ? `/providers/${encodeURIComponent(handle)}` : null;
}

/** "1984 Chevrolet K10 SWB Scottsdale"; null when nothing names the vehicle. */
export function vehicleText(label: unknown): string | null {
  const o = obj(label);
  if (!o) return null;
  const text = str(o.text);
  if (text && !text.includes('UNRESOLVED')) return text;
  const parts = [o.year, o.make, o.model, o.trim].map(v => (typeof v === 'number' ? String(v) : str(v)))
    .filter((s): s is string => !!s && s !== 'UNRESOLVED');
  return parts.length ? parts.join(' ') : null;
}

// MARK: - Viewer and actions (decided by the server from auth.uid(); never inferred here)

export type JobAction = {
  kind: string;
  rpc: string | null;
  args: JsonObject;
  binds: string[];
  doesNotBind: string[];
  termsBasis: string | null;
  label: string | null;
  /** The whole action object, for hints a step carries beyond rpc and args (vocabularies, acting_for, facilities). */
  raw: JsonObject;
};

export type Viewer = { context: string; slots: string[]; moneyVisible: boolean; party: boolean; actions: JobAction[]; issuerActions: JobAction[] };

export function parseAction(raw: unknown): JobAction | null {
  if (typeof raw === 'string') return { kind: raw, rpc: null, args: {}, binds: [], doesNotBind: [], termsBasis: null, label: null, raw: {} };
  const o = obj(raw);
  const kind = str(o?.action) ?? str(o?.kind);
  if (!o || !kind) return null;
  const binds = typeof o.binds === 'string' ? [o.binds] : strings(o.binds);
  return { kind, rpc: str(o.rpc), args: obj(o.args) ?? {}, binds, doesNotBind: strings(o.does_not_bind),
    termsBasis: str(o.terms_basis), label: str(o.label), raw: o };
}

export const parseActions = (raw: unknown): JobAction[] => arr(raw).map(parseAction).filter((a): a is JobAction => a !== null);

export function parseViewer(raw: unknown): Viewer | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    context: str(o.context) ?? 'visitor',
    slots: strings(o.slots),
    moneyVisible: o.money_visible === true,
    party: o.party === true,
    actions: parseActions(o.actions),
    issuerActions: parseActions(o.issuer_actions),
  };
}

/**
 * Signs the web can take: each passes back only the writer and arguments the server named, so the page composes
 * nothing. Steps that need the signer's own input (a quote, an offer, findings, a payment report) stay in the app.
 */
const WEB_SIGNS: Record<string, string> = {
  start_work: 'start_work',
  accept_quote: 'accept_work_order_quote',
  accept_offer: 'accept_offer',
  withdraw_offer: 'withdraw_offer',
  cancel_facility_reservation: 'cancel_facility_reservation',
  withdraw_vouch: 'withdraw_vouch',
};

export const isWebSign = (a: JobAction): boolean => !!a.rpc && WEB_SIGNS[a.kind] === a.rpc;

const ACTION_TITLES: Record<string, string> = {
  start_work: 'Start work', accept_quote: 'Accept quote', accept_offer: 'Accept offer', withdraw_offer: 'Withdraw your offer',
  cancel_facility_reservation: 'Cancel your booking request', withdraw_vouch: 'Withdraw your vouch', reserve_facility: 'Book a bay', pay_invoice: 'Pay invoice',
  issue_quote: 'Issue a quote', issue_change_order: 'Issue a change order', offer: 'Make an offer', cosign_provider: 'Co-sign this technician',
  record_findings: 'Record inspection findings', grant_inspection_access: 'Let an inspector see your car',
  attach_evidence: 'Attach photos to this job', issue_invoice: 'Issue an invoice', record_payment: 'Record a payment',
  attest_completion: 'Mark the work done', accept_completion: 'Confirm the work is done',
};

export const actionTitle = (a: JobAction): string => a.label ?? ACTION_TITLES[a.kind] ?? sentence(a.kind);

const SAYS: Record<string, string[]> = {
  start_work: ['You started this work under the accepted terms, pinned by their hash.'],
  accept_quote: ['You accept this exact quote version, pinned by its hash.'],
  accept_offer: ['This provider does this work on exactly these terms, including their current co-signs, pinned by hash.'],
  withdraw_offer: ['Your offer is withdrawn. The record that you offered stays.'],
  cancel_facility_reservation: ['You cancel your booking request for this window.'],
  withdraw_vouch: ['Your vouch stops showing. The record that you vouched stays.'],
  issue_quote: ['You offer to do this work at these prices, for this job.', 'The customer must accept it before anything is booked or paid.'],
  issue_change_order: ['The work changes as listed, for the reason you give.'],
  attest_completion: ['You say the work is done, against the accepted quote or the job as described now.'],
  accept_completion: ['You confirm the technician finished this work, as they marked it.'],
  issue_invoice: ['You bill the customer for these lines on this job.'],
  record_payment: ['You state that this payment was made, as you describe it.'],
  cosign_provider: ['You vouch for this technician within the scope you write.'],
  reserve_facility: ['You ask the shop for this space in this window.'],
  confirm_booking: ['You confirm the space for this window; it now holds capacity.'],
  vouch: ['You vouch for this person within the scope you write.'],
  record_findings: ['Your findings as the accepted inspector, item by item against the checklist.'],
  attach_evidence: ['These photos of yours document this job.'],
};
const DOES_NOT_SAY: Record<string, string[]> = {
  start_work: ['completion', 'schedule', 'payment'],
  accept_quote: ['deposit', 'payment', 'completion'],
  accept_offer: ['payment', 'completion', 'other requirements'],
  withdraw_offer: ['anything about other offers'],
  cancel_facility_reservation: ['payment'],
  withdraw_vouch: ['anything about their work'],
  issue_quote: ['that the work is booked', 'payment (a deposit here is only requested)', 'that this is final (a new version replaces it)'],
  issue_change_order: ['that the customer agrees (they accept it like a quote)', 'payment', 'that the earlier acceptance still covers the job'],
  attest_completion: ['that the customer agrees', 'payment', 'an invoice'],
  accept_completion: ['payment', 'release of money to anyone'],
  issue_invoice: ['that anything was paid', 'collection'],
  record_payment: ['that money moved through Nuke', 'refund or release'],
  cosign_provider: ['skill proof (a co-sign is not skill evidence)', 'payment until the customer accepts the offer'],
  reserve_facility: ['payment', 'vehicle access', 'the shop’s confirmation'],
  confirm_booking: ['payment', 'vehicle access'],
  vouch: ['skill proof (a vouch is not skill evidence)', 'any job, payment or booking'],
  record_findings: ['a price', 'approval of the work', "the seller's permission"],
  attach_evidence: ['who can see the photos or who owns them', 'completion', 'payment'],
};
const NOT_SAY_WORDS: Record<string, string> = {
  completion: 'That the work is done',
  schedule: 'A schedule',
  payment: 'Any payment',
  deposit: 'That a deposit was paid',
  disbursement: 'Paying anyone out',
  'money movement': 'That any money moved',
  'counterparty acceptance': 'That the customer agreed',
  'labor value': 'A price for the labor',
  'other requirements': 'Anything about the job’s other requirements',
  status: 'A change of status',
};

/** What signing says and does not say: the server's words when it states them, otherwise the writer's documented terms. */
export function signTerms(a: JobAction): { says: string[]; doesNotSay: string[] } {
  const says = (a.binds.length ? a.binds : SAYS[a.kind] ?? []).map(s => s.charAt(0).toUpperCase() + s.slice(1));
  const doesNotSay = (a.doesNotBind.length ? a.doesNotBind : DOES_NOT_SAY[a.kind] ?? [])
    .map(s => NOT_SAY_WORDS[s] ?? s.charAt(0).toUpperCase() + s.slice(1));
  return { says, doesNotSay: [...doesNotSay, 'No money moves'] };
}

// MARK: - Money (open prices; party money only when the server opened it)

export function money(amount: number | null, currency: string | null | undefined): string {
  if (amount === null) return 'Not priced';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-US')} ${currency ?? ''}`.trim();
  }
}

/** Payments and balances render only for a party the server opened money for, and only when it sent them. */
export const paymentsVisible = (viewer: Viewer | null, payments: unknown): boolean =>
  viewer?.moneyVisible === true && Array.isArray(payments);

// MARK: - Quotes

export type QuoteLine = { refKind: string | null; description: string | null; withheld: boolean; basis: string | null;
  amount: number | null; currency: string | null; unit: string | null; quantity: number | null };

export function parseLine(raw: unknown): QuoteLine {
  const o = obj(raw) ?? {};
  return {
    refKind: str(o.ref_kind),
    description: str(o.description),
    withheld: o.description_visibility === 'withheld_personal_info',
    basis: str(o.pricing_basis),
    amount: num(o.amount),
    currency: str(o.currency),
    unit: str(o.unit),
    quantity: num(o.quantity),
  };
}

/** "$160.00 / hour × 3", "$450.00", "Not priced". */
export function linePrice(l: QuoteLine): string {
  if (l.amount === null) return 'Not priced';
  const m = money(l.amount, l.currency);
  const per = ({ hourly: 'hour', day_rate: 'day', per_operation: 'operation' } as Record<string, string>)[l.basis ?? ''] ?? l.unit;
  if (!per || l.basis === 'flat') return m;
  return l.quantity !== null ? `${m} / ${per} × ${l.quantity}` : `${m} / ${per}`;
}

export function lineLabel(l: QuoteLine): string {
  if (l.description) return l.description;
  if (l.withheld) return 'Line (details hidden to protect a name)';
  return l.refKind ? sentence(l.refKind) : 'Line';
}

const RELEASE: Record<string, string> = {
  customer_completion_sign: 'the customer confirms the work is done',
  inspector_attestation: 'an inspector signs off on the work',
  installed_parts_witness: 'the installed parts are witnessed',
  photos_in_window: 'photos are taken in the job window',
};

export function releaseCondition(raw: unknown): string | null {
  const kind = typeof raw === 'string' ? raw : str(obj(raw)?.kind);
  if (!kind) return null;
  if (kind === 'days_signed') {
    const d = num(obj(raw)?.days) ?? 0;
    return d === 1 ? '1 day has passed since the work was signed off' : `${d} days have passed since the work was signed off`;
  }
  return RELEASE[kind] ?? sentence(kind).toLowerCase();
}

export function acceptanceText(a: JsonObject | null): string {
  switch (a?.state) {
    case 'accepted': {
      const who = a.accepted_by_viewer === true ? 'you' : 'the customer';
      const when = day(str(a.signed_at));
      return `Accepted by ${who}${when ? ` · ${when}` : ''}`;
    }
    case 'withheld': return acceptanceOnHold(str(a.withheld_reason));
    default: return 'Not accepted yet';
  }
}

// MARK: - Failures, explained

/** Why a read failed, in words a person can act on. */
export function readFailure(error: unknown): string {
  const e = obj(error);
  const message = String(e?.message ?? error ?? '');
  const code = String(e?.code ?? '');
  if (/unavailable/i.test(message) || code === '42501') return "This isn't public, or it doesn't exist.";
  if (code === '57014' || /timeout|timed out/i.test(message)) return 'The record took too long to load. Try again.';
  if (code === 'PGRST202' || /could not find the function/i.test(message)) return 'This reader is not deployed yet.';
  if (/fetch|network/i.test(message)) return "Couldn't reach Nuke. Check the connection and try again.";
  return message ? `The read failed: ${message}` : 'The read failed.';
}

/** Why a Sign was refused, in words a person can act on. */
export function signFailure(error: unknown): string {
  const message = String(obj(error)?.message ?? error ?? '');
  if (/hash does not match|changed since/i.test(message)) return 'This changed since you opened it. Reload the job and review it again.';
  if (/authentication required/i.test(message)) return 'Sign in to do this.';
  if (/not_customer|only the customer/i.test(message)) return 'Only the customer on this job can do this.';
  if (/offer_window_closed/i.test(message)) return 'Their availability window has passed.';
  if (/work_order_concluded/i.test(message)) return 'This job is closed.';
  return message ? `Nuke refused this: ${message}` : 'Nuke refused this.';
}
