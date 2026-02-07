#!/usr/bin/env npx tsx
/**
 * INGEST GOODING & COMPANY LOTS FROM SITEMAP
 * ~9,276 lots directly in their sitemap.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseFromSlug(url: string) {
  // /lot/YEAR-MAKE-MODEL-DESCRIPTION
  const match = url.match(/\/lot\/(\d{4})-(.+?)$/);
  if (!match) {
    // Some don't have year prefix, like concept cars
    const match2 = url.match(/\/lot\/(.+?)$/);
    if (match2) return { year: null, make: null, model: null, title: match2[1].replace(/-/g, " ") };
    return { year: null, make: null, model: null, title: null };
  }
  const year = parseInt(match[1]);
  if (year < 1900 || year > 2030) return { year: null, make: null, model: null, title: match[2].replace(/-/g, " ") };
  const parts = match[2].split("-");
  const make = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : null;
  const model = parts.slice(1, 4).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  return { year, make, model: model || null, title: `${year} ${make} ${model}` };
}

async function main() {
  console.log("🏁 Gooding & Company Sitemap Ingestion\n");
  const res = await fetch("https://www.goodingco.com/sitemap.xml", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)" },
  });
  const xml = await res.text();
  const urlRegex = /<loc>(https:\/\/www\.goodingco\.com\/lot\/[^<]+)<\/loc>/g;
  const urls: string[] = [];
  let m;
  while ((m = urlRegex.exec(xml)) !== null) urls.push(m[1]);
  console.log(`  Found ${urls.length} lots in sitemap`);

  let queued = 0;
  for (let i = 0; i < urls.length; i += 25) {
    const chunk = urls.slice(i, i + 25);
    const rows = chunk.map(url => {
      const p = parseFromSlug(url);
      return {
        listing_url: url,
        listing_title: p.title,
        listing_year: p.year,
        listing_make: p.make,
        listing_model: p.model,
        status: "pending",
        priority: 2,
        raw_data: { feed_source: "gooding", ingested_via: "sitemap_bulk", ingested_at: new Date().toISOString() },
      };
    });
    try {
      const { data } = await supabase.from("import_queue").upsert(rows, { onConflict: "listing_url", ignoreDuplicates: true }).select("id");
      queued += data?.length || 0;
    } catch (e) {
      for (const row of rows) await supabase.from("import_queue").upsert(row, { onConflict: "listing_url", ignoreDuplicates: true });
    }
    if (i % 500 === 0 && i > 0) process.stdout.write(`${i}...`);
  }
  console.log(`\n📊 Done: ${urls.length} lots, ${queued} new queued ✨\n`);
}

main().catch(console.error);
