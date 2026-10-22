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

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

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
}

function DocumentEvidence({ documentId }: { documentId: string }) {
  const [rows, setRows] = useState<ExtractionEvidence[]>([]);
  const [state, setState] = useState('Loading retained evidence…');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows([]); setCount(null); setState('Loading retained evidence…');
    Promise.resolve(supabase.from('financial_document_extractions')
      .select('id, field_key, value_normalized, extractor, extractor_model, is_superseded, superseded_by, created_at', { count: 'exact' })
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
  }, [documentId, page]);
  return <section aria-label="Retained document evidence" style={s.section}>
    <h2 style={s.sectionLabel}>RETAINED DOCUMENT EVIDENCE</h2>
    <p>{state} Newest first; page {page + 1}.</p>
    <details><summary>Document reference</summary>{documentId}</details>
    <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Newer evidence</button>{' '}
    <button type="button" disabled={(page + 1) * PAGE_SIZE >= (count ?? 0)} onClick={() => setPage(p => p + 1)}>Older evidence</button>
    {rows.map(row => <div key={row.id} style={s.td}>
      <strong>{row.field_key}</strong>: {JSON.stringify(row.value_normalized) ?? 'unknown'}
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
      setDocs([]); setDeals([]); setConcerns([]); setSelectedDocument(null); setErrors([]);
      setCounts({ docs: null, deals: null, concerns: null });
      setPage(0); setLoading(true); setSessionRevision(n => n + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
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
            'id, duplicate_of, doc_type, document_number, document_date, issuer_name_raw, recipient_name_raw, amount_ttc, currency, deal_number, review_status', { count: 'exact' }
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

      if (cancelled) return;

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
      if (cancelled) return;
      setDeals([]); setDocs([]); setConcerns([]);
      setErrors(['Financial records could not load. Totals and review coverage are unknown.']);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page, sessionRevision]);

  // ── Loading guard ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.container}>
        <h1 style={s.header}>PUBLISHING FINANCE</h1>
        <div style={s.loadingText}>LOADING</div>
      </div>
    );
  }

  // ── Access guard: owner-RLS'd tables return zero rows for non-operators ──
  if (!errors.length && page === 0 && deals.length === 0 && docs.length === 0 && concerns.length === 0) {
    return (
      <div style={s.container}>
        <h1 style={s.header}>PUBLISHING FINANCE</h1>
        <div style={s.accessLine}>
          No financial records are visible to this session. Financial data is owner-scoped; sign in with the appropriate operator account.
        </div>
      </div>
    );
  }

  const currencyTotals = invoicePageTotals(docs);
  const currentConcerns = concerns.filter(c => concernRevision(c) !== 'superseded');
  const priorConcerns = concerns.filter(c => concernRevision(c) === 'superseded');

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={s.container}>
      <h1 style={s.header}>PUBLISHING FINANCE</h1>

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
        <div style={s.section}>
          <div style={s.sectionLabel}>DOCUMENTS</div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>DATE</th>
                  <th style={s.th}>TYPE</th>
                  <th style={s.th}>NUMBER</th>
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
                    <td style={s.td}>{d.doc_type || '—'}</td>
                    <td style={s.tdMono}>{d.document_number || '—'}<br /><button type="button" onClick={() => setSelectedDocument(d.id)}>View evidence</button></td>
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
        </div>
      )}
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
