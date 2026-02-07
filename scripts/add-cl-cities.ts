#!/usr/bin/env npx tsx
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const sb = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function main() {
  // Fetch all CL city URLs
  const res = await fetch("https://www.craigslist.org/about/sites", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await res.text();

  const cityRegex = /https:\/\/([a-z]+)\.craigslist\.org/g;
  const cities = new Set<string>();
  let m;
  while ((m = cityRegex.exec(html)) !== null) {
    cities.add(m[1]);
  }

  console.log(`Found ${cities.size} CL cities total`);

  let added = 0;
  const rows = [...cities].map((slug) => ({
    source_slug: "craigslist",
    display_name: `CL - ${slug}`,
    feed_url: `https://${slug}.craigslist.org/search/cta?min_auto_year=1960&max_auto_year=1999&purveyor=owner`,
    feed_type: "html",
    search_criteria: { min_year: 1960, max_year: 1999, type: "owner" },
    enabled: true,
  }));

  // Insert in chunks
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await sb
      .from("listing_feeds")
      .upsert(chunk, { onConflict: "feed_url", ignoreDuplicates: true });
    if (!error) added += chunk.length;
    else console.log("Error:", error.message);
  }

  console.log(`Upserted ${added} feeds`);

  const { count } = await sb
    .from("listing_feeds")
    .select("*", { count: "exact", head: true })
    .eq("source_slug", "craigslist");
  console.log(`Total CL feeds now: ${count}`);
}

main().catch(console.error);
