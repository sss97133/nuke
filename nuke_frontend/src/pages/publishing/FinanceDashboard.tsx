/**
 * FinanceDashboard
 *
 * Operator finance view for the publishing arm.
 * Route: /publishing/finance
 *
 * Data source (both owner-RLS'd — anon/unauthorized sessions get ZERO rows):
 *   - v_financial_deal_flow  (aggregated per-deal roll-up)
 *   - financial_documents    (individual invoices / credit notes)
 *
 * When both queries return empty, this is not an error state — it means the
 * session is not an operator. We render a single bordered access line and
 * nothing else (no empty tables, no dead boxes).
 */

import '../../styles/accounting.css';
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import FinancialSourceReview from '../../components/financial/FinancialSourceReview';
import FinancialDocumentLines from '../../components/finance/FinancialDocumentLines';
import FinancialEvidenceRestore from '../../components/financial/FinancialEvidenceRestore';
import FinancialWorkpapers from '../../components/finance/FinancialWorkpapers';
import FinancialDocumentIntake from '../../components/finance/FinancialDocumentIntake';
import { processExistingFinancialDocument } from '../../services/financialEvidenceIntake';

// ─── Row types (local — do not import types that may not exist) ────────────

interface DealFlowRow {
  deal_number: string | null;
  deal_type: string | null;
  deal_direction: string | null;
  advertiser_name_raw: string | null;
  counterparty_name_raw: string | null;
  invoiced_total: number | null;
  credited_total: number | null;
  currency: string | null;
  invoice_count: number | null;
  document_count: number | null;
  first_invoice_date: string | null;
  mixed_currency: boolean | null;
}

export interface FinancialDocumentRow {
  id: string;
  source_filename?: string | null;
  duplicate_of: string | null;
  doc_type: string | null;
  document_number: string | null;
  document_date: string | null;
  issuer_name_raw: string | null;
  recipient_name_raw: string | null;
  amount_ttc: number | null;
  currency: string | null;
  deal_number: string | null;
  review_status: string | null;
}

export interface ReviewConcern {
  id: string;
  document_id: string;
  concern_type: string;
  priority: string;
  status: string;
  detail: string | null;
  confidence_factors?: { extraction_run_id?: string } | null;
  document?: { attributes?: { runs?: { run_id?: string; supersedes_run_id?: string | null }[] } } | null;
}

// Superseded concerns remain testimony, not unresolved questions for the current reading.
export function concernRevision(row: ReviewConcern): 'current' | 'superseded' | 'unversioned' | 'unknown' {
  const runId = row.confidence_factors?.extraction_run_id;
  if (!runId) return 'unversioned';
  const runs = row.document?.attributes?.runs;
  if (!Array.isArray(runs) || !runs.some(run => run.run_id === runId)) return 'unknown';
  return runs.some(run => run.supersedes_run_id === runId) ? 'superseded' : 'current';
}

interface ExtractionEvidence {
  id: string; field_key: string; value_normalized: unknown; extractor: string;
  extractor_model: string | null; is_superseded: boolean; superseded_by: string | null; created_at: string | null;
  document?: { owner_id: string; content_sha256: string } | { owner_id: string; content_sha256: string }[] | null;
}

interface RedactedSource {
  contract: string; source_sha256: string; derivative_sha256: string; bucket: string; storage_path: string;
  mime_type: string; width: number; height: number; policy_version: string;
  verification: { pixel_masks: boolean; metadata_removed: boolean; embedded_text_removed: boolean;
    visual_reviewed: boolean; reviewer: string; reviewed_at: string };
}

