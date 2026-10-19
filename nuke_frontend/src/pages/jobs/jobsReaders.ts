// The job loop's readers and Signs, as the database returns them, and the plain words a page says
// about them. Shapes were read from the live function bodies (pg_get_functiondef, 2026-10-19):
// open_requirements_read, work_order_offers_read, offer_on_requirement, request_contact,
// listing_work_plan_read, request_inspection, vehicle_work_orders_read, post_work_request,
// my_signature_queue, my_work_orders. Nothing here computes a number the server can state.
import { supabase } from '../../lib/supabase';

export type VehicleLabel = { year?: number | null; make?: string | null; model?: string | null; trim?: string | null; text?: string | null } | null;

export type JobViewer = {
  context?: string;
  slots?: string[];
  money_visible?: boolean;
  contact_visible?: boolean;
  identity_bridge?: string;
  party?: boolean;
  actions?: JobAction[];
};

export type JobAction = { action: string; rpc?: string; args?: Record<string, unknown>; as?: Record<string, unknown> | null };

export type MatchInput = { input: string; result: 'pass' | 'fail' | 'unknown' | string; reason?: string | null; next?: string | null };

export type OpenRequirement = {
  requirement_id: string;
  requirement_kind: string;
  description?: string | null;
  work_order_id: string;
  work_order_status?: string | null;
  display_title?: string | null;
  vehicle_label?: VehicleLabel;
  request_source_label?: string | null;
  area_band?: { city?: string | null; state?: string | null; basis?: string } | null;
  window?: { available_from?: string | null; available_until?: string | null; basis?: string } | null;
  candidates_listed?: number;
  quote_state?: { has_current_quote?: boolean; quote_versions?: number | null; acceptance?: string | null };
  match?: MatchInput[] | null;
};

export type OpenRequirementsRead = {
  viewer: JobViewer;
  as_of: string;
  rows: OpenRequirement[];
  next_after: string | null;
  match_basis?: string;
  coverage: { returned: number; total_open: number; rule?: string; not_assessed?: string[] };
  contact?: { action: string; available: boolean };
};

export type OffersRead = { work_order_id: string; viewer: JobViewer };

export type SignQueueItem = {
  kind: string;
  ref_id: string;
  work_order_id?: string | null;
  display_title?: string | null;
  vehicle_label?: VehicleLabel;
  clock?: Record<string, string | null>;
  summary?: Record<string, unknown>;
  sign?: { rpc?: string; binds?: string[] | string; does_not_bind?: string[] };
};

export type SignQueueRead = {
  as_of: string;
  items: SignQueueItem[];
  coverage: { returned: number; total: number; kinds_not_yet_available?: string[] };
};

export type WorkOrderRow = {
  work_order_id: string;
  title?: string | null;
  display_title?: string | null;
  vehicle_label?: VehicleLabel;
  slots?: string[];
  money_visible?: boolean;
  stage_states?: Record<string, string>;
  first_gap?: { stage: string; gap: string | null } | null;
  request_source_label?: string | null;
};

export type MyWorkOrdersRead = {
  as_of: string;
  rows: WorkOrderRow[];
  next_after: string | null;
  coverage: { returned: number; total_for_viewer: number };
};

export type VehicleAccess = {
  role: string;
  can_post_work_request: boolean;
  can_request_inspection: boolean;
  post_work_request_reason: string | null;
  request_inspection_reason: string | null;
};

export type VehicleWorkOrdersRead = {
  as_of: string;
  vehicle_id: string;
  vehicle_label?: VehicleLabel;
  viewer: JobViewer & { vehicle_access?: VehicleAccess };
  rows: WorkOrderRow[];
  coverage: { returned: number; total_for_vehicle: number };
};

export type PlanField = { status: string; values?: Array<{ source: string; raw?: unknown; value?: unknown; field_path?: string }> };

export type PlanClaim = {
  claim_id: string;
  kind: string;
  text: string;
  verbatim_excerpt?: { quote: string } | null;
  excerpt_status?: string;
  source?: { source_url?: string | null; table?: string; method?: string };
  clocks?: { event_at?: string | null; recorded_at?: string | null };
  confidence?: { value?: number | null; basis?: string };
};

export type PlanTarget = {
  code?: string | null;
  name?: string | null;
  state?: string;
  hours?: { min?: number | null; typical?: number | null; max?: number | null } | null;
  label?: string;
};

