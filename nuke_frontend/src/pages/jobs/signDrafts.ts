// Request bodies for the Signs that need the signer's own input, built from the server's action (its rpc, args
// and hints) plus what the person typed. Validated here the way the writers validate (their RAISE messages,
// 2026-10-19); the server checks everything again. Pure: the sheets send exactly what these return.
import { arr, num, obj, str, strings, type JobAction, type Json, type JsonObject } from './jobRead';

export type Built<A> = { ok: true; args: A } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const BASES: Array<{ key: string; title: string; unit: string | null; qty: string }> = [
  { key: 'flat', title: 'Flat', unit: null, qty: '' },
  { key: 'hourly', title: 'Hourly', unit: 'hour', qty: 'Hours' },
  { key: 'day_rate', title: 'Day rate', unit: 'day', qty: 'Days' },
  { key: 'per_operation', title: 'Per operation', unit: 'operation', qty: 'Operations' },
];
export const unitOf = (basis: string): string | null => BASES.find(b => b.key === basis)?.unit ?? null;

const numberOf = (s: string): number | null => {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const currencyOf = (s: string): string | null => {
  const c = s.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
};
const isoOf = (local: string): string | null => {
  if (!local) return null;
  const t = Date.parse(local);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The step is the one the server named, with the writer it named. */
const offered = (a: JobAction, kind: string, rpc: string) => a.kind === kind && (a.rpc ?? rpc) === rpc;

// MARK: - Quote scope (work_order_operations_read quote_refs)

export type ScopeItem = { refKind: string; refId: string; description: string; basis?: string; amount?: number | null; quantity?: number | null };

/** Every line choice with the server-given quote_ref; rows without one, or without words, are left out. */
export function quoteScope(ops: JsonObject | null): ScopeItem[] {
  const out: ScopeItem[] = [];
  const ref = (o: JsonObject | null) => obj(o?.quote_ref);
  for (const o of arr(ops?.operations).map(obj)) {
    const r = ref(o), d = str(o?.description);
    if (r && d && str(r.ref_kind) && str(r.ref_id)) out.push({ refKind: str(r.ref_kind)!, refId: str(r.ref_id)!, description: d });
    for (const q of arr(o?.requirements).map(obj)) {
      const rr = ref(q), dd = str(q?.description);
      if (rr && dd && str(rr.ref_id)) out.push({ refKind: str(rr.ref_kind) ?? 'requirement', refId: str(rr.ref_id)!, description: dd });
    }
  }
  for (const p of arr(ops?.parts).map(obj)) {
    const r = ref(p), d = str(p?.part_name);
    if (!r || !d || !str(r.ref_id)) continue;
    const unit = num(p?.unit_price), total = num(p?.total_price), qty = num(p?.quantity);
    const amount = p?.is_comped === true ? null : unit !== null ? unit * Math.max(qty ?? 1, 1) : total;
    out.push({ refKind: str(r.ref_kind) ?? 'part', refId: str(r.ref_id)!, description: d, basis: 'flat', amount });
  }
  for (const l of arr(ops?.labor).map(obj)) {
    const r = ref(l), d = str(l?.task_name);
    if (!r || !d || !str(r.ref_id)) continue;
    const hours = num(l?.hours);
    out.push({ refKind: str(r.ref_kind) ?? 'labor', refId: str(r.ref_id)!, description: d, basis: 'hourly',
      amount: l?.is_comped === true ? null : num(l?.hourly_rate), quantity: hours && hours > 0 ? hours : null });
  }
  return out;
}

// MARK: - Issue / revise quote

export type LineDraft = { included: boolean; refKind: string; refId: string | null; description: string; basis: string; amount: string; currency: string; quantity: string };

const plain = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** A revision starts from the current quote's lines; a first quote from the job's operations (other scope starts off). */
export function seedQuoteLines(scope: ScopeItem[], current: JsonObject | null): LineDraft[] {
  const lines = arr(current?.lines).map(obj).filter((o): o is JsonObject => !!o);
  if (lines.length) {
    return lines.map(l => {
      const kind = str(l.ref_kind) ?? 'fee';
      return { included: true, refKind: kind, refId: kind === 'fee' ? null : str(l.ref_id), description: str(l.description) ?? '',
        basis: str(l.pricing_basis) ?? 'flat', amount: plain(num(l.amount)), currency: str(l.currency) ?? 'USD', quantity: plain(num(l.quantity)) };
    });
  }
  const hasOps = scope.some(i => i.refKind === 'operation');
  const drafts = scope.map(i => ({ included: i.refKind === 'operation' || !hasOps, refKind: i.refKind, refId: i.refId, description: i.description,
    basis: i.basis ?? 'flat', amount: plain(i.amount), currency: 'USD', quantity: plain(i.quantity) }));
  return drafts.length ? drafts : [feeLine()];
}

export const feeLine = (): LineDraft => ({ included: true, refKind: 'fee', refId: null, description: '', basis: 'flat', amount: '', currency: 'USD', quantity: '' });

export type Condition = { kind: string; takesDays: boolean };

/** The release conditions the server allows on this action (release_conditions_vocabulary). */
export function releaseVocabulary(a: JobAction): Condition[] {
  return arr(a.raw.release_conditions_vocabulary).map((v): Condition | null => {
    if (typeof v === 'string') return { kind: v, takesDays: false };
    const o = obj(v);
    return str(o?.kind) ? { kind: str(o!.kind)!, takesDays: o!.days !== undefined } : null;
  }).filter((c): c is Condition => c !== null);
}

export type QuoteArgs = { p_work_order_id: string; p_lines: JsonObject[]; p_deposit: { amount: number; currency: string } | null;
  p_valid_until: string | null; p_supersedes_quote_id: string | null; p_release_conditions: JsonObject[] | null };

export function quoteArgs(a: JobAction, lines: LineDraft[], deposit: { amount: string; currency: string } | null, validUntil: string,
  conditions: string[], days: number, now = new Date()): Built<QuoteArgs> {
  const wo = str(a.args.p_work_order_id);
  if (!offered(a, 'issue_quote', 'issue_work_order_quote') || !wo) return fail("This job isn't open for a quote from your account.");
  const picked = lines.filter(l => l.included);
  if (picked.length < 1 || picked.length > 200) return fail('A quote has 1 to 200 lines.');
  const out: JsonObject[] = [];
  let priced = 0;
  for (const [i, l] of picked.entries()) {
    const n = i + 1, text = l.description.trim();
    if (text.length < 1 || text.length > 500 || text.includes('\n')) return fail(`Line ${n} needs a short description.`);
    if (!['operation', 'requirement', 'part', 'labor', 'fee'].includes(l.refKind) || (l.refKind === 'fee') !== (l.refId === null)) {
      return fail(`Line ${n} isn't tied to this job's work. Reload and try again.`);
    }
    if (!BASES.some(b => b.key === l.basis)) return fail(`Line ${n}: pick how it's priced.`);
    const o: JsonObject = { ref_kind: l.refKind, description: text, pricing_basis: l.basis };
    if (l.refId) o.ref_id = l.refId;
    if (unitOf(l.basis)) o.unit = unitOf(l.basis);
    if (l.amount.trim() !== '') {
      const amt = numberOf(l.amount);
      if (amt === null || amt < 0 || amt >= 10_000_000) return fail(`Line ${n}: enter the price as a number.`);
      const cur = currencyOf(l.currency);
      if (!cur) return fail(`Line ${n}: currency is a 3-letter code, like USD.`);
      o.amount = amt; o.currency = cur; priced += 1;
    }
    if (l.quantity.trim() !== '') {
      if (l.basis === 'flat') return fail(`Line ${n}: a flat price has no quantity.`);
      const q = numberOf(l.quantity);
      if (q === null || q <= 0) return fail(`Line ${n}: the quantity must be more than 0.`);
      o.quantity = q;
    }
    out.push(o);
  }
  if (priced === 0) return fail("Price at least one line — without prices it's an estimate, not a quote.");
  let dep: QuoteArgs['p_deposit'] = null;
  if (deposit) {
    const amt = numberOf(deposit.amount), cur = currencyOf(deposit.currency);
    if (amt === null || amt <= 0) return fail('Enter the deposit as a number.');
    if (!cur) return fail("The deposit's currency is a 3-letter code, like USD.");
    dep = { amount: amt, currency: cur };
  }
  const until = isoOf(validUntil);
  if (validUntil && (!until || Date.parse(until) <= now.getTime())) return fail('Valid until must be in the future.');
  const release: JsonObject[] = [];
  for (const c of releaseVocabulary(a)) {
    if (!conditions.includes(c.kind)) continue;
    if (c.takesDays) {
      if (!Number.isInteger(days) || days < 1 || days > 90) return fail('Days after sign-off is 1 to 90.');
      release.push({ kind: c.kind, days });
    } else release.push({ kind: c.kind });
  }
  if (release.length > 5) return fail('Choose at most 5 release conditions.');
  return { ok: true, args: { p_work_order_id: wo, p_lines: out, p_deposit: dep, p_valid_until: until,
    p_supersedes_quote_id: str(a.args.p_supersedes_quote_id), p_release_conditions: release.length ? release : null } };
}

// MARK: - Change order

export type BaseLineDraft = { index: number; state: 'keep' | 'modify' | 'remove'; refKind: string; refId: string | null; description: string; basis: string; amount: string; quantity: string };
export type AddedLine = { description: string; basis: string; amount: string; quantity: string };
export type Substitution = { specId: string; field: 'material' | 'process'; toKey: string; toLabel: string };
export type ChangeArgs = { p_work_order_id: string; p_base_quote_id: string; p_changes: JsonObject[]; p_reason: string };

export function baseLines(quote: JsonObject | null): BaseLineDraft[] {
  return arr(quote?.lines).map(obj).filter((o): o is JsonObject => !!o).map((l, index) => {
    const kind = str(l.ref_kind) ?? 'fee';
    return { index, state: 'keep', refKind: kind, refId: kind === 'fee' ? null : str(l.ref_id), description: str(l.description) ?? '',
      basis: str(l.pricing_basis) ?? 'flat', amount: plain(num(l.amount)), quantity: plain(num(l.quantity)) };
  });
}

function changeLine(refKind: string, refId: string | null, description: string, basis: string, amount: string, quantity: string, currency: string): Built<JsonObject> {
  const desc = description.trim();
  if (desc.length < 1 || desc.length > 500) return fail('Each line needs a description.');
  const amt = numberOf(amount);
  if (amt === null || amt < 0) return fail('Each line needs a price.');
  const o: JsonObject = { ref_kind: refKind, ref_id: refId, description: desc, pricing_basis: basis, amount: amt, currency, unit: unitOf(basis), quantity: null };
  const q = numberOf(quantity);
  if (basis !== 'flat' && q !== null && q > 0) o.quantity = q;
  return { ok: true, args: o };
}

export function changeOrderArgs(a: JobAction, quote: JsonObject | null, lines: BaseLineDraft[], added: AddedLine[], subs: Substitution[], reason: string): Built<ChangeArgs> {
  const wo = str(a.args.p_work_order_id), base = str(a.args.p_base_quote_id);
  if (!offered(a, 'issue_change_order', 'issue_change_order') || !wo || !base || base !== str(quote?.quote_id)) {
    return fail('The quote changed since you opened it. Reload and try again.');
  }
  const why = reason.trim();
  if (why.length < 1 || why.length > 1000) return fail('Say why the work changed.');
  const currency = arr(quote?.lines).map(l => str(obj(l)?.currency)).find(Boolean) ?? 'USD';
  const changes: JsonObject[] = [];
  for (const l of lines) {
    if (l.state === 'remove') changes.push({ action: 'remove', line_index: l.index });
    if (l.state === 'modify') {
      const j = changeLine(l.refKind, l.refId, l.description, l.basis, l.amount, l.quantity, currency);
      if (!j.ok) return j;
      changes.push({ action: 'modify', line_index: l.index, line: j.args });
    }
  }
  for (const d of added) {
    const j = changeLine('fee', null, d.description, d.basis, d.amount, d.quantity, currency);
    if (!j.ok) return j;
    changes.push({ action: 'add', line: j.args });
  }
  const specs = arr(obj(quote?.scope_snapshot)?.specifications).map(obj).filter((o): o is JsonObject => !!o);
  for (const s of subs) {
    const spec = specs.find(x => str(x.id) === s.specId);
    const fromKey = spec ? str(s.field === 'material' ? spec.material_key : spec.process_key) : null;
    if (!spec || !fromKey) return fail('Pick a material or process to substitute.');
    const toKey = s.toKey.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:/-]{0,79}$/.test(toKey) || toKey === fromKey) return fail('Give the substitute a short key, like mild_steel.');
    const o: JsonObject = { action: 'substitute', specification_id: s.specId, field: s.field, from_key: fromKey, to_key: toKey };
    if (s.toLabel.trim()) o.to_label = s.toLabel.trim().slice(0, 200);
    changes.push(o);
  }
  if (!changes.length) return fail('Change at least one thing.');
  if (!lines.some(l => l.state !== 'remove') && !added.length) return fail('Keep at least one line.');
  return { ok: true, args: { p_work_order_id: wo, p_base_quote_id: base, p_changes: changes, p_reason: why } };
}

