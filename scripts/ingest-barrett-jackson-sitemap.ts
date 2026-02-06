#!/usr/bin/env npx tsx
/**
 * INGEST BARRETT-JACKSON LOTS FROM SITEMAP
 *
 * Downloads Barrett-Jackson vehicle sitemaps and queues all lots
 * into import_queue.
 *
 * ~50,000+ vehicles across 2 sitemaps.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SITEMAPS = [
  "https://www.barrett-jackson.com/sitemap-vehicles.xml",
  "https://www.barrett-jackson.com/sitemap-vehicles2.xml",
];

function parseVehicleFromUrl(url: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
} {
  // URL: /EVENT/docket/vehicle/YEAR-MAKE-MODEL-DESCRIPTION-ID
  const match = url.match(/\/vehicle\/(\d{4})-(.+?)-(\d+)$/);
  if (!match) {
    // Try without trailing ID
    const match2 = url.match(/\/vehicle\/(\d{4})-(.+?)$/);
    if (!match2) return { year: null, make: null, model: null, title: null };

    const year = parseInt(match2[1]);
    if (year < 1900 || year > 2030) return { year: null, make: null, model: null, title: null };

    const slug = match2[2];
    const parts = slug.split("-");
    const make = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : null;
    const model = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    return { year, make, model: model || null, title: `${year} ${make} ${model}` };
  }

  const year = parseInt(match[1]);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null, title: null };

  const slug = match[2];
  const parts = slug.split("-");
  const make = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : null;
  const model = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  return { year, make, model: model || null, title: `${year} ${make} ${model}` };
}

async function main() {
  console.log(`🏁 Barrett-Jackson Sitemap Ingestion\n`);

  let totalLots = 0;
  let totalQueued = 0;

  for (const sitemapUrl of SITEMAPS) {
    const filename = sitemapUrl.split("/").pop();
    process.stdout.write(`  ${filename}... `);

    try {
      const response = await fetch(sitemapUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)" },
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();

      // Extract vehicle URLs
      const urlRegex = /<loc>(https:\/\/www\.barrett-jackson\.com\/[^<]+\/vehicle\/[^<]+)<\/loc>/g;
      const urls: string[] = [];
      let match;
      while ((match = urlRegex.exec(xml)) !== null) {
        urls.push(match[1]);
      }

      console.log(`${urls.length} vehicles found`);
      totalLots += urls.length;

      // Build rows in small chunks (large table = slow upserts)
      let newCount = 0;
      for (let i = 0; i < urls.length; i += 25) {
        const chunk = urls.slice(i, i + 25);
        const rows = chunk.map((url) => {
          const parsed = parseVehicleFromUrl(url);
          return {
            listing_url: url,
            listing_title: parsed.title,
            listing_year: parsed.year,
            listing_make: parsed.make,
            listing_model: parsed.model,
            status: "pending",
            priority: 2,
            raw_data: {
              feed_source: "barrett-jackson",
              ingested_via: "sitemap_bulk",
              ingested_at: new Date().toISOString(),
            },
          };
        });

        try {
          const { data: inserted, error } = await supabase
            .from("import_queue")
            .upsert(rows, { onConflict: "listing_url", ignoreDuplicates: true })
            .select("id");

          if (error) {
            // Retry individually on error
            for (const row of rows) {
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

        // Progress + brief pause
        if (i % 2500 === 0 && i > 0) {
          process.stdout.write(`${i}...`);
          await new Promise(r => setTimeout(r, 100));
        }
      }

      totalQueued += newCount;
      console.log(`    → ${newCount} new queued ✨`);
    } catch (err: any) {
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(
    `\n📊 Done: ${totalLots} vehicle lots found, ${totalQueued} new queued\n`
  );
}

main().catch(console.error);
