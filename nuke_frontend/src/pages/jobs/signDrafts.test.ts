import { describe, expect, it } from 'vitest';
import { parseAction, type JobAction, type JsonObject } from './jobRead';
import {
  attestArgs, baseLines, evidenceArgs, findingsArgs, grantArgs, notAttachableText, changeOrderArgs, completionActions, confirmBookingArgs, confirmWorkDayArgs, workDayConfirmationFailure, cosignArgs, facilityAssets, invoiceArgs, invoiceLinesFromQuote,
  payInvoiceTarget, paymentArgs, paymentSide, quoteArgs, quoteScope, refusal, releaseVocabulary, requestsLeft, reserveArgs, seedQuoteLines,
  stripeCheckoutUrl, vouchArgs,
} from './signDrafts';

const a = (raw: object): JobAction => parseAction(raw)!;
const WO = '00000000-0000-4000-a000-0000000000aa';
const NOW = new Date('2026-10-19T20:00:00Z');

const issue = a({ action: 'issue_quote', rpc: 'issue_work_order_quote', args: { p_work_order_id: WO, p_supersedes_quote_id: null },
  release_conditions_vocabulary: ['customer_completion_sign', 'photos_in_window', { kind: 'days_signed', days: '1..90' }] });

const ops = {
  operations: [{ id: 'op1', description: 'Fabricate headers', quote_ref: { ref_kind: 'operation', ref_id: 'op1' },
    requirements: [{ id: 'rq1', description: 'TIG welding', quote_ref: { ref_kind: 'requirement', ref_id: 'rq1' } }] }],
  parts: [{ id: 'p1', part_name: 'Muffler', quantity: 2, unit_price: 210, quote_ref: { ref_kind: 'part', ref_id: 'p1' } }],
  labor: [{ id: 'l1', task_name: 'Install', hours: 3, hourly_rate: 130, quote_ref: { ref_kind: 'labor', ref_id: 'l1' } }],
};

describe('issue / revise quote', () => {
  it('reads the scope with its server quote_refs and starts from the operations', () => {
    const scope = quoteScope(ops);
    expect(scope.map(s => `${s.refKind}:${s.refId}`)).toEqual(['operation:op1', 'requirement:rq1', 'part:p1', 'labor:l1']);
    expect(scope[2].amount).toBe(420);
    const lines = seedQuoteLines(scope, null);
    expect(lines.filter(l => l.included).map(l => l.refKind)).toEqual(['operation']);
  });

  it('builds exactly the args from the action plus the priced lines', () => {
    const lines = seedQuoteLines(quoteScope(ops), null).map(l => (l.refKind === 'operation' ? { ...l, amount: '1,200', basis: 'flat' } : l));
    const built = quoteArgs(issue, lines, { amount: '300', currency: 'usd' }, '2026-11-01', ['customer_completion_sign', 'days_signed'], 14, NOW);
    expect(built).toEqual({ ok: true, args: {
      p_work_order_id: WO,
      p_lines: [{ ref_kind: 'operation', ref_id: 'op1', description: 'Fabricate headers', pricing_basis: 'flat', amount: 1200, currency: 'USD' }],
      p_deposit: { amount: 300, currency: 'USD' }, p_valid_until: new Date('2026-11-01').toISOString(), p_supersedes_quote_id: null,
      p_release_conditions: [{ kind: 'customer_completion_sign' }, { kind: 'days_signed', days: 14 }],
    } });
  });

  it('refuses an unpriced quote, a flat quantity, a past validity, and a step the server did not offer', () => {
    const lines = seedQuoteLines(quoteScope(ops), null);
    expect(quoteArgs(issue, lines, null, '', [], 7, NOW)).toEqual({ ok: false, error: "Price at least one line — without prices it's an estimate, not a quote." });
    const flatQty = lines.map(l => ({ ...l, amount: '5', quantity: '2', basis: 'flat' }));
    expect(quoteArgs(issue, flatQty, null, '', [], 7, NOW).ok).toBe(false);
    const priced = lines.map(l => ({ ...l, amount: '5' }));
    expect(quoteArgs(issue, priced, null, '2020-01-01', [], 7, NOW)).toEqual({ ok: false, error: 'Valid until must be in the future.' });
    expect(quoteArgs(a({ action: 'issue_quote', rpc: 'accept_work_order_quote', args: { p_work_order_id: WO } }), priced, null, '', [], 7, NOW).ok).toBe(false);
  });

  it('offers only the release conditions in the server vocabulary', () => {
    expect(releaseVocabulary(issue).map(c => `${c.kind}${c.takesDays ? '+days' : ''}`)).toEqual(['customer_completion_sign', 'photos_in_window', 'days_signed+days']);
    const priced = seedQuoteLines(quoteScope(ops), null).map(l => ({ ...l, amount: '5' }));
    const built = quoteArgs(issue, priced, null, '', ['inspector_attestation'], 7, NOW);
    expect(built.ok && built.args.p_release_conditions).toBeNull();
  });

  it('revises from the current lines and pins the version it supersedes', () => {
    const rev = a({ action: 'issue_quote', rpc: 'issue_work_order_quote', args: { p_work_order_id: WO, p_supersedes_quote_id: 'q-1' } });
    const lines = seedQuoteLines([], { lines: [{ ref_kind: 'fee', description: 'Diagnosis', pricing_basis: 'flat', amount: 90, currency: 'USD' }] });
    const built = quoteArgs(rev, lines, null, '', [], 7, NOW);
    expect(built.ok && built.args.p_supersedes_quote_id).toBe('q-1');
  });
});

