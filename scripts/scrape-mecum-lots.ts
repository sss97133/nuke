#!/usr/bin/env npx tsx
/**
 * SCRAPE MECUM LOT PAGES FOR REAL DATA
 *
 * Fetches individual Mecum lot pages and extracts rich data from __NEXT_DATA__:
 * - hammerPrice (sale price)
 * - vinSerial (VIN)
 * - color, interior, transmission, engine (lotSeries)
 * - images, auction event, lot number, sale result
 *
 * Processes pending import_queue records with mecum URLs.
 * Runs continuously with nohup for overnight operation.
 *
 * Usage:
 *   npx tsx scripts/scrape-mecum-lots.ts              # Process pending
 *   npx tsx scripts/scrape-mecum-lots.ts --batch 50   # Batch size
 *   npx tsx scripts/scrape-mecum-lots.ts --loop        # Run continuously
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const batchSize = args.includes("--batch") ? parseInt(args[args.indexOf("--batch") + 1]) : 30;
const loop = args.includes("--loop");

interface MecumLotData {
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  hammerPrice: number | null;
  vin: string | null;
  color: string | null;
  interior: string | null;
  transmission: string | null;
  engine: string | null;
  lotNumber: string | null;
  auctionEvent: string | null;
  saleResult: string | null;
  mileage: number | null;
  images: string[];
}

function parseMecumPage(html: string): MecumLotData | null {
  // Extract __NEXT_DATA__
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    const post = data?.props?.pageProps?.post;
    if (!post) return null;

    // Extract make from taxonomy
    let make = post.makes;
    if (typeof make === "string") {
      try { make = JSON.parse(make.replace(/'/g, '"')); } catch { make = null; }
    }
    const makeName = make?.edges?.[0]?.node?.name || null;

    // Extract model
    let model = post.models;
    if (typeof model === "string") {
      try { model = JSON.parse(model.replace(/'/g, '"')); } catch { model = null; }
    }
    const modelName = model?.edges?.[0]?.node?.name || null;

    // Extract year
    let lotYear = post.lotYears;
    if (typeof lotYear === "string") {
      try { lotYear = JSON.parse(lotYear.replace(/'/g, '"')); } catch { lotYear = null; }
    }
    const year = lotYear?.edges?.[0]?.node?.name ? parseInt(lotYear.edges[0].node.name) : null;

    // Extract sale result
    let saleRes = post.saleResults;
    if (typeof saleRes === "string") {
      try { saleRes = JSON.parse(saleRes.replace(/'/g, '"')); } catch { saleRes = null; }
    }
    const saleResult = saleRes?.edges?.[0]?.node?.name || null;

    // Extract auction event
    let auctionTax = post.auctionsTax;
    if (typeof auctionTax === "string") {
      try { auctionTax = JSON.parse(auctionTax.replace(/'/g, '"')); } catch { auctionTax = null; }
    }
    const auctionEvent = auctionTax?.edges?.[0]?.node?.name || null;

    // Extract images
    let imageList: string[] = [];
    let images = post.images;
    if (typeof images === "string") {
      try { images = JSON.parse(images.replace(/'/g, '"').replace(/None/g, "null").replace(/True/g, "true").replace(/False/g, "false")); } catch { images = []; }
    }
    if (Array.isArray(images)) {
      imageList = images.map((img: any) => img?.url).filter(Boolean).slice(0, 20);
    }

    const hammerPrice = post.hammerPrice ? parseInt(post.hammerPrice) : null;
    // Odometer can be string or number; normalize to integer for DB
    const rawOdo = post.odometer;
    const mileage =
      rawOdo != null && rawOdo !== ""
        ? typeof rawOdo === "number"
          ? (isNaN(rawOdo) ? null : Math.round(rawOdo))
          : parseInt(String(rawOdo).replace(/,/g, ""), 10)
        : null;
    const mileageNum = mileage != null && !isNaN(mileage) ? mileage : null;

    return {
      title: post.title || "",
      year,
      make: makeName,
      model: modelName,
      hammerPrice: hammerPrice && hammerPrice > 0 ? hammerPrice : null,
      vin: post.vinSerial || null,
      color: post.color || null,
      interior: post.interior || null,
      transmission: post.transmission || null,
      engine: post.lotSeries || null,
      lotNumber: post.lotNumber || null,
      auctionEvent,
      saleResult,
      mileage: mileageNum,
      images: imageList,
    };
  } catch (e) {
    return null;
  }
}

async function processBatch(): Promise<{ processed: number; errors: number }> {
  // Get pending Mecum URLs
  const { data: items, error } = await supabase
    .from("import_queue")
    .select("id, listing_url")
    .eq("status", "pending")
    .ilike("listing_url", "%mecum%")
    .order("priority", { ascending: false })
    .limit(batchSize);

  if (error || !items || items.length === 0) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      // Fetch the lot page
      const res = await fetch(item.listing_url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        await supabase.from("import_queue").update({
          status: "failed",
          error_message: `HTTP ${res.status}`,
          attempts: 1,
        }).eq("id", item.id);
        errors++;
        continue;
      }

      const html = await res.text();
      const lot = parseMecumPage(html);

      if (!lot) {
        await supabase.from("import_queue").update({
          status: "failed",
          error_message: "No __NEXT_DATA__ found",
          attempts: 1,
        }).eq("id", item.id);
        errors++;
        continue;
      }

      const notesStr = [
        lot.title,
        lot.saleResult ? `Result: ${lot.saleResult}` : null,
        lot.auctionEvent ? `Event: ${lot.auctionEvent}` : null,
        lot.lotNumber ? `Lot: ${lot.lotNumber}` : null,
        lot.engine ? `Engine: ${lot.engine}` : null,
        lot.interior ? `Interior: ${lot.interior}` : null,
        lot.mileage != null ? `Miles: ${lot.mileage}` : null,
      ].filter(Boolean).join(" | ");

      const payload = {
        year: lot.year,
        make: lot.make,
        model: lot.model,
        vin: lot.vin || undefined,
        sale_price: lot.hammerPrice,
        color: lot.color || undefined,
        transmission: lot.transmission || undefined,
        mileage: lot.mileage != null ? lot.mileage : undefined,
        engine_size: lot.engine || undefined,
        source: "mecum",
        notes: notesStr,
      };

      // Check if vehicle already exists by listing_url
      const { data: existing } = await supabase
        .from("vehicles")
        .select("id")
        .eq("listing_url", item.listing_url)
        .limit(1)
        .maybeSingle();

      let vehicleId: string | null = null;

      if (existing) {
        await supabase.from("vehicles").update({ ...payload }).eq("id", existing.id);
        vehicleId = existing.id;
      } else {
        const { data: vehicle, error: vErr } = await supabase
          .from("vehicles")
          .insert({ ...payload, listing_url: item.listing_url })
          .select("id")
          .single();
        vehicleId = vehicle?.id || null;
      }

      // Mark complete
      await supabase.from("import_queue").update({
        status: "complete",
        vehicle_id: vehicleId,
        processed_at: new Date().toISOString(),
      }).eq("id", item.id);

      processed++;
    } catch (e: any) {
      await supabase.from("import_queue").update({
        status: "failed",
        error_message: e.message?.slice(0, 200),
        attempts: 1,
      }).eq("id", item.id);
      errors++;
    }

    // Small delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  return { processed, errors };
}

async function main() {
  console.log("🏁 Mecum Lot Scraper (real data extraction)");
  console.log(`   Batch: ${batchSize} | Loop: ${loop}\n`);

  let totalProcessed = 0;
  let totalErrors = 0;
  let iteration = 0;

  do {
    iteration++;
    const start = Date.now();
    const { processed, errors } = await processBatch();

    if (processed === 0 && errors === 0) {
      if (loop) {
        console.log(`  [${iteration}] Queue empty. Waiting 60s...`);
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }
      break;
    }

    totalProcessed += processed;
    totalErrors += errors;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [${iteration}] ${processed} scraped, ${errors} errors (${elapsed}s) | Total: ${totalProcessed}`);
  } while (loop);

  console.log(`\n📊 Done: ${totalProcessed} lots scraped, ${totalErrors} errors\n`);
}

main().catch(console.error);