// MARK: - Completion (from the job path's completion stage)

export type CompletionState = { completionId: string | null; completionHash: string | null; signedAt: string | null; scopeHash: string | null;
  scopeBasis: string | null; customerAcceptance: string };

export function completionState(stage: JsonObject | null): CompletionState {
  const a = obj(stage?.provider_attestation), s = obj(stage?.scope_basis);
  return { completionId: str(a?.completion_id), completionHash: str(a?.completion_hash), signedAt: str(a?.signed_at),
    scopeHash: str(s?.scope_hash), scopeBasis: str(s?.basis), customerAcceptance: str(stage?.customer_acceptance) ?? 'not_established' };
}

/**
 * The completion Signs as actions, so they render like every other server-offered step. "Mark the work done" is offered to
 * whoever the invoice reader lets issue an invoice (the backend uses one eligibility for both); "Confirm the work is done"
 * to the customer slot the server returned, once a provider attestation exists and is not yet accepted.
 */
export function completionActions(workOrderId: string, stage: JsonObject | null, invoiceActions: JobAction[], viewerSlots: string[]): JobAction[] {
  const c = completionState(stage);
  const base = { binds: [], doesNotBind: [], termsBasis: null, label: null, raw: {} };
  const out: JobAction[] = [];
  if (!c.completionId && c.scopeHash && invoiceActions.some(x => x.kind === 'issue_invoice')) {
    out.push({ ...base, kind: 'attest_completion', rpc: 'attest_work_completion', args: { p_work_order_id: workOrderId, p_scope_hash: c.scopeHash } });
  }
  if (c.completionId && c.completionHash && c.customerAcceptance !== 'established' && c.customerAcceptance !== 'signed' && viewerSlots.includes('customer')) {
    out.push({ ...base, kind: 'accept_completion', rpc: 'accept_work_completion',
      args: { p_work_order_id: workOrderId, p_completion_id: c.completionId, p_completion_hash: c.completionHash } });
  }
  return out;
}

