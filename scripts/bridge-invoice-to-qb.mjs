#!/usr/bin/env node
/**
 * Bridge Invoice → QB Transactions + Manifest Matcher
 *
 * Reads invoice_learned_pricing rows (Desert Performance #1190 + NUKE LTD invoices)
 * and creates qb_transactions records so they appear on the build timeline.
 * Also fuzzy-matches invoice items to vehicle_build_manifest devices.
 *
 * Usage:
 *   dotenvx run -- node scripts/bridge-invoice-to-qb.mjs              # dry run
 *   dotenvx run -- node scripts/bridge-invoice-to-qb.mjs --apply      # write to DB
 */

import { createClient } from "@supabase/supabase-js";

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const DRY_RUN = !process.argv.includes("--apply");

// ── Invoice item → Manifest device name mapping ──────────────────────────
// These are curated matches between Desert Performance invoice line items
// and vehicle_build_manifest device names

const INVOICE_TO_MANIFEST = {
  "M130 ECU with GPR firmware": { device: "ECU", confidence: 1.0 },
  "PDM 30": { device: "Power Distribution Module", confidence: 1.0 },
  "PCS2800 transmission ECU and generic harness": { device: "Transmission Controller", confidence: 0.95 },
  "LTCD dual LSU4.9 wideband interface": { device: "Wideband Lambda Controller", confidence: 1.0 },
  "RBD 190 remote battery disconnect": { device: "Battery Disconnect", confidence: 1.0 },
  "Kenwood radio with remote keypad D3758T": { device: "Radio/Head Unit", confidence: 0.85 },
  "Optima battery": { device: "Battery", confidence: 1.0 },
  "LSU 4.9 oxygen sensor": { device: "Wideband O2 Sensor 1", confidence: 0.95 },
  "GT101 hall effect speed sensor": { device: "Vehicle Speed Sensor", confidence: 1.0 },
  "LED under dash lights": { device: "Under-Dash LED Lights", confidence: 1.0 },
  "Door switches": { device: "Door Switch Left", confidence: 0.9 },
  "MSD billet cam sync": { device: "Cam Position Sensor", confidence: 0.8 },
  "Aeromotive A1000 pressure regulator": { device: "Fuel Pressure Sensor", confidence: 0.6 },
  "8 button keypad": { device: "Display/Dash", confidence: 0.7 },
  "LED headlight conversion kit": { device: "LED Headlight Left", confidence: 0.9 },
  "Polarity reversing relays": { device: "Amplifier Relay", confidence: 0.6 },
  // Denso D510 maps to all 8 ignition coils — price is per-coil, quantity handles it
  "Denso D510 ignition coil": { device: "Ignition Coil 1", confidence: 0.95, allCoils: true },
  "Pressure sensor (oil/fuel)": { device: "Oil Pressure Sensor (ECU)", confidence: 0.8 },
  "Temperature sensor (fuel/oil/inlet air)": { device: "Oil Temperature Sensor", confidence: 0.7 },
};

