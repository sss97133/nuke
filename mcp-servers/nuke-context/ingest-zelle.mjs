#!/usr/bin/env node
/**
 * ingest-zelle.mjs — Parse AFCU Zelle SMS notifications from iMessage chat.db
 *
 * Reads short code 767666 messages, extracts sender/amount/memo from both
 * outbound (confirmation requests) and inbound (deposit notifications),
 * writes payment records linked to work orders via contact→vehicle resolution.
 *
 * Usage:
 *   node mcp-servers/nuke-context/ingest-zelle.mjs                    # discover all Zelle txns
 *   node mcp-servers/nuke-context/ingest-zelle.mjs --vehicle <id>     # filter to one vehicle
 *   node mcp-servers/nuke-context/ingest-zelle.mjs --after 2026-02-21 # date filter
 *   node mcp-servers/nuke-context/ingest-zelle.mjs --dry-run          # preview without writing
 */

import Database from 'better-sqlite3';
import { createSupabase, CHAT_DB_PATH, APPLE_EPOCH_OFFSET } from './lib/env.mjs';

const CHAT_DB = CHAT_DB_PATH;
const ZELLE_SHORT_CODE = '767666';

// CLI args
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');
const VEHICLE_FILTER = arg('--vehicle');
const AFTER_DATE = arg('--after');

// ─── Decode attributedBody blobs ──────────────────────────────────────────────
function decodeAttributedBody(buf) {
  if (!buf) return null;
  // NSAttributedString stores text as readable ASCII/UTF-8 mixed with binary.
  // Replace non-printable bytes with single space to preserve word boundaries,
  // then collapse runs of spaces. This keeps quoted memos intact across chunks.
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) text += String.fromCharCode(b);
    else text += ' ';
  }
  // Collapse whitespace runs and trim
  text = text.replace(/\s{2,}/g, ' ').trim();
  // The Zelle message body starts after "AMERICA FIRST CREDIT UNION" markers
  // or contains "sent you $" / "Send $" / "Sending your payment"
  return text;
}

// ─── Parse Zelle message patterns ─────────────────────────────────────────────
// Inbound pattern: "DAVID GRANHOLM sent you $416.73. "BILSTEIN SHOCKS""
const INBOUND_RE = /([A-Z][A-Z .]+?)\s+sent you \$([\d,]+\.\d{2})\.\s*"([^"]+)"/;
// Outbound confirmation: 'Send $1,700.00 Zelle pmt to CHARLES TEVES?'
const OUTBOUND_RE = /Send \$([\d,]+\.\d{2}) Zelle pmt to ([A-Z][A-Z .]+?)\?/;
// Sent confirmation: "Sending your payment for $1,700.00 to CHARLES"
const SENT_RE = /Sending your payment for \$([\d,]+\.\d{2}) to ([A-Z]+)/;

function parseZelleMessage(text, ts) {
  if (!text) return null;

  // Inbound (someone sent us money)
  let match = text.match(INBOUND_RE);
  if (match) {
    return {
      direction: 'inbound',
      sender: match[1].trim(),
      amount: parseFloat(match[2].replace(/,/g, '')),
      memo: match[3].trim(),
      timestamp: ts,
      raw: text
    };
  }

  // Outbound confirmation request
  match = text.match(OUTBOUND_RE);
  if (match) {
    return {
      direction: 'outbound_request',
      recipient: match[2].trim(),
      amount: parseFloat(match[1].replace(/,/g, '')),
      memo: null,
      timestamp: ts,
      raw: text
    };
  }

  // Sent confirmation
  match = text.match(SENT_RE);
  if (match) {
    return {
      direction: 'outbound_confirmed',
      recipient: match[2].trim(),
      amount: parseFloat(match[1].replace(/,/g, '')),
      memo: null,
      timestamp: ts,
      raw: text
    };
  }

  return null;
}

// ─── Read all Zelle messages from chat.db ─────────────────────────────────────
function readZelleMessages(afterDate) {
  const db = new Database(CHAT_DB, { readonly: true });

  let dateFilter = '';
  if (afterDate) {
    const unixTs = Math.floor(new Date(afterDate).getTime() / 1000);
    const appleTs = (unixTs - APPLE_EPOCH_OFFSET) * 1e9;
    dateFilter = `AND m.date > ${appleTs}`;
  }

  const rows = db.prepare(`
    SELECT m.ROWID, m.date, m.is_from_me, m.text, m.attributedBody
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = '${ZELLE_SHORT_CODE}'
    ${dateFilter}
    ORDER BY m.date ASC
  `).all();

  db.close();

  const results = [];
  for (const row of rows) {
    const ts = new Date((row.date / 1e9 + APPLE_EPOCH_OFFSET) * 1000).toISOString();
    const text = row.text || decodeAttributedBody(row.attributedBody);
    const parsed = parseZelleMessage(text, ts);
    if (parsed) {
      parsed.rowid = row.ROWID;
      parsed.is_from_me = row.is_from_me;
      results.push(parsed);
    }
  }
  return results;
}

