#!/usr/bin/env node
/**
 * resolve.mjs — "Update me on the Granholm build"
 *
 * One command. Fuzzy input. Complete answer.
 *
 * Takes any reference to a deal — name, vehicle, nickname — and returns:
 * - Who the customer is
 * - What vehicle
 * - Every work order with itemized parts, labor, payments
 * - The balance
 * - Last communication
 *
 * Usage: node resolve.mjs "the Granholm build"
 *        node resolve.mjs "K2500"
 *        node resolve.mjs "dave"
 */

import Database from 'better-sqlite3';
import { createSupabase, CHAT_DB_PATH, APPLE_EPOCH_OFFSET } from './lib/env.mjs';

const CHAT_DB = CHAT_DB_PATH;
const supabase = createSupabase();

const query = process.argv[2];
if (!query) { console.error('Usage: node resolve.mjs "the Granholm build"'); process.exit(1); }

// ─── Primary: Call DB RPC for resolution ──────────────────────────────────────
async function resolveViaRPC(q) {
  const { data, error } = await supabase.rpc('resolve_work_order_status', { p_query: q });
  if (error) return null;
  if (data?.error) return null;
  return data;
}

/** Transform RPC JSONB → the shape our print function expects */
function transformRPCResult(rpc) {
  const vehicle = rpc.vehicle;
  const contact = rpc.contact ? {
    customer_name: rpc.contact.name,
    customer_email: rpc.contact.email,
    customer_phone: rpc.contact.phone,
  } : null;

  const workOrders = (rpc.work_orders || []).map(wo => ({
    id: wo.id,
    title: wo.title,
    status: wo.status,
    created_at: wo.created_at,
  }));

  const financials = (rpc.work_orders || []).map(wo => ({
    parts: (wo.parts || []).map(p => ({
      part_name: p.name,
      part_number: p.number,
      supplier: p.supplier,
      total_price: p.price,
      unit_price: p.unit_price,
      quantity: p.quantity,
      is_comped: p.is_comped,
      comp_reason: p.comp_reason,
      comp_retail_value: p.price,
    })),
    labor: (wo.labor || []).map(l => ({
      task_name: l.task,
      hours: l.hours,
      hourly_rate: l.rate,
      total_cost: l.total,
      rate_source: l.rate_source,
      is_comped: l.is_comped,
    })),
    payments: (wo.payments || []).map(p => ({
      amount: p.amount,
      payment_method: p.method,
      sender_name: p.sender,
      memo: p.memo,
      payment_date: p.date,
    })),
  }));

  return { vehicle, workOrders, contact, financials };
}

// ─── Fallback: Client-side resolution ─────────────────────────────────────────
async function resolveFallback(q) {
  const term = q.toLowerCase().replace(/\b(the|my|that|this|build|truck|vehicle|car|update|me|on|status|of)\b/g, '').trim();
  const searchTerm = term.split(/\s+/).filter(t => t.length > 2).join(' ') || q;

  const { data: wos } = await supabase.from('work_orders')
    .select('id, vehicle_id, customer_name, customer_email, customer_phone, title, status')
    .or(`customer_name.ilike.%${searchTerm}%,title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%`)
    .order('created_at', { ascending: false }).limit(10);

  const vehicleIds = new Set();
  for (const wo of (wos || [])) if (wo.vehicle_id) vehicleIds.add(wo.vehicle_id);

  const { data: directVehicles } = await supabase.from('vehicles')
    .select('id, year, make, model, vin, status, sale_price')
    .or(`make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%,vin.ilike.%${searchTerm}%`)
    .limit(5);
  for (const v of (directVehicles || [])) vehicleIds.add(v.id);

  if (vehicleIds.size === 0) {
    console.error(`No matches for "${q}" (search term: "${searchTerm}")`);
    process.exit(1);
  }

  const vid = [...vehicleIds][0];
  const { data: vehicle } = await supabase.from('vehicles')
    .select('id, year, make, model, vin, status, sale_price').eq('id', vid).single();

  const { data: allWos } = await supabase.from('work_orders')
    .select('id, customer_name, customer_email, customer_phone, title, status, created_at')
    .eq('vehicle_id', vid).order('created_at');

  const contact = (allWos || []).find(w => w.customer_name && w.customer_name !== 'Owner');
  const financials = await Promise.all((allWos || []).map(wo => getFinancials(wo.id)));

  return { vehicle, workOrders: allWos || [], contact, financials };
}