export function attestArgs(a: JobAction, note: string): Built<{ p_work_order_id: string; p_scope_hash: string; p_note: string | null; p_evidence: null }> {
  const wo = str(a.args.p_work_order_id), hash = str(a.args.p_scope_hash);
  if (!offered(a, 'attest_completion', 'attest_work_completion') || !wo || !hash) return fail("This job's scope isn't readable yet. Reload and try again.");
  const t = note.trim();
  if (t.length > 2000) return fail('Keep the note under 2,000 characters.');
  return { ok: true, args: { p_work_order_id: wo, p_scope_hash: hash, p_note: t || null, p_evidence: null } };
}

// MARK: - Invoice and payment

export type InvoiceLineDraft = { quoteLine: number | null; description: string; basis: string; amount: string; quantity: string };
export type InvoiceArgs = { p_work_order_id: string; p_lines: JsonObject[]; p_quote_id: string | null; p_due_at: string | null };

/** One line per accepted-quote line, so the invoice starts as quoted. */
export function invoiceLinesFromQuote(quote: JsonObject | null): InvoiceLineDraft[] {
  const lines = arr(quote?.lines).map(obj).filter((o): o is JsonObject => !!o);
  if (!lines.length) return [{ quoteLine: null, description: '', basis: 'flat', amount: '', quantity: '' }];
  return lines.map((l, i) => ({ quoteLine: i, description: str(l.description) ?? `Line ${i + 1}`, basis: str(l.pricing_basis) ?? 'flat',
    amount: plain(num(l.amount)), quantity: plain(num(l.quantity)) }));
}