// NUKE LTD internal invoice matches
const NUKE_TO_MANIFEST = {
  "Complete wiring harness installation": null, // Labor
  "Build labor": null, // Labor
  "Wiring completion and programming": null, // Labor
  "Interior package": null, // Package — multiple devices
  "Wheels package": null, // Not in wiring manifest
  "Transmission peripherals package": null, // Package
  "Machined custom pieces": null, // Custom work
  "PowerStep running boards via Far From Stock P300": { device: "AMP Research Controller", confidence: 0.9 },
  "Engine peripherals package": null, // Package
  "Fuel and exhaust package": null, // Package
  "Power window conversion kit": { device: "Window Switch Master (Driver)", confidence: 0.85 },
};

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function main() {
  console.log("=".repeat(70));
  console.log("Bridge Invoice → QB Transactions + Manifest");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (use --apply to write)" : "APPLYING"}`);
  console.log("=".repeat(70));

  // 1. Load invoice items (vehicle_id is null on these — they were ingested before linking)
  const { data: invoiceItems, error: invErr } = await sb
    .from("invoice_learned_pricing")
    .select("*")
    .order("unit_price", { ascending: false });

  if (invErr) { console.error("Failed to load invoices:", invErr); process.exit(1); }
  console.log(`\nInvoice items loaded: ${invoiceItems.length}`);

  // 2. Load manifest
  const { data: manifest, error: manErr } = await sb
    .from("vehicle_build_manifest")
    .select("*")
    .eq("vehicle_id", VEHICLE_ID);

  if (manErr) { console.error("Failed to load manifest:", manErr); process.exit(1); }
  console.log(`Manifest devices loaded: ${manifest.length}`);

  // 3. Check existing QB transactions to avoid duplicates
  const { data: existingQB } = await sb
    .from("qb_transactions")
    .select("qb_id")
    .eq("vehicle_id", VEHICLE_ID)
    .like("qb_id", "invoice-%");

  const existingIds = new Set((existingQB || []).map(r => r.qb_id));
  console.log(`Existing invoice-bridged QB rows: ${existingIds.size}`);

  // 4. Process each invoice item
  const qbInserts = [];
  const manifestUpdates = [];
  let totalInvoiceValue = 0;

  for (const item of invoiceItems) {
    const lineTotal = (item.unit_price || 0) * (item.quantity || 1);
    totalInvoiceValue += lineTotal;
    const qbId = `invoice-${slugify(item.shop_name)}-${slugify(item.part_name)}`;

    // Skip if already bridged
    if (existingIds.has(qbId)) {
      console.log(`  SKIP (exists): ${item.part_name} — ${qbId}`);
      continue;
    }

    // Determine category from invoice context
    const isLabor = /labor|install|tuning|testing|programming|modify/i.test(item.part_name);
    const isPackage = /package/i.test(item.part_name);
    const category = isLabor ? "labor" : isPackage ? "package" : "parts";

    // Create QB transaction row
    qbInserts.push({
      qb_id: qbId,
      qb_type: "Invoice",
      date: item.invoice_date,
      vendor_name: item.shop_name,
      total_amount: lineTotal,
      line_description: `${item.brand || ""} ${item.part_name}`.trim(),
      line_amount: lineTotal,
      line_account_name: "Vehicle Parts & Materials",
      memo: `Bridged from ${item.source_invoice}`,
      doc_number: item.source_invoice,
      vehicle_id: VEHICLE_ID,
      confidence: item.confidence || 1.0,
      confidence_signals: {
        source: "invoice_bridge",
        invoice_id: item.id,
        original_invoice: item.source_invoice,
      },
      category,
    });

    // Try to match to manifest device
    const allMappings = { ...INVOICE_TO_MANIFEST, ...NUKE_TO_MANIFEST };
    const mapping = allMappings[item.part_name];

    if (mapping && mapping.device) {
      const device = manifest.find(d => d.device_name === mapping.device);
      if (device && !device.purchased) {
        manifestUpdates.push({
          id: device.id,
          device_name: device.device_name,
          invoice_part: item.part_name,
          price: item.unit_price,
          price_source: "invoice",
          invoice_ref: item.source_invoice,
          confidence: mapping.confidence,
        });

        // If this is the coil, mark all 8
        if (mapping.allCoils) {
          for (let c = 2; c <= 8; c++) {
            const coilDevice = manifest.find(d => d.device_name === `Ignition Coil ${c}`);
            if (coilDevice && !coilDevice.purchased) {
              manifestUpdates.push({
                id: coilDevice.id,
                device_name: coilDevice.device_name,
                invoice_part: item.part_name,
                price: item.unit_price / 8,
                price_source: "invoice",
                invoice_ref: item.source_invoice,
                confidence: mapping.confidence,
              });
            }
          }
        }
      } else if (device && device.purchased) {
        console.log(`  ALREADY PURCHASED: ${device.device_name} ← ${item.part_name}`);
      }
    }

    console.log(`  QB: ${qbId} — $${lineTotal} (${category})`);
  }

  // 5. Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Total invoice value: $${totalInvoiceValue.toLocaleString()}`);
  console.log(`  QB transactions to create: ${qbInserts.length}`);
  console.log(`  Manifest devices to update: ${manifestUpdates.length}`);

  if (manifestUpdates.length > 0) {
    console.log("\n  Manifest matches:");
    for (const m of manifestUpdates) {
      console.log(`    ${m.device_name} ← ${m.invoice_part} ($${m.price}) [${(m.confidence * 100).toFixed(0)}%]`);
    }
  }

  // 6. Apply
  if (DRY_RUN) {
    console.log("\nDRY RUN — use --apply to write changes.");
    return;
  }

  // Insert QB transactions in batches
  console.log(`\nInserting ${qbInserts.length} QB transactions...`);
  const BATCH = 50;
  let qbOk = 0, qbFail = 0;
  for (let i = 0; i < qbInserts.length; i += BATCH) {
    const batch = qbInserts.slice(i, i + BATCH);
    const { error } = await sb.from("qb_transactions").upsert(batch, { onConflict: "qb_id" });
    if (error) {
      console.error(`  Batch ${i}-${i + batch.length} failed:`, error.message);
      qbFail += batch.length;
    } else {
      qbOk += batch.length;
    }
  }
  console.log(`  QB: ${qbOk} inserted, ${qbFail} failed`);

  // Update manifest devices
  console.log(`\nUpdating ${manifestUpdates.length} manifest devices...`);
  let manOk = 0, manFail = 0;
  for (const m of manifestUpdates) {
    const { error } = await sb
      .from("vehicle_build_manifest")
      .update({
        purchased: true,
        price: m.price,
        price_source: m.price_source,
        invoice_ref: m.invoice_ref,
        status: "purchased",
      })
      .eq("id", m.id);

    if (error) {
      console.error(`  FAIL: ${m.device_name} — ${error.message}`);
      manFail++;
    } else {
      console.log(`  OK: ${m.device_name} → $${m.price}`);
      manOk++;
    }
  }
  console.log(`  Manifest: ${manOk} updated, ${manFail} failed`);

  // 7. Verify
  const { data: postManifest } = await sb
    .from("vehicle_build_manifest")
    .select("purchased")
    .eq("vehicle_id", VEHICLE_ID);

  const { data: postQB } = await sb
    .from("qb_transactions")
    .select("line_amount")
    .eq("vehicle_id", VEHICLE_ID);

  const purchasedCount = (postManifest || []).filter(d => d.purchased).length;
  const totalQBSpend = (postQB || []).reduce((s, r) => s + (parseFloat(r.line_amount) || 0), 0);

  console.log(`\n${"=".repeat(70)}`);
  console.log("POST-BRIDGE STATE");
  console.log(`  Manifest purchased: ${purchasedCount} / ${(postManifest || []).length}`);
  console.log(`  Total QB spend: $${totalQBSpend.toLocaleString()}`);
  console.log("=".repeat(70));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
