#!/usr/bin/env tsx
/**
 * Receipt line-item OCR sweep.
 *
 * Calls the deployed `receipt-extract` edge function for receipts that have
 * file_url but no rows in `receipt_items`, then writes the parsed line items
 * to `receipt_items` with the canonical schema (description / part_number /
 * vendor_sku / category / quantity / unit_price / total_price / line_number).
 *
 * Usage:
 *   npm run ocr:receipts -- --vehicle-id=<uuid>     # one vehicle (recommended)
 *   npm run ocr:receipts -- --vehicle-vin=<vin>
 *   npm run ocr:receipts -- --vehicle-scoped       # all receipts attached to any vehicle
 *   npm run ocr:receipts -- --all                  # every unprocessed receipt with a file_url
 *   npm run ocr:receipts -- --vehicle-vin=CKR187F127263 --limit=10 --dry-run
 *
 * Knobs:
 *   --concurrency=N   parallel OCR calls (default 3 — Textract/Azure rate-limit-friendly)
 *   --limit=N         stop after N receipts (handy for cost-bounded test runs)
 *   --dry-run         fetch/parse but skip the receipt_items insert
 *   --resume-after=N  skip the first N candidates (cheap retries after partial runs)
 */

import { createClient } from "@supabase/supabase-js";

type Args = {
  vehicleId?: string;
  vehicleVin?: string;
  vehicleScoped?: boolean;
  all?: boolean;
  concurrency: number;
  limit: number;
  dryRun: boolean;
  resumeAfter: number;
};

const ALLOWED_CATEGORIES = new Set([
  "audio","brakes","consumables","cooling","electrical","engine","exhaust","exterior",
  "fee","fuel_system","hardware","hvac","interior","labor","lighting","maintenance",
  "paint","safety","shipping","storage","suspension","tax","tools","transmission",
]);

function parseArgs(argv: string[]): Args {
  const out: Args = {
    concurrency: 3,
    limit: Infinity,
    dryRun: false,
    resumeAfter: 0,
  };
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.startsWith("--") ? raw.slice(2).split("=", 2) : [raw, ""];
    switch (k) {
      case "vehicle-id": out.vehicleId = v; break;
      case "vehicle-vin": out.vehicleVin = v; break;
      case "vehicle-scoped": out.vehicleScoped = true; break;
      case "all": out.all = true; break;
      case "concurrency": out.concurrency = Number(v) || 3; break;
      case "limit": out.limit = Number(v) || Infinity; break;
      case "dry-run": out.dryRun = true; break;
      case "resume-after": out.resumeAfter = Number(v) || 0; break;
      default:
        throw new Error(`Unknown flag: --${k}`);
    }
  }
  if (!out.vehicleId && !out.vehicleVin && !out.vehicleScoped && !out.all) {
    throw new Error("Specify one of: --vehicle-id, --vehicle-vin, --vehicle-scoped, --all");
  }
  return out;
}