export function reviewedSource(value: unknown, ownerId?: string, sourceHash?: string): RedactedSource | null {
  const envelope = value as { value?: unknown } | null;
  const v = (envelope && typeof envelope === 'object' && 'value' in envelope ? envelope.value : value) as RedactedSource | null;
  if (!v || !ownerId || !sourceHash || v.contract !== 'financial_redacted_source_v1' ||
    v.source_sha256 !== sourceHash || !/^[a-f0-9]{64}$/.test(v.derivative_sha256) ||
    v.bucket !== 'user-documents' || v.mime_type !== 'image/png' || v.policy_version !== 'financial-private-v1' ||
    v.storage_path !== `${ownerId}/redacted/${sourceHash}/${v.derivative_sha256}.png` ||
    ![v.width, v.height].every(n => Number.isSafeInteger(n) && n > 0) || v.width * v.height > 80_000_000 ||
    v.verification?.pixel_masks !== true || v.verification?.metadata_removed !== true ||
    v.verification?.embedded_text_removed !== true || v.verification?.visual_reviewed !== true ||
    typeof v.verification?.reviewer !== 'string' || !v.verification.reviewer.trim() ||
    !Number.isFinite(Date.parse(v.verification.reviewed_at))) return null;
  return v;
}

export async function verifySourceRaster(bytes: ArrayBuffer, source: RedactedSource) {
  const b = new Uint8Array(bytes);
  if (b.length < 45 || b.length > 20 * 1024 * 1024 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => b[i] !== n)) throw new Error('Invalid raster');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== source.derivative_sha256) throw new Error('Derivative hash mismatch');
  const view = new DataView(bytes);
  let offset = 8, data = false, ended = false;
  while (offset + 12 <= b.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...b.slice(offset + 4, offset + 8));
    if (offset + length + 12 > b.length || !['IHDR', 'IDAT', 'IEND'].includes(type)) throw new Error('Unexpected PNG metadata or text');
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || view.getUint32(16) !== source.width || view.getUint32(20) !== source.height || b[24] !== 8 || b[25] !== 2) throw new Error('Unexpected raster geometry');
    } else if (type === 'IHDR') throw new Error('Repeated PNG header');
    if (type === 'IDAT') data = true;
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && data && offset === b.length; break; }
  }
  if (!ended) throw new Error('Incomplete raster');
}

