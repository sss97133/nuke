#!/usr/bin/env node
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function extractAndQueue(url, iqId) {
  const resp = await fetch(SUPABASE_URL + "/functions/v1/bat-simple-extract", {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  const data = await resp.json();
  const v = data.extracted || data.vehicle;
  if (v == null) { console.log("  FAILED:", url); return null; }

  const price = v.sale_price ? " $" + v.sale_price.toLocaleString() : " (active)";
  console.log("  " + v.year + " " + v.make + " " + v.model + price + " VIN:" + (v.vin || "?"));

  if (data.vehicle_id) {
    await fetch(SUPABASE_URL + "/rest/v1/import_queue?id=eq." + iqId, {
      method: "PATCH",
      headers: { "apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "complete", vehicle_id: data.vehicle_id, error_message: null, processed_at: new Date().toISOString() })
    });
    console.log("    -> linked to vehicle " + data.vehicle_id);
  }
  return v;
}

async function main() {
  const items = [
    { url: "https://bringatrailer.com/listing/1995-chevrolet-suburban-24/", id: "16c66d97-d374-4810-b0a5-b4f53e3315ff" },
    { url: "https://bringatrailer.com/listing/1961-chevrolet-c10-pickup-11/", id: "8ee679d2-3ed7-419c-889b-3b853884988d" },
    { url: "https://bringatrailer.com/listing/1975-chevrolet-c20-pickup/", id: "14579c2e-dc8c-46b5-a92a-49f9bd0b421e" }
  ];

  for (const item of items) {
    console.log("Extracting:", item.url);
    await extractAndQueue(item.url, item.id);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
