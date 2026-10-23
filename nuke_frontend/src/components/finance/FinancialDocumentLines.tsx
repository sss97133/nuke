import { useAccountingBook } from './AccountingBookContext';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface FinancialLine {
  id: string; line_number: number; description: string | null; reference_code: string | null; quantity: number | null;
  attributes?: { staging?: { amount?: string | null; unit_price?: string | null; currency?: string | null;
    source_line_key?: string; source_row?: number; source_file_sha256?: string; issues?: string[]; geometry?: unknown };
    accounting_record?: unknown; recognition_status?: string; payment_status?: string; reimbursement_status?: string };
}
export function FinancialLineTable({ lines }: { lines: FinancialLine[] }) {
  const items = lines.filter(line => !!line.attributes?.staging && !line.attributes?.accounting_record);
  if (!items.length) return null;
  return <section aria-label="Retained document items">
    <h3 style={{ fontSize: 12 }}>DOCUMENT ITEMS</h3>
    <p>{items.length} retained items. Observed amounts have no established tax basis. Payment and expense recognition remain separate.</p>
    <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th scope="col">LINE</th><th scope="col">DESCRIPTION / SKU</th><th scope="col">QUANTITY</th><th scope="col">UNIT PRICE</th><th scope="col">OBSERVED AMOUNT</th><th scope="col">EVIDENCE / STATUS</th></tr></thead>
      <tbody>{items.map(line => { const source=line.attributes!.staging!;return <tr key={line.id}>
        <td>{line.line_number}</td><td>{line.description || 'Unresolved description'}{line.reference_code && <div>{line.reference_code}</div>}</td>
        <td>{line.quantity ?? 'Not extracted'}</td><td>{source.unit_price ?? 'Not extracted'}</td>
        <td>{source.amount ?? 'Unresolved'} {source.currency || '(currency unresolved)'}</td>
        <td><div>{line.attributes?.recognition_status || 'Recognition not assessed'} · {line.attributes?.payment_status || 'Payment unresolved'} · {line.attributes?.reimbursement_status || 'Reimbursement unresolved'}</div>
          {source.issues?.length ? <div>{source.issues.join('; ')}</div> : null}
          <details><summary>Source reference</summary><div>Source row: {source.source_row ?? 'Unknown'}</div><div>Source file SHA-256: {source.source_file_sha256 || 'Unknown'}</div><div>Retained line: {source.source_line_key || 'Unknown'}</div><div>{source.geometry ? 'Region evidence retained' : 'Image region not retained'}</div></details>
        </td>
      </tr>;})}</tbody>
    </table></div>
  </section>;
}