export type PlanOperation = { operation_id: string; keyword_entry_id?: string | null; system?: string | null; targets: PlanTarget[] };

export type PlanPart = {
  term: string;
  state?: string;
  fitment?: string;
  rows: Array<{ catalog_part_id?: string; part_number?: string | null; name?: string | null; price_current?: number | null; currency?: string | null; manufacturer?: string | null }>;
};

export type PlanChecklistItem = { item_id: string; question: string; order?: number; finding?: { system?: string | null } | null };

export type WorkPlan = {
  as_of: string;
  vehicle_id: string;
  record_label?: string | null;
  listing_url?: string | null;
  vehicle_label?: VehicleLabel;
  identity: { fields: Record<string, PlanField>; conflicts: string[]; unresolved_specificity: string[]; vin_decode?: { state?: string } };
  claims: PlanClaim[];
  candidate_operations: PlanOperation[];
  parts: PlanPart[];
  ppi_checklist: PlanChecklistItem[];
  inspection_scope: Record<string, unknown> & { ppi_checklist?: unknown[] };
  operation_coverage?: { eligible_claims?: number; matched_claims?: number };
  counts?: { claims?: number; ppi_items?: number };
  model_calls?: number;
  database_writes?: number;
};

export type PostedJob = {
  work_order_id: string;
  duplicate?: boolean;
  visibility?: string;
  listed_in_open_requirements?: boolean;
  listing_basis?: string;
  needed_by?: string | null;
  operations?: Array<{ line_number: number; text: string }>;
  requirements?: Array<{ requirement_id: string; kind: string; description: string }>;
  intake_evidence?: { image_count?: number } | null;
  suggested_cost?: {
    lines?: Array<{ line_number: number; text?: string | null; hours?: { low?: number | null; high?: number | null } | null; state?: string }>;
    total?: { lines_estimated?: number; lines?: number } | null;
  } | null;
};

export type Refusal = { message: string; code?: string };

type RpcResult<T> = { data: T; refusal: null } | { data: null; refusal: Refusal };

async function call<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, refusal: { message: refusalText(error), code: error.code } };
  return { data: data as T, refusal: null };
}

/** The server's own words for a refusal (its RAISE messages are written for people), or a plain fallback. */
export function refusalText(error: { message?: string; code?: string } | null | undefined): string {
  const m = (error?.message ?? '').trim();
  if (error?.code === '42501' && /sign-in|authentication/i.test(m)) return 'Sign in first.';
  if (m && m.length <= 240 && !/\b(relation|column|function|syntax|violates)\b/i.test(m)) return m;
  return 'Nuke could not do that right now.';
}

export const JobReaders = {
  openRequirements: (after: string | null) => call<OpenRequirementsRead>('open_requirements_read', { p_after: after, p_limit: 25, p_kind: null }),
  offers: (workOrderId: string) => call<OffersRead>('work_order_offers_read', { p_work_order_id: workOrderId }),
  plan: (vehicleId: string) => call<WorkPlan>('listing_work_plan_read', { p_vehicle_id: vehicleId }),
  vehicleWorkOrders: (vehicleId: string) => call<VehicleWorkOrdersRead>('vehicle_work_orders_read', { p_vehicle_id: vehicleId, p_after: null, p_limit: 25 }),
  signatureQueue: () => call<SignQueueRead>('my_signature_queue', {}),
  myWorkOrders: (after: string | null) => call<MyWorkOrdersRead>('my_work_orders', { p_slot: null, p_after: after, p_limit: 25 }),
};

export const JobSigns = {
  offer: (args: OfferArgs) => call<{ offer_id: string; duplicate: boolean }>('offer_on_requirement', args),
  contact: (requirementId: string, message: string) =>
    call<{ request_id: string }>('request_contact', { p_context_kind: 'requirement', p_context_id: requirementId, p_message: message }),
  requestInspection: (vehicleId: string, scope: Record<string, unknown>) =>
    call<{ work_order_id: string; duplicate: boolean; checklist_items: number }>('request_inspection',
      { p_vehicle_id: vehicleId, p_parent_work_order_id: null, p_scope: { ...scope, request_source: 'web' } }),
  postWorkRequest: (args: PostArgs) => call<PostedJob>('post_work_request', args),
};

