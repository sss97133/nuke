#!/usr/bin/env node
/**
 * statement-html.mjs — Render a customer work order statement as an HTML file
 *
 * Usage: node statement-html.mjs "granholm"
 *        npm run wo:statement granholm
 *
 * Opens the resulting HTML in the default browser.
 */

import { createSupabase } from './lib/env.mjs';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

const supabase = createSupabase();
const query = process.argv[2];
if (!query) { console.error('Usage: node statement-html.mjs "granholm"'); process.exit(1); }

const { data, error } = await supabase.rpc('generate_customer_statement', { p_query: query });
if (error || data?.error) {
  console.error('Error:', error?.message || data?.message || 'Unknown');
  process.exit(1);
}

const $ = n => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const d = data;
const vehicle = d.vehicle;
const customer = d.customer;
const totals = d.totals;
const perWo = d.per_work_order || [];
const billable = d.sections.billable_items || [];
const goodwill = d.sections.goodwill_items || [];
const payments = d.sections.payments_received || [];

// Group billable items by work order
const woGroups = {};
for (const item of billable) {
  const wo = item.work_order;
  if (!woGroups[wo]) woGroups[wo] = { parts: [], labor: [] };
  const cat = item.category === 'labor' ? 'labor' : 'parts';
  woGroups[wo][cat].push(item);
}

function partsRows(parts) {
  if (!parts.length) return '';
  let rows = parts.map(p => {
    const qty = p.detail ? `<span class="qty-detail">${p.detail}</span>` : p.quantity || 1;
    return `<tr>
      <td class="desc">${esc(p.description)}</td>
      <td class="supplier">${esc(p.supplier || '')}</td>
      <td class="qty">${qty}</td>
      <td class="money">${$(p.amount)}</td>
    </tr>`;
  }).join('\n');
  const total = parts.reduce((s, p) => s + Number(p.amount || 0), 0);
  rows += `<tr class="subtotal-row"><td colspan="3">Parts subtotal</td><td class="money">${$(total)}</td></tr>`;
  return rows;
}