export function invoiceArgs(a: JobAction, lines: InvoiceLineDraft[], currency: string, quoteId: string | null, due: string): Built<InvoiceArgs> {
  const wo = str(a.args.p_work_order_id);
  if (!offered(a, 'issue_invoice', 'issue_work_order_invoice') || !wo) return fail('Only the job’s technician or shop can issue its invoice.');
  const cur = currencyOf(currency);
  if (!cur) return fail('Use a three-letter currency, like USD.');
  const out: JsonObject[] = [];
  for (const d of lines) {
    const desc = d.description.trim();
    if (!desc) return fail('Each line needs a description.');
    const amt = numberOf(d.amount);
    if (amt === null || amt < 0) return fail('Each line needs an amount.');
    let qty: number | null = null;
    if (d.basis !== 'flat') {
      qty = numberOf(d.quantity);
      if (qty === null || qty <= 0) return fail('Lines priced by the hour, day or operation need a quantity.');
    }
    out.push({ quote_line: d.quoteLine, description: desc, pricing_basis: d.basis, amount: amt, currency: cur, unit: unitOf(d.basis), quantity: qty });
  }
  if (out.length < 1 || out.length > 200) return fail('Add at least one line.');
  const used = out.map(l => l.quote_line).filter((x): x is number => typeof x === 'number');
  if (new Set(used).size !== used.length) return fail('Each quote line can be invoiced once.');
  const dueAt = isoOf(due);
  if (due && !dueAt) return fail('Pick a due date.');
  return { ok: true, args: { p_work_order_id: wo, p_lines: out, p_quote_id: quoteId, p_due_at: dueAt } };
}

export const METHODS: Array<{ key: string; title: string }> = [
  { key: 'bank_transfer', title: 'Bank transfer' }, { key: 'cash', title: 'Cash' }, { key: 'check', title: 'Check' }, { key: 'card', title: 'Card' },
  { key: 'ach', title: 'ACH' }, { key: 'wire', title: 'Wire' }, { key: 'zelle', title: 'Zelle' }, { key: 'venmo', title: 'Venmo' },
  { key: 'paypal', title: 'PayPal' }, { key: 'other', title: 'Other' },
];

export type PaymentArgs = { p_invoice_id: string; p_amount: number; p_currency: string; p_method: string; p_paid_at: string; p_reference: string | null };

/** "payer" (I paid) or "payee" (I received), as the server decided for this viewer. */
export const paymentSide = (a: JobAction): 'payer' | 'payee' => (a.raw.as === 'payer' ? 'payer' : 'payee');

export function paymentArgs(a: JobAction, invoice: JsonObject | null, amount: string, method: string, paidAt: string, reference: string, now = new Date()): Built<PaymentArgs> {
  const id = str(a.args.p_invoice_id);
  if (!offered(a, 'record_payment', 'record_work_order_payment') || !id || id !== str(invoice?.invoice_id)) return fail('This invoice changed. Reload and try again.');
  const value = numberOf(amount);
  if (value === null || value <= 0 || value >= 1_000_000_000) return fail('Enter the amount.');
  if (!METHODS.some(m => m.key === method)) return fail('Pick how it was paid.');
  const at = isoOf(paidAt);
  if (!at) return fail('Pick the payment date.');
  if (Date.parse(at) > now.getTime()) return fail("The payment date can't be in the future.");
  const ref = reference.trim();
  if (ref.length > 200) return fail('Keep the reference under 200 characters.');
  return { ok: true, args: { p_invoice_id: id, p_amount: value, p_currency: str(invoice?.currency) ?? 'USD', p_method: method, p_paid_at: at, p_reference: ref || null } };
}