// ── Plain words ────────────────────────────────────────────────────────────

export const jobHref = (workOrderId: string) => `/jobs/${encodeURIComponent(workOrderId)}`;

export function vehicleText(v: VehicleLabel | undefined): string | null {
  if (!v) return null;
  return v.text || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || null;
}

export function requirementKind(k: string): string {
  switch (k) {
    case 'skill': return 'Skill';
    case 'inspection': return 'Inspection';
    case 'tool': return 'Tool';
    case 'equipment': return 'Equipment';
    case 'facility': return 'Shop space';
    case 'approval': return 'Approval';
    default: return sentence(k);
  }
}

export function sentence(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "2 open requests on Nuke right now" — the reader's own total, not the page. */
export function openRequestsSentence(totalOpen: number): string {
  if (totalOpen <= 0) return 'No open requests on Nuke right now';
  return `${totalOpen.toLocaleString('en-US')} open request${totalOpen === 1 ? '' : 's'} on Nuke right now`;
}

export function areaText(a: OpenRequirement['area_band']): string | null {
  if (!a) return null;
  return [a.city, a.state].filter(Boolean).join(', ') || null;
}

export function windowText(w: OpenRequirement['window']): string | null {
  const from = day(w?.available_from);
  const until = day(w?.available_until);
  if (from && until) return `${from} – ${until}`;
  return from ? `from ${from}` : until ? `until ${until}` : null;
}

export function quoteText(q: OpenRequirement['quote_state']): string {
  if (!q?.has_current_quote) return 'No quote yet';
  return q.acceptance === 'accepted' ? 'Quote accepted' : 'Quoted, not accepted yet';
}

export function matchInputLabel(i: string): string {
  switch (i) {
    case 'skill': return 'Skill';
    case 'tools': return 'Tools';
    case 'facility': return 'Shop space';
    case 'area': return 'Area';
    case 'availability': return 'Availability';
    case 'evidence_rung': return 'Technician profile';
    default: return sentence(i);
  }
}

/** One match input in plain words, from the reader's own reason. A missing input is never a rejection. */
export function matchReason(m: MatchInput): string {
  const r = m.reason ?? '';
  if (r.startsWith('not required for a')) return 'Not needed for this';
  switch (m.input) {
    case 'skill': {
      const named = /capability (.+) is named in the requirement/.exec(r);
      if (m.result === 'pass' && named) return `Your record shows ${named[1].replace(/_/g, ' ')}`;
      return r.includes('do not name') ? "Your record doesn't show this skill yet" : 'Not shown in your record yet';
    }
    case 'tools': {
      const named = /requirement: (.+?)( \(claimed|$)/.exec(r);
      if (m.result === 'pass' && named) return `You said you own: ${named[1]}`;
      return r.includes('no claimed tool records') ? 'No tools in your records' : 'No matching tool in your records';
    }
    case 'facility':
      if (m.result === 'pass') return 'Shop space is free in the window';
      return m.result === 'fail' ? 'Shop space is booked in the window' : 'No shop space found for this job';
    case 'area':
      if (m.result === 'pass') return r.includes('city') ? 'Same city' : 'Same state';
      if (r.includes('job area not public')) return "The job's area isn't public";
      if (r.includes('states no area')) return "Your profile doesn't list an area";
      return 'Different state';
    case 'availability':
      return "You haven't set availability yet";
    case 'evidence_rung':
      if (m.result === 'pass') return 'Linked and backed by your work';
      if (m.result === 'unknown') return 'Linked by you, not yet backed by work';
      return 'Not linked yet';
    default:
      return sentence(r);
  }
}

export function matchNext(n: string | null | undefined): string | null {
  switch (n) {
    case 'plan_b_supplier_needed': return 'needs a backup supplier';
    case 'claim_provider_link': return 'link your technician profile';
    case null: case undefined: case '': return null;
    default: return sentence(n).toLowerCase();
  }
}

export function matchMark(result: string): string {
  return result === 'pass' ? '✓' : result === 'fail' ? '–' : '?';
}

export function matchResultWord(result: string): string {
  return result === 'pass' ? 'yes' : result === 'fail' ? 'not yet' : 'unknown';
}

export function yourRung(r: unknown): string {
  switch (r) {
    case 'work_evidence': return 'Backed by your work';
    case 'co_sign': return 'Vouched for by someone you worked with';
    case 'authenticated_sign': return 'Signed';
    case 'organization_owner': return 'Shop owner';
    default: return 'Linked by you, not yet backed by work';
  }
}

export const SIGN_KIND_TITLE: Record<string, string> = {
  quote_to_accept: 'Quote to accept',
  change_order_to_accept: 'Change order to accept',
  offer_to_accept: 'Offer to accept',
  completion_to_accept: 'Completion to confirm',
  invoice_payment_to_confirm: 'Payment to confirm',
  inspection_access_request: 'Inspection permission',
  contact_request: 'Contact request',
  facility_reservation_to_confirm: 'Shop booking to confirm',
  work_session: 'Work day to confirm',
};

export const signKindTitle = (k: string) => SIGN_KIND_TITLE[k] ?? sentence(k);

export function binds(item: SignQueueItem): string[] {
  const b = item.sign?.binds;
  return Array.isArray(b) ? b : b ? [b] : [];
}

/**
 * A payment amount reaches the page only on the payee's own confirmation item, which the server marks
 * parties_only. Anything else that carries an amount is not a payment and is not rendered as one.
 */
export function paymentLine(item: SignQueueItem): string | null {
  if (item.kind !== 'invoice_payment_to_confirm') return null;
  const s = item.summary ?? {};
  if (s.visibility !== 'parties_only') return null;
  const amount = typeof s.amount === 'number' ? s.amount : null;
  const currency = typeof s.currency === 'string' ? s.currency : null;
  if (amount == null || !currency) return null;
  return `${money(amount, currency)} reported paid${typeof s.method === 'string' ? ` by ${s.method}` : ''}`;
}

/** Open prices on a quote (prices are open by doctrine; payments are not). */
export function quoteTotals(item: SignQueueItem): string | null {
  if (item.kind !== 'quote_to_accept' && item.kind !== 'change_order_to_accept') return null;
  const totals = item.summary?.totals_by_currency;
  if (!Array.isArray(totals) || totals.length === 0) return null;
  return (totals as Array<{ total: unknown; currency: unknown; complete?: boolean }>)
    .map(t => `${money(Number(t.total), String(t.currency))}${t.complete ? '' : ' (some lines unpriced)'}`).join(' + ');
}

export function money(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return 'unknown';
  try {
    return amount.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 });
  } catch {
    return `${amount.toLocaleString('en-US')} ${currency}`;
  }
}