describe('change order', () => {
  const quote: JsonObject = { quote_id: 'q-1', lines: [{ ref_kind: 'labor', ref_id: 'l1', description: 'Install', pricing_basis: 'hourly', amount: 130, currency: 'USD', quantity: 3 },
    { ref_kind: 'fee', description: 'Shop supplies', pricing_basis: 'flat', amount: 40, currency: 'USD' }],
    scope_snapshot: { specifications: [{ id: 's1', material_key: 'stainless_steel.304', process_key: 'welding.tig' }] } };
  const act = a({ action: 'issue_change_order', rpc: 'issue_change_order', args: { p_work_order_id: WO, p_base_quote_id: 'q-1' } });

  it('lists add, remove, modify and substitute with a reason', () => {
    const lines = baseLines(quote).map(l => (l.index === 1 ? { ...l, state: 'remove' as const } : { ...l, state: 'modify' as const, quantity: '4' }));
    const built = changeOrderArgs(act, quote, lines, [{ description: 'Hanger', basis: 'flat', amount: '20', quantity: '' }],
      [{ specId: 's1', field: 'material', toKey: 'mild_steel', toLabel: 'Mild steel' }], 'Customer chose mild steel');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.args.p_changes.map(c => c.action)).toEqual(['modify', 'remove', 'add', 'substitute']);
    expect(built.args.p_changes[0]).toMatchObject({ line_index: 0, line: { quantity: 4, unit: 'hour', currency: 'USD' } });
    expect(built.args.p_changes[3]).toEqual({ action: 'substitute', specification_id: 's1', field: 'material', from_key: 'stainless_steel.304', to_key: 'mild_steel', to_label: 'Mild steel' });
  });

  it('refuses a stale base, no reason, or no change', () => {
    expect(changeOrderArgs(act, { ...quote, quote_id: 'q-2' }, baseLines(quote), [], [], 'x').ok).toBe(false);
    expect(changeOrderArgs(act, quote, baseLines(quote), [], [], ' ')).toEqual({ ok: false, error: 'Say why the work changed.' });
    expect(changeOrderArgs(act, quote, baseLines(quote), [], [], 'why')).toEqual({ ok: false, error: 'Change at least one thing.' });
  });
});

describe('completion', () => {
  const issueInvoice = [a({ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } })];
  it('offers Mark done only to a viewer the invoice reader lets invoice, pinned to the scope hash', () => {
    const stage = { scope_basis: { basis: 'accepted_quote', scope_hash: 'h'.repeat(64) }, customer_acceptance: 'not_established' };
    expect(completionActions(WO, stage, [], ['performer'])).toEqual([]);
    const [mark] = completionActions(WO, stage, issueInvoice, ['performer']);
    expect(mark).toMatchObject({ kind: 'attest_completion', rpc: 'attest_work_completion', args: { p_work_order_id: WO, p_scope_hash: 'h'.repeat(64) } });
    expect(attestArgs(mark, '  done ')).toEqual({ ok: true, args: { p_work_order_id: WO, p_scope_hash: 'h'.repeat(64), p_note: 'done', p_evidence: null } });
  });
  it('offers Confirm done only to the customer slot, pinned to the attestation hash', () => {
    const stage = { provider_attestation: { completion_id: 'c1', completion_hash: 'k'.repeat(64) }, customer_acceptance: 'not_established', scope_basis: { scope_hash: 'h' } };
    expect(completionActions(WO, stage, issueInvoice, ['performer'])).toEqual([]);
    expect(completionActions(WO, stage, [], ['customer'])[0]).toMatchObject({ kind: 'accept_completion', args: { p_completion_id: 'c1', p_completion_hash: 'k'.repeat(64) } });
    expect(completionActions(WO, { ...stage, customer_acceptance: 'established' }, [], ['customer'])).toEqual([]);
  });
});