/** The work order a pay_invoice action names, only when it names the invoice checkout function. */
export function payInvoiceTarget(a: JobAction): string | null {
  const fn = str(a.raw.function) ?? 'create-work-order-invoice-checkout';
  return a.kind === 'pay_invoice' && fn === 'create-work-order-invoice-checkout' ? str(a.args.work_order_id) : null;
}

/** Only an https page on stripe.com is opened. */
export function stripeCheckoutUrl(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname === 'stripe.com' || u.hostname.endsWith('.stripe.com')) ? u.toString() : null;
  } catch { return null; }
}

export function payRefusal(code: string | null): string {
  switch (code) {
    case 'not_the_customer': return 'Only the customer on this job can pay its invoice.';
    case 'no_invoice': return 'There is no invoice to pay yet.';
    case 'nothing_due': return 'This invoice is already paid.';
    case 'currency_not_supported': return "This invoice's currency can't be paid by card yet.";
    case 'below_processor_minimum': return 'The balance is below the card payment minimum.';
    default: return "Card payment isn't available right now. Reload the job and try again.";
  }
}

// MARK: - Co-sign and vouch

export const COSIGN_KINDS: Array<{ key: string; title: string; explain: string }> = [
  { key: 'supervision', title: 'Supervision', explain: "You'll oversee their work on this job." },
  { key: 'suitability', title: 'Suitability', explain: "You think they're right for this job." },
  { key: 'permission', title: 'Permission', explain: 'They can use your shop or tools for this job.' },
  { key: 'availability', title: 'Availability', explain: "You can confirm they're available for it." },
];

/** The capacities the server lets this viewer co-sign in: a shop they own or belong to, or themself. */
export function actingFor(a: JobAction): Array<{ title: string; cut: JsonObject }> {
  return arr(a.raw.acting_for).map(obj).map(o => {
    const cut = obj(o?.p_cut);
    if (!o || !cut) return null;
    return { title: o.kind === 'organization' ? str(o.name) ?? 'Your shop' : 'Yourself', cut };
  }).filter((x): x is { title: string; cut: JsonObject } => x !== null);
}

export type CutBasis = 'none' | 'share_of_labor_line' | 'flat' | 'day_rate';
export type CosignArgs = { p_work_order_id: string; p_offer_id: string; p_kinds: string[]; p_scope: string; p_cut: JsonObject | null };

const pickKinds = (kinds: string[]) => [...new Set(kinds)].filter(k => COSIGN_KINDS.some(c => c.key === k)).sort();

export function cosignArgs(a: JobAction, kinds: string[], scope: string, basis: CutBasis, value: string, currency: string, acting: JsonObject | null): Built<CosignArgs> {
  const wo = str(a.args.p_work_order_id), offer = str(a.args.p_offer_id);
  if (!offered(a, 'cosign_provider', 'cosign_provider') || !wo || !offer) return fail("This offer isn't open for co-signing from your account.");
  const picked = pickKinds(kinds);
  if (!picked.length) return fail('Pick at least one kind.');
  const text = scope.trim();
  if (text.length < 1 || text.length > 2000) return fail("Write what you're vouching for.");
  const cut: JsonObject = {};
  if (basis === 'share_of_labor_line') {
    const p = numberOf(value);
    if (p === null || p <= 0 || p > 100) return fail('The cut is a percentage between 0 and 100.');
    Object.assign(cut, { basis, percentage: p });
  } else if (basis === 'flat' || basis === 'day_rate') {
    const amt = numberOf(value), cur = currencyOf(currency);
    if (amt === null || amt < 0) return fail("Enter the cut's amount.");
    if (!cur) return fail('Use a three-letter currency, like USD.');
    Object.assign(cut, { basis, amount: amt, currency: cur }, basis === 'day_rate' ? { unit: 'day' } : {});
  }
  if (acting) Object.assign(cut, acting);
  return { ok: true, args: { p_work_order_id: wo, p_offer_id: offer, p_kinds: picked, p_scope: text, p_cut: Object.keys(cut).length ? cut : null } };
}

export type VouchArgs = { p_subject_user_id: string | null; p_subject_actor_id: string | null; p_kinds: string[]; p_scope: string; p_expires_at: string | null };

export function vouchArgs(subject: { userId: string | null; actorId: string | null }, kinds: string[], scope: string, expires: string, now = new Date()): Built<VouchArgs> {
  if (!!subject.userId === !!subject.actorId) return fail("This profile can't take vouches right now.");
  const picked = pickKinds(kinds);
  if (!picked.length) return fail('Pick at least one kind.');
  const text = scope.trim();
  if (text.length < 1 || text.length > 2000) return fail("Write what you're vouching for.");
  const at = isoOf(expires);
  if (expires && (!at || Date.parse(at) <= now.getTime())) return fail('Pick an end date in the future.');
  return { ok: true, args: { p_subject_user_id: subject.userId, p_subject_actor_id: subject.actorId, p_kinds: picked, p_scope: text, p_expires_at: at } };
}

// MARK: - Shop bookings

export type FacilityChoice = { organizationId: string; name: string };
export const facilityChoices = (a: JobAction): FacilityChoice[] =>
  arr(a.raw.facilities).map(obj).map(o => (str(o?.organization_id) ? { organizationId: str(o!.organization_id)!, name: str(o!.name) ?? 'Unnamed shop' } : null))
    .filter((x): x is FacilityChoice => x !== null);