export function slotWords(slot: string): string {
  switch (slot) {
    case 'customer': return 'You asked for this';
    case 'performer': return "You're doing this";
    case 'org_owner': return 'Your shop';
    case 'vehicle_access': return 'Your vehicle';
    case 'admin': return 'Admin view';
    default: return sentence(slot);
  }
}

export const STAGES = ['intake', 'inspection', 'plan', 'terms', 'execution', 'completion', 'accounting'] as const;

export function stageWord(stage: string): string {
  switch (stage) {
    case 'intake': return 'Request';
    case 'inspection': return 'Inspection';
    case 'plan': return 'Estimate';
    case 'terms': return 'Quote and acceptance';
    case 'execution': return 'Work';
    case 'completion': return 'Completion';
    case 'accounting': return 'Invoice and payment';
    default: return sentence(stage);
  }
}

export function stateWord(state: string | undefined): string {
  switch (state) {
    case 'recorded': return 'recorded';
    case 'partial': return 'partly recorded';
    case 'absent': return 'not recorded';
    case 'not_applicable': return 'not needed';
    case 'status_only': return 'status only';
    default: return state ? sentence(state).toLowerCase() : 'unknown';
  }
}

export function gapWord(gap: string): string {
  switch (gap) {
    case 'no_operations': return 'no operations listed yet';
    case 'no_approval_clock': return 'no acceptance recorded yet';
    case 'no_start_clock': return 'work start not recorded yet';
    case 'no_payment_record': return 'no payment recorded yet';
    case 'no_status_history': return 'no status history yet';
    case 'no_inspection_requirement': return 'no inspection requested';
    case 'no_schedule_window': return 'no schedule window yet';
    default: return sentence(gap).toLowerCase();
  }
}

// ── Listing plan words ─────────────────────────────────────────────────────

