// Seller type for Craigslist listing episodes already landed, from the retained snapshot of each: no Craigslist fetch.
//   dotenvx run -q -- deno run -A scripts/craigslist-seller-type-backfill.ts [--apply] [--limit 200] [--before <iso>] [--sleep-ms 1500]
// Newest first from --before. An event whose snapshot is gone, or that states no class, gets `unknown` (confidence 0), so
// a missing page is visible as unknown and not as private. Rows are written through record_lot_quality_signals.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseSellerClass } from "../supabase/functions/_shared/craigslistAttributes.ts";
import { craigslistSellerTypeRow } from "../supabase/functions/ingest/craigslistSellerType.ts";
import { recordSellerTypes } from "../supabase/functions/_shared/sellerType.ts";

const arg = (k: string, d: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const APPLY = Deno.args.includes("--apply");
const LIMIT = parseInt(arg("--limit", "200"), 10);
const SLEEP = parseInt(arg("--sleep-ms", "1500"), 10);
const before = arg("--before", new Date().toISOString());
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const { data: events, error } = await db.from("vehicle_events").select("id, vehicle_id, created_at, metadata")
  .eq("source_platform", "craigslist").lt("created_at", before).order("created_at", { ascending: false }).limit(LIMIT);
if (error) { console.error(error.message); Deno.exit(1); }
const list = events ?? [];
const snapIds = [...new Set(list.map((e: any) => e.metadata?.snapshot_id).filter(Boolean))];
const htmlById = new Map<string, string>();
for (let i = 0; i < snapIds.length; i += 20) {
  const { data } = await db.from("listing_page_snapshots").select("id, html").in("id", snapIds.slice(i, i + 20));
  for (const r of data ?? []) if (r.html) htmlById.set(r.id, r.html);
}
const vehIds = [...new Set(list.map((e: any) => e.vehicle_id))];
const desc = new Map<string, string>();
for (let i = 0; i < vehIds.length; i += 40) {
  const { data } = await db.from("vehicles").select("id, description").in("id", vehIds.slice(i, i + 40));
  for (const r of data ?? []) desc.set(r.id, r.description ?? "");
}
const tally = { events: list.length, private: 0, dealer: 0, unknown: 0, no_snapshot: 0 };
const rows = list.map((e: any) => {
  const html = htmlById.get(e.metadata?.snapshot_id);
  if (!html) tally.no_snapshot++;
  const row = craigslistSellerTypeRow(e.id, html ? parseSellerClass(html) : null, desc.get(e.vehicle_id));
  tally[row.value as "private" | "dealer" | "unknown"]++;
  return row;
});
let written = 0;
if (APPLY && rows.length) { written = await recordSellerTypes(db, rows, "backfill-craigslist-seller-type"); await new Promise((r) => setTimeout(r, SLEEP)); }
console.log(JSON.stringify({ apply: APPLY, ...tally, written, next_before: list.length ? list[list.length - 1].created_at : before }));