describe('invoice and payment', () => {
  it('prefills from the accepted quote and refuses a quote line invoiced twice', () => {
    const lines = invoiceLinesFromQuote({ lines: [{ description: 'Install', pricing_basis: 'hourly', amount: 130, quantity: 3 }] });
    const act = a({ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } });
    const built = invoiceArgs(act, lines, 'usd', 'q-1', '');
    expect(built).toEqual({ ok: true, args: { p_work_order_id: WO, p_quote_id: 'q-1', p_due_at: null,
      p_lines: [{ quote_line: 0, description: 'Install', pricing_basis: 'hourly', amount: 130, currency: 'USD', unit: 'hour', quantity: 3 }] } });
    expect(invoiceArgs(act, [...lines, ...lines], 'USD', 'q-1', '')).toEqual({ ok: false, error: 'Each quote line can be invoiced once.' });
  });

  it('records a payment in the invoice currency, never dated in the future, with a known method', () => {
    const act = a({ action: 'record_payment', rpc: 'record_work_order_payment', args: { p_invoice_id: 'inv-1' }, as: 'payer' });
    const invoice = { invoice_id: 'inv-1', currency: 'USD' };
    expect(paymentSide(act)).toBe('payer');
    expect(paymentArgs(act, invoice, '1,590', 'zelle', '2026-10-18', ' ref 12 ', NOW)).toEqual({ ok: true,
      args: { p_invoice_id: 'inv-1', p_amount: 1590, p_currency: 'USD', p_method: 'zelle', p_paid_at: new Date('2026-10-18').toISOString(), p_reference: 'ref 12' } });
    expect(paymentArgs(act, invoice, '10', 'zelle', '2026-12-01', '', NOW)).toEqual({ ok: false, error: "The payment date can't be in the future." });
    expect(paymentArgs(act, invoice, '10', 'crypto', '2026-10-18', '', NOW)).toEqual({ ok: false, error: 'Pick how it was paid.' });
    expect(paymentArgs(act, { invoice_id: 'inv-2' }, '10', 'cash', '2026-10-18', '', NOW).ok).toBe(false);
  });

  it('pays by card only through the named checkout function and only to an https stripe.com page', () => {
    expect(payInvoiceTarget(a({ action: 'pay_invoice', function: 'create-work-order-invoice-checkout', args: { work_order_id: WO } }))).toBe(WO);
    expect(payInvoiceTarget(a({ action: 'pay_invoice', function: 'something-else', args: { work_order_id: WO } }))).toBeNull();
    expect(stripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test')).toBe('https://checkout.stripe.com/c/pay/cs_test');
    expect(stripeCheckoutUrl('https://stripe.com.evil.test/x')).toBeNull();
    expect(stripeCheckoutUrl('http://checkout.stripe.com/x')).toBeNull();
  });
});