export const PLAN_HEADLINE = 'This is what checking this car would cover, not a restoration price.';
export const ROUGH_GUIDE = 'rough guide, not calibrated';
/** Shown instead of any labor rate: the plan states hours only until a technician quotes. */
export const NO_SHOP_RATE = "No shop rate on record yet — a technician's quote sets the price.";

export const IDENTITY_FIELDS = ['year', 'make', 'model', 'vin', 'engine_displacement_l', 'transmission', 'drivetrain', 'induction'] as const;

export function identityFieldLabel(f: string): string {
  switch (f) {
    case 'vin': return 'VIN';
    case 'engine_displacement_l': return 'Engine size';
    default: return sentence(f);
  }
}

export function identityStatusWord(s: string | undefined): string {
  switch (s) {
    case 'agree': return 'Sources agree';
    case 'single_source': return 'One source';
    case 'conflict': return 'Records disagree';
    case 'unresolved_specificity': return 'One source is more specific';
    default: return 'Not stated';
  }
}

export function identityValues(f: PlanField | undefined): string {
  const vals = f?.values ?? [];
  if (vals.length === 0) return 'not stated';
  return vals.map(v => `${sourceWord(v.source)}: ${String(v.raw ?? v.value)}`).join(' · ');
}

function sourceWord(s: string): string {
  switch (s) {
    case 'record': return 'Nuke record';
    case 'listing_text': return 'listing text';
    case 'listing_text_extraction': return 'listing extraction';
    case 'vin_decode': return 'VIN decode';
    default: return sentence(s).toLowerCase();
  }
}

export function claimKindWord(k: string): string {
  switch (k) {
    case 'listing_statement': return 'Listing statement';
    case 'defect_or_condition': return 'Condition or defect';
    case 'condition_summary': return 'Condition summary';
    case 'modification': return 'Modification';
    case 'reported_completed_work': return 'Work reported done';
    case 'document_or_title': return 'Documents or title';
    case 'odometer': return 'Odometer';
    default: return sentence(k);
  }
}

export function isExactQuote(c: PlanClaim): boolean {
  return c.excerpt_status === 'exact_excerpt_in_listing_text' && !!c.verbatim_excerpt?.quote;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; }
}

/** "quoted from bringatrailer.com · date not read · not scored" */
export function claimSourceLine(c: PlanClaim): string {
  const how = isExactQuote(c) ? 'quoted from' : 'paraphrased from';
  const host = hostOf(c.source?.source_url) ?? 'the listing';
  const when = day(c.clocks?.event_at ?? c.clocks?.recorded_at) ?? 'date not read';
  const conf = typeof c.confidence?.value === 'number' ? `confidence ${Math.round(c.confidence.value * 100)}%` : 'not scored';
  return `${how} ${host} · ${when} · ${conf}`;
}

const h = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** "2–6 h", "about 4 h" or "hours not stated". Hours only: never multiplied into a price. */
export function targetHours(t: PlanTarget): string {
  const lo = t.hours?.min, hi = t.hours?.max, typ = t.hours?.typical;
  if (typeof lo === 'number' && typeof hi === 'number') return lo === hi ? `about ${h(lo)} h` : `${h(lo)}–${h(hi)} h`;
  if (typeof typ === 'number') return `about ${h(typ)} h`;
  return 'hours not stated';
}

export function rangeHours(r: { low?: number | null; high?: number | null } | null | undefined): string | null {
  if (typeof r?.low !== 'number' || typeof r?.high !== 'number') return null;
  return r.low === r.high ? `about ${h(r.low)} h` : `about ${h(r.low)}–${h(r.high)} h`;
}

export function systemWord(s: string | null | undefined): string {
  switch (s) {
    case 'engine_bay': return 'Engine bay';
    case 'top_end': return 'Engine top end';
    case 'bottom_end': return 'Engine bottom end';
    case null: case undefined: case '': return 'General';
    default: return sentence(s);
  }
}

// ── Sign argument builders (pure; the page sends exactly these) ───────────

export type OfferLineDraft = { description: string; pricing_basis: string; amount: string; currency: string; quantity: string };

export type OfferArgs = {
  p_requirement_id: string;
  p_terms: { lines: Array<{ description: string; pricing_basis: string; amount: number; currency: string; unit: string | null; quantity: number | null }> };
  p_available_from: string | null;
  p_available_until: string | null;
  p_note: string | null;
};