// ─── Resolve sender → contact → work orders ──────────────────────────────────
async function resolvePaymentToWorkOrder(supabase, payment) {
  // Search work orders by customer name
  const senderParts = payment.sender.split(/\s+/);
  const lastName = senderParts[senderParts.length - 1];

  const { data: wos } = await supabase
    .from('work_orders')
    .select('id, vehicle_id, customer_name, title, status')
    .ilike('customer_name', `%${lastName}%`)
    .order('created_at', { ascending: false });

  if (!wos || wos.length === 0) {
    // Try deal_contacts
    const { data: contacts } = await supabase
      .from('deal_contacts')
      .select('id, full_name, vehicle_id')
      .ilike('last_name', `%${lastName}%`);

    if (contacts?.length > 0) {
      // Find work orders for the contact's vehicle
      const vehicleIds = [...new Set(contacts.map(c => c.vehicle_id).filter(Boolean))];
      for (const vid of vehicleIds) {
        const { data: vehicleWos } = await supabase
          .from('work_orders')
          .select('id, vehicle_id, customer_name, title, status')
          .eq('vehicle_id', vid)
          .order('created_at', { ascending: false });
        if (vehicleWos?.length > 0) return vehicleWos;
      }
    }
    return [];
  }

  return wos;
}

// ─── Write payment to DB ──────────────────────────────────────────────────────
async function writePayment(supabase, payment, workOrder) {
  // Dedup via unique index (work_order_id, amount, payment_method, sender_name)
  const record = {
    work_order_id: workOrder.id,
    amount: payment.amount,
    payment_method: 'zelle',
    sender_name: payment.sender,
    memo: payment.memo || null,
    payment_date: payment.timestamp,
    source: 'imessage_sms',
    status: 'completed',
    source_metadata: {
      chat_identifier: ZELLE_SHORT_CODE,
      message_rowid: payment.rowid,
      direction: payment.direction,
      raw_text: payment.raw?.slice(0, 300)
    }
  };

  const { data, error } = await supabase
    .from('work_order_payments')
    .upsert(record, { onConflict: 'work_order_id,amount,payment_method,sender_name' })
    .select()
    .single();

  if (error) {
    console.error(`  [error] Failed to insert payment: ${error.message}`);
    return null;
  }
  return data;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Zelle Payment Ingestion ===\n');

  const afterDate = AFTER_DATE || '2025-01-01';
  console.log(`Reading Zelle messages from chat.db (after ${afterDate})...`);

  const payments = readZelleMessages(afterDate);
  console.log(`Found ${payments.length} Zelle transaction(s)\n`);

  // Separate inbound (received) from outbound
  const inbound = payments.filter(p => p.direction === 'inbound');
  const outbound = payments.filter(p => p.direction === 'outbound_request' || p.direction === 'outbound_confirmed');

  console.log('── INBOUND (received) ──');
  for (const p of inbound) {
    console.log(`  ${p.timestamp.slice(0, 10)} | ${p.sender.padEnd(25)} | $${p.amount.toFixed(2).padStart(10)} | "${p.memo}"`);
  }

  console.log('\n── OUTBOUND (sent) ──');
  for (const p of outbound) {
    console.log(`  ${p.timestamp.slice(0, 10)} | ${(p.recipient || '?').padEnd(25)} | $${p.amount.toFixed(2).padStart(10)}`);
  }

  // Filter to post-sale Granholm payments if vehicle filter specified
  let targetPayments = inbound;
  if (VEHICLE_FILTER) {
    // Only process inbound payments for now — outbound are expenses, different flow
    const supabase = createSupabase();

    // Get work orders for the vehicle
    const { data: wos } = await supabase
      .from('work_orders')
      .select('id, customer_name, title')
      .eq('vehicle_id', VEHICLE_FILTER);

    if (wos?.length > 0) {
      const customerNames = wos.map(wo => wo.customer_name?.toUpperCase()).filter(Boolean);
      targetPayments = inbound.filter(p =>
        customerNames.some(name => {
          const parts = name.split(/\s+/);
          return parts.some(part => p.sender.includes(part) && part.length > 2);
        })
      );
      console.log(`\n── Filtered to vehicle ${VEHICLE_FILTER}: ${targetPayments.length} payment(s) ──`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would write these payments to DB:');
    const total = targetPayments.reduce((sum, p) => sum + p.amount, 0);
    for (const p of targetPayments) {
      console.log(`  $${p.amount.toFixed(2)} from ${p.sender} — "${p.memo}" (${p.timestamp.slice(0, 10)})`);
    }
    console.log(`  TOTAL: $${total.toFixed(2)}`);
    return;
  }

  // Write to database
  const supabase = createSupabase();
  let written = 0;
  let skipped = 0;

  console.log('\n── Writing payments to work orders ──\n');

  for (const payment of targetPayments) {
    const workOrders = await resolvePaymentToWorkOrder(supabase, payment);

    if (workOrders.length === 0) {
      console.log(`  [?] No work order found for sender: ${payment.sender}`);
      skipped++;
      continue;
    }

    // Use the most relevant work order (in_progress first, then most recent)
    const wo = workOrders.find(w => w.status === 'in_progress') || workOrders[0];

    if (VEHICLE_FILTER && wo.vehicle_id !== VEHICLE_FILTER) {
      console.log(`  [skip] Work order ${wo.id} is for different vehicle`);
      skipped++;
      continue;
    }

    console.log(`  ${payment.timestamp.slice(0, 10)} | $${payment.amount.toFixed(2)} "${payment.memo}" → WO "${wo.title}"`);

    const result = await writePayment(supabase, payment, wo);
    if (result) written++;
    else skipped++;
  }

  // Summary
  const totalReceived = targetPayments.reduce((sum, p) => sum + p.amount, 0);
  console.log('\n── Summary ──');
  console.log(`  Payments found: ${targetPayments.length}`);
  console.log(`  Written to DB:  ${written}`);
  console.log(`  Skipped:        ${skipped}`);
  console.log(`  Total received: $${totalReceived.toFixed(2)}`);
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