describe('co-sign, vouch and bookings', () => {
  it('co-signs with kinds, scope, a cut and the server capacity merged in', () => {
    const act = a({ action: 'cosign_provider', rpc: 'cosign_provider', args: { p_work_order_id: WO, p_offer_id: 'o1' } });
    expect(cosignArgs(act, ['permission', 'supervision', 'permission', 'bogus'], ' I own the lift ', 'share_of_labor_line', '10', 'USD', { organization_id: 'org1' }))
      .toEqual({ ok: true, args: { p_work_order_id: WO, p_offer_id: 'o1', p_kinds: ['permission', 'supervision'], p_scope: 'I own the lift',
        p_cut: { basis: 'share_of_labor_line', percentage: 10, organization_id: 'org1' } } });
    expect(cosignArgs(act, [], 'x', 'none', '', 'USD', null)).toEqual({ ok: false, error: 'Pick at least one kind.' });
  });

  it('vouches for exactly one subject with a future end', () => {
    expect(vouchArgs({ userId: 'u1', actorId: null }, ['suitability'], 'Good welder', '', NOW)).toEqual({ ok: true,
      args: { p_subject_user_id: 'u1', p_subject_actor_id: null, p_kinds: ['suitability'], p_scope: 'Good welder', p_expires_at: null } });
    expect(vouchArgs({ userId: 'u1', actorId: 'a1' }, ['suitability'], 'x', '', NOW).ok).toBe(false);
    expect(vouchArgs({ userId: 'u1', actorId: null }, ['suitability'], 'x', '2020-01-01', NOW).ok).toBe(false);
  });

  it('books a declared space for a future window of at most 31 days', () => {
    const act = a({ action: 'reserve_facility', rpc: 'reserve_facility', args: { p_work_order_id: WO } });
    expect(reserveArgs(act, 'as1', '2026-10-20T08:00', '2026-10-20T17:00', 'hourly', '25', 'usd', NOW)).toEqual({ ok: true, args: {
      p_work_order_id: WO, p_asset_id: 'as1', p_from: new Date('2026-10-20T08:00').toISOString(), p_until: new Date('2026-10-20T17:00').toISOString(),
      p_terms: { basis: 'hourly', amount: 25, currency: 'USD' } } });
    expect(reserveArgs(act, 'as1', '2026-10-20T08:00', '2026-12-20T08:00', 'none', '', '', NOW)).toEqual({ ok: false, error: 'A booking can be at most 31 days.' });
    expect(reserveArgs(act, null, '2026-10-20T08:00', '2026-10-20T09:00', 'none', '', '', NOW)).toEqual({ ok: false, error: 'Choose a space.' });
  });

  it('flattens facility_read asset groups', () => {
    expect(facilityAssets({ assets_by_kind: [{ kind: 'lift', capacity_total: 2, assets: [{ asset_id: 'as1', label: 'Lift A', capacity: 1, busy: [{ from: '2026-10-20T08:00:00Z', until: '2026-10-20T10:00:00Z' }] }] }] }))
      .toEqual([{ assetId: 'as1', kind: 'lift', label: 'Lift A', capacity: 1, busy: [{ from: '2026-10-20T08:00:00Z', until: '2026-10-20T10:00:00Z' }] }]);
  });

  it('confirms a work day only from its exact affirmative queue action', () => {
    const item = { kind: 'work_session', ref_id: 'session-1', sign: { rpc: 'confirm_work_session', args_hint: { p_session_id: 'session-1', p_confirm: true } } };
    expect(confirmWorkDayArgs(item)).toEqual({ ok: true, args: { p_session_id: 'session-1', p_confirm: true } });
    for (const changed of [
      { ...item, kind: 'quote_to_accept' }, { ...item, ref_id: 'session-2' },
      { ...item, sign: { ...item.sign, rpc: 'another_writer' } },
      { ...item, sign: { ...item.sign, args_hint: { p_session_id: 'session-1', p_confirm: false } } },
      { ...item, sign: { rpc: 'confirm_work_session' } },
    ]) expect(confirmWorkDayArgs(changed).ok).toBe(false);
    expect(workDayConfirmationFailure({ ok: true, confirmed: true, session_id: 'session-1' }, 'session-1')).toBeNull();
    for (const result of [null, {}, { ok: false, error: 'not_authorized' }, { ok: true, confirmed: false, session_id: 'session-1' }, { ok: true, confirmed: true, session_id: 'other' }]) {
      expect(workDayConfirmationFailure(result, 'session-1')).toBeTruthy();
    }
  });

  it('confirms a booking only from its own queue sign hint', () => {
    const item = { kind: 'facility_reservation_to_confirm', ref_id: 'r1', sign: { rpc: 'confirm_facility_reservation', args_hint: { p_reservation_id: 'r1', p_hash: 'hh' } } };
    expect(confirmBookingArgs(item)).toEqual({ ok: true, args: { p_reservation_id: 'r1', p_hash: 'hh' } });
    expect(confirmBookingArgs({ ...item, ref_id: 'r2' }).ok).toBe(false);
  });
});

