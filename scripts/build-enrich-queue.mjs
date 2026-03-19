import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fbVehicles = JSON.parse(readFileSync("data/fb-saved-ids.json", "utf-8"));

function norm(t) { return (t||"").toLowerCase().replace(/[·•—–|,]/g," ").replace(/\s+/g," ").trim(); }

const { data: dbVehicles } = await sb.from("vehicles")
  .select("id, asking_price, listing_title, primary_image_url, status")
  .eq("source", "facebook-saved")
  .neq("status", "duplicate");

const dbByKey = new Map();
for (const v of dbVehicles) {
  dbByKey.set(norm(v.listing_title) + "|" + (v.asking_price || ""), v);
}

const queue = [];
for (const fbv of fbVehicles) {
  const key = norm(fbv.title) + "|" + (fbv.price || "");
  const dbMatch = dbByKey.get(key);
  if (dbMatch && !dbMatch.primary_image_url) {
    queue.push({ vehicle_id: dbMatch.id, facebook_id: fbv.facebook_id, title: fbv.title });
  }
}

writeFileSync("data/fb-enrich-queue.json", JSON.stringify(queue, null, 2));
console.log(`${queue.length} vehicles need image enrichment`);