async function getFinancials(woId) {
  const [partsRes, laborRes, paymentsRes] = await Promise.all([
    supabase.from('work_order_parts')
      .select('part_name, part_number, brand, quantity, unit_price, total_price, supplier, is_comped, comp_reason, comp_retail_value, notes')
      .eq('work_order_id', woId).order('created_at'),
    supabase.from('work_order_labor')
      .select('task_name, hours, hourly_rate, total_cost, is_comped, comp_reason, comp_retail_value, rate_source, industry_standard_hours, calculated_rate')
      .eq('work_order_id', woId).order('created_at'),
    supabase.from('work_order_payments')
      .select('amount, payment_method, sender_name, memo, payment_date')
      .eq('work_order_id', woId).order('payment_date'),
  ]);

  return { parts: partsRes.data || [], labor: laborRes.data || [], payments: paymentsRes.data || [] };
}

// ─── Step 3: Last communication from iMessage ─────────────────────────────────
function getLastMessage(phone) {
  if (!phone) return null;
  try {
    // Normalize phone to +1XXXXXXXXXX
    const normalized = phone.replace(/\D/g, '');
    const chatId = normalized.length === 10 ? `+1${normalized}` : `+${normalized}`;

    const db = new Database(CHAT_DB, { readonly: true });
    const row = db.prepare(`
      SELECT datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as ts,
        m.is_from_me,
        (SELECT COUNT(*) FROM chat_message_join cmj2
         JOIN message m2 ON m2.ROWID = cmj2.message_id
         WHERE cmj2.chat_id = c.ROWID) as total_msgs
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = ?
      ORDER BY m.date DESC LIMIT 1
    `).get(chatId);
    db.close();

    if (!row) return null;
    return {
      lastMessage: row.ts,
      from: row.is_from_me ? 'you' : 'them',
      totalMessages: row.total_msgs,
      chatId,
    };
  } catch { return null; }
}

// ─── Output ───────────────────────────────────────────────────────────────────
const $ = n => `$${Number(n || 0).toFixed(2)}`;
const pad = (s, w) => (s || '').slice(0, w).padEnd(w);
const line = '─'.repeat(70);

