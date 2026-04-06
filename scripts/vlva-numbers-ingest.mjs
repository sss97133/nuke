#!/usr/bin/env node
// vlva-numbers-ingest.mjs
// Ingests SP2024 and INVENTORY 2024 financial data into deal_jackets
// Run: dotenvx run -- node scripts/vlva-numbers-ingest.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VLVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Vehicle ID Mappings (resolved from DB queries) ───────────────────────
// These were matched by VIN search across the vehicles table
const VEHICLE_IDS = {
  '1968_911':       '982e6686-8663-492a-92ad-c6fff8988a59',
  '1966_c10':       '655f224f-d8ae-4fc6-a3ec-4ab8db234fdf',
  '1972_k10_short': 'd7962908-9a01-4082-a85e-6bbe532550b2',
  '1972_k10_yellow':'9c659234-4f56-4e23-9c16-5c1b6494db2a',
  '1976_c30':       '3f1791fe-4fe2-4994-b6fe-b137ffa57370',
  '1983_240d':      '3ea44fa2-5c5f-487a-861d-44b9c034e332',
  '2008_bentley':   '6a0aa0bb-5fb2-45f3-bb8b-b914fcc713f9',
  '2003_s55':       'a094e9d6-bcc0-43aa-b3bd-161ad3dd95d9',
  '1932_highboy':   'f5884e03-50c1-471a-b218-ced433aa4204',
  '1988_jeep':      'f7a10a48-4cd8-4ff9-9166-702367d1c859',
  '1977_blazer':    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
  '1979_k15':       'e1b9c9ba-94e9-4a45-85c0-30bac65a40f8',
  '2001_yukon':     'a2f84444-b721-4b66-93e0-84700d94d046',
  // 1978 K20 Cheyenne Blue (VIN CKL248Z164631) — not in vehicles table
};

// ─── Deal Data from SP2024 and INVENTORY 2024 ────────────────────────────

