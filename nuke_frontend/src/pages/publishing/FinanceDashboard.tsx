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
}

interface FinancialDocumentRow {
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [dealRes, docRes] = await Promise.all([
        supabase
          .from('v_financial_deal_flow')
          .select(
            'deal_number, deal_type, deal_direction, advertiser_name_raw, counterparty_name_raw, invoiced_total, credited_total, currency, invoice_count, document_count, first_invoice_date'
          )
          .order('invoiced_total', { ascending: false }),
        supabase
          .from('financial_documents')
          .select(
            'doc_type, document_number, document_date, issuer_name_raw, recipient_name_raw, amount_ttc, currency, deal_number, review_status'
          )
          .order('document_date', { ascending: false })
          .limit(200),
      ]);

      if (cancelled) return;

      setDeals((dealRes.data as DealFlowRow[]) ?? []);
      setDocs((docRes.data as FinancialDocumentRow[]) ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
  if (deals.length === 0 && docs.length === 0) {
    return (
      <div style={s.container}>
        <h1 style={s.header}>PUBLISHING FINANCE</h1>
        <div style={s.accessLine}>
          OPERATOR ACCESS REQUIRED — financial data is owner-scoped. Sign in with
          an operator account.
        </div>
      </div>
    );
  }

  // ── Derived: invoiced totals per currency (from fetched doc rows) ────────
  // Sum amount_ttc grouped by currency; only factures (invoices), not credit
  // notes, so the strip reflects gross invoiced value.
  const totalsByCurrency: Record<string, number> = {};
  for (const d of docs) {
    const t = (d.doc_type || '').toLowerCase();
    const isFacture = t.includes('facture') || t.includes('invoice');
    if (!isFacture) continue;
    const cur = d.currency || '—';
    totalsByCurrency[cur] = (totalsByCurrency[cur] || 0) + (d.amount_ttc || 0);
  }
  const currencyTotals = Object.entries(totalsByCurrency).sort(
    (a, b) => b[1] - a[1]
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={s.container}>
      <h1 style={s.header}>PUBLISHING FINANCE</h1>

      {/* Stats strip */}
      <div style={s.statsBar}>
        <span>{docs.length} DOCS</span>
        <span>{deals.length} DEALS</span>
        {currencyTotals.map(([cur, total]) => (
          <span key={cur}>
            {formatAmount(total)} {cur} INVOICED
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
                    <td style={s.tdRight}>{formatAmount(d.invoiced_total)}</td>
                    <td style={s.tdRight}>{formatAmount(d.credited_total)}</td>
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
                {docs.map((d, i) => (
                  <tr key={`${d.document_number ?? 'x'}-${i}`} style={s.tr}>
                    <td style={s.tdMono}>{formatDate(d.document_date)}</td>
                    <td style={s.td}>{d.doc_type || '—'}</td>
                    <td style={s.tdMono}>{d.document_number || '—'}</td>
                    <td style={s.td}>{d.issuer_name_raw || '—'}</td>
                    <td style={s.td}>{d.recipient_name_raw || '—'}</td>
                    <td style={s.tdRight}>{formatAmount(d.amount_ttc)}</td>
                    <td style={s.tdMono}>{d.currency || '—'}</td>
                    <td style={s.tdMono}>{d.deal_number || '—'}</td>
                    <td style={s.td}>{d.review_status || '—'}</td>
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