function RedactedDocumentSource({ row }: { row: ExtractionEvidence }) {
  const document = Array.isArray(row.document) ? (row.document.length === 1 ? row.document[0] : null) : row.document;
  const source = reviewedSource(row.value_normalized, document?.owner_id, document?.content_sha256);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false, objectUrl: string | null = null;
    setUrl(null); setError(false);
    if (!source || row.is_superseded) return;
    supabase.storage.from(source.bucket).download(source.storage_path).then(async ({ data, error }) => {
      if (error || !data) throw new Error('Derivative unavailable');
      const bytes = await data.arrayBuffer();
      await verifySourceRaster(bytes, source);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [row]);
  if (row.is_superseded) return <p>Source display review superseded.</p>;
  if (!source) return <p>Source display awaits a hash-linked redaction review.</p>;
  return <div>
    <p>Private redacted copy · Review attributed to {source.verification.reviewer} · {source.verification.reviewed_at}</p>
    {error ? <p>Redacted source could not be verified or loaded.</p> : url ?
      <img src={url} width={source.width} height={source.height} alt="Reviewed redacted document" style={{ maxWidth: '100%', height: 'auto' }} /> : <p>Verifying redacted source…</p>}
    <p>Line regions have not been established; no image overlay is asserted.</p>
  </div>;
}

function DocumentEvidence({ documentId }: { documentId: string }) {
  const [rows, setRows] = useState<ExtractionEvidence[]>([]);
  const [state, setState] = useState('Loading retained evidence…');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setRows([]); setCount(null); setState('Loading retained evidence…');
    Promise.resolve(supabase.from('financial_document_extractions')
      .select('id, field_key, value_normalized, extractor, extractor_model, is_superseded, superseded_by, created_at, document:financial_documents(owner_id, content_sha256)', { count: 'exact' })
      .eq('document_id', documentId).order('created_at', { ascending: false }).order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1))
      .then(({ data, error, count }) => {
        if (cancelled) return;
        if (error) { setState('Retained evidence could not load.'); return; }
        setCount(count);
        setRows((data || []) as ExtractionEvidence[]);
        setState(`${data?.length || 0} of ${count ?? 'unknown'} visible extraction records. Interpretations are not posted expenses.`);
      }).catch(() => { if (!cancelled) setState('Retained evidence could not load.'); });
    return () => { cancelled = true; };
  }, [documentId, page, reviewRevision]);
  return <section aria-label="Retained document evidence" style={s.section}>
    <h2 style={s.sectionLabel}>RETAINED DOCUMENT EVIDENCE</h2>
    <p>{state} Newest first; page {page + 1}.</p>
    <details><summary>Document reference</summary>{documentId}</details>
    <button type="button" disabled={processing} onClick={async () => {
      setProcessing(true); setProcessingMessage('Processing retained source…');
      try {
        const result = await processExistingFinancialDocument(documentId);
        setProcessingMessage(result.status === 'complete' ? 'Document processing complete. Review the accounting results.' : result.status === 'blocked' ? 'Source retained. Processing needs attention; inspect the evidence and concerns below.' : 'Source retained. Reconciliation needs review; inspect the evidence and concerns below.');
        setReviewRevision(n => n + 1);
      } catch (error) { setProcessingMessage(error instanceof Error ? error.message : 'Processing failed. Retry this retained source.'); }
      finally { setProcessing(false); }
    }}>{processing ? 'Processing…' : 'Resume document processing'}</button>
    {processingMessage && <p role="status">{processingMessage}</p>}
    <FinancialDocumentLines key={`${documentId}:${reviewRevision}`} documentId={documentId} />
    <FinancialSourceReview key={documentId} documentId={documentId} onComplete={() => setReviewRevision(n => n + 1)} />
    <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Newer evidence</button>{' '}
    <button type="button" disabled={(page + 1) * PAGE_SIZE >= (count ?? 0)} onClick={() => setPage(p => p + 1)}>Older evidence</button>
    {rows.map(row => <div key={row.id} style={s.td}>
      <strong>{row.field_key}</strong>: {row.field_key === 'redacted_source' ? <RedactedDocumentSource row={row} /> : JSON.stringify(row.value_normalized) ?? 'unknown'}
      <div>{row.extractor} {row.extractor_model} · {row.created_at || 'unknown recording date'}</div>
      <details><summary>Evidence reference</summary>{row.id}</details>
      <div>{row.is_superseded ? `Superseded by ${row.superseded_by || 'unknown revision'}` : 'Retained interpretation; acceptance not established'}</div>
    </div>)}
  </section>;
}

const PAGE_SIZE = 200;