function inferCategory(desc: string, raw?: string | null): string | null {
  const r = (raw || "").toLowerCase().trim();
  if (r && ALLOWED_CATEGORIES.has(r)) return r;
  const d = (desc || "").toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/oil|filter|fluid|grease|lube/, "maintenance"],
    [/brake|pad|rotor|caliper|master cyl/, "brakes"],
    [/shock|spring|sway|control arm|bushing|bilstein/, "suspension"],
    [/exhaust|muffler|header|tip|cutout|tubing|borla/, "exhaust"],
    [/wire|harness|relay|fuse|alternator|battery|switch|connector/, "electrical"],
    [/engine|piston|ring|cam|valve|head|gasket|carb/, "engine"],
    [/trans(mission)?|clutch|driveshaft|seal/, "transmission"],
    [/radiator|coolant|thermostat|water pump/, "cooling"],
    [/hvac|heater|a\/?c|climate/, "hvac"],
    [/light|bulb|led|halogen|lens/, "lighting"],
    [/audio|speaker|stereo|head unit/, "audio"],
    [/paint|primer|clear coat|touch.?up/, "paint"],
    [/labor|hours|hr\b|hourly/, "labor"],
    [/tool|wrench|socket|tig/, "tools"],
    [/bolt|nut|washer|screw|hardware|fastener|clamp/, "hardware"],
    [/shipping|freight|delivery/, "shipping"],
    [/tax\b/, "tax"],
    [/fee\b|surcharge/, "fee"],
  ];
  for (const [rx, cat] of rules) if (rx.test(d)) return cat;
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via dotenvx)");
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  let resolvedVehicleId = args.vehicleId;
  if (!resolvedVehicleId && args.vehicleVin) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin")
      .eq("vin", args.vehicleVin)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`No vehicle found for VIN ${args.vehicleVin}`);
    resolvedVehicleId = data.id;
    console.log(`Resolved VIN ${args.vehicleVin} → ${data.year} ${data.make} ${data.model} (${data.id})`);
  }

  let q = supabase
    .from("receipts")
    .select("id, file_url, file_type, vehicle_id, scope_type, scope_id, vendor_name, total_amount")
    .not("file_url", "is", null)
    .ilike("file_url", "http%");

  if (resolvedVehicleId) {
    q = q.eq("vehicle_id", resolvedVehicleId);
  } else if (args.vehicleScoped) {
    q = q.not("vehicle_id", "is", null);
  }

  q = q.order("created_at", { ascending: true });

  const { data: candidates, error: qErr } = await q;
  if (qErr) throw qErr;
  if (!candidates || candidates.length === 0) {
    console.log("No candidate receipts.");
    return;
  }

  // Filter out receipts that already have line items.
  const ids = candidates.map((r) => r.id);
  const { data: alreadyHas, error: ihErr } = await supabase
    .from("receipt_items")
    .select("receipt_id")
    .in("receipt_id", ids);
  if (ihErr) throw ihErr;
  const haveItems = new Set((alreadyHas || []).map((r) => r.receipt_id));
  let work = candidates.filter((r) => !haveItems.has(r.id));
  if (args.resumeAfter > 0) work = work.slice(args.resumeAfter);
  if (work.length > args.limit) work = work.slice(0, args.limit);

  console.log(
    `Candidates: ${candidates.length} total, ${haveItems.size} already have items, ${work.length} to process.`,
  );
  if (args.dryRun) console.log("DRY RUN — will skip the receipt_items insert.");

  const extractFnUrl = `${url.replace(/\/$/, "")}/functions/v1/receipt-extract`;

  let processed = 0, succeeded = 0, failed = 0, totalItems = 0;

  async function processOne(rec: any): Promise<void> {
    processed += 1;
    const tag = `[${processed}/${work.length}] ${rec.id.slice(0, 8)}`;
    try {
      const resp = await fetch(extractFnUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: rec.file_url, mimeType: rec.file_type || undefined }),
      });
      const text = await resp.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!resp.ok || !parsed || parsed.error) {
        failed += 1;
        console.log(`${tag} FAIL: status=${resp.status} ${parsed?.error || text.slice(0, 200)}`);
        return;
      }
      const items: any[] = Array.isArray(parsed.items) ? parsed.items : [];
      if (items.length === 0) {
        succeeded += 1;
        console.log(`${tag} ok (0 items extracted; vendor=${parsed.vendor_name || rec.vendor_name || "?"})`);
        return;
      }

      const rows = items.map((it: any, idx: number) => {
        const desc = (it.description || "").trim() || (it.part_number ? `Item ${it.part_number}` : "Line item");
        const qty = typeof it.quantity === "number" ? it.quantity : null;
        const unit = typeof it.unit_price === "number" ? it.unit_price : null;
        const explicitTotal = typeof it.total_price === "number" ? it.total_price : null;
        const computedTotal = qty !== null && unit !== null ? qty * unit : null;
        const total_price = explicitTotal ?? computedTotal ?? null;
        return {
          receipt_id: rec.id,
          line_number: typeof it.line_number === "number" ? it.line_number : idx + 1,
          description: desc,
          part_number: it.part_number || null,
          vendor_sku: it.vendor_sku || null,
          category: inferCategory(desc, it.category),
          quantity: qty,
          unit_price: unit,
          total_price,
        };
      });

      if (!args.dryRun) {
        const { error: insErr } = await supabase.from("receipt_items").insert(rows);
        if (insErr) {
          failed += 1;
          console.log(`${tag} INSERT_FAIL: ${insErr.message}`);
          return;
        }
        const updates: Record<string, any> = {
          processed_at: new Date().toISOString(),
          status: "extracted",
          processing_status: "completed",
        };
        if (parsed.vendor_name && !rec.vendor_name) updates.vendor_name = parsed.vendor_name;
        if (typeof parsed.total === "number") updates.total = parsed.total;
        if (typeof parsed.subtotal === "number") updates.subtotal = parsed.subtotal;
        if (typeof parsed.tax === "number") updates.tax = parsed.tax;
        if (parsed.receipt_date) updates.receipt_date = parsed.receipt_date;
        if (parsed.raw_json) updates.raw_json = parsed.raw_json;
        const { error: updErr } = await supabase.from("receipts").update(updates).eq("id", rec.id);
        if (updErr) console.log(`${tag} (items inserted but receipt update failed: ${updErr.message})`);
      }
      succeeded += 1;
      totalItems += rows.length;
      console.log(`${tag} ok (${rows.length} items; vendor=${parsed.vendor_name || rec.vendor_name || "?"})`);
    } catch (e: any) {
      failed += 1;
      console.log(`${tag} EXC: ${e?.message || e}`);
    }
  }

  // Simple bounded-parallel worker pool.
  const queue = [...work];
  const workers = Array.from({ length: Math.max(1, args.concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      await processOne(next);
    }
  });
  await Promise.all(workers);

  console.log("\n=== summary ===");
  console.log(`processed: ${processed}`);
  console.log(`succeeded: ${succeeded}`);
  console.log(`failed:    ${failed}`);
  console.log(`new line items inserted: ${totalItems}${args.dryRun ? " (dry run — not actually inserted)" : ""}`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
