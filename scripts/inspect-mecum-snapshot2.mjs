#!/usr/bin/env node
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const res = await fetch(
    SUPABASE_URL + "/storage/v1/object/listing-snapshots/mecum/2026/02/18/6d852161-f8cc-4901-a7e3-001f10344efd.html",
    { headers: { Authorization: "Bearer " + KEY } }
  );
  const html = await res.text();

  // Find the big JSON block that has vinSerial, transmission, etc.
  // It seems to be in __NEXT_DATA__ or a script tag
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (nextData) {
    const data = JSON.parse(nextData[1]);
    console.log("__NEXT_DATA__ keys:", Object.keys(data));
    // Drill into props
    const pageProps = data?.props?.pageProps;
    if (pageProps) {
      console.log("\npageProps keys:", Object.keys(pageProps));
      // Look for lot/vehicle data
      const lot = pageProps.lot || pageProps.vehicle || pageProps.data;
      if (lot) console.log("\nlot data:", JSON.stringify(lot).substring(0, 2000));
    }
  }

  // Also find the JSON block with vinSerial
  const jsonMatch = html.match(/\{[^{}]*"vinSerial"[^{}]*\}/);
  if (jsonMatch) {
    console.log("\n\nJSON with vinSerial:", jsonMatch[0].substring(0, 1000));
  }

  // Find the bigger JSON context
  const idx = html.indexOf('"vinSerial"');
  if (idx > -1) {
    // Walk backwards to find the opening brace
    let depth = 0;
    let start = idx;
    for (let i = idx; i >= 0; i--) {
      if (html[i] === '}') depth++;
      if (html[i] === '{') {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    // Walk forward to find the closing brace
    depth = 0;
    let end = idx;
    for (let i = start; i < html.length; i++) {
      if (html[i] === '{') depth++;
      if (html[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const jsonStr = html.substring(start, end);
    try {
      const obj = JSON.parse(jsonStr);
      console.log("\n\nParsed vehicle JSON keys:", Object.keys(obj));
      // Print vehicle-relevant fields
      const interesting = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' || typeof v === 'number') interesting[k] = v;
      }
      console.log("\nVehicle fields:", JSON.stringify(interesting, null, 2));
    } catch (e) {
      console.log("Parse error, raw substring:", jsonStr.substring(0, 500));
    }
  }

  // JSON-LD
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd[1]);
      console.log("\n\nJSON-LD:", JSON.stringify(ld, null, 2));
    } catch {}
  }
}
main().catch(console.error);