describe('contact and refusals', () => {
  it('reads the daily limit from the inbox', () => {
    expect(requestsLeft({ limits: { requests_per_day: 10, requests_sent_last_day: 7 } })).toBe(3);
    expect(requestsLeft({})).toBeNull();
  });
  it('turns writer refusals into words and hides internal errors', () => {
    expect(refusal({ message: 'Contact request limit reached (10 per day)' })).toBe("You've reached today's limit for new requests. Try again tomorrow.");
    expect(refusal({ message: 'Scope hash does not match the current accepted quote or scope' })).toBe('The job changed since you opened it. Reload and try again.');
    expect(refusal({ message: 'relation "x" does not exist' })).toBe('Nuke could not do that right now.');
  });
});

describe('inspection findings, access and evidence', () => {
  const rec = a({ action: 'record_findings', rpc: 'record_inspection_findings', args: { p_inspection_work_order_id: 'insp1' } });
  const blank = { finding: '', severity: 'info', system: '', photoRef: '' };
  it('records verdicts only for answered checklist items, plus other findings', () => {
    const built = findingsArgs(rec, ['frame', 'rust'], ' Solid truck ', [
      { ...blank, itemId: 'frame', verdict: 'supports', finding: 'Frame straight,\nno repairs', system: 'undercarriage', photoRef: 'IMG_0001' },
      { ...blank, itemId: 'rust', verdict: null },
      { ...blank, itemId: null, verdict: null, finding: 'Small oil seep', severity: 'monitor' },
    ], 'good');
    expect(built).toEqual({ ok: true, args: { p_inspection_work_order_id: 'insp1', p_findings: { summary: 'Solid truck', overall_condition: 'good', findings: [
      { finding: 'Frame straight, no repairs', severity: 'info', item_id: 'frame', verdict: 'supports', system: 'undercarriage', evidence_photo_ref: 'IMG_0001' },
      { finding: 'Small oil seep', severity: 'monitor' },
    ] } } });
  });
  it('refuses an answered item without words, an unknown item, no findings, or a step not offered', () => {
    expect(findingsArgs(rec, ['frame'], 'x', [{ ...blank, itemId: 'frame', verdict: 'contradicts' }], '')).toEqual({ ok: false, error: 'Say what you found for each checklist item you answered.' });
    expect(findingsArgs(rec, ['frame'], 'x', [{ ...blank, itemId: 'other', verdict: 'unknown', finding: 'y' }], '').ok).toBe(false);
    expect(findingsArgs(rec, [], 'x', [{ ...blank, itemId: null, verdict: null }], '')).toEqual({ ok: false, error: 'Record at least one finding.' });
    expect(findingsArgs(a({ action: 'record_findings', rpc: 'grant_inspection_access', args: { p_inspection_work_order_id: 'insp1' } }), [], 'x', [{ ...blank, itemId: null, verdict: null, finding: 'y' }], '').ok).toBe(false);
  });
  it('grants access with a scope and an optional future window', () => {
    const grant = a({ action: 'grant_inspection_access', rpc: 'grant_inspection_access', args: { p_inspection_work_order_id: 'insp1' } });
    expect(grantArgs(grant, ' Driveway only, no test drive ', '', '', NOW)).toEqual({ ok: true, args: { p_inspection_work_order_id: 'insp1', p_scope: 'Driveway only, no test drive', p_window: null } });
    expect(grantArgs(grant, 'x', '2026-10-21T09:00', '', NOW)).toEqual({ ok: false, error: 'Pick both the start and the end, or neither.' });
    expect(grantArgs(grant, 'x', '2020-01-01T09:00', '2020-01-01T10:00', NOW)).toEqual({ ok: false, error: 'The window must end in the future.' });
  });
  it('attaches only listed own photos for this job and explains exclusions', () => {
    const attach = a({ action: 'attach_evidence', rpc: 'attach_job_evidence', args: { p_work_order_id: WO } });
    const candidates = { items: [{ image_id: 'i1', work_order_id: WO }, { image_id: 'i2', work_order_id: 'other' }], coverage: { not_attachable_excluded: 2 } };
    expect(evidenceArgs(attach, candidates, ['i1', 'i2', 'i1', 'x'], null, ' after ')).toEqual({ ok: true, args: { p_work_order_id: WO, p_image_ids: ['i1'], p_operation_id: null, p_note: 'after' } });
    expect(evidenceArgs(attach, candidates, ['i2'], null, '')).toEqual({ ok: false, error: 'Choose at least one of your photos listed here.' });
    expect(notAttachableText(candidates)).toContain('2 of your photos');
    expect(notAttachableText({ coverage: { not_attachable_excluded: 0 } })).toBeNull();
  });
});
