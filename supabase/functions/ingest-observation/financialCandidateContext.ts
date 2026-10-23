import { financialCandidates, type BankContext, type LedgerContext, type ReceiptContext } from './financialCandidates.ts';
type ObjectValue = Record<string, unknown>;
type Client = { rpc(name: string, args: ObjectValue): PromiseLike<{ data: unknown; error: unknown }> };
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Owner comes exclusively from verified server authentication, never a request's declared owner. */
export async function financialCandidateContext(db: Client, authenticatedOwnerId: string, accountingRead: unknown) {
  if (!uuid(authenticatedOwnerId)) throw new Error('Authenticated owner required');
  const evidence = object(accountingRead), document = object(evidence?.document);
  if (!document || !uuid(document.id) || !hash(document.content_sha256) ||
      (document.owner_id !== undefined && document.owner_id !== authenticatedOwnerId)) throw new Error('Owned accounting read required');
  const gaps: string[] = [];
  const cells = Array.isArray(evidence?.fields) ? evidence.fields.map(object).filter((x): x is ObjectValue => !!x && x.is_superseded !== true) : [];
  function observed(key: string, type: string): string | null {
    const selected = cells.filter(cell => cell.field_key === key);
    if (selected.length !== 1) return null;
    const cell = selected[0], wrapper = object(cell.value_normalized), witness = object(wrapper?.evidence);
    if (cell.value_type !== type || !wrapper || !witness || witness.source_sha256 !== document!.content_sha256 ||
        (wrapper.original_sha256 !== undefined && wrapper.original_sha256 !== document!.content_sha256)) return null;
    return string(wrapper.value);
  }
  const explicitRole = observed('document_role', 'text');
  const docType = observed('doc_type', 'text');
  const role = ['purchase','refund','statement','payment'].includes(explicitRole || '') ? explicitRole as ReceiptContext['role']
    : ['receipt','invoice'].includes(docType || '') ? 'purchase'
    : docType === 'statement' ? 'statement' : 'unknown';
  if (role === 'unknown') gaps.push('supported_document_role');
  const receipt: ReceiptContext = { owner_id: authenticatedOwnerId, source_key: document.content_sha256,
    source_document_sha256: document.content_sha256, date: observed('document_date','date'),
    amount: observed('amount_ttc','amount'), currency: observed('currency','currency'), role,
    merchant: observed('issuer_name_raw','text'), card_last4: observed('card_last4','identifier') };
  const rows: ObjectValue[] = [], ids = new Set<string>(), sources = new Set<string>();
  let cursor: string | null = null, total: number | null = null, complete = false, pages = 0;
  for (; pages < 20;) {
    pages++;
    let response: {data: unknown; error: unknown};
    try { response = await db.rpc('read_financial_tax_workpapers',{p_owner_id:authenticatedOwnerId,p_after:cursor,p_limit:500}); }
    catch { gaps.push('accounting_reader_failed');break; }
    const page = object(response.data);
    if (response.error || !page || !Array.isArray(page.records) || page.records.length > 500 ||
        !Number.isSafeInteger(page.total_rows) || Number(page.total_rows)<0) {gaps.push('accounting_reader_failed');break;}
    if (total !== null && total !== page.total_rows) {gaps.push('population_changed_during_read');break;}
    total = Number(page.total_rows);
    if (page.controls_valid !== true || page.duplicate_source_keys !== 0 || page.duplicate_record_ids !== 0) {gaps.push('source_controls_invalid');break;}
    let invalid = false, last: string | null = cursor;
    for (const raw of page.records) {
      const row = object(raw), record = object(row?.record);
      if (!row || !record || !uuid(row.id) || (last !== null && row.id <= last) || ids.has(row.id) ||
          !hash(record.source_key) || sources.has(record.source_key) ||
          (row.owner_id !== undefined && row.owner_id !== authenticatedOwnerId) ||
          !['retained_bank_movement','retained_ledger_decision'].includes(String(record.record_kind))) {invalid=true;break;}
      ids.add(row.id);sources.add(record.source_key);last=row.id;rows.push(record);
    }
    if (invalid) {gaps.push('invalid_or_duplicate_source_record');break;}
    if (page.next_after !== (page.records.length ? last : null)) {gaps.push('invalid_page_cursor');break;}
    if (rows.length > total) {gaps.push('population_count_mismatch');break;}
    if (rows.length === total) {complete=true;break;}
    if (!page.records.length) {gaps.push('incomplete_source_population');break;}
    cursor=last;
  }
  if (!complete && pages===20 && !gaps.length) gaps.push('source_page_limit');
  const bank: BankContext[] = [], ledger: LedgerContext[] = [];
  const bankAliases = new Map<string,string[]>();
  for (const r of rows.filter(r=>r.record_kind==='retained_bank_movement')) {
    const key = String(r.source_key), id = string(r.local_id);
    if (id) bankAliases.set(id,[...(bankAliases.get(id)||[]),key]);
    bank.push({ owner_id:authenticatedOwnerId,source_key:key,date:string(r.date),amount:string(r.amount),
      currency:string(r.currency),merchant:null,card_last4:null,
      // Existing attributed section/category is retained; only explicit transfer/payment labels exclude cash movement.
      movement:r.section==='Transfer' || r.section==='Financing' ? 'transfer' : r.section==='Card payment' ? 'card_payment' : 'unknown' });
  }
  for (const r of rows.filter(r=>r.record_kind==='retained_ledger_decision')) {
    const links = Array.isArray(r.bank_links) ? r.bank_links.filter((x): x is string=>typeof x==='string') : [];
    ledger.push({owner_id:authenticatedOwnerId,source_key:String(r.source_key),date:string(r.date),amount:string(r.amount),
      currency:string(r.currency),section:string(r.section)||'Unknown',document_source_keys:[],
      // Unknown/ambiguous aliases do not become finalized links. Source CSV SHA is not original-image SHA.
      payment_source_keys:links.flatMap(link=>sources.has(link)?[link]:bankAliases.get(link)?.length===1?bankAliases.get(link)!:[]) });
  }
  if(bank.length>5000 || ledger.length>5000){complete=false;gaps.push('candidate_population_limit');}
  const context=financialCandidates(authenticatedOwnerId,receipt,bank.slice(0,5000),ledger.slice(0,5000),
    {date_window_days:7,source_population_complete:complete});
  return {...context,missing:[...new Set([...context.missing,...gaps])],population:{expected_rows:total,loaded_rows:rows.length,
    pages,complete,bank_rows:bank.length,ledger_rows:ledger.length},
    limits:{max_pages:20,page_size:500,max_bank_rows:5000,max_ledger_rows:5000},
    linkage_limit:'Current retained record contract has no explicit document-source link; amount/date/payment suggestions are not already-booked proof.'};
}