interface AccountingContext {
  status?: string;
  missing?: string[];
  bank_candidates?: { source_key: string; days_difference: number; witnesses: string[] }[];
  already_booked?: { source_key: string; section: string; basis: string }[];
  ledger_candidates?: { source_key: string; section: string; basis: string }[];
  population?: { loaded_rows: number; expected_rows: number | null; complete: boolean };
}
const missingLabels: Record<string, string> = {
  valid_observed_amount: 'A supported document amount', valid_document_date: 'A readable document date',
  supported_currency: 'The currency supported by the source', supported_document_role: 'The kind of document',
  nonzero_purchase_or_refund_amount: 'A purchase or refund amount', consistent_document_role_and_sign: 'Agreement between the amount and purchase or refund description',
  accounting_reader_failed: 'Some saved accounting records could not be read', population_changed_during_read: 'Accounting records changed during the search',
  source_controls_invalid: 'Repeated or conflicting accounting records need checking', invalid_or_duplicate_source_record: 'A source record needs checking',
  invalid_page_cursor: 'Part of the accounting history could not be followed', population_count_mismatch: 'The record count needs checking',
  incomplete_source_population: 'More accounting records remain to be searched', source_page_limit: 'More accounting records remain to be searched',
  candidate_population_limit: 'More accounting records remain to be compared',
};
function AccountingContextSummary({ context }: { context: AccountingContext | null }) {
  if (!context) return null;
  const candidates = Array.isArray(context.bank_candidates) ? context.bank_candidates : [];
  const recorded = (context.already_booked || []).filter(row => row.basis === 'explicit_document_source_link');
  const possibleEntries = context.ledger_candidates || [];
  const missing = [...new Set((context.missing || []).map(key => missingLabels[key] || 'Additional source information needs checking'))];
  const population = context.population;
  return <section aria-label="Accounting comparison">
    <h3 style={{ fontSize: 12 }}>ACCOUNTING COMPARISON</h3>
    {population && <p>{population.loaded_rows} of {population.expected_rows ?? 'an unknown number of'} saved records searched.
      {population.complete ? ' This covers the records currently available in your account.' : ' The search is partial; additional matches may exist.'}</p>}
    {recorded.length > 0 ? <p>{recorded.length} existing accounting {recorded.length === 1 ? 'entry is' : 'entries are'} explicitly linked to this document. This does not establish payment or tax treatment.</p> : <p>No explicit link to an existing accounting entry has been established.</p>}
    {candidates.length ? <><p>{candidates.length} possible bank {candidates.length === 1 ? 'transaction' : 'transactions'}. These are suggestions awaiting reconciliation.</p>
      <ul>{candidates.map((candidate,index) => <li key={candidate.source_key}>Possible transaction {index + 1}: {candidate.days_difference === 0 ? 'same date as the document' : `${Math.abs(candidate.days_difference)} days ${candidate.days_difference > 0 ? 'after' : 'before'} the document`}.
        {candidate.witnesses.includes('same_merchant_literal') ? ' Merchant text also agrees.' : ''}
        {candidate.witnesses.includes('same_card_suffix_candidate_only') ? ' Card ending also agrees.' : ''}
        <details><summary>Saved transaction reference</summary>{candidate.source_key}</details></li>)}</ul></>
      : context.status === 'ineligible' ? <p>This document is not being compared as a purchase or refund.</p>
      : context.status === 'missing' ? <p>Payment comparison is waiting for supported source information.</p>
      : context.status === 'unmatched' ? <p>No matching bank transaction was found in the records searched.</p>
      : <p>Payment comparison is not available yet.</p>}
    {possibleEntries.length > 0 && <p>{possibleEntries.length} possible existing accounting {possibleEntries.length === 1 ? 'entry needs' : 'entries need'} comparison. Similar dates or amounts do not prove the purchase was already recorded.</p>}
    {missing.length > 0 && <><p>Still unresolved:</p><ul>{missing.map(label => <li key={label}>{label}</li>)}</ul></>}
    <p>These comparisons do not add an expense or establish who paid or was reimbursed.</p>
  </section>;
}

export default function FinancialDocumentLines({ documentId }: { documentId: string }) {
  const { ownerId, shared } = useAccountingBook();
  const [lines,setLines]=useState<FinancialLine[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [context,setContext]=useState<AccountingContext|null>(null);
  useEffect(()=>{
    let cancelled=false;
    setLines([]);setError(null);setContext(null);
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      cancelled=true;setLines([]);setError(null);setContext(null);
    });
    void supabase.functions.invoke('ingest-observation',{body:{mode:'financial_evidence_v1',action:'read',document_id:documentId,...(shared ? {owner_user_id:ownerId} : {})}})
      .then(({data,error})=>{
        if(cancelled)return;
        if(error || data?.error){setError('Document items could not load.');return;}
        setContext(data?.data?.context || null);
        if(!Array.isArray(data?.data?.lines)){setError('Document item extraction is not available yet.');return;}
        setLines(data.data.lines);
      }).catch(()=>{if(!cancelled)setError('Document items could not load.');});
    return()=>{cancelled=true;subscription.unsubscribe();};
  },[documentId,ownerId,shared]);
  return <>{error && <p role="status">{error}</p>}<AccountingContextSummary context={context}/><FinancialLineTable lines={lines}/></>;
}
