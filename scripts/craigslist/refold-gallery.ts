// Re-fold Craigslist galleries from retained snapshots: no fetch of any Craigslist page.
//   dotenvx run -q -- deno run -A scripts/craigslist/refold-gallery.ts [--apply] [--limit 25] [--before <iso>] [--sleep-ms 1500]
//
// What it did on 2026-10-15 (lane-live-market, run in batches of 25 vehicles, newest first from the run time back to
// 2026-10-13 18:45Z): 850 Craigslist vehicles, 9,724 full-size (1200x900) image rows inserted, 9,757 smaller (600x450)
// rows marked is_duplicate with duplicate_of pointing at the full-size row (superseded, never deleted), 2 errors. Why:
// every stored Craigslist image was the 600x450 size and the page showed one photo. The same run order that day was
// (1) the vision-gate classifier on Craigslist vehicles, (2) this script, so the full-size copies inherited the approved
// gate verdict of the rows they replaced.
//
// For each Craigslist vehicle (newest first, from --before), read the latest retained snapshot of its post, take the
// page's whole gallery at 1200x900 (extract-craigslist's extractGallery), and plan against the vehicle's image rows
// (supabase/functions/_shared/craigslistImages.ts): add the full-size photo, mark the 600x450 row a duplicate of it, and
// move the primary flag and vehicles.primary_image_url with the photo. New rows land ai_processing_status 'skipped' so the
// photo pipeline trigger does not fire. Dry run unless --apply. Prints the next --before so a run resumes where it stopped.
// Default pace: one vehicle per 1.5 s, because every inserted image row fires the image triggers. A second run plans
// nothing for a vehicle that already holds the full-size rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractGallery } from "../../supabase/functions/extract-craigslist/extract.ts";
import { applyCraigslistImagePlan, planCraigslistImages } from "../../supabase/functions/_shared/craigslistImages.ts";

const arg = (k: string, d: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const APPLY = Deno.args.includes("--apply");
const LIMIT = parseInt(arg("--limit", "25"), 10);
const SLEEP = parseInt(arg("--sleep-ms", "1500"), 10);
const before = arg("--before", new Date().toISOString());
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const { data: vehicles, error } = await db.from("vehicles").select("id, listing_url, created_at")
  .eq("source", "craigslist").not("listing_url", "is", null).lt("created_at", before)
  .order("created_at", { ascending: false }).limit(LIMIT);
if (error) { console.error("vehicles:", error.message); Deno.exit(1); }

const tally = { vehicles: 0, no_snapshot: 0, no_gallery: 0, unchanged: 0, would_insert: 0, would_supersede: 0, inserted: 0, superseded: 0, errors: 0 };
let next = before;
for (const v of vehicles ?? []) {
  tally.vehicles++; next = v.created_at;
  const urls = [v.listing_url, v.listing_url.replace("https://craigslist.org/", "https://www.craigslist.org/")];
  const { data: snaps } = await db.from("listing_page_snapshots").select("html, fetched_at")
    .eq("platform", "craigslist").in("listing_url", urls).not("html", "is", null).order("fetched_at", { ascending: false }).limit(1);
  const html = snaps?.[0]?.html as string | undefined;
  if (!html) { tally.no_snapshot++; continue; }
  const gallery = extractGallery(html);
  if (gallery.length === 0) { tally.no_gallery++; continue; }
  const { data: rows } = await db.from("vehicle_images").select("id, image_url, is_primary, is_duplicate, vision_gate_status").eq("vehicle_id", v.id).limit(500);
  const plan = planCraigslistImages(rows ?? [], gallery);
  if (plan.insert.length === 0) { tally.unchanged++; continue; }
  tally.would_insert += plan.insert.length; tally.would_supersede += plan.supersede.length;
  if (APPLY) {
    const r = await applyCraigslistImagePlan(db, { vehicleId: v.id, sourceUrl: v.listing_url, source: "craigslist", plan });
    tally.inserted += r.inserted; tally.superseded += r.superseded; tally.errors += r.errors.length;
    if (r.errors.length) console.error(v.id, r.errors.slice(0, 2).join("; "));
    await new Promise((res) => setTimeout(res, SLEEP));
  }
}
console.log(JSON.stringify({ apply: APPLY, ...tally, next_before: next }));