export type Asset = { assetId: string; kind: string; label: string; capacity: number; busy: Array<{ from: string; until: string }> };

/** facility_read's declared assets, grouped by kind on the server, flattened here. */
export function facilityAssets(read: JsonObject | null): Asset[] {
  const groups = arr(read?.assets).length ? arr(read?.assets) : arr(read?.asset_groups);
  const out: Asset[] = [];
  for (const g of groups.map(obj)) {
    const kind = str(g?.kind) ?? 'other';
    const inner = arr(g?.assets);
    const list = inner.length ? inner : [g as Json];
    for (const a of list.map(obj)) {
      if (!str(a?.asset_id)) continue;
      out.push({ assetId: str(a!.asset_id)!, kind: str(a!.kind) ?? kind, label: str(a!.label) ?? 'Unnamed', capacity: num(a!.capacity) ?? 1,
        busy: arr(a!.busy).map(obj).filter((b): b is JsonObject => !!b && !!str(b.from)).map(b => ({ from: str(b.from)!, until: str(b.until) ?? '' })) });
    }
  }
  return out;
}

export type ReserveArgs = { p_work_order_id: string; p_asset_id: string; p_from: string; p_until: string; p_terms: { basis: string; amount: number; currency: string } | null };

export function reserveArgs(a: JobAction, assetId: string | null, from: string, until: string, feeBasis: 'none' | 'hourly' | 'day_rate', amount: string, currency: string, now = new Date()): Built<ReserveArgs> {
  const wo = str(a.args.p_work_order_id);
  if (!offered(a, 'reserve_facility', 'reserve_facility') || !wo) return fail("This job can't book shop space from your account.");
  if (!assetId) return fail('Choose a space.');
  const f = isoOf(from), u = isoOf(until);
  if (!f || !u) return fail('Pick when it starts and ends.');
  if (Date.parse(f) >= Date.parse(u)) return fail('The end has to be after the start.');
  if (Date.parse(u) <= now.getTime()) return fail('Pick a time in the future.');
  if (Date.parse(u) - Date.parse(f) > 31 * 86_400_000) return fail('A booking can be at most 31 days.');
  let terms: ReserveArgs['p_terms'] = null;
  if (feeBasis !== 'none') {
    const amt = numberOf(amount), cur = currencyOf(currency);
    if (amt === null || amt < 0 || amt >= 1_000_000) return fail('Enter the fee as a number.');
    if (!cur) return fail('Currency is a 3-letter code, like USD.');
    terms = { basis: feeBasis, amount: amt, currency: cur };
  }
  return { ok: true, args: { p_work_order_id: wo, p_asset_id: assetId, p_from: f, p_until: u, p_terms: terms } };
}

/** confirm_facility_reservation from a facility_reservation_to_confirm queue item's own sign hint. */
export function confirmBookingArgs(item: JsonObject): Built<{ p_reservation_id: string; p_hash: string }> {
  const sign = obj(item.sign), hint = obj(sign?.args_hint) ?? obj(sign?.args);
  const id = str(hint?.p_reservation_id), hash = str(hint?.p_hash);
  if (item.kind !== 'facility_reservation_to_confirm' || str(sign?.rpc) !== 'confirm_facility_reservation' || !id || id !== str(item.ref_id) || !hash) {
    return fail("This request can't be confirmed from here. Reload and try again.");
  }
  return { ok: true, args: { p_reservation_id: id, p_hash: hash } };
}

// MARK: - Inspection findings, inspection access, job evidence

export const VERDICTS: Array<{ key: string; title: string }> = [
  { key: 'supports', title: 'Matches what was claimed' }, { key: 'contradicts', title: "Doesn't match" }, { key: 'unknown', title: "Couldn't tell" },
];
export const SEVERITIES: Array<{ key: string; title: string }> = [
  { key: 'info', title: 'For information' }, { key: 'monitor', title: 'Keep an eye on it' }, { key: 'concern', title: 'Concern' }, { key: 'critical', title: 'Critical' },
];
export const CONDITIONS: Array<{ key: string; title: string }> = [
  { key: 'excellent', title: 'Excellent' }, { key: 'good', title: 'Good' }, { key: 'fair', title: 'Fair' }, { key: 'rough', title: 'Rough' },
  { key: 'project', title: 'Project' }, { key: 'parts_only', title: 'Parts only' },
];
/** The systems record_inspection_findings accepts (2026-10-19). */
export const SYSTEMS = ['engine_bay', 'top_end', 'bottom_end', 'undercarriage', 'interior', 'wheels', 'drivetrain', 'cooling', 'electrical', 'fuel',
  'ignition', 'suspension', 'brakes', 'body', 'other'];

export type FindingDraft = { itemId: string | null; verdict: string | null; finding: string; severity: string; system: string; photoRef: string };
export type FindingsArgs = { p_inspection_work_order_id: string; p_findings: { summary: string; findings: JsonObject[]; overall_condition: string | null } };

const oneLine = (s: string) => s.split(/\r?\n/).join(' ').trim();

