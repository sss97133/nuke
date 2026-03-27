#!/usr/bin/env node
/**
 * ingest-receipts.mjs — Parse order confirmation emails into work_order_parts
 *
 * Reads Amazon auto-confirm and Summit Racing order confirmation emails via
 * Gmail API (MCP or OAuth), extracts itemized parts with prices and part numbers,
 * writes to work_order_parts linked to active work orders.
 *
 * Usage:
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-receipts.mjs                    # discover all
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-receipts.mjs --vehicle <id>     # filter
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-receipts.mjs --seed             # seed known data
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-receipts.mjs --dry-run          # preview
 *
 * The --seed flag writes already-extracted receipt data from the initial discovery
 * session (Amazon + Summit orders, Feb-Mar 2026) without needing Gmail API access.
 */

import { createSupabase } from './lib/env.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');
const SEED = flag('--seed');
const VEHICLE_FILTER = arg('--vehicle');

// ─── Known receipt data (extracted from Gmail MCP session 2026-03-26) ─────────
// These are the actual itemized parts from order confirmation emails.
// Source citations included for every line item.

const EXHAUST_WO_ID = '00000001-0000-4000-a000-000000000001'; // Custom Exhaust Fabrication
const PREDELIVERY_WO_ID = 'd18b1119-7468-4ebc-8d73-078df4d57e7b'; // Pre-Delivery WO
const K2500_VEHICLE_ID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

const KNOWN_PARTS = [
  // ─── Amazon Order 113-8547344-3052230 (Mar 26, 2026) — $98.02 ───────────
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'Universal Exhaust Hanger Rod SS 3/8" x 10" (4 PCS)',
    part_number: null,
    brand: 'Generic',
    quantity: 1,
    unit_price: 19.59,
    total_price: 19.59,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 113-8547344-3052230, Mar 26 2026. Heavy-duty SS exhaust pipe hanger rod.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'LOYORTY 8-Pack 2.5" 304 SS Exhaust Elbow 90° Mandrel Bend',
    part_number: null,
    brand: 'LOYORTY',
    quantity: 1,
    unit_price: 26.99,
    total_price: 26.99,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 113-8547344-3052230, Mar 26 2026. 16GA/.065" thickness.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: '2.5" 304 SS Tight Radius Pie Cuts 90° (5 PCS)',
    part_number: null,
    brand: 'Generic',
    quantity: 1,
    unit_price: 23.88,
    total_price: 23.88,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 113-8547344-3052230, Mar 26 2026. Laser cut & deburred.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'Cotonlake 2.5" 45° SS304 Bend Tube Exhaust Elbow (4 PCS)',
    part_number: null,
    brand: 'Cotonlake',
    quantity: 1,
    unit_price: 19.99,
    total_price: 19.99,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 113-8547344-3052230, Mar 26 2026.',
    status: 'received'
  },

  // ─── Amazon Order 111-0256389-1972269 (Mar 11, 2026) — $44.29 ──────────
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'SS TIG Welding Rods ER308L 1/16" x 16" (1 LB)',
    part_number: 'ER308L',
    brand: 'Generic',
    quantity: 1,
    unit_price: 16.99,
    total_price: 16.99,
    supplier: 'Amazon',
    category: 'consumable',
    notes: 'Amazon order 111-0256389-1972269, Mar 11 2026. For SS exhaust fabrication.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: '2.5" 304 SS Tight Radius Pie Cuts 90° (5 PCS)',
    part_number: null,
    brand: 'Generic',
    quantity: 1,
    unit_price: 23.88,
    total_price: 23.88,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-0256389-1972269, Mar 11 2026. Second set of pie cuts.',
    status: 'received'
  },

  // ─── Amazon Order 111-7614026-2636230 (Mar 11, 2026) — $232.10 ─────────
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'PALOZO SS Exhaust Flange Connection Kit 3-Bolt 2.5" (2 PCS)',
    part_number: null,
    brand: 'PALOZO',
    quantity: 1,
    unit_price: 21.99,
    total_price: 21.99,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-7614026-2636230, Mar 11 2026. With gaskets, bolts, nuts.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'Acrux7 2.5" 45° 304 SS Mandrel Bend Exhaust Elbow (4 Pack)',
    part_number: null,
    brand: 'Acrux7',
    quantity: 1,
    unit_price: 19.99,
    total_price: 19.99,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-7614026-2636230, Mar 11 2026. 1.5mm thickness.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'DNA MOTORING 2.5" SS DIY Exhaust Tubing Mandrel Bend Kit (8 PCS)',
    part_number: 'ZTL-25SS-8P',
    brand: 'DNA MOTORING',
    quantity: 1,
    unit_price: 90.23,
    total_price: 90.23,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-7614026-2636230, Mar 11 2026. Straight & U-bend kit.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: '2.5" 304 SS 90° Mandrel Bend Exhaust Elbow (4 Pack)',
    part_number: null,
    brand: 'Generic',
    quantity: 1,
    unit_price: 19.99,
    total_price: 19.99,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-7614026-2636230, Mar 11 2026. 16GA/.065" OD.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: '2.5" SS T304 Straight Pipe Tubing 48" Long (Pack of 2)',
    part_number: null,
    brand: 'Generic',
    quantity: 1,
    unit_price: 61.97,
    total_price: 61.97,
    supplier: 'Amazon',
    category: 'exhaust',
    notes: 'Amazon order 111-7614026-2636230, Mar 11 2026. Main straight piping sections.',
    status: 'received'
  },

  // ─── Summit Order #6765204 (Mar 1, 2026) — $122.44 ─────────────────────
  // SUM-RP22000 already in work_order_parts (from original WO creation)
  {
    work_order_id: PREDELIVERY_WO_ID,
    part_name: 'Raybestos Element3 Brake Master Cylinder',
    part_number: 'AGB-MC39308',
    brand: 'Raybestos',
    quantity: 1,
    unit_price: 66.99,
    total_price: 66.99,
    supplier: 'Summit Racing',
    category: 'brakes',
    notes: 'Summit order #6765204, Mar 1 2026. MC39308. For 73-87 K2500.',
    status: 'received'
  },

  // ─── Summit Order #6555575 (Mar 6, 2026) — $44.99 ──────────────────────
  {
    work_order_id: PREDELIVERY_WO_ID,
    part_name: 'Goodmark Air Dam',
    part_number: 'GMK-4145-035-812',
    brand: 'Goodmark',
    quantity: 1,
    unit_price: 44.99,
    total_price: 44.99,
    supplier: 'Summit Racing',
    category: 'body',
    notes: 'Summit order #6555575, Mar 6 2026. GMK4145035812.',
    status: 'received'
  },

  // ─── Summit Order #6242597 (Mar 17, 2026) — $617.48 ────────────────────
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'QTP Electric 2.5" Exhaust Cutout Kit (pair)',
    part_number: 'QTP-QTEC50CP',
    brand: 'Quick Time Performance',
    quantity: 1,
    unit_price: 554.58,
    total_price: 554.58,
    supplier: 'Summit Racing',
    category: 'exhaust',
    notes: 'Summit order #6242597, Mar 17 2026. Kit includes QTP-QTEC50 cutout + QTP-10250 Y-pipes x2.',
    status: 'received'
  },
  {
    work_order_id: EXHAUST_WO_ID,
    part_name: 'QTP Adjustable Turndown 2.5"',
    part_number: 'QTP-11250',
    brand: 'Quick Time Performance',
    quantity: 2,
    unit_price: 31.45,
    total_price: 62.90,
    supplier: 'Summit Racing',
    category: 'exhaust',
    notes: 'Summit order #6242597, Mar 17 2026. Adjustable angle exhaust tips.',
    status: 'received'
  },
];

