// Insert a vehicle's image rows only for URLs it does not already hold.
//
// vehicle_images has no unique key on (vehicle_id, image_url), so a writer that inserts without looking first adds the
// same URL again on every run: 2026-02-03/04, source bat_import, one Porsche 911 holds 9,972 rows for 719 URLs (the top
// search results hold 7,052-9,972 rows for 140-719 URLs, and vehicles.image_count counts the rows). Read the vehicle's
// existing URLs in pages (PostgREST caps a response, so one .limit() read silently sees only the first rows of a vehicle
// that already has many), drop the ones it holds and repeats within the batch, and insert the rest.
import { mustWrite } from "./writeResult.ts";

type Client = { from: (table: string) => any };
const PAGE = 1000;

/** Every image_url the vehicle holds, duplicates and superseded rows included (a flagged copy of a URL still means it is held). */
export async function fetchHeldImageUrls(supabase: Client, vehicleId: string): Promise<Set<string>> {
  const held = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("vehicle_images")
      .select("image_url")
      .eq("vehicle_id", vehicleId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`vehicle_images read failed: ${error.message}`);
    for (const r of data ?? []) if (r?.image_url) held.add(String(r.image_url));
    if (!data || data.length < PAGE) break;
  }
  return held;
}

export function missingRows<T extends { image_url?: string | null }>(rows: T[], held: Set<string>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const u = r?.image_url ? String(r.image_url) : "";
    if (!u || held.has(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(r);
  }
  return out;
}

/** Returns what supabase's insert returns ({ data, error }) so callers keep their handling; error also carries a read failure. */
export async function insertMissingVehicleImages<T extends { image_url?: string | null }>(
  supabase: Client,
  vehicleId: string,
  rows: T[],
  opts: { select?: string } = {},
): Promise<{ data: any[] | null; error: { message: string } | null; skipped: number }> {
  let held: Set<string>;
  try {
    held = await fetchHeldImageUrls(supabase, vehicleId);
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, skipped: 0 };
  }
  const fresh = missingRows(rows, held);
  const skipped = rows.length - fresh.length;
  if (fresh.length === 0) return { data: [], error: null, skipped };
  const q = supabase.from("vehicle_images").insert(fresh);
  const res = await (opts.select ? q.select(opts.select) : q);
  return { data: res.data ?? null, error: res.error ?? null, skipped };
}

export { mustWrite };