export function findingsArgs(a: JobAction, checklistIds: string[], summary: string, drafts: FindingDraft[], condition: string): Built<FindingsArgs> {
  const id = str(a.args.p_inspection_work_order_id);
  if (!offered(a, 'record_findings', 'record_inspection_findings') || !id) return fail("You aren't the accepted inspector on this inspection.");
  const s = summary.trim();
  if (!s) return fail('Write a one-line summary.');
  if (s.length > 500) return fail('Keep the summary under 500 characters.');
  const out: JsonObject[] = [];
  for (const d of drafts) {
    const answers = d.itemId !== null;
    if (answers && d.verdict === null) continue;
    const text = oneLine(d.finding);
    if (!text) { if (answers) return fail('Say what you found for each checklist item you answered.'); continue; }
    if (text.length > 2000) return fail('Keep each finding under 2,000 characters.');
    if (answers && !checklistIds.includes(d.itemId!)) return fail('A checklist item changed. Reload and try again.');
    if (answers && !VERDICTS.some(v => v.key === d.verdict)) return fail('Pick a verdict for each answered item.');
    if (!SEVERITIES.some(v => v.key === d.severity)) return fail('Pick a severity for each finding.');
    if (d.system && !SYSTEMS.includes(d.system)) return fail('Pick a system from the list.');
    const ref = d.photoRef.trim();
    if (ref.length > 1024) return fail('Keep each photo reference under 1,024 characters.');
    const o: JsonObject = { finding: text, severity: d.severity };
    if (answers) { o.item_id = d.itemId; o.verdict = d.verdict; }
    if (d.system) o.system = d.system;
    if (ref) o.evidence_photo_ref = ref;
    out.push(o);
  }
  if (!out.length) return fail('Record at least one finding.');
  if (out.length > 100) return fail('At most 100 findings in one report.');
  if (condition && !CONDITIONS.some(c => c.key === condition)) return fail('Pick the overall condition from the list.');
  return { ok: true, args: { p_inspection_work_order_id: id, p_findings: { summary: s, findings: out, overall_condition: condition || null } } };
}

export type GrantArgs = { p_inspection_work_order_id: string; p_scope: string; p_window: { from: string; until: string } | null };

export function grantArgs(a: JobAction, scope: string, from: string, until: string, now = new Date()): Built<GrantArgs> {
  const id = str(a.args.p_inspection_work_order_id);
  if (!offered(a, 'grant_inspection_access', 'grant_inspection_access') || !id) return fail('Only the verified owner can let an inspector see this vehicle.');
  const s = scope.trim();
  if (!s) return fail('Say what the inspector may do (for example, where, and whether a test drive is allowed).');
  if (s.length > 2000) return fail('Keep the scope under 2,000 characters.');
  let w: GrantArgs['p_window'] = null;
  if (from || until) {
    const f = isoOf(from), u = isoOf(until);
    if (!f || !u) return fail('Pick both the start and the end, or neither.');
    if (Date.parse(f) >= Date.parse(u)) return fail('The window must end after it starts.');
    if (Date.parse(u) <= now.getTime()) return fail('The window must end in the future.');
    w = { from: f, until: u };
  }
  return { ok: true, args: { p_inspection_work_order_id: id, p_scope: s, p_window: w } };
}

export type EvidenceArgs = { p_work_order_id: string; p_image_ids: string[]; p_operation_id: string | null; p_note: string | null };

/** Only photos the candidates reader lists for this job (the viewer's own, not sensitive or personal); at most 50 at once. */
export function evidenceArgs(a: JobAction, candidates: JsonObject | null, imageIds: string[], operationId: string | null, note: string): Built<EvidenceArgs> {
  const wo = str(a.args.p_work_order_id);
  if (!offered(a, 'attach_evidence', 'attach_job_evidence') || !wo) return fail("You can't attach photos to this job.");
  const eligible = new Set(arr(candidates?.items).map(obj).filter(i => str(i?.work_order_id) === wo).map(i => str(i?.image_id)).filter((x): x is string => !!x));
  const ids = [...new Set(imageIds)].filter(id => eligible.has(id));
  if (!ids.length) return fail('Choose at least one of your photos listed here.');
  if (ids.length > 50) return fail('Attach at most 50 photos at once.');
  const n = note.trim();
  if (n.length > 1000) return fail('Keep the note under 1,000 characters.');
  return { ok: true, args: { p_work_order_id: wo, p_image_ids: ids, p_operation_id: operationId, p_note: n || null } };
}

/** Why some of the viewer's photos in the job window can't be attached, from the reader's own count and basis. */
export function notAttachableText(candidates: JsonObject | null): string | null {
  const n = num(obj(candidates?.coverage)?.not_attachable_excluded) ?? 0;
  if (n <= 0) return null;
  return `${n.toLocaleString('en-US')} of your photo${n === 1 ? '' : 's'} from this job's window can't be attached: photos marked sensitive or personal, attributed to another vehicle, or replaced by a newer copy are excluded.`;
}

// MARK: - Contact

export function contactMessage(message: string, max = 500): Built<string> {
  const m = message.trim();
  if (m.length < 1 || m.length > max) return fail(`Write a message of 1 to ${max.toLocaleString('en-US')} characters.`);
  return { ok: true, args: m };
}