const DEALS = [
  // ── SP2024 Confirmed Inventory Deals (7 vehicles, through 10/5/24) ──
  {
    key: '1968_911',
    stock_number: 'SP24-1968-911',
    deal_type: 'sale',
    initial_cost: 12500,
    reconditioning_total: 5000,
    sale_price_inc_doc: 26150,
    gross_profit: 8650,
    acquisition_date: '2023-09-24',
    sold_date: '2024-04-09',
    notes: 'SOURCE: SP2024. Channel: BaT. Capital: Skylar. ACL 5%: $1,308. Cap ROI: $1,298.',
  },
  {
    key: '1966_c10',
    stock_number: 'SP24-1966-C10',
    deal_type: 'sale',
    initial_cost: 40000,
    reconditioning_total: 10000,
    sale_price_inc_doc: 60000,
    gross_profit: 10000,
    acquisition_date: '2024-01-19',
    sold_date: '2024-05-03',
    notes: 'SOURCE: SP2024. Channel: Off-BaT. Capital: Skylar. Price UT batch (Laura capital). ACL 5%: $3,000. Cap ROI: $1,500.',
  },
  {
    key: '1972_k10_short',
    stock_number: 'SP24-1972-K10',
    deal_type: 'sale',
    initial_cost: 40000,
    reconditioning_total: 20000,
    sale_price_inc_doc: 78500,
    gross_profit: 18500,
    acquisition_date: '2024-01-19',
    sold_date: '2024-06-10',
    notes: 'SOURCE: SP2024. Channel: Off-BaT (sold for $78,500, BaT shows $66K). Capital: Skylar. Price UT batch. ACL 5%: $3,925. Cap ROI: $2,775.',
  },
  {
    key: '1972_k10_yellow',
    stock_number: 'SP24-1972-K10L',
    deal_type: 'sale',
    initial_cost: 20000,
    reconditioning_total: 1000,
    sale_price_inc_doc: 21500,
    gross_profit: 500,
    acquisition_date: '2024-01-19',
    sold_date: '2024-07-05',
    notes: 'SOURCE: SP2024. Channel: Off-BaT liquidation. Capital: Skylar. Price UT batch. ACL 5%: $1,075. Cap ROI: $75.',
  },
  {
    // 1978 K20 Cheyenne Blue — no vehicle_id in DB
    key: null,
    stock_number: 'SP24-1978-K20',
    deal_type: 'sale',
    initial_cost: 400,
    reconditioning_total: 1260,
    sale_price_inc_doc: 3000,
    gross_profit: 1340,
    acquisition_date: '2024-01-19',
    sold_date: '2024-07-24',
    notes: 'SOURCE: SP2024. Channel: Off-BaT. Capital: Skylar. Price UT batch (1978 K20 Cheyenne Blue, VIN CKL248Z164631). ACL 5%: $150. Cap ROI: $201. VEHICLE NOT IN DB.',
  },
  {
    key: '1976_c30',
    stock_number: 'SP24-1976-C30',
    deal_type: 'sale',
    initial_cost: 25000,
    reconditioning_total: 5000,
    sale_price_inc_doc: 63000,
    gross_profit: 33000,
    acquisition_date: '2024-01-19',
    sold_date: '2024-10-05',
    notes: 'SOURCE: SP2024. Channel: BaT. Capital: Skylar. Price UT batch. ACL 5%: $3,150. Cap ROI: $4,950. DB model says C10 but SP2024 says C20/C30 Silverado Crew.',
  },
  {
    key: '1983_240d',
    stock_number: 'SP24-1983-240D',
    deal_type: 'sale',
    initial_cost: 25000,
    reconditioning_total: 3000,
    sale_price_inc_doc: 32000,
    gross_profit: 4000,
    acquisition_date: '2024-06-20',
    sold_date: '2024-10-05',
    notes: 'SOURCE: SP2024. Channel: BaT. Capital: Doug.',
  },

  // ── SP2024 Consignment Deals (3 vehicles, 8% fee) ──
  {
    key: '2008_bentley',
    stock_number: 'SP24-2008-BENTLEY',
    deal_type: 'consignment',
    initial_cost: null,
    reconditioning_total: 600,
    sale_price_inc_doc: 42000,
    gross_profit: null,
    consignment_rate: 0.08,
    acquisition_date: '2023-10-10',
    sold_date: '2023-12-12',
    notes: 'SOURCE: SP2024. Consignment 8% fee = $3,760. Finder: Doug. Up-front: $1,000. BaT shows $26,500 — discrepancy with SP2024 $42,000.',
  },
  {
    key: '2003_s55',
    stock_number: 'SP24-2003-S55',
    deal_type: 'consignment',
    initial_cost: null,
    reconditioning_total: 3000,
    sale_price_inc_doc: 20825,
    gross_profit: null,
    consignment_rate: 0.08,
    acquisition_date: '2024-04-15',
    sold_date: '2024-08-20',
    notes: 'SOURCE: SP2024. Consignment 8% fee = $2,266. Finder: Doug. Up-front: $3,600.',
  },
  {
    key: '1932_highboy',
    stock_number: 'SP24-1932-HIGHBOY',
    deal_type: 'consignment',
    initial_cost: null,
    reconditioning_total: 800,
    sale_price_inc_doc: 36250,
    gross_profit: null,
    consignment_rate: 0.08,
    acquisition_date: '2024-07-11',
    sold_date: '2024-08-31',
    notes: 'SOURCE: SP2024. Consignment 8% fee = $2,700. Finder: Doug. Up-front: $600.',
  },

  // ── INVENTORY 2024 Additional Deals ──
  {
    key: '1988_jeep',
    stock_number: 'INV24-1988-JEEP',
    deal_type: 'sale',
    initial_cost: 6000,
    reconditioning_total: 1550,
    sale_price_inc_doc: 11000,
    gross_profit: 3000,
    acquisition_date: '2024-01-15',
    sold_date: '2024-04-15',
    notes: 'SOURCE: INVENTORY 2024. Capital: Don ($6,000). BaT sale.',
  },
  {
    key: '1977_blazer',
    stock_number: 'INV24-1977-BLAZER',
    deal_type: 'sale',
    initial_cost: 11479,
    reconditioning_total: 50650,
    sale_price_inc_doc: null, // projected $80K, not yet sold at time of spreadsheet
    gross_profit: null,
    acquisition_date: '2023-10-01',
    sold_date: null,
    notes: 'SOURCE: INVENTORY 2024. Capital: Laura (loaned $50,650 for build). Purchase $11,479. Projected sale $80K, projected profit $12,760. UNSOLD as of spreadsheet date.',
  },
  {
    key: '1979_k15',
    stock_number: 'INV24-1979-K15',
    deal_type: 'sale',
    initial_cost: 12300,
    reconditioning_total: 10405,
    sale_price_inc_doc: 31000,
    gross_profit: 6595,
    acquisition_date: '2024-03-01',
    sold_date: '2026-02-13',
    notes: 'SOURCE: INVENTORY 2024. Capital: Danny ($12,300). Expenses: $5,881 (Skylar) + $4,524 (Doug). BaT sale $30K (DB) vs $31K (INVENTORY 2024).',
  },
  {
    key: '2001_yukon',
    stock_number: 'INV24-2001-YUKON',
    deal_type: 'sale',
    initial_cost: 4500,
    reconditioning_total: 8519,
    sale_price_inc_doc: 22000,
    gross_profit: 7881,
    acquisition_date: '2024-06-01',
    sold_date: '2024-12-17',
    notes: 'SOURCE: INVENTORY 2024. Capital: 4-way split. BaT shows $18,750 — discrepancy with INVENTORY 2024 $22,000. FLAGGED: buyer = VivaLasVegasAutos (self-purchase).',
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('VLVA Numbers Ingest');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Organization: ${VLVA_ORG_ID}`);
  console.log(`Deals to process: ${DEALS.length}`);
  console.log();

  // Check existing deal_jackets for VLVA
  const { data: existing, error: existErr } = await supabase
    .from('deal_jackets')
    .select('id, stock_number, vehicle_id, sale_price_inc_doc')
    .eq('organization_id', VLVA_ORG_ID);

  if (existErr) {
    console.error('Error fetching existing deals:', existErr.message);
    process.exit(1);
  }

  console.log(`Existing VLVA deal_jackets: ${existing.length}`);
  existing.forEach(d => console.log(`  ${d.stock_number || '(no stock#)'} — $${d.sale_price_inc_doc}`));
  console.log();

  const existingStockNumbers = new Set(existing.map(d => d.stock_number));
  const existingVehicleIds = new Set(existing.map(d => d.vehicle_id).filter(Boolean));

  let created = 0;
  let skipped = 0;
  let noVehicle = 0;

  for (const deal of DEALS) {
    const vehicleId = deal.key ? VEHICLE_IDS[deal.key] : null;
    const label = deal.stock_number;

    // Skip if stock number already exists
    if (existingStockNumbers.has(deal.stock_number)) {
      console.log(`SKIP ${label} — stock number already exists`);
      skipped++;
      continue;
    }

    // Skip if vehicle already has a deal jacket
    if (vehicleId && existingVehicleIds.has(vehicleId)) {
      console.log(`SKIP ${label} — vehicle ${vehicleId} already has a deal jacket`);
      skipped++;
      continue;
    }

    if (!vehicleId) {
      console.log(`WARN ${label} — no vehicle_id (will create without link)`);
      noVehicle++;
    }

    const record = {
      vehicle_id: vehicleId || null,
      organization_id: VLVA_ORG_ID,
      stock_number: deal.stock_number,
      deal_type: deal.deal_type,
      initial_cost: deal.initial_cost,
      reconditioning_total: deal.reconditioning_total,
      sale_price_inc_doc: deal.sale_price_inc_doc,
      total_selling_price: deal.sale_price_inc_doc,
      gross_profit: deal.gross_profit,
      acquisition_date: deal.acquisition_date,
      sold_date: deal.sold_date,
      consignment_rate: deal.consignment_rate || null,
      notes: deal.notes,
      visibility: 'principals',
    };

    // Compute total_cost for inventory deals
    if (deal.deal_type === 'sale' && deal.initial_cost != null) {
      record.total_initial_cost = deal.initial_cost;
      record.total_cost = deal.initial_cost + (deal.reconditioning_total || 0);
    }

    if (DRY_RUN) {
      console.log(`WOULD CREATE ${label}:`, JSON.stringify(record, null, 2));
    } else {
      const { data, error } = await supabase
        .from('deal_jackets')
        .insert(record)
        .select('id, stock_number')
        .single();

      if (error) {
        console.error(`ERROR ${label}:`, error.message);
        continue;
      }

      console.log(`CREATED ${label} — id: ${data.id}`);

      // Create reconditioning entry for the total expenses
      if (deal.reconditioning_total && deal.reconditioning_total > 0) {
        const { error: reconErr } = await supabase
          .from('deal_reconditioning')
          .insert({
            deal_id: data.id,
            vendor_name: 'Various',
            description: `Total reconditioning/expenses per ${deal.notes.includes('SP2024') ? 'SP2024' : 'INVENTORY 2024'}`,
            amount: deal.reconditioning_total,
          });

        if (reconErr) {
          console.error(`  RECON ERROR ${label}:`, reconErr.message);
        } else {
          console.log(`  + reconditioning: $${deal.reconditioning_total}`);
        }
      }

      created++;
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`Results: ${created} created, ${skipped} skipped, ${noVehicle} without vehicle link`);

  // Verify final count
  if (!DRY_RUN) {
    const { count } = await supabase
      .from('deal_jackets')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', VLVA_ORG_ID);
    console.log(`Total VLVA deal_jackets now: ${count}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