export const PRICING_BASES: Array<{ key: string; title: string }> = [
  { key: 'flat', title: 'Flat price' },
  { key: 'hourly', title: 'Hourly' },
  { key: 'day_rate', title: 'Day rate' },
  { key: 'per_operation', title: 'Per operation' },
];

export function pricingUnit(basis: string): string | null {
  return basis === 'hourly' ? 'hour' : basis === 'day_rate' ? 'day' : basis === 'per_operation' ? 'operation' : null;
}

/** The offer body from the server's own offer action, or why it can't be sent yet. */
export function offerArgs(action: JobAction, lines: OfferLineDraft[], window: { from: string; until: string } | null, note: string, now = new Date()):
  { args: OfferArgs } | { error: string } {
  const rid = action.args?.p_requirement_id;
  if (action.action !== 'offer' || (action.rpc ?? 'offer_on_requirement') !== 'offer_on_requirement' || typeof rid !== 'string') {
    return { error: "This job isn't taking offers from your account." };
  }
  const out: OfferArgs['p_terms']['lines'] = [];
  for (const d of lines) {
    const desc = d.description.trim();
    if (desc.length < 1 || desc.length > 300 || desc.includes('\n')) return { error: 'Each line needs a short description.' };
    if (!PRICING_BASES.some(b => b.key === d.pricing_basis)) return { error: 'Pick how each line is priced.' };
    const amount = Number(d.amount.replace(/,/g, ''));
    if (d.amount.trim() === '' || !Number.isFinite(amount) || amount < 0) return { error: 'Each line needs an amount.' };
    const cur = d.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) return { error: 'Each line needs a three-letter currency, like USD.' };
    let qty: number | null = null;
    if (d.quantity.trim() !== '' && d.pricing_basis !== 'flat') {
      qty = Number(d.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return { error: 'Quantity must be more than zero.' };
    }
    out.push({ description: desc, pricing_basis: d.pricing_basis, amount, currency: cur, unit: pricingUnit(d.pricing_basis), quantity: qty });
  }
  if (out.length === 0 || out.length > 20) return { error: 'Add at least one priced line.' };
  let from: string | null = null, until: string | null = null;
  if (window) {
    const f = Date.parse(window.from), u = Date.parse(window.until);
    if (!Number.isFinite(f) || !Number.isFinite(u) || f >= u || u <= now.getTime()) return { error: 'Pick a window in the future that starts before it ends.' };
    from = new Date(f).toISOString(); until = new Date(u).toISOString();
  }
  const n = note.trim();
  if (n.length > 500 || n.includes('\n')) return { error: 'Keep the note to one line.' };
  return { args: { p_requirement_id: rid, p_terms: { lines: out }, p_available_from: from, p_available_until: until, p_note: n || null } };
}

/** The same pattern post_work_request refuses: an @ or a phone-shaped number. */
export const CONTACT_PATTERN = /(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})/;
export const hasContactDetails = (s: string) => CONTACT_PATTERN.test(s);

export type PostArgs = {
  p_vehicle_id: string;
  p_description: string;
  p_image_ids: null;
  p_requested_operations: null;
  p_needed_by: string | null;
  p_visibility: 'open' | 'invite_only';
};

export function postArgs(action: JobAction, description: string, neededBy: string | null, visibility: 'open' | 'invite_only', now = new Date()):
  { args: PostArgs } | { error: string } {
  const vid = action.args?.p_vehicle_id;
  if (action.action !== 'post_work_request' || typeof vid !== 'string') return { error: 'You can post a job only for a vehicle you own, added, or have access to.' };
  const d = description.trim();
  if (d.length < 1 || d.length > 4000) return { error: 'Describe the work (1 to 4,000 characters).' };
  if (hasContactDetails(d)) return { error: 'Take out phone numbers and emails. People reach you through Nuke.' };
  let needed: string | null = null;
  if (neededBy) {
    const t = Date.parse(neededBy);
    if (!Number.isFinite(t) || t <= now.getTime()) return { error: 'Pick a needed-by date in the future.' };
    needed = new Date(t).toISOString();
  }
  return { args: { p_vehicle_id: vid, p_description: d, p_image_ids: null, p_requested_operations: null, p_needed_by: needed, p_visibility: visibility } };
}
