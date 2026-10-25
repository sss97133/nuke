/**
 * WorkOrderStatement — Two modes:
 * 1. INVOICE (default) — clean auto shop invoice, printable, customer-facing
 * 2. EDIT — full CRUD with inline editing, status dropdowns, provenance (owner view)
 *
 * Route: /work-orders/statement?work_order_id=UUID | ?vehicle_id=UUID | ?handle=name (or ?q=UUID / ?q=@handle)
 * Open statement; payments and balances only for the viewer's own work orders; contact is brokered by Nuke.
 */

import React, { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './statement-editor.css';
import {
  useWorkOrderStatement,
  type PartRow,
  type LaborRow,
  type PaymentRow,
  type ShopInfo,
} from './vehicle-profile/hooks/useWorkOrderStatement';

type PaymentMethod = NonNullable<ShopInfo['payment_methods']>[number];

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

const ContactViaNuke: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <button type="button" disabled title="Contact requests are brokered by Nuke; not available yet" style={{ cursor: 'not-allowed', opacity: 0.6, ...style }}>CONTACT VIA NUKE</button>
);

const InvoiceView: React.FC<{ data: any; onEdit?: () => void; theme: InvoiceTheme; onThemeChange: (t: InvoiceTheme) => void }> = ({ data, onEdit, theme, onThemeChange }) => {
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

  // Compute tax for totals
  const taxInfo = (() => {
    let partsPreTax = 0, partsTax = 0;
    for (const p of allParts) {
      const pretax = (p.unit_price || 0) * (p.quantity || 1);
      const total = p.total_price || 0;
      if (p.is_taxable && total > pretax) { partsPreTax += pretax; partsTax += total - pretax; }
      else { partsPreTax += total; }
    }
    return { partsPreTax: Math.round(partsPreTax * 100) / 100, partsTax: Math.round(partsTax * 100) / 100 };
  })();

  // ── CLASSIC: true carbon copy repair order form ──
  if (theme === 'classic') {
    const RO: React.CSSProperties = { border: '1px solid #7B96B0', fontFamily: 'Arial, Helvetica, sans-serif' };
    const roNum = `${String(Math.abs(data.vehicle.id?.charCodeAt(0) || 0) * 100 + 1001).padStart(7, '0')}`;
    return (
      <div className="ro-page" style={{ minHeight: '100vh', background: '#c8d0d8', padding: '20px', fontSize: '10px', color: '#1a3050' }}>

        {/* Theme picker */}
        <div className="no-print" style={{ display: 'flex', gap: '6px', marginBottom: '12px', justifyContent: 'center' }}>
          {(['classic', 'modern', 'dealer'] as InvoiceTheme[]).map(t => (
            <button key={t} onClick={() => onThemeChange(t)} style={{
              padding: '4px 12px', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'Arial',
              border: theme === t ? '2px solid #1a3050' : '1px solid #999',
              background: theme === t ? '#1a3050' : 'transparent',
              color: theme === t ? '#fff' : '#444',
            }}>{t}</button>
          ))}
        </div>

        <div className="ro-paper" style={{ maxWidth: '780px', margin: '0 auto', background: '#EDF2F7', padding: '24px 28px', border: '2px solid #7B96B0', position: 'relative' }}>

          {/* ── HEADER ── */}
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '0.12em', color: '#1a3050', textTransform: 'uppercase' }}>REPAIR ORDER</div>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '0.08em' }}>{data.shop?.name?.toUpperCase() || 'NUKE'}</div>
            <div style={{ fontSize: '9px', color: '#4a6080' }}>Vehicle Build & Service</div>
            <div style={{ fontSize: '9px', color: '#4a6080' }}>{[data.shop?.city, data.shop?.state?.toUpperCase()].filter(Boolean).join(', ') || 'Las Vegas, NV'}</div>
            {data.shop?.website && <div style={{ fontSize: '9px', color: '#4a6080' }}>{data.shop.website.replace(/^https?:\/\/(www\.)?/, '')}</div>}
          </div>

          {/* Order number */}
          <div style={{ position: 'absolute', top: '24px', right: '28px', fontSize: '16px', fontWeight: 900, fontFamily: 'Courier New', color: '#1a3050' }}>{roNum}</div>

          {/* ── CUSTOMER / VEHICLE INFO GRID ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', ...RO, marginBottom: '2px' }}>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #7B96B0' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>CONTACT </span>
              <span style={{ fontWeight: 600 }}>via Nuke</span>
            </div>
            <div style={{ padding: '3px 6px', minWidth: '120px' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>DATE </span>
              <span style={{ fontWeight: 600 }}>{fmtDate(new Date().toISOString())}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', ...RO, marginBottom: '2px' }}>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #7B96B0' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>ADDRESS </span>
              <span>—</span>
            </div>
            <div style={{ padding: '3px 6px', minWidth: '120px' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>PH. NO. </span>
              <span>—</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', ...RO, marginBottom: '2px' }}>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #7B96B0' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>MAKE AND MODEL </span>
              <span style={{ fontWeight: 600 }}>{vehicleTitle}</span>
            </div>
            <div style={{ padding: '3px 6px', borderRight: '1px solid #7B96B0' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>VIN NO. </span>
              <span style={{ fontFamily: 'Courier New', fontSize: '9px' }}>{data.vehicle.vin || '—'}</span>
            </div>
            <div style={{ padding: '3px 6px' }}>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', color: '#4a6080' }}>ODOMETER </span>
              <span>—</span>
            </div>
          </div>

          {/* ── LABOR SECTION ── */}
          <div style={{ ...RO, marginTop: '6px', marginLeft: '12px', marginRight: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', background: '#D5DDE5', borderBottom: '1px solid #7B96B0' }}>
              <div style={{ padding: '3px 6px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderRight: '1px solid #7B96B0' }}>DESCRIPTION</div>
              <div style={{ padding: '3px 6px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>AMOUNT</div>
            </div>
            {allLabor.map(l => (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #BCC8D4' }}>
                <div style={{ padding: '2px 6px', borderRight: '1px solid #BCC8D4', fontSize: '9px' }}>{l.task_name}</div>
                <div style={{ padding: '2px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '9px', fontWeight: 600 }}>{l.total_cost != null ? fmt(l.total_cost) : '—'}</div>
              </div>
            ))}
            {/* Empty ruled lines to fill space */}
            {Array.from({ length: Math.max(0, 3 - allLabor.length) }).map((_, i) => (
              <div key={`empty-l-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #BCC8D4', height: '16px' }}>
                <div style={{ borderRight: '1px solid #BCC8D4' }} />
                <div />
              </div>
            ))}
          </div>

          {/* ── PARTS + TOTALS side by side ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '0', marginTop: '6px', marginLeft: '12px', marginRight: '12px' }}>

            {/* Parts left side */}
            <div style={{ ...RO, borderRight: 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '30px 70px 1fr 70px', background: '#D5DDE5', borderBottom: '1px solid #7B96B0' }}>
                <div style={{ padding: '3px 4px', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', borderRight: '1px solid #7B96B0' }}>QTY</div>
                <div style={{ padding: '3px 4px', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', borderRight: '1px solid #7B96B0' }}>PART NO.</div>
                <div style={{ padding: '3px 4px', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', borderRight: '1px solid #7B96B0' }}>NAME OF PART</div>
                <div style={{ padding: '3px 4px', fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', textAlign: 'right' }}>SALE AMT.</div>
              </div>
              {allParts.map(p => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '30px 70px 1fr 70px', borderBottom: '1px solid #BCC8D4' }}>
                  <div style={{ padding: '1px 4px', borderRight: '1px solid #BCC8D4', fontSize: '9px', textAlign: 'center' }}>{p.quantity}</div>
                  <div style={{ padding: '1px 4px', borderRight: '1px solid #BCC8D4', fontSize: '8px', fontFamily: 'Courier New', color: '#4a6080' }}>{p.part_number || ''}</div>
                  <div style={{ padding: '1px 4px', borderRight: '1px solid #BCC8D4', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</div>
                  <div style={{ padding: '1px 4px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '9px', fontWeight: 600 }}>{p.total_price != null ? fmt(p.total_price) : ''}</div>
                </div>
              ))}
              {/* TOTAL PARTS row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', borderTop: '2px solid #7B96B0', background: '#D5DDE5' }}>
                <div style={{ padding: '3px 6px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', borderRight: '1px solid #7B96B0' }}>TOTAL PARTS</div>
                <div style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '10px', fontWeight: 700 }}>{fmt(data.totals.parts)}</div>
              </div>
            </div>

            {/* Totals right side */}
            <div style={{ ...RO }}>
              {[
                { label: 'Total Labor', value: fmt(data.totals.labor) },
                { label: 'Total Parts', value: fmt(data.totals.parts) },
                { label: 'Shop/Supplies', value: '—' },
                { label: 'Other', value: data.totals.goodwill > 0 ? `(${fmt(data.totals.goodwill)})` : '—' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #BCC8D4' }}>
                  <div style={{ padding: '2px 6px', fontSize: '9px', fontWeight: 500, fontStyle: 'italic', borderRight: '1px solid #BCC8D4' }}>{row.label}</div>
                  <div style={{ padding: '2px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '9px', fontWeight: 600 }}>{row.value}</div>
                </div>
              ))}
              {/* TOTAL */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #7B96B0', background: '#D5DDE5' }}>
                <div style={{ padding: '3px 6px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', borderRight: '1px solid #7B96B0' }}>TOTAL</div>
                <div style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '10px', fontWeight: 700 }}>{fmt(taxInfo.partsPreTax + data.totals.labor)}</div>
              </div>
              {/* TAX */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #7B96B0' }}>
                <div style={{ padding: '3px 6px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', borderRight: '1px solid #7B96B0' }}>TAX</div>
                <div style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '10px', fontWeight: 700 }}>{fmt(taxInfo.partsTax)}</div>
              </div>
              {/* Payments */}
              {data.totals.payments > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #7B96B0' }}>
                  <div style={{ padding: '3px 6px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#006847', borderRight: '1px solid #7B96B0' }}>PAID</div>
                  <div style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '10px', fontWeight: 700, color: '#006847' }}>({fmt(data.totals.payments)})</div>
                </div>
              )}
              {/* TOTAL AMOUNT */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', background: '#1a3050' }}>
                <div style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#fff', borderRight: '1px solid #7B96B0' }}>{data.moneyVisible ? 'TOTAL AMOUNT' : 'TOTAL · PAYMENTS SHOWN TO PARTIES ONLY'}</div>
                <div style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '12px', fontWeight: 800, color: '#fff' }}>{fmt(data.totals.balance)}</div>
              </div>
            </div>
          </div>

          {/* ── COURTESY ITEMS ── */}
          {(compedParts.length > 0 || compedLabor.length > 0) && (
            <div style={{ marginTop: '8px', marginLeft: '12px', marginRight: '12px', ...RO, background: '#f0f4e8' }}>
              <div style={{ padding: '3px 6px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #7B96B0', color: '#5C6B3C' }}>Courtesy — No Charge</div>
              {[...compedParts.map(p => ({ name: p.part_name, reason: p.comp_reason, value: p.comp_retail_value || p.total_price || 0 })),
                ...compedLabor.map(l => ({ name: l.task_name, reason: l.comp_reason, value: l.comp_retail_value || l.total_cost || 0 }))
              ].map((item, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderBottom: '1px solid #c4ceaf' }}>
                  <div style={{ padding: '1px 6px', fontSize: '8px', borderRight: '1px solid #c4ceaf' }}>
                    {item.name}{item.reason ? <span style={{ color: '#888', marginLeft: '4px' }}>— {item.reason}</span> : ''}
                  </div>
                  <div style={{ padding: '1px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '8px', color: '#5C6B3C' }}>{fmt(item.value)}</div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', borderTop: '2px solid #5C6B3C' }}>
                <div style={{ padding: '2px 6px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', textAlign: 'right', borderRight: '1px solid #c4ceaf', color: '#5C6B3C' }}>TOTAL COURTESY</div>
                <div style={{ padding: '2px 6px', textAlign: 'right', fontFamily: 'Courier New', fontSize: '9px', fontWeight: 700, color: '#5C6B3C' }}>{fmt(data.totals.goodwill)}</div>
              </div>
            </div>
          )}

          {/* ── AUTHORIZATION ── */}
          <div style={{ marginTop: '10px', marginLeft: '12px', marginRight: '12px', fontSize: '7px', color: '#4a6080', lineHeight: 1.4, fontStyle: 'italic' }}>
            I hereby authorize the above repair work to be done along with the necessary material, and hereby grant you and/or your employees permission to operate the car, truck or vehicle herein described on streets, highways or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above car, truck or vehicle to secure the amount of repairs thereto.
          </div>

          {/* ── FOOTER ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px', marginLeft: '12px', marginRight: '12px', fontSize: '8px' }}>
            <div>
              <div style={{ borderBottom: '1px solid #7B96B0', paddingBottom: '2px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', color: '#4a6080' }}>Work Authorized by</span>
              </div>
              <div style={{ borderBottom: '1px solid #7B96B0', paddingBottom: '2px' }}>
                <span style={{ fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', color: '#4a6080' }}>Delivered to</span>
              </div>
            </div>
            <div>
              <div style={{ borderBottom: '1px solid #7B96B0', paddingBottom: '2px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', color: '#4a6080' }}>Date Promised</span>
              </div>
              <div style={{ borderBottom: '1px solid #7B96B0', paddingBottom: '2px' }}>
                <span style={{ fontWeight: 700, fontSize: '7px', textTransform: 'uppercase', color: '#4a6080' }}>Date Delivered</span>
              </div>
            </div>
          </div>

          {/* Payment Instructions */}
          {data.shop?.payment_methods && data.shop.payment_methods.length > 0 && (
            <div style={{ margin: '10px 0', padding: '8px 10px', border: '1px solid #7B96B0', background: '#e8edf3' }}>
              <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1a3050', marginBottom: '6px' }}>Payment Instructions</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.shop.payment_methods.length}, 1fr)`, gap: '10px', fontSize: '9px', color: '#1a3050', lineHeight: 1.5 }}>
                {data.shop.payment_methods.map((pm: PaymentMethod, i: number) => (
                  <div key={i}>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>{pm.label}</div>
                    <div>{pm.detail}</div>
                    {pm.note && <div style={{ fontSize: '7px', color: '#4a6080' }}>{pm.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '8px', marginLeft: '12px', marginRight: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <QRCodeSVG
                value={`https://nuke.ag/vehicle/${data.vehicle.id}`}
                size={52}
                level="M"
                fgColor="#1a3050"
                bgColor="transparent"
                role="img"
                aria-label="QR code: this vehicle's page on Nuke"
              />
              <div style={{ fontSize: '7px', color: '#4a6080', textTransform: 'uppercase' }}>Payment due upon receipt<br/>Questions? Contact {data.shop?.email || 'support@nuke.ag'}</div>
            </div>
            <>
              <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet" />
              <div style={{ fontFamily: "'Dancing Script', cursive", fontSize: '26px', color: '#4a6080' }}>Thank You</div>
            </>
          </div>

          {/* Action bar */}
          <div className="no-print" style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #7B96B0' }}>
            {onEdit && <button onClick={onEdit} style={{ padding: '8px 16px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid #7B96B0', background: 'transparent', color: '#4a6080', cursor: 'pointer', fontFamily: 'Arial' }}>EDIT</button>}
            <button onClick={() => window.print()} style={{ padding: '8px 16px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', border: '2px solid #1a3050', background: 'transparent', color: '#1a3050', cursor: 'pointer', fontFamily: 'Arial' }}>PRINT</button>
            <ContactViaNuke style={{
              flex: 1, padding: '8px 16px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', border: '2px solid #1a3050', fontFamily: 'Arial', background: '#1a3050', color: '#fff',
            }} />
          </div>
        </div>

        <style>{`
          @media print {
            .no-print { display: none !important; }
            @page { margin: 0.3in 0.4in; size: letter; }
            html, body { background: white !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
            /* Hide site chrome */
            header, nav, footer, [class*="Header"], [class*="Navigation"], [class*="sidebar"], [class*="Sidebar"] { display: none !important; }
            /* Strip page wrapper */
            .ro-page { background: white !important; padding: 0 !important; min-height: auto !important; }
            /* Strip paper styling — print directly */
            .ro-paper { max-width: 100% !important; margin: 0 !important; padding: 16px 20px !important; border: none !important; background: white !important; box-shadow: none !important; }
            /* Preserve form colors */
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          }
        `}</style>
      </div>
    );
  }

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
            <div style={T.shopName}>{data.shop?.name?.toUpperCase() || 'NUKE'}</div>
            <div style={T.shopDetail}>Vehicle Build & Service</div>
            <div style={T.shopDetail}>{[data.shop?.city, data.shop?.state?.toUpperCase()].filter(Boolean).join(', ') || 'Las Vegas, NV'}</div>
            {data.shop?.website && <div style={T.shopDetail}>{data.shop.website.replace(/^https?:\/\/(www\.)?/, '')}</div>}
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
            <div style={T.infoLine}>Contact via Nuke</div>
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
                <span>{data.moneyVisible ? 'BALANCE DUE' : 'TOTAL · PAYMENTS SHOWN TO PARTIES ONLY'}</span>
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

        {/* Payment Instructions */}
        {data.shop?.payment_methods && data.shop.payment_methods.length > 0 && (
          <div style={{ marginTop: '24px', padding: '16px', border: '2px solid #1a1a1a', background: '#fafafa' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: '10px' }}>Payment Instructions</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.shop.payment_methods.length}, 1fr)`, gap: '16px', fontSize: '10px', lineHeight: 1.5 }}>
              {data.shop.payment_methods.map((pm: PaymentMethod, i: number) => (
                <div key={i}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>{pm.label}</div>
                  <div>{pm.detail}</div>
                  {pm.note && <div style={{ color: '#888', marginTop: '2px' }}>{pm.note}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={T.footer}>
          <div>Thank you for your business.</div>
          <div style={{ marginTop: '4px', fontSize: '10px', color: '#999' }}>
            Payment due upon receipt. Questions? Contact {data.shop?.email || 'nuke.ag'}
          </div>
        </div>

        {/* Action bar — not printed */}
        <div style={T.actionBar} className="no-print">
          {onEdit && <button onClick={onEdit} style={T.editBtn}>EDIT</button>}
          <button onClick={() => window.print()} style={T.printBtn}>PRINT</button>
          <ContactViaNuke style={{ ...T.sendBtn, background: '#1a1a1a' }} />
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
  value: string | number | null | undefined;
  type?: 'text' | 'number';
  format?: 'currency' | 'plain';
  onSave: (value: string | number | null) => void | Promise<unknown>;
  style?: React.CSSProperties;
  placeholder?: string;
}

function saveFailure(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : 'The change could not be saved. Try again.';
}

export const CellEditor: React.FC<CellEditorProps> = ({ value, type = 'text', format = 'currency', onSave, style, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const cancelled = useRef(false);
  const cancelTimer = () => { clearTimeout(saveRef.current); saveRef.current = undefined; };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelTimer(); clearTimeout(savedRef.current); };
  }, []);
  useEffect(() => { if (!editing) setEditValue(String(value ?? '')); }, [value, editing]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const doSave = async (val: string) => {
    cancelTimer();
    if (inFlight.current || cancelled.current || !mounted.current) return;
    const parsed = type === 'number' ? (val === '' ? null : Number(val)) : val;
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) {
      setError('Enter a finite number.');
      return;
    }
    if (parsed === value) { setEditing(false); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
      if (!mounted.current) return;
      setSaved(true);
      setEditing(false);
      savedRef.current = setTimeout(() => setSaved(false), 1500);
    } catch (failure) {
      if (mounted.current) setError(saveFailure(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setEditValue(nextValue);
    setError(null);
    cancelTimer();
    saveRef.current = setTimeout(() => void doSave(nextValue), 1500);
  };

  if (editing) {
    return (
      <span className="statement-cell-editor" style={style}>
        <input ref={inputRef} type={type} step={type === 'number' ? '0.01' : undefined} value={editValue}
          aria-label={placeholder || 'Edit value'} aria-invalid={!!error} disabled={saving}
          onChange={handleChange}
          onBlur={() => { if (!error) void doSave(editValue); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void doSave(editValue); }
            if (e.key === 'Escape' && !inFlight.current) {
              e.preventDefault(); cancelled.current = true; cancelTimer();
              setEditValue(String(value ?? '')); setError(null); setEditing(false);
            }
          }}
          placeholder={placeholder}
        />
        {saving && <span role="status">Saving…</span>}
        {error && <span role="alert" className="statement-save-error">{error} Your draft is still here.</span>
        }
        {error && <button type="button" onClick={() => void doSave(editValue)}>Retry save</button>}
      </span>
    );
  }

  return (
    <button type="button" className="statement-cell-value" onClick={() => { cancelled.current = false; setSaved(false); setEditing(true); }} style={style} title="Click to edit">
      {value != null && value !== '' ? (type === 'number' ? (format === 'currency' ? fmt(Number(value)) : String(value)) : value) : '\u2014'}
      {saved && <span role="status"> Saved</span>}
    </button>
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

export const StatusSelect: React.FC<{ value: string | null; options: { value: string; label: string; color: string }[]; onSave: (v: string) => void | Promise<unknown> }> = ({ value, options, onSave }) => {
  const { run, pending, error } = useStatementAction();
  return (
    <span className="statement-status-editor">
      <select value={value || ''} aria-label="Status" disabled={pending} onChange={(e) => { const next = e.target.value; void run(() => onSave(next)); }}>
        {!options.some(option => option.value === value) && <option value={value || ''}>{value || 'Unknown status'}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {pending && <span role="status">Saving…</span>}
      {error && <span role="alert" className="statement-save-error">{error}</span>}
    </span>
  );
};

function useStatementAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: () => unknown | Promise<unknown>) => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try { await action(); }
    catch (failure) { if (mounted.current) setError(saveFailure(failure)); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  return { run, pending, error };
}

export const EditView: React.FC<{ data: any; updateField: any; addRow: any; deleteRow: any; toggleComp: any; onInvoice: () => void }> = ({ data, updateField, addRow, deleteRow, toggleComp, onInvoice }) => {
  const { run, pending, error: actionError } = useStatementAction();
  const [showSource, setShowSource] = useState<Set<string>>(new Set());
  const toggleSource = (id: string) => setShowSource(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');
  const E = editStyles;

  return (
    <div style={E.page} className="statement-edit">
      <div style={E.container}>
        {/* Back to invoice */}
        <button onClick={onInvoice} style={E.backBtn}>BACK TO INVOICE</button>

        <div style={E.header}>
          <span style={E.headerTitle}>EDITING: {vehicleTitle}</span>
          <span style={E.headerBalance}>{data.moneyVisible ? `Balance: ${fmt(data.totals.balance)}` : 'Payments shown to parties only'}</span>
        </div>

        {pending && <p role="status">Saving the change…</p>}
        {actionError && <p role="alert" className="statement-save-error">{actionError}</p>}

        {data.workOrders.map((wo: any) => {
          const woParts = data.parts[wo.id] || [];
          const woLabor = data.labor[wo.id] || [];

          return (
            <div key={wo.id} style={E.woSection} className="statement-work-order">
              <div style={E.woTitle}>{wo.title}</div>

              {/* Parts */}
              <div style={E.sectionLabel}>PARTS</div>
              <div style={E.gridHead6} className="statement-edit-grid">
                <span>Description</span><span style={E.r}>Supplier</span><span style={E.r}>Qty</span><span style={E.r}>Total</span><span style={E.c}>Comp</span><span>Status</span>
              </div>
              {woParts.map((part: PartRow) => {
                const isDead = ['cancelled', 'returned', 'wrong_order', 'not_used'].includes(part.status || '');
                const sourceTag = part.notes?.match(/Amazon/i) ? 'AMZN' : part.notes?.match(/gmail/i) ? 'GMAIL' : part.ai_extracted ? 'AI' : part.notes ? 'SRC' : null;
                return (
                  <React.Fragment key={part.id}>
                    <div className="statement-edit-grid" style={{ ...E.gridRow6, opacity: part.is_comped || isDead ? 0.45 : 1 }}>
                      <span style={E.name}>
                        {sourceTag && <button type="button" onClick={() => toggleSource(part.id)} className="statement-source" aria-label={`Source for ${part.part_name}`} aria-expanded={showSource.has(part.id)} style={E.srcTag}>{sourceTag}</button>}
                        <CellEditor value={part.part_name} onSave={(v) => updateField('work_order_parts', part.id, 'part_name', v)} />
                      </span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={part.supplier} onSave={(v) => updateField('work_order_parts', part.id, 'supplier', v)} placeholder="supplier" /></span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={part.quantity} type="number" format="plain" onSave={(v) => updateField('work_order_parts', part.id, 'quantity', v)} /></span>
                      <span style={{ ...E.mono, ...E.r, fontWeight: 700, textDecoration: part.is_comped || isDead ? 'line-through' : 'none' }}><CellEditor value={part.total_price} type="number" onSave={(v) => updateField('work_order_parts', part.id, 'total_price', v)} /></span>
                      <span style={E.c}><button type="button" aria-label={`Comp ${part.part_name}`} aria-pressed={part.is_comped} disabled={pending} onClick={() => void run(() => toggleComp('work_order_parts', part.id))} className="statement-comp">{part.is_comped ? '\u2713' : '—'}</button></span>
                      <span><StatusSelect value={part.status} options={PART_STATUSES} onSave={(v) => updateField('work_order_parts', part.id, 'status', v)} /></span>
                    </div>
                    {showSource.has(part.id) && (
                      <div style={E.prov}>{part.notes && <div><b>SOURCE:</b> {part.notes}</div>}{part.buy_url && <div><b>URL:</b> <a href={part.buy_url} target="_blank" rel="noopener noreferrer" style={{ color: '#EE7623', fontSize: '7px', wordBreak: 'break-all' }}>{part.buy_url}</a></div>}{part.part_number && <div><b>PART#:</b> {part.part_number}</div>}</div>
                    )}
                  </React.Fragment>
                );
              })}
              <button disabled={pending} onClick={() => void run(() => addRow('work_order_parts', wo.id))} style={E.addBtn}>+ ADD PART</button>

              {/* Labor */}
              <div style={{ ...E.sectionLabel, marginTop: '12px' }}>LABOR</div>
              <div style={E.gridHead6} className="statement-edit-grid">
                <span>Task</span><span style={E.r}>Hours</span><span style={E.r}>Rate</span><span style={E.r}>Total</span><span style={E.c}>Comp</span><span>Status</span>
              </div>
              {woLabor.map((labor: LaborRow) => {
                const isDead = ['cancelled', 'not_needed'].includes(labor.status || '');
                const sourceTag = labor.rate_source?.match(/iMessage/i) ? 'iMSG' : labor.rate_source?.match(/flat/i) ? 'FLAT' : labor.rate_source?.match(/book/i) ? 'BOOK' : labor.rate_source ? 'RATE' : null;
                return (
                  <React.Fragment key={labor.id}>
                    <div className="statement-edit-grid" style={{ ...E.gridRow6, opacity: labor.is_comped || isDead ? 0.45 : 1 }}>
                      <span style={E.name}>
                        {sourceTag && <button type="button" onClick={() => toggleSource(labor.id)} className="statement-source" aria-label={`Source for ${labor.task_name}`} aria-expanded={showSource.has(labor.id)} style={E.srcTag}>{sourceTag}</button>}
                        <CellEditor value={labor.task_name} onSave={(v) => updateField('work_order_labor', labor.id, 'task_name', v)} />
                      </span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={labor.hours} type="number" format="plain" onSave={(v) => updateField('work_order_labor', labor.id, 'hours', v)} /></span>
                      <span style={{ ...E.mono, ...E.r }}><CellEditor value={labor.hourly_rate} type="number" onSave={(v) => updateField('work_order_labor', labor.id, 'hourly_rate', v)} /></span>
                      <span style={{ ...E.mono, ...E.r, fontWeight: 700, textDecoration: labor.is_comped || isDead ? 'line-through' : 'none' }}><CellEditor value={labor.total_cost} type="number" onSave={(v) => updateField('work_order_labor', labor.id, 'total_cost', v)} /></span>
                      <span style={E.c}><button type="button" aria-label={`Comp ${labor.task_name}`} aria-pressed={labor.is_comped} disabled={pending} onClick={() => void run(() => toggleComp('work_order_labor', labor.id))} className="statement-comp">{labor.is_comped ? '\u2713' : '—'}</button></span>
                      <span><StatusSelect value={labor.status} options={LABOR_STATUSES} onSave={(v) => updateField('work_order_labor', labor.id, 'status', v)} /></span>
                    </div>
                    {showSource.has(labor.id) && (
                      <div style={E.prov}>{labor.rate_source && <div><b>RATE:</b> {labor.rate_source}</div>}{labor.notes && <div><b>NOTES:</b> {labor.notes}</div>}</div>
                    )}
                  </React.Fragment>
                );
              })}
              <button disabled={pending} onClick={() => void run(() => addRow('work_order_labor', wo.id))} style={E.addBtn}>+ ADD LABOR</button>
            </div>
          );
        })}

        {/* Payments */}
        <div style={E.sectionLabel}>PAYMENTS</div>
        <div className="statement-payment-list" tabIndex={0} aria-label="Recorded payments">
        {data.workOrders.flatMap((wo: any) =>
          (data.payments[wo.id] || []).map((pm: PaymentRow) => (
            <div key={pm.id} style={E.payRow} className="statement-payment-row">
              <span style={E.mono}>{pm.payment_date ? fmtDateShort(pm.payment_date) : '—'}</span>
              <span style={E.mono}><CellEditor value={pm.payment_method} onSave={(v) => updateField('work_order_payments', pm.id, 'payment_method', v)} /></span>
              <span><CellEditor value={pm.memo} onSave={(v) => updateField('work_order_payments', pm.id, 'memo', v)} placeholder="memo" /></span>
              <span style={{ ...E.mono, ...E.r, fontWeight: 700, color: '#006847' }}><CellEditor value={pm.amount} type="number" onSave={(v) => updateField('work_order_payments', pm.id, 'amount', v)} /></span>
              <button type="button" aria-label="Delete payment" disabled={pending} onClick={() => void run(() => deleteRow('work_order_payments', pm.id))}>{'\u2715'}</button>
            </div>
          ))
        )}
        </div>
        <button disabled={pending || !data.workOrders[0]} onClick={() => { const woId = data.workOrders[0]?.id; if (woId) void run(() => addRow('work_order_payments', woId)); }} style={E.addBtn}>+ ADD PAYMENT</button>
      </div>
    </div>
  );
};

const editStyles = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-family)', fontSize: 'var(--text-body)', lineHeight: 1.6, padding: '12px' } as React.CSSProperties,
  container: { maxWidth: '900px', margin: '0 auto' } as React.CSSProperties,
  backBtn: { marginBottom: '12px', padding: '6px 14px', fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', border: '2px solid var(--border, #ccc)', background: 'transparent', color: 'var(--text-secondary, #888)', cursor: 'pointer', fontFamily: 'var(--font-family)' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '2px solid var(--text)', marginBottom: '12px' } as React.CSSProperties,
  headerTitle: { fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  headerBalance: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-callout)', fontWeight: 700 } as React.CSSProperties,
  woSection: { marginBottom: '16px', padding: '10px 12px', border: '2px solid var(--border, #ccc)' } as React.CSSProperties,
  woTitle: { fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: '8px' } as React.CSSProperties,
  sectionLabel: { fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--text-secondary, #888)', marginBottom: '4px' } as React.CSSProperties,
  gridHead6: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 100px 90px 100px 48px 140px', gap: '2px 6px', padding: '3px 0', borderBottom: '2px solid var(--text)', fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-secondary, #888)' } as React.CSSProperties,
  gridRow6: { display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 100px 90px 100px 48px 140px', gap: '2px 6px', padding: '3px 0', borderBottom: '1px solid var(--border, #ddd)', fontSize: 'var(--text-callout)', alignItems: 'center' } as React.CSSProperties,
  payRow: { display: 'grid', gridTemplateColumns: '100px 100px minmax(160px, 1fr) 100px 44px', gap: '2px 6px', padding: '3px 0', borderBottom: '1px solid var(--border, #ddd)', fontSize: 'var(--text-callout)', alignItems: 'center' } as React.CSSProperties,
  name: { minWidth: 0, whiteSpace: 'normal' as const } as React.CSSProperties,
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-callout)' } as React.CSSProperties,
  r: { textAlign: 'right' as const } as React.CSSProperties,
  c: { textAlign: 'center' as const } as React.CSSProperties,
  srcTag: { display: 'inline-block', padding: '6px', marginRight: '4px', fontSize: 'var(--text-callout)', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, border: '1px solid var(--text-secondary, #888)', color: 'var(--text-secondary, #888)', cursor: 'pointer', verticalAlign: 'middle', lineHeight: 1.4 } as React.CSSProperties,
  prov: { padding: '4px 8px 6px 20px', background: 'var(--bg-secondary, #fafafa)', borderBottom: '1px solid var(--border, #ddd)', fontSize: 'var(--text-callout)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary, #888)', lineHeight: 1.8 } as React.CSSProperties,
  addBtn: { display: 'inline-block', padding: '4px 10px', marginTop: '4px', fontSize: 'var(--text-callout)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', border: '1px dashed var(--border, #ddd)', background: 'transparent', color: 'var(--text-secondary, #888)', cursor: 'pointer', fontFamily: 'var(--font-family)' } as React.CSSProperties,
};


// ══════════════════════════════════════════════════════════════
// MAIN — switches between invoice and edit mode
// ══════════════════════════════════════════════════════════════

const WorkOrderStatement: React.FC = () => {
  const [searchParams] = useSearchParams();
  const workOrderId = searchParams.get('work_order_id');
  const vehicleId = searchParams.get('vehicle_id');
  const handle = searchParams.get('handle');
  const q = searchParams.get('q');
  const query = workOrderId ? `wo:${workOrderId}` : vehicleId ? `vehicle:${vehicleId}` : handle ? `handle:${handle}` : q || null;
  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <p role="status">Loading the statement…</p>;
  return <StatementForViewer key={`${user?.id ?? 'anonymous'}:${query}`} query={query} canEdit={!!user} />;
};

const StatementForViewer: React.FC<{query: string | null; canEdit: boolean}> = ({query, canEdit}) => {
  const [mode, setMode] = useState<'invoice' | 'edit'>('invoice');
  const [theme, setTheme] = useState<InvoiceTheme>('classic');

  const { data, matches, loading, error, updateField, addRow, deleteRow, toggleComp } = useWorkOrderStatement(query);

  const center: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial', color: '#888' };
  if (!query) return <div style={center}>Add ?work_order_id=, ?vehicle_id= or ?handle= to the URL</div>;
  if (loading) return <div style={{ ...center, fontFamily: 'Courier New', fontSize: '12px' }}>Loading...</div>;
  if (matches) {
    return (
      <div style={{ ...center, flexDirection: 'column', gap: '8px' }}>
        <div>Choose a vehicle</div>
        {matches.map((m) => (
          <a key={m.vehicle_id} href={`?vehicle_id=${m.vehicle_id}`}>{m.vehicle_label?.text || m.vehicle_id}</a>
        ))}
      </div>
    );
  }
  if (error || !data) return <div style={center}>{error || 'No statement found for this lookup'}</div>;

  if (mode === 'edit' && canEdit) {
    return <EditView data={data} updateField={updateField} addRow={addRow} deleteRow={deleteRow} toggleComp={toggleComp} onInvoice={() => setMode('invoice')} />;
  }

  return <InvoiceView data={data} onEdit={canEdit ? () => setMode('edit') : undefined} theme={theme} onThemeChange={setTheme} />;
};

export default WorkOrderStatement;
