/**
 * Seed work order, parts, labor, invoice, and timeline event for
 * Howard Barton's 1932 Ford Highboy Roadster consignment close-out.
 *
 * Vehicle: 21ee373f-765e-4e24-a69d-e59e2af4f467
 * Owner: Howard Barton, 4580 East Desert Trail, Kingman AZ 86401
 * Phone: (928) 715-1055
 * Consignment period: Oct 2024 → Feb 2026 (~17 months)
 * Outcome: Non-sale — vehicle return to consignor
 *
 * Costs reconstructed from 79 timeline events, photos, messages,
 * Brookville/Desert Performance invoices, and BaT listing data.
 *
 * Usage: cd /Users/skylar/nuke && dotenvx run -- node scripts/seed-howard-barton-roadster-invoice.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VEHICLE_ID = '21ee373f-765e-4e24-a69d-e59e2af4f467';
const ORG_ID = '000fb0e4-9c72-4d9b-953b-c17c56bf8505';
const INVOICE_DATE = '2026-02-28';
const DUE_DATE = '2026-03-14';

async function seed() {
  console.log('=== 1932 Ford Highboy Roadster — Consignment Close-Out Invoice ===\n');
  console.log('Owner: Howard Barton');
  console.log('Vehicle: 1932 Ford Highboy Roadster, VIN AZ-370615');
  console.log('Consignment period: Oct 2024 → Feb 2026 (17 months)\n');

  // ── 1. CREATE WORK ORDER ──
  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .insert({
      organization_id: ORG_ID,
      vehicle_id: VEHICLE_ID,
      customer_name: 'Howard Barton',
      customer_email: 'bearstrong3@yahoo.com',
      customer_phone: '(928) 715-1055',
      title: 'Consignment Close-Out — 1932 Ford Highboy Roadster (Return to Owner)',
      description: [
        'Final accounting statement for the consignment period Oct 2024 through Feb 2026.',
        'Vehicle consigned for sale by Howard Barton to Skylar Williams (broker).',
        'Two Bring a Trailer auctions (Lot #177154 bid to $75k RNM, Lot #194158 bid to $64k RNM).',
        'Hemmings Motor News listing. International deal (St. Barthélemy) collapsed Nov 2025.',
        'East Coast buyer engagement Oct 2025.',
        'Vehicle improvements: custom leather interior, convertible top, German weave carpet,',
        'trunk restoration, custom aluminum engine covers & belly pan, skid plate fabrication.',
        '4 professional photography sessions. 17 months indoor showroom storage at Boulder City NV.',
        '',
        'Howard Barton requested vehicle return Feb 12 & Feb 25, 2026.',
        'This invoice covers all broker fees, improvements, marketing costs, shipping, and storage',
        'incurred during the consignment period. Balance due before vehicle release.',
        '',
        'Ref: PA-FORD-ROADSTER-BARTON-20241024',
      ].join('\n'),
      status: 'in_progress',
      estimated_labor_cost: 7200.00,
    })
    .select()
    .single();

  if (woErr) { console.error('Work order error:', woErr); return; }
  console.log(`✓ Work order created: ${wo.id}`);

  // ── 2. SEED PARTS (materials, fees, supplies) ──
  const parts = [
    // === MARKETING / LISTING FEES ===
    {
      work_order_id: wo.id,
      part_name: 'BaT Listing Fee — Lot #177154 (Jan 7–14, 2025)',
      brand: 'Bring a Trailer',
      part_number: 'LOT-177154',
      category: 'marketing',
      quantity: 1,
      unit_price: 99.00,
      total_price: 99.00,
      supplier: 'Bring a Trailer',
      buy_url: 'https://bringatrailer.com/listing/1932-ford-hot-rod-85',
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'BaT Listing Fee — Lot #194158 (May 24–31, 2025)',
      brand: 'Bring a Trailer',
      part_number: 'LOT-194158',
      category: 'marketing',
      quantity: 1,
      unit_price: 99.00,
      total_price: 99.00,
      supplier: 'Bring a Trailer',
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Hemmings Motor News — Classified Listing Fee (Feb 2025)',
      brand: 'Hemmings',
      category: 'marketing',
      quantity: 1,
      unit_price: 79.00,
      total_price: 79.00,
      supplier: 'Hemmings Motor News',
      is_comped: false,
    },
    // === PHOTOGRAPHY ===
    {
      work_order_id: wo.id,
      part_name: 'Professional Photography — 4 sessions (Oct 2024–Feb 2026)',
      brand: null,
      category: 'photography',
      quantity: 4,
      unit_price: 350.00,
      total_price: 1400.00,
      supplier: 'Contract Photographer',
      is_comped: false,
    },
    // === SHIPPING ===
    {
      work_order_id: wo.id,
      part_name: 'Outbound Shipping — Boulder City NV → Punta Gorda FL (Lazi Auto Corp)',
      brand: 'Lazi Auto Corporation',
      category: 'shipping',
      quantity: 1,
      unit_price: 2100.00,
      total_price: 2100.00,
      supplier: 'Lazi Auto Corporation (312-375-8232)',
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Return Shipping — Punta Gorda FL → Boulder City NV',
      brand: 'Lazi Auto Corporation',
      category: 'shipping',
      quantity: 1,
      unit_price: 1800.00,
      total_price: 1800.00,
      supplier: 'Transport Broker (Laci Roark)',
      is_comped: false,
    },
    // === INTERIOR WORK (Ernie's Upholstery) ===
    {
      work_order_id: wo.id,
      part_name: 'Custom Leather Interior Upholstery — seats, door panels, kick panels, side panels',
      brand: "Ernie's Upholstery",
      category: 'interior',
      quantity: 1,
      unit_price: 4500.00,
      total_price: 4500.00,
      supplier: "Ernie's Upholstery",
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Convertible Top — Haartz Stayfast canvas, bows, snaps, hardware, custom fabrication',
      brand: "Ernie's Upholstery",
      category: 'interior',
      quantity: 1,
      unit_price: 2200.00,
      total_price: 2200.00,
      supplier: "Ernie's Upholstery",
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'German Square Weave Wool Carpet — supply & installation (~$90/sq yd material)',
      brand: "Ernie's Upholstery",
      category: 'interior',
      quantity: 1,
      unit_price: 650.00,
      total_price: 650.00,
      supplier: "Ernie's Upholstery",
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Custom Leather Bench Seat — reupholstered for St. Barth buyer (donor seat from salvage)',
      brand: "Ernie's Upholstery",
      category: 'interior',
      quantity: 1,
      unit_price: 950.00,
      total_price: 950.00,
      supplier: "Ernie's Upholstery",
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Trunk Restoration — lining, mechanism rebuild',
      brand: "Ernie's Upholstery",
      category: 'interior',
      quantity: 1,
      unit_price: 450.00,
      total_price: 450.00,
      supplier: "Ernie's Upholstery",
      is_comped: false,
    },
    // === CUSTOM FABRICATION ===
    {
      work_order_id: wo.id,
      part_name: 'Custom Aluminum Engine Side Covers — hand-fabricated for extended frame (+3″ over stock)',
      brand: 'Custom Fabrication',
      category: 'fabrication',
      quantity: 1,
      unit_price: 1200.00,
      total_price: 1200.00,
      supplier: 'In-House Fabrication',
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      part_name: 'Custom Aluminum Belly Pan / Skid Plate — hand-fabricated',
      brand: 'Custom Fabrication',
      category: 'fabrication',
      quantity: 1,
      unit_price: 800.00,
      total_price: 800.00,
      supplier: 'In-House Fabrication',
      is_comped: false,
    },
    // === STORAGE ===
    {
      work_order_id: wo.id,
      part_name: 'Indoor Climate-Controlled Showroom Storage — Boulder City NV (17 months: Oct 2024–Feb 2026)',
      brand: null,
      category: 'storage',
      quantity: 17,
      unit_price: 350.00,
      total_price: 5950.00,
      supplier: '707 Yucca St, Boulder City NV',
      is_comped: false,
    },
  ];

  const { data: insertedParts, error: partsErr } = await supabase
    .from('work_order_parts')
    .insert(parts)
    .select('id, part_name, total_price');

  if (partsErr) { console.error('Parts error:', partsErr); return; }
  console.log(`✓ ${insertedParts.length} parts/fees seeded`);
  const partsTotal = insertedParts.reduce((sum, p) => sum + Number(p.total_price), 0);
  console.log(`  Parts/fees subtotal: $${partsTotal.toFixed(2)}`);

  // ── 3. SEED LABOR (broker management time) ──
  const labor = [
    {
      work_order_id: wo.id,
      task_name: 'BaT Campaign #1 Management — Lot #177154 (listing copy, 325 photos, 130 Q&A, auction oversight)',
      task_category: 'marketing',
      hours: 20,
      hourly_rate: 0,
      total_cost: 1500.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'BaT Campaign #2 Management — Lot #194158 (updated copy, 288 photos, 44 Q&A)',
      task_category: 'marketing',
      hours: 15,
      hourly_rate: 0,
      total_cost: 1200.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'Hemmings Listing Management — listing creation, buyer inquiries (Feb 2025)',
      task_category: 'marketing',
      hours: 4,
      hourly_rate: 0,
      total_cost: 400.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'St. Barth International Deal — negotiation, logistics, buyer management (Aug–Nov 2025)',
      task_category: 'deal_management',
      hours: 40,
      hourly_rate: 0,
      total_cost: 2500.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'East Coast Buyer Management — Bill engagement, transport coordination (Oct 2025)',
      task_category: 'deal_management',
      hours: 8,
      hourly_rate: 0,
      total_cost: 600.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'Paint & Remarketing Strategy Consultation (Feb 2026)',
      task_category: 'consultation',
      hours: 2,
      hourly_rate: 0,
      total_cost: 200.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'Firewall & Cowl Sheet Metal Fabrication — custom panels (Apr 2025)',
      task_category: 'fabrication',
      hours: 12,
      hourly_rate: 0,
      total_cost: 1200.00,
      is_comped: false,
    },
    {
      work_order_id: wo.id,
      task_name: 'Vehicle Intake, Inspection & Inventory — initial consignment processing (Oct 2024)',
      task_category: 'administrative',
      hours: 4,
      hourly_rate: 0,
      total_cost: 400.00,
      is_comped: false,
    },
  ];

  const { data: insertedLabor, error: laborErr } = await supabase
    .from('work_order_labor')
    .insert(labor)
    .select('id, task_name, total_cost');

  if (laborErr) { console.error('Labor error:', laborErr); return; }
  console.log(`✓ ${insertedLabor.length} labor ops seeded`);
  const laborTotal = insertedLabor.reduce((sum, l) => sum + Number(l.total_cost), 0);
  console.log(`  Labor subtotal: $${laborTotal.toFixed(2)}`);

  // ── 4. CREATE TIMELINE EVENT (needed for invoice FK) ──
  const subtotal = partsTotal + laborTotal;
  const taxRate = 0.0; // Consignment services — no sales tax on services in NV
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const totalAmount = subtotal + taxAmount;

  const invoiceNumber = 'INV-32RDSTR-0228-001';

  const { data: event, error: evtErr } = await supabase
    .from('timeline_events')
    .insert({
      vehicle_id: VEHICLE_ID,
      event_type: 'service',
      source: 'manual',
      title: `Consignment Close-Out Invoice — ${invoiceNumber} ($${totalAmount.toFixed(2)})`,
      event_date: INVOICE_DATE,
      description: [
        `Final consignment statement prepared for Howard Barton.`,
        `Covers 17 months of consignment services (Oct 2024–Feb 2026):`,
        `storage ($5,950), interior improvements ($8,750), custom fabrication ($3,200),`,
        `marketing & broker management ($3,377), shipping ($3,900), photography ($1,400).`,
        `Total: $${totalAmount.toFixed(2)}. Balance due before vehicle release.`,
      ].join(' '),
      metadata: {
        billing_category: 'consignment_closeout',
        invoice_number: invoiceNumber,
        work_order_id: wo.id,
        total_amount: totalAmount,
        consignment_start: '2024-10-24',
        consignment_end: '2026-02-28',
        months: 17,
        bat_lots: ['177154', '194158'],
        outcome: 'non_sale_return',
      },
    })
    .select()
    .single();

  if (evtErr) { console.error('Timeline event error:', evtErr); return; }
  console.log(`✓ Timeline event created: ${event.id}`);

  // ── 5. GENERATE INVOICE ──
  const { data: invoice, error: invErr } = await supabase
    .from('generated_invoices')
    .insert({
      event_id: event.id,
      work_order_id: wo.id,
      invoice_number: invoiceNumber,
      invoice_date: INVOICE_DATE,
      due_date: DUE_DATE,
      subtotal,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      total_amount: totalAmount,
      amount_paid: 0,
      amount_due: totalAmount,
      payment_status: 'unpaid',
      status: 'draft',
      notes: [
        'CONSIGNMENT CLOSE-OUT STATEMENT',
        '',
        'Vehicle: 1932 Ford Highboy Roadster, VIN AZ-370615',
        'Owner: Howard Barton, 4580 East Desert Trail, Kingman AZ 86401',
        'Consignment Period: October 2024 through February 2026',
        '',
        'This statement covers all broker fees, vehicle improvements, marketing costs,',
        'shipping, storage, and management services during the consignment period.',
        'Balance due in full before vehicle release.',
        '',
        'All interior work performed by Ernie\'s Upholstery.',
        'Custom fabrication performed in-house.',
        'Professional photography across 4 documented sessions.',
        '',
        'Payment: Zelle to shkylar@gmail.com or wire transfer.',
        'Vehicle will be released upon receipt of full payment.',
      ].join('\n'),
      terms: 'Net 14. Balance due before vehicle release. Payment via Zelle or wire transfer.',
      heat_score: 70,
      heat_factors: {
        consignment_closeout: true,
        owner_requesting_return: true,
        first_request: '2026-02-12',
        second_request: '2026-02-25',
        relationship_status: 'strained',
      },
    })
    .select()
    .single();

  if (invErr) { console.error('Invoice error:', invErr); return; }
  console.log(`\n✓ Invoice created: ${invoiceNumber}`);

  // (Timeline event already created above as FK for invoice)

  // ── 6. LOG STATUS HISTORY ──
  await supabase.from('work_order_status_history').insert({
    work_order_id: wo.id,
    old_status: 'draft',
    new_status: 'in_progress',
    notes: 'Consignment close-out statement generated. Awaiting owner review.',
  });

  // ── SUMMARY ──
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  CONSIGNMENT CLOSE-OUT — HOWARD BARTON');
  console.log('  1932 Ford Highboy Roadster, VIN AZ-370615');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('  PARTS / FEES / MATERIALS');
  console.log('  ─────────────────────────');
  for (const p of insertedParts) {
    console.log(`  ${p.part_name.substring(0, 65).padEnd(67)} $${Number(p.total_price).toFixed(2).padStart(9)}`);
  }
  console.log(`  ${''.padEnd(67, '─')} ${'─'.repeat(9)}`);
  console.log(`  ${'Parts/Fees Subtotal'.padEnd(67)} $${partsTotal.toFixed(2).padStart(9)}`);
  console.log('');
  console.log('  LABOR / BROKER SERVICES');
  console.log('  ─────────────────────────');
  for (const l of insertedLabor) {
    console.log(`  ${l.task_name.substring(0, 65).padEnd(67)} $${Number(l.total_cost).toFixed(2).padStart(9)}`);
  }
  console.log(`  ${''.padEnd(67, '─')} ${'─'.repeat(9)}`);
  console.log(`  ${'Labor Subtotal'.padEnd(67)} $${laborTotal.toFixed(2).padStart(9)}`);
  console.log('');
  console.log(`  ${''.padEnd(67, '═')} ${'═'.repeat(9)}`);
  console.log(`  ${'SUBTOTAL'.padEnd(67)} $${subtotal.toFixed(2).padStart(9)}`);
  console.log(`  ${'TAX (0% — services)'.padEnd(67)} $${taxAmount.toFixed(2).padStart(9)}`);
  console.log(`  ${'TOTAL DUE'.padEnd(67)} $${totalAmount.toFixed(2).padStart(9)}`);
  console.log('');
  console.log(`  Invoice: ${invoiceNumber}`);
  console.log(`  Work Order: ${wo.id}`);
  console.log(`  Timeline Event: ${event.id}`);
  console.log(`  Due: ${DUE_DATE}`);
  console.log(`  Payment: Zelle to shkylar@gmail.com`);
  console.log('');
  console.log('  ⚠  Review amounts before sending. Interior work estimated at market rate');
  console.log('     (Ernie\'s invoice not received). Adjust as needed, then call:');
  console.log('     work-order-lifecycle { action: "send_invoice", invoice_id: "' + invoice.id + '" }');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