function laborRows(labor) {
  if (!labor.length) return '';
  let rows = labor.map(l => `<tr>
    <td class="desc">${esc(l.description)}</td>
    <td class="supplier">${esc(l.detail || '')}</td>
    <td class="qty"></td>
    <td class="money">${$(l.amount)}</td>
  </tr>`).join('\n');
  const total = labor.reduce((s, l) => s + Number(l.amount || 0), 0);
  rows += `<tr class="subtotal-row"><td colspan="3">Labor subtotal</td><td class="money">${$(total)}</td></tr>`;
  return rows;
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Work Order Statement — ${vehicle.year} ${vehicle.make} ${vehicle.model}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #f0f0f0; }
  .page { max-width: 850px; margin: 20px auto; background: #fff; border: 1px solid #ccc; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 28px 32px 20px; border-bottom: 3px solid #1a1a1a; }
  .shop-name { font-size: 28px; font-weight: 800; letter-spacing: 0.12em; }
  .shop-sub { font-size: 10px; color: #666; letter-spacing: 0.06em; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h2 { font-size: 18px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .doc-title .doc-date { font-size: 10px; color: #666; margin-top: 2px; font-family: 'Courier New', monospace; }

  /* Info grid */
  .info-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border-bottom: 1px solid #ddd; }
  .info-box { padding: 14px 24px; }
  .info-box + .info-box { border-left: 1px solid #ddd; }
  .info-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 4px; }
  .info-value { font-size: 12px; font-weight: 600; }
  .info-detail { font-size: 10px; color: #555; margin-top: 1px; }

  /* Vehicle banner */
  .vehicle-bar { background: #f7f7f7; border-bottom: 2px solid #1a1a1a; padding: 14px 24px; }
  .vehicle-title { font-size: 15px; font-weight: 700; }
  .vehicle-meta { display: flex; gap: 24px; margin-top: 6px; font-size: 10px; color: #555; }
  .vehicle-meta span { }
  .vehicle-meta .label { font-weight: 700; color: #888; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; }

  /* Work order sections */
  .wo-section { border-bottom: 1px solid #e0e0e0; }
  .wo-header { background: #fafafa; padding: 10px 24px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; }
  .wo-title { font-size: 12px; font-weight: 700; }
  .wo-status { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 3px; }
  .wo-status.completed { background: #e8f5e9; color: #2e7d32; }
  .wo-status.in_progress { background: #fff3e0; color: #e65100; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; }
  .section-label { padding: 8px 24px 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #888; background: #fff; border-bottom: 1px solid #eee; }
  th { padding: 6px 12px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #888; border-bottom: 2px solid #ddd; background: #fff; }
  th:last-child, td.money { text-align: right; font-family: 'Courier New', monospace; }
  td { padding: 5px 12px; border-bottom: 1px solid #f0f0f0; font-size: 10px; vertical-align: top; }
  td.desc { font-weight: 500; max-width: 340px; }
  td.supplier { color: #888; font-size: 9px; }
  td.qty { text-align: center; font-size: 9px; }
  td.money { font-weight: 600; white-space: nowrap; }
  .qty-detail { font-size: 9px; color: #666; }
  .subtotal-row td { border-top: 1px solid #ccc; border-bottom: 2px solid #ccc; font-weight: 700; font-size: 10px; padding-top: 6px; padding-bottom: 6px; }

  /* Goodwill section */
  .goodwill { padding: 0 0 12px; }
  .goodwill-header { padding: 12px 24px 6px; font-size: 11px; font-weight: 700; color: #2e7d32; }
  .goodwill-note { padding: 0 24px 8px; font-size: 9px; color: #666; }
  .goodwill table td { color: #555; }
  .goodwill td.money { color: #2e7d32; }
  .goodwill .subtotal-row td { color: #2e7d32; font-weight: 700; }

  /* Payments */
  .payments { padding: 0 0 12px; border-top: 1px solid #e0e0e0; }
  .payments-header { padding: 12px 24px 6px; font-size: 11px; font-weight: 700; }
  .payments table td.money { color: #1565c0; }

  /* Totals */
  .totals-section { border-top: 3px solid #1a1a1a; padding: 16px 24px; }
  .totals-grid { display: grid; grid-template-columns: 1fr auto; gap: 0; max-width: 340px; margin-left: auto; }
  .totals-grid .t-label { padding: 3px 0; font-size: 11px; }
  .totals-grid .t-value { padding: 3px 0; font-size: 11px; text-align: right; font-family: 'Courier New', monospace; font-weight: 600; }
  .totals-grid .t-sep { grid-column: 1 / -1; border-top: 1px solid #ccc; margin: 4px 0; }
  .totals-grid .t-big { font-size: 16px; font-weight: 800; padding: 6px 0; }
  .totals-grid .t-due { color: #c62828; }
  .totals-grid .t-green { color: #2e7d32; }
  .totals-grid .t-blue { color: #1565c0; }
  .totals-grid .t-sep-heavy { grid-column: 1 / -1; border-top: 2px solid #1a1a1a; margin: 6px 0; }

  /* Footer */
  .footer { border-top: 1px solid #e0e0e0; padding: 12px 24px; font-size: 9px; color: #888; display: flex; justify-content: space-between; }

  @media print {
    body { background: #fff; }
    .page { border: none; margin: 0; max-width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="shop-name">NUKE</div>
      <div class="shop-sub">Vehicle Build Services &bull; Las Vegas, NV</div>
    </div>
    <div class="doc-title">
      <h2>Work Order Statement</h2>
      <div class="doc-date">${today}</div>
    </div>
  </div>

  <!-- Info bar: Customer | Vehicle | Balance -->
  <div class="info-bar">
    <div class="info-box">
      <div class="info-label">Customer</div>
      <div class="info-value">${esc(customer?.name || '')}</div>
      <div class="info-detail">${esc(customer?.email || '')}</div>
      <div class="info-detail">${esc(customer?.phone || '')}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Vehicle</div>
      <div class="info-value">${vehicle.year} ${esc(vehicle.make)} ${esc(vehicle.model)}</div>
      <div class="info-detail">VIN: ${esc(vehicle.vin || 'N/A')}</div>
    </div>
    <div class="info-box" style="text-align:right;">
      <div class="info-label">Balance Due</div>
      <div class="info-value" style="font-size:20px; color:#c62828; font-family:'Courier New',monospace;">${$(totals.balance_due)}</div>
      <div class="info-detail">${$(totals.total_paid)} of ${$(totals.subtotal)} paid</div>
    </div>
  </div>

  <!-- Vehicle banner -->
  <div class="vehicle-bar">
    <div class="vehicle-title">${vehicle.year} ${esc(vehicle.make)} ${esc(vehicle.model)}</div>
    <div class="vehicle-meta">
      <span><span class="label">VIN</span> ${esc(vehicle.vin || 'N/A')}</span>
      <span><span class="label">Work Orders</span> ${perWo.length}</span>
      <span><span class="label">Total Work Value</span> ${$(totals.total_work_value)}</span>
    </div>
  </div>

  <!-- Work Order Sections -->
  ${perWo.map(wo => {
    const g = woGroups[wo.work_order];
    if (!g) return '';
    const statusClass = wo.status.replace(/\s/g, '_');
    return `
  <div class="wo-section">
    <div class="wo-header">
      <div class="wo-title">${esc(wo.work_order)}</div>
      <div class="wo-status ${statusClass}">${esc(wo.status)}</div>
    </div>

    ${g.parts.length ? `
    <div class="section-label">Parts</div>
    <table>
      <thead><tr><th style="width:45%">Description</th><th style="width:20%">Supplier</th><th style="width:10%">Qty</th><th style="width:15%">Amount</th></tr></thead>
      <tbody>${partsRows(g.parts)}</tbody>
    </table>` : ''}

    ${g.labor.length ? `
    <div class="section-label">Labor</div>
    <table>
      <thead><tr><th style="width:45%">Description</th><th style="width:20%">Rate</th><th style="width:10%"></th><th style="width:15%">Amount</th></tr></thead>
      <tbody>${laborRows(g.labor)}</tbody>
    </table>` : ''}
  </div>`;
  }).join('\n')}

  <!-- Goodwill Section -->
  ${goodwill.length ? `
  <div class="goodwill">
    <div class="goodwill-header">Goodwill — Completed At No Charge</div>
    <div class="goodwill-note">The following work was performed as a courtesy. Retail values shown for reference.</div>
    <table style="margin:0 12px; width:calc(100% - 24px);">
      <thead><tr><th style="width:50%">Description</th><th style="width:10%">Type</th><th style="width:25%">Reason</th><th style="width:15%">Retail Value</th></tr></thead>
      <tbody>
        ${goodwill.map(g => `<tr>
          <td class="desc">${esc(g.description)}${g.detail ? ` <span style="color:#888;font-size:9px;">(${esc(g.detail)})</span>` : ''}</td>
          <td class="supplier">${g.category === 'labor' ? 'Labor' : 'Part'}</td>
          <td style="font-size:9px;color:#666;">${esc((g.reason || '').replace(/goodwill/i, '').replace(/—\s*/, '').trim())}</td>
          <td class="money">${$(g.retail_value)}</td>
        </tr>`).join('\n')}
        <tr class="subtotal-row"><td colspan="3">Goodwill total</td><td class="money">${$(totals.goodwill_value)}</td></tr>
      </tbody>
    </table>
  </div>` : ''}

  <!-- Payments Section -->
  ${payments.length ? `
  <div class="payments">
    <div class="payments-header">Payments Received</div>
    <table style="margin:0 12px; width:calc(100% - 24px);">
      <thead><tr><th>Date</th><th>Method</th><th>Memo</th><th>Amount</th></tr></thead>
      <tbody>
        ${payments.map(p => `<tr>
          <td>${esc(p.date)}</td>
          <td style="text-transform:uppercase;font-size:9px;font-weight:700;">${esc(p.method)}</td>
          <td>${esc(p.memo || '')}</td>
          <td class="money">${$(p.amount)}</td>
        </tr>`).join('\n')}
        <tr class="subtotal-row"><td colspan="3">Total payments</td><td class="money">${$(totals.total_paid)}</td></tr>
      </tbody>
    </table>
  </div>` : ''}

  <!-- Totals -->
  <div class="totals-section">
    <div class="totals-grid">
      <div class="t-label">Parts</div><div class="t-value">${$(totals.parts)}</div>
      <div class="t-label">Labor</div><div class="t-value">${$(totals.labor)}</div>
      <div class="t-sep"></div>
      <div class="t-label" style="font-weight:700;">Total Billed</div><div class="t-value" style="font-weight:700;">${$(totals.subtotal)}</div>
      <div class="t-label t-blue">Payments Received</div><div class="t-value t-blue">-${$(totals.total_paid)}</div>
      <div class="t-sep-heavy"></div>
      <div class="t-label t-big t-due">BALANCE DUE</div><div class="t-value t-big t-due">${$(totals.balance_due)}</div>
      <div class="t-sep"></div>
      <div class="t-label t-green" style="font-size:10px;">Goodwill provided (no charge)</div><div class="t-value t-green" style="font-size:10px;">${$(totals.goodwill_value)}</div>
      <div class="t-label" style="font-size:10px;color:#888;">Total work performed</div><div class="t-value" style="font-size:10px;color:#888;">${$(totals.total_work_value)}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>NUKE Vehicle Build Services &bull; Las Vegas, NV &bull; nuke.ag</div>
    <div>Generated ${today}</div>
  </div>

</div>
</body>
</html>`;

// Write and open
const outPath = join(tmpdir(), `nuke-statement-${query.toLowerCase().replace(/\s+/g, '-')}.html`);
writeFileSync(outPath, html, 'utf8');
console.log(`Statement written to: ${outPath}`);
try { execSync(`open "${outPath}"`); } catch {}
