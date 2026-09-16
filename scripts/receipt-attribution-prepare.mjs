#!/usr/bin/env node
/**
 * receipt-attribution-prepare.mjs — pull orphan receipts (vehicle_id IS NULL), slice
 * into per-agent worklists for multi-agent attribution.
 *
 * Each worklist line: {receipt_id, vendor, merchant_address, total, transaction_date,
 *                      receipt_type, payment_method, card_last4, line_items, vehicle_hint}
 * Plus a header line with the candidate vehicle list (Skylar's 92 vehicles).
 *
 * Usage:
 *   node scripts/receipt-attribution-prepare.mjs --limit 500 --batch-size 100 --out /tmp/receipt-attr/run-1
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '500'));
const BATCH = parseInt(arg('--batch-size', '100'));
const OUT = arg('--out', `/tmp/receipt-attr/run-${Date.now()}`);

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Pull Skylar's vehicle candidate set
const { data: vehicles, error: vErr } = await sb
  .from('vehicles')
  .select('id, year, make, model, trim, vin, color, color_primary')
  .in('id', JSON.parse(process.env.SKYLAR_VEHICLE_IDS || '[]'));

if (vErr) { console.error('vehicles fetch:', vErr.message); process.exit(1); }

// Fallback if env not set: pull from vehicle_user_permissions
let vehicleList = vehicles;
if (!vehicleList || vehicleList.length === 0) {
  const { data: perms } = await sb
    .from('vehicle_user_permissions')
    .select('vehicle_id')
    .eq('user_id', '0b9f107a-d124-49de-9ded-94698f63c1c4')
    .eq('is_active', true)
    .limit(200);
  const ids = (perms || []).map(p => p.vehicle_id);
  const { data: vs } = await sb
    .from('vehicles')
    .select('id, year, make, model, trim, vin, color, color_primary')
    .in('id', ids);
  vehicleList = vs || [];
}
console.log(`prepare: vehicle candidates: ${vehicleList.length}`);

// Pull orphan receipts (Tier A: have raw_json, no vehicle_id)
const { data: receipts, error: rErr } = await sb
  .from('receipts')
  .select('id, vendor_name, vendor_address, transaction_date, total, total_amount, payment_method, card_last4, raw_json, file_name, file_url')
  .is('vehicle_id', null)
  .not('raw_json', 'is', null)
  .limit(LIMIT);

if (rErr) { console.error('receipts fetch:', rErr.message); process.exit(1); }

console.log(`prepare: pulled ${receipts.length} orphan receipts`);

// Slice into batches
mkdirSync(OUT, { recursive: true });

// Header file with vehicle candidates (loaded once, referenced by every agent)
writeFileSync(`${OUT}/vehicles.json`, JSON.stringify(vehicleList.map(v => ({
  id: v.id,
  label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '),
  vin: v.vin || null,
  color: v.color || v.color_primary || null,
})), null, 2));

// One worklist per batch
for (let i = 0; i < receipts.length; i += BATCH) {
  const batch = receipts.slice(i, i + BATCH);
  const batchId = `b${String(Math.floor(i / BATCH)).padStart(3, '0')}`;
  const lines = batch.map(r => {
    const data = r.raw_json?.data_v2 || r.raw_json || {};
    return JSON.stringify({
      receipt_id: r.id,
      vendor: r.vendor_name || data.merchant_name || null,
      merchant_address: r.vendor_address || data.merchant_address || null,
      transaction_date: r.transaction_date || data.transaction_date || null,
      total: r.total || r.total_amount || data.total || null,
      receipt_type: data.receipt_type || null,
      vehicle_hint: data.vehicle_hint || null,
      payment_method: r.payment_method || data.payment_method || null,
      card_last4: r.card_last4 || data.card_last4 || null,
      line_items: (data.line_items || []).slice(0, 20).map(li => ({
        description: li.description || null,
        part_number: li.part_number || null,
        category: li.category || null,
        qty: li.qty || li.quantity || null,
        total: li.total_price || li.unit_price || null,
      })),
      file_name: r.file_name || null,
    });
  }).join('\n');
  writeFileSync(`${OUT}/${batchId}.jsonl`, lines);
  console.log(`  ${batchId}: ${batch.length} receipts → ${OUT}/${batchId}.jsonl`);
}
writeFileSync(`${OUT}/sink.jsonl`, '');
console.log(`prepare: ${Math.ceil(receipts.length / BATCH)} batches written to ${OUT}`);
console.log(`prepare: sink: ${OUT}/sink.jsonl`);
console.log(`prepare: vehicles: ${OUT}/vehicles.json`);
