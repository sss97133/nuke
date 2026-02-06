#!/usr/bin/env npx tsx
/**
 * INGEST MECUM LOTS FROM SITEMAP
 *
 * Downloads all 43 Mecum lot sitemaps, extracts lot URLs,
 * parses year/make/model from the URL slug, and queues everything
 * into import_queue.
 *
 * ~43,000 lots total. Filters out motorcycles and non-vehicle lots.
 *
 * Usage:
 *   npx tsx scripts/ingest-mecum-sitemap.ts           # All sitemaps
 *   npx tsx scripts/ingest-mecum-sitemap.ts --start 1 --end 10  # Sitemaps 1-10
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TOTAL_SITEMAPS = 43;
const args = process.argv.slice(2);
const startIdx = args.includes("--start") ? parseInt(args[args.indexOf("--start") + 1]) : 1;
const endIdx = args.includes("--end") ? parseInt(args[args.indexOf("--end") + 1]) : TOTAL_SITEMAPS;

// Motorcycle/non-car keywords to filter out
const SKIP_KEYWORDS = [
  "kawasaki", "harley", "honda-motorcycle", "yamaha-motorcycle", "suzuki-motorcycle",
  "ducati", "triumph-motorcycle", "indian-motorcycle", "bmw-motorcycle",
  "road-art", "memorabilia", "sign", "neon", "pedal-car", "go-kart",
  "boat", "jet-ski", "snowmobile", "atv", "tractor",
];

function parseVehicleFromSlug(url: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
} {
  // URL pattern: /lots/LOTID/YEAR-MAKE-MODEL-DESCRIPTION/
  const match = url.match(/\/lots\/\d+\/(\d{4})-(.+?)\/?$/);
  if (!match) return { year: null, make: null, model: null, title: null };

  const year = parseInt(match[1]);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null, title: null };

  const slug = match[2];
  const parts = slug.split("-");

  // First word is usually make
  const make = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : null;
  // Rest is model + description
  const model = parts.slice(1, 4).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  const title = `${year} ${make} ${model}`;

  return { year, make, model: model || null, title };
}

function isVehicle(url: string): boolean {
  const lower = url.toLowerCase();
  return !SKIP_KEYWORDS.some((kw) => lower.includes(kw));
}

async function main() {
  console.log(`🏁 Mecum Sitemap Ingestion`);
  console.log(`   Sitemaps: ${startIdx} to ${endIdx} of ${TOTAL_SITEMAPS}\n`);

  let totalLots = 0;
  let totalQueued = 0;
  let totalSkipped = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    process.stdout.write(`  Sitemap ${i}/${TOTAL_SITEMAPS}... `);

    try {
      const response = await fetch(
        `https://www.mecum.com/sitemaps/lot-sitemap${i}.xml`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)" },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();

      // Extract all lot URLs
      const urlRegex = /<loc>(https:\/\/www\.mecum\.com\/lots\/[^<]+)<\/loc>/g;
      const urls: string[] = [];
      let match;
      while ((match = urlRegex.exec(xml)) !== null) {
        urls.push(match[1]);
      }

      // Filter to vehicles only (no motorcycles, memorabilia, etc.)
      const vehicleUrls = urls.filter(isVehicle);
      const skipped = urls.length - vehicleUrls.length;
      totalSkipped += skipped;

      // Build import queue rows
      const rows = vehicleUrls.map((url) => {
        const parsed = parseVehicleFromSlug(url);
        return {
          listing_url: url.replace(/\/$/, ""), // Remove trailing slash
          listing_title: parsed.title,
          listing_year: parsed.year,
          listing_make: parsed.make,
          listing_model: parsed.model,
          status: "pending",
          priority: 2,
          raw_data: {
            feed_source: "mecum",
            ingested_via: "sitemap_bulk",
            sitemap_file: `lot-sitemap${i}.xml`,
            ingested_at: new Date().toISOString(),
          },
        };
      });

      totalLots += vehicleUrls.length;

      // Upsert in small chunks (import_queue is large, big upserts timeout)
      let newCount = 0;
      for (let j = 0; j < rows.length; j += 25) {
        const chunk = rows.slice(j, j + 25);
        try {
          const { data: inserted, error } = await supabase
            .from("import_queue")
            .upsert(chunk, { onConflict: "listing_url", ignoreDuplicates: true })
            .select("id");

          if (error) {
            // Retry once with even smaller batch
            for (const row of chunk) {
              await supabase
                .from("import_queue")
                .upsert(row, { onConflict: "listing_url", ignoreDuplicates: true });
            }
          } else {
            newCount += inserted?.length || 0;
          }
        } catch (e) {
          // ignore and continue
        }
        // Brief pause to not overwhelm DB
        if (j % 200 === 0 && j > 0) await new Promise(r => setTimeout(r, 100));
      }

      totalQueued += newCount;
      console.log(
        `${vehicleUrls.length} vehicles (${skipped} non-car skipped), ${newCount} new` +
          (newCount > 0 ? " ✨" : "")
      );
    } catch (err: any) {
      console.log(`❌ ${err.message}`);
    }

    // Small delay
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\n📊 Done: ${totalLots} vehicle lots found, ${totalQueued} new queued, ${totalSkipped} non-vehicles skipped\n`
  );
}

main().catch(console.error);