function printReport(vehicle, contact, workOrders, financials, comms) {
  // ── Header ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  VIN: ${vehicle.vin || 'unknown'}`);
  if (contact) {
    console.log(`  Customer: ${contact.customer_name} | ${contact.customer_email || ''} | ${contact.customer_phone || ''}`);
  }
  if (vehicle.sale_price) console.log(`  Sale: ${$(vehicle.sale_price)}`);
  if (comms) {
    console.log(`  Last text: ${comms.lastMessage} (${comms.from}) — ${comms.totalMessages} messages total`);
  }
  console.log(`${'═'.repeat(70)}`);

  let grandParts = 0, grandLabor = 0, grandPayments = 0, grandComped = 0;

  for (let i = 0; i < workOrders.length; i++) {
    const wo = workOrders[i];
    const fin = financials[i];
    if (!fin) continue;

    const charged = {
      parts: fin.parts.filter(p => !p.is_comped),
      labor: fin.labor.filter(l => !l.is_comped),
    };
    const comped = {
      parts: fin.parts.filter(p => p.is_comped),
      labor: fin.labor.filter(l => l.is_comped),
    };

    const partsTotal = charged.parts.reduce((s, p) => s + Number(p.total_price || 0), 0);
    const laborTotal = charged.labor.reduce((s, l) => s + Number(l.total_cost || 0), 0);
    const paymentsTotal = fin.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const compedTotal = comped.parts.reduce((s, p) => s + Number(p.comp_retail_value || p.total_price || 0), 0)
      + comped.labor.reduce((s, l) => s + Number(l.comp_retail_value || l.total_cost || 0), 0);

    // Skip empty work orders
    if (partsTotal === 0 && laborTotal === 0 && paymentsTotal === 0 && charged.parts.length === 0 && charged.labor.length === 0) continue;

    grandParts += partsTotal;
    grandLabor += laborTotal;
    grandPayments += paymentsTotal;
    grandComped += compedTotal;

    console.log(`\n  WO: ${wo.title}`);
    console.log(`  Status: ${wo.status}`);
    console.log(`  ${line}`);

    // Parts
    if (charged.parts.length > 0) {
      console.log(`  Parts:`);
      for (const p of charged.parts) {
        const pn = p.part_number ? ` [${p.part_number}]` : '';
        console.log(`    ${pad(p.part_name + pn, 45)} ${pad(p.supplier, 10)} ${$(p.total_price).padStart(10)}`);
      }
      console.log(`    ${''.padEnd(55)} ${('─'.repeat(10))}`);
      console.log(`    ${''.padEnd(55)} ${$(partsTotal).padStart(10)}`);
    }

    // Labor
    if (charged.labor.length > 0) {
      console.log(`  Labor:`);
      for (const l of charged.labor) {
        const hrs = l.industry_standard_hours || l.hours;
        const rate = l.calculated_rate || l.hourly_rate;
        const detail = hrs && rate ? `${hrs}h @ ${$(rate)}/hr` : '';
        console.log(`    ${pad(l.task_name, 40)} ${pad(detail, 15)} ${$(l.total_cost).padStart(10)}`);
        if (l.rate_source) console.log(`      cite: ${l.rate_source.slice(0, 65)}`);
      }
      console.log(`    ${''.padEnd(55)} ${('─'.repeat(10))}`);
      console.log(`    ${''.padEnd(55)} ${$(laborTotal).padStart(10)}`);
    }

    // Comped
    if (compedTotal > 0) {
      console.log(`  Comped (goodwill, $0 charged):`);
      for (const p of comped.parts) {
        const val = Number(p.comp_retail_value || p.total_price || 0);
        if (val > 0) console.log(`    ${pad(p.part_name, 55)} ${$(val).padStart(10)}`);
      }
      for (const l of comped.labor) {
        const val = Number(l.comp_retail_value || l.total_cost || 0);
        if (val > 0) console.log(`    ${pad(l.task_name, 55)} ${$(val).padStart(10)}`);
      }
      console.log(`    ${'Goodwill total'.padEnd(55)} ${$(compedTotal).padStart(10)}`);
    }

    // Payments
    if (fin.payments.length > 0) {
      console.log(`  Payments:`);
      for (const p of fin.payments) {
        const dt = (p.payment_date || '').slice(0, 10);
        console.log(`    ${pad(dt, 12)} ${pad(p.payment_method, 7)} ${pad(p.memo || '', 36)} ${$(p.amount).padStart(10)}`);
      }
      console.log(`    ${''.padEnd(55)} ${('─'.repeat(10))}`);
      console.log(`    ${''.padEnd(55)} ${$(paymentsTotal).padStart(10)}`);
    }
  }

  // ── Bottom line ──
  const grandCharged = grandParts + grandLabor;
  const balance = grandCharged - grandPayments;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${'Parts'.padEnd(55)} ${$(grandParts).padStart(10)}`);
  console.log(`  ${'Labor'.padEnd(55)} ${$(grandLabor).padStart(10)}`);
  console.log(`  ${''.padEnd(55)} ${('─'.repeat(10))}`);
  console.log(`  ${'Total charged'.padEnd(55)} ${$(grandCharged).padStart(10)}`);
  console.log(`  ${'Payments received'.padEnd(55)} ${$(-grandPayments).padStart(10)}`);
  console.log(`  ${''.padEnd(55)} ${'═'.repeat(10)}`);

  if (balance > 0) {
    console.log(`  ${'BALANCE DUE'.padEnd(55)} ${$(balance).padStart(10)}`);
  } else if (balance < 0) {
    console.log(`  ${'CREDIT (overpayment)'.padEnd(55)} ${$(Math.abs(balance)).padStart(10)}`);
  } else {
    console.log(`  ${'PAID IN FULL'.padEnd(55)} ${'$0.00'.padStart(10)}`);
  }

  if (grandComped > 0) {
    console.log(`  ${'Goodwill provided'.padEnd(55)} ${$(grandComped).padStart(10)}`);
  }
  console.log(`${'═'.repeat(70)}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  // Primary path: DB RPC (no filesystem, no Node dependencies)
  let vehicle, workOrders, contact, financials;
  const rpcResult = await resolveViaRPC(query);
  if (rpcResult) {
    const tx = transformRPCResult(rpcResult);
    vehicle = tx.vehicle;
    workOrders = tx.workOrders;
    contact = tx.contact;
    financials = tx.financials;
    console.log('  [via RPC: resolve_work_order_status]');
  } else {
    // Fallback: client-side resolution (more queries but handles edge cases)
    const fb = await resolveFallback(query);
    vehicle = fb.vehicle;
    workOrders = fb.workOrders;
    contact = fb.contact;
    financials = fb.financials;
    console.log('  [via client-side fallback]');
  }

  if (!vehicle) { console.log('Could not resolve vehicle.'); process.exit(1); }

  // Enrich with local iMessage data (the DB function can't read chat.db)
  const phone = contact?.customer_phone;
  const comms = getLastMessage(phone);

  printReport(vehicle, contact, workOrders, financials, comms);

  const elapsed = Date.now() - t0;
  console.log(`  Resolved in ${elapsed}ms`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
