/**
 * WorkOrderStatement — Two modes:
 * 1. INVOICE (default) — clean auto shop invoice, printable, customer-facing
 * 2. EDIT — full CRUD with inline editing, status dropdowns, provenance (owner view)
 *
 * Route: /work-orders/statement?q=granholm (or ?vehicle_id=UUID)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  useWorkOrderStatement,
  type PartRow,
  type LaborRow,
  type PaymentRow,
} from './vehicle-profile/hooks/useWorkOrderStatement';

// ── Helpers ──

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const fmtDateShort = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ══════════════════════════════════════════════════════════════
// INVOICE VIEW — clean auto shop invoice
// ══════════════════════════════════════════════════════════════

type InvoiceTheme = 'classic' | 'modern' | 'dealer';

const InvoiceView: React.FC<{ data: any; onEdit: () => void; onSend: () => void; sending: boolean; sentStatus: string; theme: InvoiceTheme; onThemeChange: (t: InvoiceTheme) => void }> = ({ data, onEdit, onSend, sending, sentStatus, theme, onThemeChange }) => {
  const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');
  const invoiceDate = fmtDate(new Date().toISOString());
  const invoiceNum = `INV-${(data.vehicle.model || 'VEH').replace(/\s+/g, '').toUpperCase().slice(0, 6)}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;

  // Collect all billable and comped parts/labor across work orders
  const allParts: PartRow[] = [];
  const allLabor: LaborRow[] = [];
  const compedParts: PartRow[] = [];
  const compedLabor: LaborRow[] = [];
  for (const wo of data.workOrders) {
    for (const p of (data.parts[wo.id] || [])) {
      if (['cancelled', 'returned', 'wrong_order', 'not_used'].includes(p.status || '')) continue;
      if (p.is_comped) { compedParts.push(p); } else { allParts.push(p); }
    }
    for (const l of (data.labor[wo.id] || [])) {
      if (['cancelled', 'not_needed'].includes(l.status || '')) continue;
      if (l.is_comped) { compedLabor.push(l); } else { allLabor.push(l); }
    }
  }

  // Theme styles
  const T = theme === 'classic' ? CLASSIC : theme === 'dealer' ? DEALER : INV;

  return (
    <div style={T.page}>
      <div style={T.paper}>

        {/* Theme picker — not printed */}
        <div className="no-print" style={{ display: 'flex', gap: '6px', marginBottom: '12px', justifyContent: 'flex-end' }}>
          {(['classic', 'modern', 'dealer'] as InvoiceTheme[]).map(t => (
            <button key={t} onClick={() => onThemeChange(t)} style={{
              padding: '4px 12px', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'Arial',
              border: theme === t ? '2px solid #1a1a1a' : '1px solid #ccc',
              background: theme === t ? '#1a1a1a' : 'transparent',
              color: theme === t ? '#fff' : '#888',
            }}>{t}</button>
          ))}
        </div>

        {/* Shop Header */}
        <div style={T.shopHeader}>
          <div>
            <div style={T.shopName}>NUKE</div>
            <div style={T.shopDetail}>Vehicle Build & Service</div>
            <div style={T.shopDetail}>Las Vegas, NV</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={T.invoiceTitle}>INVOICE</div>
            <table style={T.metaTable}>
              <tbody>
                <tr><td style={T.metaLabel}>Invoice #</td><td style={T.metaValue}>{invoiceNum}</td></tr>
                <tr><td style={T.metaLabel}>Date</td><td style={T.metaValue}>{invoiceDate}</td></tr>
                <tr><td style={T.metaLabel}>Terms</td><td style={T.metaValue}>Due on Receipt</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={T.divider} />

        {/* Bill To / Vehicle */}
        <div style={T.infoRow}>
          <div>
            <div style={T.infoLabel}>BILL TO</div>
            {data.contact ? (
              <>
                <div style={T.infoName}>{data.contact.name}</div>
                {data.contact.email && <div style={T.infoLine}>{data.contact.email}</div>}
                {data.contact.phone && <div style={T.infoLine}>{data.contact.phone}</div>}
              </>
            ) : (
              <div style={T.infoLine}>—</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={T.infoLabel}>VEHICLE</div>
            <div style={T.infoName}>{vehicleTitle}</div>
            {data.vehicle.vin && <div style={T.infoLine}>VIN: {data.vehicle.vin}</div>}
          </div>
        </div>

        <div style={T.divider} />

        {/* Parts */}
        {allParts.length > 0 && (
          <>
            <div style={T.sectionTitle}>Parts & Materials</div>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={T.th}>Description</th>
                  <th style={{ ...T.th, textAlign: 'center', width: '50px' }}>Qty</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Unit Price</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {allParts.map(p => (
                  <tr key={p.id}>
                    <td style={T.td}>{p.part_name}</td>
                    <td style={{ ...T.td, textAlign: 'center' }}>{p.quantity}</td>
                    <td style={{ ...T.td, textAlign: 'right' }}>{p.unit_price != null ? fmt(p.unit_price) : '—'}</td>
                    <td style={{ ...T.td, textAlign: 'right', fontWeight: 600 }}>{p.total_price != null ? fmt(p.total_price) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #333' }}>Parts Subtotal</td>
                  <td style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #333' }}>{fmt(data.totals.parts)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {/* Labor */}
        {allLabor.length > 0 && (
          <>
            <div style={{ ...T.sectionTitle, marginTop: '20px' }}>Labor</div>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={T.th}>Description</th>
                  <th style={{ ...T.th, textAlign: 'center', width: '50px' }}>Hours</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Rate</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {allLabor.map(l => (
                  <tr key={l.id}>
                    <td style={T.td}>{l.task_name}</td>
                    <td style={{ ...T.td, textAlign: 'center' }}>{l.hours > 0 ? l.hours : '—'}</td>
                    <td style={{ ...T.td, textAlign: 'right' }}>{l.hourly_rate != null && l.hourly_rate > 0 ? fmt(l.hourly_rate) + '/hr' : 'Flat'}</td>
                    <td style={{ ...T.td, textAlign: 'right', fontWeight: 600 }}>{l.total_cost != null ? fmt(l.total_cost) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #333' }}>Labor Subtotal</td>
                  <td style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #333' }}>{fmt(data.totals.labor)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {/* Totals — with tax breakout */}
        {(() => {
          // Compute pre-tax parts total and tax amount
          let partsPreTax = 0;
          let partsTax = 0;
          for (const p of allParts) {
            const pretax = (p.unit_price || 0) * (p.quantity || 1);
            const total = p.total_price || 0;
            if (p.is_taxable && total > pretax) {
              partsPreTax += pretax;
              partsTax += total - pretax;
            } else {
              partsPreTax += total;
            }
          }
          partsPreTax = Math.round(partsPreTax * 100) / 100;
          partsTax = Math.round(partsTax * 100) / 100;
          const partsWithTax = Math.round((partsPreTax + partsTax) * 100) / 100;
          const subtotal = partsWithTax + data.totals.labor;
          const balance = subtotal - data.totals.payments;

          return (
            <div style={T.totalsSection}>
              <div style={T.totalLine}>
                <span>Parts</span>
                <span>{fmt(partsPreTax)}</span>
              </div>
              <div style={T.totalLine}>
                <span>Labor</span>
                <span>{fmt(data.totals.labor)}</span>
              </div>
              {partsTax > 0 && (
                <div style={{ ...T.totalLine, color: '#888', fontSize: '10px' }}>
                  <span>Sales Tax (8.375%)</span>
                  <span>{fmt(partsTax)}</span>
                </div>
              )}
              <div style={{ ...T.totalLine, borderTop: '1px solid #ccc', paddingTop: '6px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700 }}>Subtotal</span>
                <span style={{ fontWeight: 700 }}>{fmt(subtotal)}</span>
              </div>
              {data.totals.payments > 0 && (
                <div style={{ ...T.totalLine, color: '#006847' }}>
                  <span>Payments Received</span>
                  <span>({fmt(data.totals.payments)})</span>
                </div>
              )}
              <div style={T.balanceDue}>
                <span>BALANCE DUE</span>
                <span>{fmt(balance)}</span>
              </div>
            </div>
          );
        })()}

        {/* Payments Received */}
        {data.totals.payments > 0 && (
          <>
            <div style={{ ...T.sectionTitle, marginTop: '20px' }}>Payments Received</div>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={T.th}>Date</th>
                  <th style={T.th}>Method</th>
                  <th style={T.th}>Memo</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.workOrders.flatMap((wo: any) =>
                  (data.payments[wo.id] || []).filter((pm: PaymentRow) => pm.status === 'completed').map((pm: PaymentRow) => (
                    <tr key={pm.id}>
                      <td style={T.td}>{pm.payment_date ? fmtDateShort(pm.payment_date) : '—'}</td>
                      <td style={{ ...T.td, textTransform: 'capitalize' }}>{pm.payment_method}</td>
                      <td style={T.td}>{pm.memo || '—'}</td>
                      <td style={{ ...T.td, textAlign: 'right', fontWeight: 600, color: '#006847' }}>{fmt(pm.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}

        {/* Goodwill — itemized courtesy items */}
        {(compedParts.length > 0 || compedLabor.length > 0) && (
          <>
            <div style={{ ...T.sectionTitle, marginTop: '14px', color: '#8B6914' }}>Courtesy — No Charge</div>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={T.th}>Description</th>
                  <th style={{ ...T.th, width: '60px' }}>Type</th>
                  <th style={{ ...T.th, textAlign: 'right', width: '80px' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {compedParts.map(p => (
                  <tr key={p.id}>
                    <td style={T.td}>{p.part_name}{p.comp_reason ? <span style={{ color: '#999', marginLeft: '6px' }}>— {p.comp_reason}</span> : null}</td>
                    <td style={{ ...T.td, color: '#888' }}>Part</td>
                    <td style={{ ...T.td, textAlign: 'right', color: '#8B6914' }}>{fmt(p.comp_retail_value || p.total_price || (p.unit_price || 0) * (p.quantity || 1))}</td>
                  </tr>
                ))}
                {compedLabor.map(l => (
                  <tr key={l.id}>
                    <td style={T.td}>{l.task_name}{l.comp_reason ? <span style={{ color: '#999', marginLeft: '6px' }}>— {l.comp_reason}</span> : null}</td>
                    <td style={{ ...T.td, color: '#888' }}>Labor</td>
                    <td style={{ ...T.td, textAlign: 'right', color: '#8B6914' }}>{fmt(l.comp_retail_value || l.total_cost || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #8B6914', color: '#8B6914' }}>Total Courtesy Value</td>
                  <td style={{ ...T.td, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #8B6914', color: '#8B6914' }}>{fmt(data.totals.goodwill)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {/* Footer */}
        <div style={T.footer}>
          <div>Thank you for your business.</div>
          <div style={{ marginTop: '4px', fontSize: '10px', color: '#999' }}>
            Payment due upon receipt. Questions? Contact us at nuke.ag
          </div>
        </div>

        {/* Action bar — not printed */}
        <div style={T.actionBar} className="no-print">
          <button onClick={onEdit} style={T.editBtn}>EDIT</button>
          <button onClick={() => window.print()} style={T.printBtn}>PRINT</button>
          {data.contact?.email && (
            <button
              onClick={onSend}
              disabled={sending || sentStatus === 'sent'}
              style={{
                ...T.sendBtn,
                opacity: sending ? 0.6 : 1,
                background: sentStatus === 'sent' ? '#006847' : '#1a1a1a',
              }}
            >
              {sending ? 'SENDING...' : sentStatus === 'sent' ? 'SENT' : 'SEND TO CUSTOMER'}
            </button>
          )}
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }
          @page { margin: 0.4in 0.5in; size: letter; }
        }
      `}</style>
    </div>
  );
};

const INV = {
  page: {
    minHeight: '100vh',
    background: '#f0f0f0',
    padding: '20px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '11px',
    color: '#1a1a1a',
    lineHeight: 1.2,
  } as React.CSSProperties,

  paper: {
    maxWidth: '800px',
    margin: '0 auto',
    background: '#fff',
    padding: '24px 36px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  } as React.CSSProperties,

  shopHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  } as React.CSSProperties,

  shopName: {
    fontSize: '22px',
    fontWeight: 800,
    letterSpacing: '0.08em',
    lineHeight: 1,
  } as React.CSSProperties,

  shopDetail: {
    fontSize: '11px',
    color: '#666',
    marginTop: '2px',
  } as React.CSSProperties,

  invoiceTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#1a1a1a',
    letterSpacing: '0.04em',
  } as React.CSSProperties,

  metaTable: {
    marginTop: '6px',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
  } as React.CSSProperties,

  metaLabel: {
    padding: '1px 12px 1px 0',
    color: '#888',
    textAlign: 'right' as const,
    fontWeight: 600,
  } as React.CSSProperties,

  metaValue: {
    padding: '1px 0',
    fontWeight: 400,
  } as React.CSSProperties,

  divider: {
    borderTop: '2px solid #1a1a1a',
    margin: '8px 0',
  } as React.CSSProperties,

  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  } as React.CSSProperties,

  infoLabel: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: '#888',
    marginBottom: '4px',
  } as React.CSSProperties,

  infoName: {
    fontSize: '11px',
    fontWeight: 700,
  } as React.CSSProperties,

  infoLine: {
    fontSize: '10px',
    color: '#555',
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#888',
    marginBottom: '2px',
    marginTop: '6px',
  } as React.CSSProperties,

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '10px',
  } as React.CSSProperties,

  th: {
    textAlign: 'left' as const,
    padding: '2px 6px',
    borderBottom: '2px solid #333',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#888',
  } as React.CSSProperties,

  td: {
    padding: '2px 6px',
    borderBottom: '1px solid #e5e5e5',
    verticalAlign: 'top' as const,
  } as React.CSSProperties,

  totalsSection: {
    marginTop: '12px',
    marginLeft: 'auto',
    width: '250px',
    fontSize: '11px',
  } as React.CSSProperties,

  totalLine: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 0',
  } as React.CSSProperties,

  balanceDue: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0 0',
    marginTop: '4px',
    borderTop: '3px solid #1a1a1a',
    fontSize: '14px',
    fontWeight: 800,
  } as React.CSSProperties,

  goodwillNote: {
    marginTop: '12px',
    padding: '6px 10px',
    background: '#f9f6f0',
    border: '1px solid #e8e0d0',
    fontSize: '11px',
    color: '#8B6914',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,

  footer: {
    marginTop: '20px',
    paddingTop: '8px',
    borderTop: '1px solid #ddd',
    textAlign: 'center' as const,
    fontSize: '12px',
    color: '#666',
  } as React.CSSProperties,

  actionBar: {
    display: 'flex',
    gap: '8px',
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #eee',
  } as React.CSSProperties,

  editBtn: {
    padding: '10px 20px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    border: '2px solid #ccc',
    background: 'transparent',
    color: '#666',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,

  printBtn: {
    padding: '10px 20px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    border: '2px solid #1a1a1a',
    background: 'transparent',
    color: '#1a1a1a',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,

  sendBtn: {
    flex: 1,
    padding: '10px 20px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    border: '2px solid #1a1a1a',
    background: '#1a1a1a',
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,
};


// ── CLASSIC theme — yellow carbon copy shop invoice ──
const CLASSIC: typeof INV = {
  ...INV,
  page: { ...INV.page, background: '#e8e0d0' },
  paper: { ...INV.paper, background: '#fffef5', border: '3px double #8B7355', padding: '28px 36px' },
  shopName: { ...INV.shopName, fontSize: '26px', fontFamily: 'Georgia, serif', fontWeight: 800, letterSpacing: '0.12em' },
  shopDetail: { ...INV.shopDetail, fontFamily: 'Georgia, serif', fontStyle: 'italic' },
  invoiceTitle: { ...INV.invoiceTitle, fontFamily: 'Georgia, serif', fontSize: '20px', borderBottom: '2px solid #8B7355', paddingBottom: '4px' },
  divider: { borderTop: '2px solid #8B7355', margin: '10px 0' },
  sectionTitle: { ...INV.sectionTitle, color: '#5C4033', fontFamily: 'Georgia, serif', borderBottom: '1px solid #c4b69c', paddingBottom: '2px' },
  th: { ...INV.th, borderBottom: '2px solid #8B7355', color: '#5C4033', fontFamily: 'Georgia, serif' },
  td: { ...INV.td, borderBottom: '1px solid #d9cdb5' },
  totalsSection: { ...INV.totalsSection, background: '#f5f0e0', padding: '10px 14px', border: '1px solid #c4b69c' },
  balanceDue: { ...INV.balanceDue, borderTop: '3px double #8B7355', color: '#5C4033' },
  footer: { ...INV.footer, fontFamily: 'Georgia, serif', fontStyle: 'italic', borderTop: '2px solid #8B7355' },
  goodwillNote: { ...INV.goodwillNote, background: '#f5f0e0', border: '1px solid #c4b69c' },
  infoLabel: { ...INV.infoLabel, color: '#5C4033', fontFamily: 'Georgia, serif' },
  metaLabel: { ...INV.metaLabel, color: '#5C4033' },
};

// ── DEALER theme — dark header, professional service receipt ──
const DEALER: typeof INV = {
  ...INV,
  page: { ...INV.page, background: '#eee' },
  paper: { ...INV.paper, padding: '0', overflow: 'hidden' },
  shopHeader: { ...INV.shopHeader, background: '#1a1a1a', color: '#fff', padding: '20px 32px', margin: 0 },
  shopName: { ...INV.shopName, color: '#fff', fontSize: '24px', letterSpacing: '0.15em' },
  shopDetail: { ...INV.shopDetail, color: '#aaa' },
  invoiceTitle: { ...INV.invoiceTitle, color: '#fff', fontSize: '16px' },
  metaTable: { ...INV.metaTable, color: '#ccc' },
  metaLabel: { ...INV.metaLabel, color: '#888' },
  metaValue: { ...INV.metaValue, color: '#fff' },
  divider: { borderTop: '3px solid #C8102E', margin: '0' },
  infoRow: { ...INV.infoRow, padding: '16px 32px' },
  infoLabel: { ...INV.infoLabel, color: '#C8102E' },
  sectionTitle: { ...INV.sectionTitle, color: '#C8102E', marginLeft: '32px', marginRight: '32px' },
  table: { ...INV.table, margin: '0 32px', width: 'calc(100% - 64px)' },
  th: { ...INV.th, borderBottom: '2px solid #C8102E', color: '#666' },
  td: { ...INV.td, borderBottom: '1px solid #eee' },
  totalsSection: { ...INV.totalsSection, marginRight: '32px', padding: '12px 16px', background: '#f8f8f8' },
  balanceDue: { ...INV.balanceDue, borderTop: '3px solid #C8102E', color: '#C8102E' },
  footer: { ...INV.footer, background: '#1a1a1a', color: '#888', padding: '16px 32px', margin: 0, borderTop: 'none' },
  goodwillNote: { ...INV.goodwillNote, margin: '12px 32px', background: '#f0f8f0', border: '1px solid #cde0cd' },
  actionBar: { ...INV.actionBar, padding: '12px 32px' },
};


// ══════════════════════════════════════════════════════════════
// EDIT VIEW — full CRUD, inline editing, provenance, status
// ══════════════════════════════════════════════════════════════

// ── Inline Cell Editor ──

interface CellEditorProps {
  value: any;
  type?: 'text' | 'number';
  format?: 'currency' | 'plain';
  onSave: (value: any) => void;
  style?: React.CSSProperties;
  placeholder?: string;
}

const CellEditor: React.FC<CellEditorProps> = ({ value, type = 'text', format = 'currency', onSave, style, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveRef = useRef<NodeJS.Timeout>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditValue(value ?? ''); }, [value]);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const doSave = useCallback(async (val: any) => {
    const parsed = type === 'number' ? (val === '' ? null : Number(val)) : val;
    if (parsed === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(parsed); setSaved(true); setTimeout(() => setSaved(false), 1500); } catch { setEditValue(value ?? ''); }
    setSaving(false);
    setEditing(false);
  }, [value, type, onSave]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => doSave(e.target.value), 1500);
  };

  if (editing) {
    return (
      <div style={{ position: 'relative', ...style }}>
        <input ref={inputRef} type={type} step={type === 'number' ? '0.01' : undefined} value={editValue}
          onChange={handleChange}
          onBlur={() => { if (saveRef.current) clearTimeout(saveRef.current); doSave(editValue); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (saveRef.current) clearTimeout(saveRef.current); doSave(editValue); } if (e.key === 'Escape') { setEditValue(value ?? ''); setEditing(false); } }}
          placeholder={placeholder}
          style={{ width: '100%', border: '1px solid var(--vp-gulf-orange, #EE7623)', padding: '1px 4px', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 'inherit', textAlign: 'inherit', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
        />
        {saving && <span style={{ position: 'absolute', right: '-40px', top: '50%', transform: 'translateY(-50%)', fontSize: '7px', color: 'var(--vp-gulf-orange)', whiteSpace: 'nowrap' }}>saving...</span>}
      </div>
    );
  }

  return (
    <span onClick={() => setEditing(true)} style={{ cursor: 'pointer', padding: '0 2px', transition: 'background 150ms', ...style, ...(saved ? { background: 'rgba(0, 66, 37, 0.06)' } : {}) }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(238, 118, 35, 0.06)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = saved ? 'rgba(0, 66, 37, 0.06)' : 'transparent'; }}
      title="Click to edit"
    >
      {value != null && value !== '' ? (type === 'number' ? (format === 'currency' ? fmt(Number(value)) : String(value)) : value) : '\u2014'}
    </span>
  );
};

// ── Status Select ──

const PART_STATUSES = [
  { value: 'installed', label: 'INSTALLED', color: '#004225' },
  { value: 'received', label: 'RECEIVED', color: '#1a1a1a' },
  { value: 'ordered', label: 'ORDERED', color: '#EE7623' },
  { value: 'agreed', label: 'AGREED', color: '#888' },
  { value: 'quoted', label: 'QUOTED', color: '#888' },
  { value: 'replaced', label: 'REPLACED', color: '#8B6914' },
  { value: 'wrong_order', label: 'WRONG ORDER', color: '#C8102E' },
  { value: 'not_used', label: 'NOT USED', color: '#888' },
  { value: 'returned', label: 'RETURNED', color: '#666' },
  { value: 'cancelled', label: 'CANCELLED', color: '#C8102E' },
];

const LABOR_STATUSES = [
  { value: 'active', label: 'ACTIVE', color: '#004225' },
  { value: 'complete', label: 'COMPLETE', color: '#004225' },
  { value: 'in_progress', label: 'IN PROGRESS', color: '#EE7623' },
  { value: 'not_needed', label: 'NOT NEEDED', color: '#888' },
  { value: 'cancelled', label: 'CANCELLED', color: '#C8102E' },
];

const StatusSelect: React.FC<{ value: string | null; options: { value: string; label: string; color: string }[]; onSave: (v: string) => void }> = ({ value, options, onSave }) => {
  const current = options.find(o => o.value === value) || options[0];
  return (
    <select value={value || ''} onChange={(e) => onSave(e.target.value)}
      style={{ appearance: 'none', WebkitAppearance: 'none', border: `1px solid ${current.color}`, color: current.color, background: 'transparent', padding: '1px 4px', fontSize: '6px', fontWeight: 700, fontFamily: 'Courier New', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', maxWidth: '80px' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
};


const EditView: React.FC<{ data: any; updateField: any; addRow: any; deleteRow: any; toggleComp: any; onInvoice: () => void }> = ({ data, updateField, addRow, deleteRow, toggleComp, onInvoice }) => {
  const [showSource, setShowSource] = useState<Set<string>>(new Set());
  const toggleSource = (id: string) => setShowSource(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');
  const E = editStyles;

  return (
    <div style={E.page}>
      <div style={E.container}>
        {/* Back to invoice */}
        <button onClick={onInvoice} style={E.backBtn}>BACK TO INVOICE</button>

        <div style={E.header}>
          <span style={E.headerTitle}>EDITING: {vehicleTitle}</span>
          <span style={E.headerBalance}>Balance: {fmt(data.totals.balance)}</span>
        </div>

        {data.workOrders.map((wo: any) => {
          const woParts = data.parts[wo.id] || [];
          const woLabor = data.labor[wo.id] || [];

          return (
            <div key={wo.id} style={E.woSection}>
              <div style={E.woTitle}>{wo.title}</div>

              {/* Parts */}
              <div style={E.sectionLabel}>PARTS</div>
              <div style={E.gridHead6}>
                <span>Description</span><span style={E.r}>Supplier</span><span style={E.r}>Qty</span><span style={E.r}>Total</span><span style={E.c}>Comp</span><span>Status</span>
              </div>
              {woParts.map((part: PartRow) => {
                const isDead = ['cancelled', 'returned', 'wrong_order', 'not_used'].includes(part.status || '');
                const sourceTag = part.notes?.match(/Amazon/i) ? 'AMZN' : part.notes?.match(/gmail/i) ? 'GMAIL' : part.ai_extracted ? 'AI' : part.notes ? 'SRC' : null;
                return (
                  <React.Fragment key={part.id}>
                    <div style={{ ...E.gridRow6, opacity: part.is_comped || isDead ? 0.45 : 1 }}>
                      <span style={E.name}>
                        {sourceTag && <span onClick={() => toggleSource(part.id)} style={E.srcTag}>{sourceTag}</span>}
                        <CellEditor value={part.part_name} onSave={(v) => updateField('work_order_parts', part.id, 'part_name', v)} />
                      </span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={part.supplier} onSave={(v) => updateField('work_order_parts', part.id, 'supplier', v)} placeholder="supplier" /></span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={part.quantity} type="number" format="plain" onSave={(v) => updateField('work_order_parts', part.id, 'quantity', v)} /></span>
                      <span style={{ ...E.mono, ...E.r, fontWeight: 700, textDecoration: part.is_comped || isDead ? 'line-through' : 'none' }}><CellEditor value={part.total_price} type="number" onSave={(v) => updateField('work_order_parts', part.id, 'total_price', v)} /></span>
                      <span style={E.c}><span onClick={() => toggleComp('work_order_parts', part.id)} style={E.comp(part.is_comped)}>{part.is_comped ? '\u2713' : ''}</span></span>
                      <span><StatusSelect value={part.status} options={PART_STATUSES} onSave={(v) => updateField('work_order_parts', part.id, 'status', v)} /></span>
                    </div>
                    {showSource.has(part.id) && (
                      <div style={E.prov}>{part.notes && <div><b>SOURCE:</b> {part.notes}</div>}{part.buy_url && <div><b>URL:</b> <a href={part.buy_url} target="_blank" rel="noopener noreferrer" style={{ color: '#EE7623', fontSize: '7px', wordBreak: 'break-all' }}>{part.buy_url}</a></div>}{part.part_number && <div><b>PART#:</b> {part.part_number}</div>}</div>
                    )}
                  </React.Fragment>
                );
              })}
              <button onClick={() => addRow('work_order_parts', wo.id)} style={E.addBtn}>+ ADD PART</button>

              {/* Labor */}
              <div style={{ ...E.sectionLabel, marginTop: '12px' }}>LABOR</div>
              <div style={E.gridHead6}>
                <span>Task</span><span style={E.r}>Hours</span><span style={E.r}>Rate</span><span style={E.r}>Total</span><span style={E.c}>Comp</span><span>Status</span>
              </div>
              {woLabor.map((labor: LaborRow) => {
                const isDead = ['cancelled', 'not_needed'].includes(labor.status || '');
                const sourceTag = labor.rate_source?.match(/iMessage/i) ? 'iMSG' : labor.rate_source?.match(/flat/i) ? 'FLAT' : labor.rate_source?.match(/book/i) ? 'BOOK' : labor.rate_source ? 'RATE' : null;
                return (
                  <React.Fragment key={labor.id}>
                    <div style={{ ...E.gridRow6, opacity: labor.is_comped || isDead ? 0.45 : 1 }}>
                      <span style={E.name}>
                        {sourceTag && <span onClick={() => toggleSource(labor.id)} style={E.srcTag}>{sourceTag}</span>}
                        <CellEditor value={labor.task_name} onSave={(v) => updateField('work_order_labor', labor.id, 'task_name', v)} />
                      </span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={labor.hours} type="number" format="plain" onSave={(v) => updateField('work_order_labor', labor.id, 'hours', v)} /></span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={labor.hourly_rate} type="number" onSave={(v) => updateField('work_order_labor', labor.id, 'hourly_rate', v)} /></span>
                      <span style={{ ...E.mono, ...E.r, fontWeight: 700, textDecoration: labor.is_comped || isDead ? 'line-through' : 'none' }}><CellEditor value={labor.total_cost} type="number" onSave={(v) => updateField('work_order_labor', labor.id, 'total_cost', v)} /></span>
                      <span style={E.c}><span onClick={() => toggleComp('work_order_labor', labor.id)} style={E.comp(labor.is_comped)}>{labor.is_comped ? '\u2713' : ''}</span></span>
                      <span><StatusSelect value={labor.status} options={LABOR_STATUSES} onSave={(v) => updateField('work_order_labor', labor.id, 'status', v)} /></span>
                    </div>
                    {showSource.has(labor.id) && (
                      <div style={E.prov}>{labor.rate_source && <div><b>RATE:</b> {labor.rate_source}</div>}{labor.notes && <div><b>NOTES:</b> {labor.notes}</div>}</div>
                    )}
                  </React.Fragment>
                );
              })}
              <button onClick={() => addRow('work_order_labor', wo.id)} style={E.addBtn}>+ ADD LABOR</button>
            </div>
          );
        })}

        {/* Payments */}
        <div style={E.sectionLabel}>PAYMENTS</div>
        {data.workOrders.flatMap((wo: any) =>
          (data.payments[wo.id] || []).map((pm: PaymentRow) => (
            <div key={pm.id} style={E.payRow}>
              <span style={E.mono}>{pm.payment_date ? fmtDateShort(pm.payment_date) : '—'}</span>
              <span style={E.mono}><CellEditor value={pm.payment_method} onSave={(v) => updateField('work_order_payments', pm.id, 'payment_method', v)} /></span>
              <span><CellEditor value={pm.memo} onSave={(v) => updateField('work_order_payments', pm.id, 'memo', v)} placeholder="memo" /></span>
              <span style={{ ...E.mono, ...E.r, fontWeight: 700, color: '#006847' }}><CellEditor value={pm.amount} type="number" onSave={(v) => updateField('work_order_payments', pm.id, 'amount', v)} /></span>
              <span onClick={() => deleteRow('work_order_payments', pm.id)} style={{ cursor: 'pointer', color: '#ccc', fontSize: '9px' }} title="Delete">{'\u2715'}</span>
            </div>
          ))
        )}
        <button onClick={() => { const woId = data.workOrders[0]?.id; if (woId) addRow('work_order_payments', woId); }} style={E.addBtn}>+ ADD PAYMENT</button>
      </div>
    </div>
  );
};

const editStyles = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Arial, sans-serif', fontSize: '9px', lineHeight: 1.6, padding: '20px' } as React.CSSProperties,
  container: { maxWidth: '900px', margin: '0 auto' } as React.CSSProperties,
  backBtn: { marginBottom: '12px', padding: '6px 14px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', border: '2px solid var(--border, #ccc)', background: 'transparent', color: 'var(--text-secondary, #888)', cursor: 'pointer', fontFamily: 'Arial' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '2px solid var(--text)', marginBottom: '12px' } as React.CSSProperties,
  headerTitle: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  headerBalance: { fontFamily: 'Courier New', fontSize: '12px', fontWeight: 700 } as React.CSSProperties,
  woSection: { marginBottom: '16px', padding: '10px 12px', border: '2px solid var(--border, #ccc)' } as React.CSSProperties,
  woTitle: { fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: '8px' } as React.CSSProperties,
  sectionLabel: { fontSize: '7px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--text-secondary, #888)', marginBottom: '4px' } as React.CSSProperties,
  gridHead6: { display: 'grid', gridTemplateColumns: '1fr 90px 36px 70px 30px 80px', gap: '2px 6px', padding: '3px 0', borderBottom: '2px solid var(--text)', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-secondary, #888)' } as React.CSSProperties,
  gridRow6: { display: 'grid', gridTemplateColumns: '1fr 90px 36px 70px 30px 80px', gap: '2px 6px', padding: '3px 0', borderBottom: '1px solid var(--border, #ddd)', fontSize: '8px', alignItems: 'center' } as React.CSSProperties,
  payRow: { display: 'grid', gridTemplateColumns: '80px 80px 1fr 80px 20px', gap: '2px 6px', padding: '3px 0', borderBottom: '1px solid var(--border, #ddd)', fontSize: '8px', alignItems: 'center' } as React.CSSProperties,
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  mono: { fontFamily: 'Courier New', fontSize: '8px' } as React.CSSProperties,
  r: { textAlign: 'right' as const } as React.CSSProperties,
  c: { textAlign: 'center' as const } as React.CSSProperties,
  comp: (on: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', border: '2px solid var(--text)', cursor: 'pointer', fontSize: '9px', fontWeight: 700, background: on ? '#EE7623' : 'transparent', color: on ? '#fff' : 'transparent', lineHeight: 1 }),
  srcTag: { display: 'inline-block', padding: '0 3px', marginRight: '4px', fontSize: '5px', fontWeight: 700, fontFamily: 'Courier New', letterSpacing: '0.08em', textTransform: 'uppercase' as const, border: '1px solid var(--text-secondary, #888)', color: 'var(--text-secondary, #888)', cursor: 'pointer', verticalAlign: 'middle', lineHeight: '10px' } as React.CSSProperties,
  prov: { padding: '4px 8px 6px 20px', background: 'var(--bg-secondary, #fafafa)', borderBottom: '1px solid var(--border, #ddd)', fontSize: '7px', fontFamily: 'Courier New', color: 'var(--text-secondary, #888)', lineHeight: 1.8 } as React.CSSProperties,
  addBtn: { display: 'inline-block', padding: '4px 10px', marginTop: '4px', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', border: '1px dashed var(--border, #ddd)', background: 'transparent', color: 'var(--text-secondary, #888)', cursor: 'pointer', fontFamily: 'Arial' } as React.CSSProperties,
};


// ══════════════════════════════════════════════════════════════
// MAIN — switches between invoice and edit mode
// ══════════════════════════════════════════════════════════════

const WorkOrderStatement: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || searchParams.get('vehicle_id') || null;
  const [mode, setMode] = useState<'invoice' | 'edit'>('invoice');
  const [theme, setTheme] = useState<InvoiceTheme>('classic');
  const [sending, setSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const { data, loading, error, updateField, addRow, deleteRow, toggleComp, refetch } = useWorkOrderStatement(query);

  const handleSend = useCallback(async () => {
    if (!data?.contact?.email || !data.vehicle) return;
    setSending(true);
    setSentStatus('idle');
    try {
      const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');
      const invoiceDate = new Date().toISOString().split('T')[0];
      const invoiceNumber = `INV-${(data.vehicle.model || 'VEH').replace(/\s+/g, '').toUpperCase().slice(0, 6)}-${invoiceDate.replace(/-/g, '').slice(4)}`;
      await supabase.from('generated_invoices').upsert({ work_order_id: data.workOrders[0]?.id, invoice_number: invoiceNumber, invoice_date: invoiceDate, due_date: invoiceDate, subtotal: data.totals.subtotal, tax_amount: 0, tax_rate: 0, total_amount: data.totals.subtotal, amount_paid: data.totals.payments, amount_due: data.totals.balance, payment_status: data.totals.balance > 0 ? 'partial' : 'paid', status: 'sent', sent_at: new Date().toISOString() }, { onConflict: 'work_order_id' });
      const { error: sendError } = await supabase.functions.invoke('send-invoice-email', { body: { to: data.contact.email, subject: `Invoice: ${vehicleTitle} — ${fmt(data.totals.balance)} Balance Due`, customer_name: data.contact.name, vehicle_title: vehicleTitle, invoice_number: invoiceNumber, invoice_date: invoiceDate, total: data.totals.subtotal, paid: data.totals.payments, balance: data.totals.balance, line_items: data.workOrders.map((wo: any) => ({ description: wo.title, amount: wo.parts_total + wo.labor_total })) } });
      if (sendError) throw sendError;
      setSentStatus('sent');
    } catch { setSentStatus('error'); } finally { setSending(false); }
  }, [data]);

  if (!query) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial', color: '#888' }}>Add ?q=name or ?vehicle_id=UUID to the URL</div>;
  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Courier New', color: '#888', fontSize: '12px' }}>Loading...</div>;
  if (error || !data) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial', color: '#888' }}>{error || `No results for "${query}"`}</div>;

  if (mode === 'edit') {
    return <EditView data={data} updateField={updateField} addRow={addRow} deleteRow={deleteRow} toggleComp={toggleComp} onInvoice={() => setMode('invoice')} />;
  }

  return <InvoiceView data={data} onEdit={() => setMode('edit')} onSend={handleSend} sending={sending} sentStatus={sentStatus} theme={theme} onThemeChange={setTheme} />;
};

export default WorkOrderStatement;