// These are displayed-page invoice totals, never a complete ledger or tax deduction.
export function invoicePageTotals(docs: FinancialDocumentRow[]) {
  const totals: Record<string, number> = {};
  for (const d of docs) {
    if (d.duplicate_of || !['facture', 'invoice'].includes((d.doc_type || '').toLowerCase())) continue;
    if (d.amount_ttc == null || !Number.isFinite(Number(d.amount_ttc)) || !d.currency) continue;
    totals[d.currency] = (totals[d.currency] || 0) + Number(d.amount_ttc);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatAmount(n: number | null): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FinanceDashboard() {
  const generation = useRef(0);
  const [deals, setDeals] = useState<DealFlowRow[]>([]);
  const [docs, setDocs] = useState<FinancialDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [concerns, setConcerns] = useState<ReviewConcern[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<{ docs: number | null; deals: number | null; concerns: number | null }>({ docs: null, deals: null, concerns: null });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      generation.current++;
      setDocs([]); setDeals([]); setConcerns([]); setSelectedDocument(null); setErrors([]);
      setCounts({ docs: null, deals: null, concerns: null });
      setPage(0); setLoading(true); setSessionRevision(n => n + 1);
    });
    return () => { generation.current++; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = ++generation.current;
    setLoading(true);
    setErrors([]);
    setCounts({ docs: null, deals: null, concerns: null });

    async function load() {
      const [dealRes, docRes, queueRes] = await Promise.all([
        supabase
          .from('v_financial_deal_flow')
          .select(
            'deal_number, deal_type, deal_direction, advertiser_name_raw, counterparty_name_raw, invoiced_total, credited_total, currency, invoice_count, document_count, first_invoice_date, mixed_currency', { count: 'exact' }
          )
          .order('invoiced_total', { ascending: false })
          .limit(PAGE_SIZE),
        supabase
          .from('financial_documents')
          .select(
            'id, source_filename, duplicate_of, doc_type, document_number, document_date, issuer_name_raw, recipient_name_raw, amount_ttc, currency, deal_number, review_status', { count: 'exact' }
          )
          .order('document_date', { ascending: false, nullsFirst: false })
          .order('id')
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
        supabase.from('financial_review_queue')
          .select('id, document_id, concern_type, priority, status, detail, confidence_factors, document:financial_documents(attributes)', { count: 'exact' })
          .eq('status', 'pending')
          .order('created_at', { ascending: true }).order('id')
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
      ]);

      if (cancelled || generation.current !== request) return;

      setErrors([
        ...(dealRes.error ? ['Deal flow could not load.'] : []),
        ...(docRes.error ? ['Documents could not load; invoice totals are unknown.'] : []),
        ...(queueRes.error ? ['Review concerns could not load.'] : []),
      ]);
      setCounts({ docs: docRes.error ? null : docRes.count, deals: dealRes.error ? null : dealRes.count, concerns: queueRes.error ? null : queueRes.count });
      setConcerns((queueRes.data as ReviewConcern[]) ?? []);
      setDeals((dealRes.data as DealFlowRow[]) ?? []);
      setDocs((docRes.data as FinancialDocumentRow[]) ?? []);
      setLoading(false);
    }

    load().catch(() => {
      if (cancelled || generation.current !== request) return;
      setDeals([]); setDocs([]); setConcerns([]);
      setErrors(['Financial records could not load. Totals and review coverage are unknown.']);
      setLoading(false);
    });
    return () => {
      cancelled = true; if (generation.current === request) generation.current++;
    };
  }, [page, sessionRevision]);

  const noRecords = !errors.length && page === 0 && deals.length === 0 && docs.length === 0 && concerns.length === 0 && !selectedDocument;

  const currencyTotals = invoicePageTotals(docs);
  const currentConcerns = concerns.filter(c => concernRevision(c) !== 'superseded');
  const priorConcerns = concerns.filter(c => concernRevision(c) === 'superseded');

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="accounting-page" style={s.container}>
      <header className="accounting-header"><div><span className="accounting-eyebrow">PRIVATE ACCOUNT</span><h1>Accounting</h1><p>Your books, the documents behind them, and what still needs review.</p></div>
        <button type="button" onClick={() => setSessionRevision(n => n + 1)}>Refresh records</button></header>
      <FinancialWorkpapers revision={sessionRevision} onOpen={setSelectedDocument} />
      <div className="accounting-review-note"><strong>Tax review is a separate step</strong><p>Saved records do not establish that reconciliation, tax adjustments, signatures or filing are complete. Review the supporting decisions before using these figures in a return.</p></div>
      <details className="accounting-disclosure"><summary>Add documents <span>Receipts, invoices and supporting files</span></summary>
        <FinancialDocumentIntake onComplete={documentId => { setSelectedDocument(documentId); setSessionRevision(n => n + 1); }} />
      </details>
      <details className="accounting-disclosure accounting-advanced"><summary>Advanced: recover existing books <span>Import a prepared recovery bundle</span></summary>
        <FinancialEvidenceRestore onRestored={() => { setPage(0); setSessionRevision(n => n + 1); }} />
      </details>
      {loading ? <div style={s.loadingText}>LOADING</div> : noRecords ? <div style={s.accessLine}>
        No source documents are visible in this view yet. Use Add documents or the recovery tools above.
      </div> : <>
      {errors.map(error => <p role="alert" key={error}>{error}</p>)}
      <p>Page {page + 1}: {docs.length} of {counts.docs ?? 'unknown'} visible documents; {concerns.length} of {counts.concerns ?? 'unknown'} pending concern records across revision history.
        {' '}{deals.length} of {counts.deals ?? 'unknown'} visible deals shown. Invoice amounts below cover this document page only, exclude marked duplicates, and are not recognized expenses.</p>
      <div>
        <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous page</button>{' '}
        <button type="button" disabled={(page + 1) * PAGE_SIZE >= Math.max(counts.docs ?? 0, counts.concerns ?? 0)} onClick={() => setPage(p => p + 1)}>Next page</button>
      </div>
      {concerns.length > 0 && <section aria-label="Pending accounting concerns" style={s.section}>
        <h2 style={s.sectionLabel}>PENDING ACCOUNTING CONCERNS</h2>
        <p>{currentConcerns.length} current or unversioned concerns on this page; {priorConcerns.length} from superseded readings are retained below. Each concern is independent. A missing vehicle or unresolved party does not itself determine expense recognition.</p>
        <div style={s.tableWrap}><table style={s.table}>
          <thead><tr><th style={s.th}>Priority</th><th style={s.th}>Concern</th><th style={s.th}>Evidence document</th><th style={s.th}>Detail</th></tr></thead>
          <tbody>{currentConcerns.map(c => <tr key={c.id}>
            <td style={s.td}>{c.priority}</td><td style={s.td}>{c.concern_type}</td>
            <td style={s.tdMono}><button type="button" onClick={() => setSelectedDocument(c.document_id)}>View evidence</button></td>
            <td style={s.td}>{c.detail || 'No detail recorded'}{concernRevision(c) === 'unversioned' && <div>Unversioned concern</div>}{concernRevision(c) === 'unknown' && <div>Revision lineage unavailable; still requires review</div>}<details><summary>Concern reference</summary>{c.id}</details></td>
          </tr>)}</tbody>
        </table></div>
        {priorConcerns.length > 0 && <details><summary>Concerns from superseded readings ({priorConcerns.length})</summary>
          <p>These records retain their pending status in history. A later interpretation does not constitute an owner resolution.</p>
          {priorConcerns.map(c => <div key={c.id} style={s.td}>{c.concern_type}: {c.detail || 'No detail recorded'}{' '}
            <button type="button" onClick={() => setSelectedDocument(c.document_id)}>View evidence</button>
            <details><summary>Concern reference</summary>{c.id}</details>
          </div>)}
        </details>}
      </section>}

      {selectedDocument && <DocumentEvidence key={selectedDocument} documentId={selectedDocument} />}

      {/* Stats strip */}
      <div style={s.statsBar}>
        <span>{docs.length} DOCS</span>
        <span>{deals.length} DEALS</span>
        {currencyTotals.map(([cur, total]) => (
          <span key={cur}>
            {formatAmount(total)} {cur} INVOICED ON THIS PAGE
          </span>
        ))}
      </div>

      {/* DEAL FLOW */}
      {deals.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionLabel}>DEAL FLOW</div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>DEAL</th>
                  <th style={s.th}>TYPE</th>
                  <th style={s.th}>DIR</th>
                  <th style={s.th}>ADVERTISER</th>
                  <th style={s.th}>COUNTERPARTY</th>
                  <th style={s.thRight}>INVOICED</th>
                  <th style={s.thRight}>CREDITED</th>
                  <th style={s.th}>CUR</th>
                  <th style={s.thRight}>INV</th>
                  <th style={s.thRight}>DOCS</th>
                  <th style={s.th}>FIRST INVOICE</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d, i) => (
                  <tr key={`${d.deal_number ?? 'x'}-${i}`} style={s.tr}>
                    <td style={s.tdMono}>{d.deal_number || '—'}</td>
                    <td style={s.td}>{d.deal_type || '—'}</td>
                    <td style={s.td}>{d.deal_direction || '—'}</td>
                    <td style={s.td}>{d.advertiser_name_raw || '—'}</td>
                    <td style={s.td}>{d.counterparty_name_raw || '—'}</td>
                    <td style={s.tdRight}>{d.mixed_currency ? 'MIXED CURRENCIES' : formatAmount(d.invoiced_total)}</td>
                    <td style={s.tdRight}>{d.mixed_currency ? 'MIXED CURRENCIES' : formatAmount(d.credited_total)}</td>
                    <td style={s.tdMono}>{d.currency || '—'}</td>
                    <td style={s.tdRight}>{d.invoice_count ?? '—'}</td>
                    <td style={s.tdRight}>{d.document_count ?? '—'}</td>
                    <td style={s.tdMono}>{formatDate(d.first_invoice_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DOCUMENTS */}
      {docs.length > 0 && (
        <details className="accounting-disclosure" style={s.section}>
          <summary>Source documents <span>{docs.length} shown on this page</span></summary>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>DATE</th>
                  <th style={s.th}>TYPE</th>
                  <th style={s.th}>SOURCE DOCUMENT</th>
                  <th style={s.th}>ISSUER</th>
                  <th style={s.th}>RECIPIENT</th>
                  <th style={s.thRight}>AMOUNT TTC</th>
                  <th style={s.th}>CUR</th>
                  <th style={s.th}>DEAL</th>
                  <th style={s.th}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} id={`financial-document-${d.id}`} style={s.tr}>
                    <td style={s.tdMono}>{formatDate(d.document_date)}</td>
                    <td style={s.td}>{d.doc_type || 'Not classified'}</td>
                    <td style={s.tdMono}>{d.source_filename || d.document_number || 'Source document'}<br /><button type="button" onClick={() => setSelectedDocument(d.id)}>View evidence</button></td>
                    <td style={s.td}>{d.issuer_name_raw || '—'}</td>
                    <td style={s.td}>{d.recipient_name_raw || '—'}</td>
                    <td style={s.tdRight}>{formatAmount(d.amount_ttc)}</td>
                    <td style={s.tdMono}>{d.currency || '—'}</td>
                    <td style={s.tdMono}>{d.deal_number || '—'}</td>
                    <td style={s.td}>{d.review_status || '—'}{d.duplicate_of && <><br />Duplicate of {d.duplicate_of}</>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      </>}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 12px',
    maxWidth: '1200px',
    margin: '0 auto',
    fontFamily: 'Arial, sans-serif',
    color: 'var(--text)',
  },
  header: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text)',
    margin: 0,
    padding: 'var(--space-3) 0',
  },
  loadingText: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    padding: 'var(--space-6) 0',
  },
  accessLine: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    border: '2px solid var(--border)',
    borderRadius: 0,
    padding: 'var(--space-3)',
    lineHeight: 1.5,
  },
  statsBar: {
    display: 'flex',
    gap: 'var(--space-4)',
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-4)',
    borderBottom: '2px solid var(--border)',
    paddingBottom: 'var(--space-2)',
    flexWrap: 'wrap',
  },
  section: {
    marginBottom: 'var(--space-5)',
  },
  sectionLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-2)',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '2px solid var(--border)',
    borderRadius: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'Arial, sans-serif',
  },
  th: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    textAlign: 'left',
    padding: 'var(--space-2)',
    borderBottom: '2px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  thRight: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    textAlign: 'right',
    padding: 'var(--space-2)',
    borderBottom: '2px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid var(--border)',
  },
  td: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    color: 'var(--text)',
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'top',
  },
  tdMono: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text)',
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
  },
  tdRight: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--text)',
    padding: 'var(--space-2)',
    borderBottom: '1px solid var(--border)',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
  },
};
