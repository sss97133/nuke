#!/usr/bin/env node
/**
 * balance.mjs — Real-time work order balance computation
 *
 * Computes the full balance for any work order by summing:
 * - Parts cost (work_order_parts, non-comped)
 * - Labor cost (work_order_labor, non-comped)
 * - Payments received (work_order_payments)
 * - Comped items (listed at retail but $0 charged)
 *
 * Every line item traces to a source citation.
 *
 * Usage:
 *   dotenvx run -- node mcp-servers/nuke-context/balance.mjs "granholm"
 *   dotenvx run -- node mcp-servers/nuke-context/balance.mjs --wo <work_order_id>
 *   dotenvx run -- node mcp-servers/nuke-context/balance.mjs --vehicle <vehicle_id>
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

// ─── Load env ─────────────────────────────────────────────────────────────────
try {
  const envOutput = execSync('cd /Users/skylar/nuke && dotenvx run -- env', {
    encoding: 'utf-8', timeout: 10000
  });
  for (const line of envOutput.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq + 1);
  }
} catch {}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env. Run with: dotenvx run -- node mcp-servers/nuke-context/balance.mjs "granholm"');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const query = args.find(a => !a.startsWith('--'));
const WO_ID = arg('--wo');
const VEHICLE_ID = arg('--vehicle');

// ─── Resolve query to work orders ─────────────────────────────────────────────
async function resolveWorkOrders() {
  if (WO_ID) {
    const { data } = await supabase.from('work_orders')
      .select('id, vehicle_id, customer_name, title, status')
      .eq('id', WO_ID);
    return data || [];
  }

  if (VEHICLE_ID) {
    const { data } = await supabase.from('work_orders')
      .select('id, vehicle_id, customer_name, title, status')
      .eq('vehicle_id', VEHICLE_ID)
      .order('created_at', { ascending: false });
    return data || [];
  }

  if (query) {
    const { data } = await supabase.from('work_orders')
      .select('id, vehicle_id, customer_name, title, status')
      .or(`customer_name.ilike.%${query}%,title.ilike.%${query}%,description.ilike.%${query}%`)
      .order('created_at', { ascending: false });
    return data || [];
  }

  console.error('Usage: balance.mjs "granholm" | --wo <id> | --vehicle <id>');
  process.exit(1);
}

// ─── Compute balance for one work order ───────────────────────────────────────
async function computeBalance(wo) {
  // Get parts
  const { data: parts } = await supabase.from('work_order_parts')
    .select('part_name, part_number, brand, quantity, unit_price, total_price, supplier, is_comped, comp_reason, comp_retail_value, notes')
    .eq('work_order_id', wo.id)
    .order('created_at');

  // Get labor
  const { data: labor } = await supabase.from('work_order_labor')
    .select('task_name, task_category, hours, hourly_rate, total_cost, is_comped, comp_reason, comp_retail_value, industry_standard_hours, calculated_rate, rate_source, notes')
    .eq('work_order_id', wo.id)
    .order('created_at');

  // Get payments
  const { data: payments } = await supabase.from('work_order_payments')
    .select('amount, payment_method, sender_name, memo, payment_date, source')
    .eq('work_order_id', wo.id)
    .order('payment_date');

  // ── Compute totals ──
  const chargedParts = (parts || []).filter(p => !p.is_comped);
  const compedParts = (parts || []).filter(p => p.is_comped);
  const chargedLabor = (labor || []).filter(l => !l.is_comped);
  const compedLabor = (labor || []).filter(l => l.is_comped);

  const partsTotal = chargedParts.reduce((s, p) => s + Number(p.total_price || 0), 0);
  const laborTotal = chargedLabor.reduce((s, l) => s + Number(l.total_cost || 0), 0);
  const paymentsTotal = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const compedPartsValue = compedParts.reduce((s, p) => s + Number(p.comp_retail_value || p.total_price || 0), 0);
  const compedLaborValue = compedLabor.reduce((s, l) => s + Number(l.comp_retail_value || l.total_cost || 0), 0);

  const totalCharged = partsTotal + laborTotal;
  const balanceDue = totalCharged - paymentsTotal;

  return {
    wo,
    parts: parts || [],
    labor: labor || [],
    payments: payments || [],
    chargedParts, compedParts, chargedLabor, compedLabor,
    partsTotal, laborTotal, paymentsTotal,
    compedPartsValue, compedLaborValue,
    totalCharged, balanceDue
  };
}

// ─── Format receipt ───────────────────────────────────────────────────────────
function printReceipt(b) {
  const line = (w = 72) => '─'.repeat(w);
  const money = n => `$${Number(n).toFixed(2).padStart(9)}`;
  const pad = (s, w) => (s || '').slice(0, w).padEnd(w);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  WORK ORDER RECEIPT`);
  console.log(`  ${b.wo.title}`);
  console.log(`  Customer: ${b.wo.customer_name || 'N/A'} | Status: ${b.wo.status}`);
  console.log(`${'═'.repeat(72)}`);

  // ── PARTS ──
  if (b.chargedParts.length > 0) {
    console.log(`\n  PARTS (charged)`);
    console.log(`  ${line(68)}`);
    for (const p of b.chargedParts) {
      const pn = p.part_number ? ` [${p.part_number}]` : '';
      console.log(`  ${pad(p.part_name + pn, 48)} ${pad(p.supplier, 12)} ${money(p.total_price)}`);
      if (p.notes) console.log(`    Source: ${p.notes.slice(0, 60)}`);
    }
    console.log(`  ${line(68)}`);
    console.log(`  ${'PARTS SUBTOTAL'.padEnd(60)} ${money(b.partsTotal)}`);
  }

  // ── COMPED PARTS ──
  if (b.compedParts.length > 0) {
    console.log(`\n  PARTS (comped — retail value shown, $0 charged)`);
    console.log(`  ${line(68)}`);
    for (const p of b.compedParts) {
      const val = p.comp_retail_value || p.total_price || 0;
      console.log(`  ${pad(p.part_name, 48)} ${pad(p.supplier, 12)} ${money(val)} COMPED`);
      if (p.comp_reason) console.log(`    Reason: ${p.comp_reason}`);
    }
    console.log(`  ${'COMPED PARTS VALUE'.padEnd(60)} ${money(b.compedPartsValue)}`);
  }

  // ── LABOR ──
  if (b.chargedLabor.length > 0) {
    console.log(`\n  LABOR (charged)`);
    console.log(`  ${line(68)}`);
    for (const l of b.chargedLabor) {
      const hrs = l.hours ? `${l.hours}h` : '';
      const rate = l.hourly_rate ? `@ $${l.hourly_rate}/hr` : '';
      const cite = l.rate_source ? ` [${l.rate_source}]` : '';
      console.log(`  ${pad(l.task_name, 40)} ${pad(`${hrs} ${rate}`, 20)} ${money(l.total_cost)}`);
      if (cite) console.log(`    Rate citation: ${cite}`);
    }
    console.log(`  ${line(68)}`);
    console.log(`  ${'LABOR SUBTOTAL'.padEnd(60)} ${money(b.laborTotal)}`);
  }

  // ── COMPED LABOR ──
  if (b.compedLabor.length > 0) {
    console.log(`\n  LABOR (comped — retail value shown, $0 charged)`);
    console.log(`  ${line(68)}`);
    for (const l of b.compedLabor) {
      const val = l.comp_retail_value || l.total_cost || 0;
      console.log(`  ${pad(l.task_name, 48)} ${pad(l.task_category, 12)} ${money(val)} COMPED`);
      if (l.comp_reason) console.log(`    Reason: ${l.comp_reason}`);
    }
    console.log(`  ${'COMPED LABOR VALUE'.padEnd(60)} ${money(b.compedLaborValue)}`);
  }

  // ── PAYMENTS ──
  if (b.payments.length > 0) {
    console.log(`\n  PAYMENTS RECEIVED`);
    console.log(`  ${line(68)}`);
    for (const p of b.payments) {
      const dt = p.payment_date?.slice(0, 10) || '?';
      console.log(`  ${pad(dt, 12)} ${pad(p.payment_method, 8)} ${pad(p.memo || '', 28)} ${pad(p.sender_name, 12)} ${money(p.amount)}`);
    }
    console.log(`  ${line(68)}`);
    console.log(`  ${'TOTAL PAYMENTS'.padEnd(60)} ${money(b.paymentsTotal)}`);
  }

  // ── BALANCE ──
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${'TOTAL CHARGED'.padEnd(60)} ${money(b.totalCharged)}`);
  console.log(`  ${'TOTAL PAYMENTS'.padEnd(60)} ${money(b.paymentsTotal)}`);
  console.log(`  ${line(68)}`);

  if (b.balanceDue > 0) {
    console.log(`  ${'BALANCE DUE'.padEnd(60)} ${money(b.balanceDue)}`);
  } else if (b.balanceDue < 0) {
    console.log(`  ${'OVERPAYMENT (credit)'.padEnd(60)} ${money(Math.abs(b.balanceDue))}`);
  } else {
    console.log(`  ${'PAID IN FULL'.padEnd(60)} ${money(0)}`);
  }

  if (b.compedPartsValue + b.compedLaborValue > 0) {
    console.log(`  ${'GOODWILL / COMPED VALUE'.padEnd(60)} ${money(b.compedPartsValue + b.compedLaborValue)}`);
  }
  console.log(`${'═'.repeat(72)}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const workOrders = await resolveWorkOrders();

  if (workOrders.length === 0) {
    console.error(`No work orders found for "${query || WO_ID || VEHICLE_ID}"`);
    process.exit(1);
  }

  console.log(`Found ${workOrders.length} work order(s)\n`);

  let grandParts = 0, grandLabor = 0, grandPayments = 0;

  for (const wo of workOrders) {
    const balance = await computeBalance(wo);
    printReceipt(balance);

    grandParts += balance.partsTotal;
    grandLabor += balance.laborTotal;
    grandPayments += balance.paymentsTotal;
  }

  // Grand summary across all WOs
  if (workOrders.length > 1) {
    const grandTotal = grandParts + grandLabor;
    const grandBalance = grandTotal - grandPayments;
    console.log(`${'═'.repeat(72)}`);
    console.log(`  GRAND TOTAL ACROSS ${workOrders.length} WORK ORDERS`);
    console.log(`  ${'Parts'.padEnd(60)} $${grandParts.toFixed(2).padStart(9)}`);
    console.log(`  ${'Labor'.padEnd(60)} $${grandLabor.toFixed(2).padStart(9)}`);
    console.log(`  ${'Payments'.padEnd(60)} $${grandPayments.toFixed(2).padStart(9)}`);
    console.log(`  ${'─'.repeat(68)}`);
    console.log(`  ${'NET BALANCE'.padEnd(60)} $${grandBalance.toFixed(2).padStart(9)}`);
    console.log(`${'═'.repeat(72)}\n`);
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