export function requestsLeft(inbox: JsonObject | null): number | null {
  const l = obj(inbox?.limits);
  const per = num(l?.requests_per_day), sent = num(l?.requests_sent_last_day);
  return per === null || sent === null ? null : Math.max(per - sent, 0);
}

export function leftTodayText(n: number | null): string | null {
  if (n === null) return null;
  if (n === 0) return "You've reached today's limit for new requests.";
  return n === 1 ? 'You can send 1 more request today.' : `You can send ${n} more requests today.`;
}

export const contactStatus = (s: string | null): string =>
  ({ pending: 'Waiting for a reply', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' } as Record<string, string>)[s ?? ''] ?? (s ? s.replace(/_/g, ' ') : 'Unknown');

export function contactContext(kind: string | null, label: string | null, incoming: boolean): string {
  if (label) return label;
  switch (kind) {
    case 'profile': return incoming ? 'Your profile' : 'Their profile';
    case 'work_order': return 'A job';
    case 'requirement': return 'An open requirement';
    case 'vehicle': return 'A vehicle';
    default: return 'Nuke';
  }
}

export const itemActions = (item: JsonObject | null): string[] => strings(item?.actions);

// MARK: - Refusals in plain words

const REFUSALS: Array<[RegExp, string]> = [
  [/Authentication required|Sign-in required/i, 'Sign in first.'],
  [/customer cannot quote/i, "You're the customer on this job, so you can't quote it."],
  [/unavailable for quoting/i, "Only the shop's owner, an accepted technician or the job's technician can quote it."],
  [/must be the next version|must name the current quote|base must be the current quote/i, 'Someone issued a new version meanwhile. Reload and try again.'],
  [/scope snapshot must equal|Scope hash does not match/i, 'The job changed since you opened it. Reload and try again.'],
  [/prices at least one line/i, "Price at least one line — without prices it's an estimate, not a quote."],
  [/Invalid quote line|Invalid invoice line|names a quote line|invoiced twice/i, "One of the lines isn't valid. Check its price, currency and quantity."],
  [/validity must end after/i, 'Valid until must be in the future.'],
  [/release condition/i, 'Check the release conditions.'],
  [/amends an accepted quote/i, "The quote isn't accepted yet; revise it instead."],
  [/Completion hash does not match/i, 'This changed since you opened it. Reload and review it again.'],
  [/Completion is withheld/i, 'The work changed since it was marked done. Ask the technician to mark it done again.'],
  [/unavailable for completion|unavailable for invoicing/i, "Only the job's technician or shop can do this."],
  [/Completion unavailable/i, 'Only the customer on this job can confirm it is done.'],
  [/Invoice must reference/i, 'The accepted quote changed. Reload and try again.'],
  [/currency must match/i, "Use the invoice's currency."],
  [/Only the current invoice/i, 'A newer invoice replaced this one. Reload and try again.'],
  [/Paid time/i, "The payment date can't be in the future."],
  [/Unknown payment method/i, 'Pick how it was paid.'],
  [/Cannot vouch for oneself/i, "You can't vouch for yourself."],
  [/needs_facility_organization_or_owned_tools/i, 'To vouch, you need a shop on Nuke or tools on record.'],
  [/Co-sign unavailable/i, "You can't co-sign this offer from your account."],
  [/client cannot record findings/i, "You're the customer on this inspection, so you can't record its findings."],
  [/Inspection unavailable for findings/i, 'Only the accepted inspector can record findings.'],
  [/Invalid finding/i, 'One finding is incomplete: each needs one line of text and a severity, and a verdict when it answers a checklist item.'],
  [/verified owner of the vehicle required/i, 'Only the verified owner of this vehicle can grant access.'],
  [/Accept an inspector offer before granting access/i, 'Accept an inspector first, then grant access.'],
  [/Window needs from before until/i, 'The window must end after it starts, and in the future.'],
  [/already attached to this work order/i, 'Some of these photos are already filed to this job.'],
  [/Operation is not on this work order/i, 'That operation is not on this job. Reload and try again.'],
  [/unavailable for evidence/i, "You can't file photos to this job."],
  [/not a declared, in-service facility asset/i, "That space isn't available for booking."],
  [/Window must be future/i, 'Pick a future window of at most 31 days that starts before it ends.'],
  [/Only the customer or an accepted provider reserves/i, 'Only the customer or an accepted technician can book space for this job.'],
  [/limit reached \(10 per day\)/i, "You've reached today's limit for new requests. Try again tomorrow."],
  [/Thread message limit/i, "You've sent a lot in this conversation today. Try again tomorrow."],
  [/already exists/i, 'You already have a request waiting with them about this.'],
  [/cannot contact yourself/i, "That's you."],
  [/Messages open after/i, 'Messages open once they accept your request.'],
  [/Contact request is/i, 'This request was already answered.'],
  [/No reachable recipient|context unavailable|request unavailable/i, "This person can't be reached through Nuke right now."],
];

export function refusal(error: unknown): string {
  const m = String(obj(error)?.message ?? error ?? '');
  const hit = REFUSALS.find(([re]) => re.test(m));
  if (hit) return hit[1];
  if (m && m.length <= 240 && !/\b(relation|column|function|syntax|violates)\b/i.test(m)) return m;
  return 'Nuke could not do that right now.';
}
