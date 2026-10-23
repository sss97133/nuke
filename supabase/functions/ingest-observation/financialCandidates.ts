/** Deterministic context over owner-scoped retained records. Never posting or owner testimony. */
export interface CandidateSource {
  owner_id: string; source_key: string; date: string | null; amount: string | null;
  currency: string | null; merchant?: string | null; card_last4?: string | null;
  source_document_sha256?: string | null;
}
export interface ReceiptContext extends CandidateSource {
  role: 'purchase' | 'refund' | 'statement' | 'payment' | 'unknown';
}
export interface BankContext extends CandidateSource {
  movement: 'purchase' | 'refund' | 'transfer' | 'card_payment' | 'unknown';
}
export interface LedgerContext extends CandidateSource {
  section: string; document_source_keys: string[]; payment_source_keys: string[];
}
const amount = (value: string | null): bigint | null => {
  if (typeof value !== 'string' || !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) return null;
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(6, '0')) * (negative ? -1n : 1n);
};
const day = (value: string | null): number | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n / 86400000 : null;
};
const merchant = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function financialCandidates(ownerId: string, receipt: ReceiptContext, bank: BankContext[], ledger: LedgerContext[],
  options: { date_window_days: number; source_population_complete: boolean }) {
  if (!ownerId || receipt.owner_id !== ownerId) throw new Error('Owner-scoped receipt required');
  if (!Number.isInteger(options.date_window_days) || options.date_window_days < 0 || options.date_window_days > 31 || bank.length > 5000 || ledger.length > 5000) {
    throw new Error('Bounded retained population required');
  }
  const result = { contract: 'financial_context_candidates_v1', source_key: receipt.source_key,
    evidence_stage: 'computed_candidate_not_owner_decision', date_window_days: options.date_window_days,
    source_population_complete: options.source_population_complete,
    status: 'missing' as 'missing' | 'ineligible' | 'unmatched' | 'unique_candidate' | 'ambiguous',
    missing: [] as string[], bank_candidates: [] as { source_key: string; days_difference: number; witnesses: string[] }[],
    already_booked: [] as { source_key: string; section: string; basis: string }[],
    ledger_candidates: [] as { source_key: string; section: string; basis: string }[],
    expense_posted: false, reimbursement_determined: false };
  const ownedLedger = ledger.filter(r => r.owner_id === ownerId);
  // Direct source identity supports an already-recorded check independently of missing monetary fields.
  for (const row of ownedLedger) {
    if (row.document_source_keys.includes(receipt.source_key) ||
        (!!receipt.source_document_sha256 && row.source_document_sha256 === receipt.source_document_sha256)) {
      result.already_booked.push({ source_key: row.source_key, section: row.section, basis: 'explicit_document_source_link' });
    }
  }
  if (!['purchase', 'refund'].includes(receipt.role)) { result.status = 'ineligible'; return result; }
  const total = amount(receipt.amount), date = day(receipt.date);
  if (total === null) result.missing.push('valid_observed_amount');
  if (date === null) result.missing.push('valid_document_date');
  if (!receipt.currency || !/^[A-Z]{3}$/.test(receipt.currency)) result.missing.push('supported_currency');
  if (total === 0n) result.missing.push('nonzero_purchase_or_refund_amount');
  if (total !== null && ((receipt.role === 'purchase' && total < 0n) || (receipt.role === 'refund' && total > 0n))) result.missing.push('consistent_document_role_and_sign');
  if (result.missing.length || total === null || date === null) return result;
  const sameMoney = (row: CandidateSource, expected: bigint) => row.currency === receipt.currency && amount(row.amount) === expected;
  const dateDistance = (row: CandidateSource) => { const d = day(row.date); return d === null ? null : d - date; };
  for (const row of bank) {
    if (row.owner_id !== ownerId || ['transfer', 'card_payment'].includes(row.movement) || !sameMoney(row, -total)) continue;
    const days = dateDistance(row);
    if (days === null || Math.abs(days) > options.date_window_days) continue;
    // Contradictory known masks are a negative control. Unknown token mapping remains missing evidence.
    if (receipt.card_last4 && row.card_last4 && receipt.card_last4 !== row.card_last4) continue;
    const witnesses = ['signed_amount', 'currency', days === 0 ? 'same_date' : 'posting_date_window'];
    if (receipt.card_last4 && row.card_last4 === receipt.card_last4) witnesses.push('same_card_suffix_candidate_only');
    if (merchant(receipt.merchant) && merchant(receipt.merchant) === merchant(row.merchant)) witnesses.push('same_merchant_literal');
    result.bank_candidates.push({ source_key: row.source_key, days_difference: days, witnesses });
  }
  // A bank suggestion is never promoted into a proved receipt→ledger link.
  const bankKeys = new Set(result.bank_candidates.map(r => r.source_key));
  for (const row of ownedLedger) {
    if (result.already_booked.some(r => r.source_key === row.source_key)) continue;
    const days = dateDistance(row);
    const viaPayment = row.payment_source_keys.some(key => bankKeys.has(key));
    if (viaPayment || (sameMoney(row, total) && days !== null && Math.abs(days) <= options.date_window_days)) {
      result.ledger_candidates.push({ source_key: row.source_key, section: row.section,
        basis: viaPayment ? 'ledger_links_candidate_payment_not_confirmed_document' : 'amount_currency_date_candidate_only' });
    }
  }
  result.bank_candidates.sort((a,b)=>Math.abs(a.days_difference)-Math.abs(b.days_difference)||a.source_key.localeCompare(b.source_key));
  result.status = result.bank_candidates.length === 0 ? 'unmatched' : result.bank_candidates.length === 1 ? 'unique_candidate' : 'ambiguous';
  return result;
}
