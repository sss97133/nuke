#!/usr/bin/env node
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const res = await fetch(
    SUPABASE_URL + "/storage/v1/object/listing-snapshots/carsandbids/2026/02/27/a357bfd1-edd8-439b-8d81-dc20f78e1474.html",
    { headers: { Authorization: "Bearer " + KEY } }
  );
  const html = await res.text();

  console.log("Title:", html.match(/<title>([^<]+)<\/title>/)?.[1]);
  console.log("HTML length:", html.length);

  // Meta tags
  const metas = html.matchAll(/<meta[^>]*>/gi);
  for (const m of metas) {
    const tag = m[0];
    if (tag.includes("og:") || tag.includes("description")) console.log(tag);
  }

  // __NEXT_DATA__
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (nextData) {
    const data = JSON.parse(nextData[1]);
    const pageProps = data?.props?.pageProps;
    if (pageProps) {
      console.log("\npageProps keys:", Object.keys(pageProps));
      // Look for auction/listing data
      const auction = pageProps.auction || pageProps.listing || pageProps.lot;
      if (auction) {
        console.log("\nauction keys:", Object.keys(auction));
        const interesting = {};
        for (const [k, v] of Object.entries(auction)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') interesting[k] = v;
        }
        console.log("\nauction fields:", JSON.stringify(interesting, null, 2));
      }
    }
  }

  // Vehicle spec keywords
  for (const kw of ["transmission", "Transmission", "mileage", "Mileage", "VIN", "vin"]) {
    const idx = html.indexOf(kw);
    if (idx > -1) {
      console.log(`\nFound "${kw}" at ${idx}:`, html.substring(Math.max(0, idx-50), idx+100));
    }
  }
}
main().catch(console.error);
