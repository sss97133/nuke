#!/usr/bin/env node
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const res = await fetch(
    SUPABASE_URL + "/storage/v1/object/listing-snapshots/mecum/2026/02/18/6d852161-f8cc-4901-a7e3-001f10344efd.html",
    { headers: { Authorization: "Bearer " + KEY } }
  );
  const html = await res.text();

  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  console.log("Title:", title);
  console.log("HTML length:", html.length);

  // Meta tags
  const metas = html.matchAll(/<meta[^>]*>/gi);
  for (const m of metas) {
    const tag = m[0];
    if (tag.includes("og:") || tag.includes("description")) console.log(tag);
  }

  // JSON-LD
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  if (jsonLd) console.log("JSON-LD:", jsonLd[1].substring(0, 500));

  // Check for vehicle spec keywords
  for (const kw of ["transmission", "Transmission", "mileage", "Mileage", "VIN", "vin", "Odometer"]) {
    const idx = html.indexOf(kw);
    if (idx > -1) {
      console.log(`\nFound "${kw}" at ${idx}:`);
      console.log(html.substring(Math.max(0, idx-80), idx+150));
    }
  }
}
main().catch(console.error);