// ─── Write parts to DB ────────────────────────────────────────────────────────
async function seedParts(supabase) {
  console.log('\n=== Receipt Mining — Seed Known Data ===\n');

  let written = 0;
  let skipped = 0;

  for (const part of KNOWN_PARTS) {
    // Check if already exists (by part_name + work_order_id + supplier)
    const { data: existing } = await supabase
      .from('work_order_parts')
      .select('id')
      .eq('work_order_id', part.work_order_id)
      .eq('part_name', part.part_name)
      .eq('supplier', part.supplier)
      .limit(1);

    if (existing?.length > 0) {
      console.log(`  [skip] ${part.part_name} — already exists`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${part.supplier.padEnd(15)} | $${part.total_price.toFixed(2).padStart(7)} | ${part.part_name.slice(0, 60)}`);
      written++;
      continue;
    }

    const { error } = await supabase
      .from('work_order_parts')
      .insert({
        work_order_id: part.work_order_id,
        part_name: part.part_name,
        part_number: part.part_number,
        brand: part.brand,
        quantity: part.quantity,
        unit_price: part.unit_price,
        total_price: part.total_price,
        supplier: part.supplier,
        category: part.category,
        notes: part.notes,
        status: part.status,
        ai_extracted: false,
        user_verified: false,
        is_comped: false,
        is_taxable: true
      });

    if (error) {
      console.error(`  [error] ${part.part_name}: ${error.message}`);
    } else {
      console.log(`  [ok] ${part.supplier.padEnd(15)} | $${part.total_price.toFixed(2).padStart(7)} | ${part.part_name.slice(0, 60)}`);
      written++;
    }
  }

  // Summary
  const amazonTotal = KNOWN_PARTS.filter(p => p.supplier === 'Amazon').reduce((s, p) => s + p.total_price, 0);
  const summitTotal = KNOWN_PARTS.filter(p => p.supplier === 'Summit Racing').reduce((s, p) => s + p.total_price, 0);

  console.log('\n── Summary ──');
  console.log(`  Parts written: ${written}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Amazon total:  $${amazonTotal.toFixed(2)} (${KNOWN_PARTS.filter(p => p.supplier === 'Amazon').length} items)`);
  console.log(`  Summit total:  $${summitTotal.toFixed(2)} (${KNOWN_PARTS.filter(p => p.supplier === 'Summit Racing').length} items)`);
  console.log(`  Grand total:   $${(amazonTotal + summitTotal).toFixed(2)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const supabase = createSupabase();

  if (SEED || !process.env.GOOGLE_REFRESH_TOKEN) {
    await seedParts(supabase);
    if (!SEED && !process.env.GOOGLE_REFRESH_TOKEN) {
      console.log('\nNote: Gmail OAuth not configured. Used --seed mode (known data only).');
      console.log('Run `dotenvx run -- node scripts/gmail-poller.mjs --setup` to enable live Gmail mining.');
    }
    return;
  }

  // TODO: Gmail API live polling mode
  // Uses gmail-poller.mjs OAuth pattern to search for new order emails
  // and parse them with vendor-specific templates (Amazon, Summit, eBay)
  console.log('Live Gmail mining not yet implemented. Use --seed for known data.');
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
