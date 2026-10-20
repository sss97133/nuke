/**
 * ingest/repostMatch.ts: a re-posted Craigslist car is the vehicle it already is.
 *
 * Craigslist gives a re-post a new post id and a new opaque share token, and most posts carry no VIN, so none of ingest's
 * tiers (VIN, URL) can link one. A dealer in Henderson re-posts its cars daily: 2026-10-20, last 7 days (vehicle_events, same
 * URL slug and price), 315 cars became 859 vehicle rows, the worst one car as 25 rows. A re-post re-uses the photo files, and a
 * Craigslist image id (the file name without its size suffix) is the same on every post that carries the file: the five rows of
 * one 1978 Electra shared 20 distinct ids. That is evidence of one car, not a guess from a title.
 *
 * Tier 2d (after the URL tiers, before the circumstantial Tier 3): attach the post to an existing live vehicle when
 *   - the post has at least MIN_SHARED photo ids and the vehicle shares at least MIN_SHARED of them, being at least MIN_RATIO of
 *     the smaller of the two photo sets;
 *   - year, make and the first word of the model agree (a post that names no model matches on year and make alone);
 *   - the VINs do not conflict (two different VINs are two cars) and a user-owned vehicle is never a target;
 *   - the vehicle is live (not merged, not deleted).
 * Among qualifying vehicles the one sharing the most photos wins, ties to the oldest. "False splits are acceptable; false
 * merges are catastrophic": any guard failing means no match, and the post becomes a vehicle as before.
 *
 * The post still lands its own listing episode (landCraigslistCapture keys it by post id), so the vehicle shows every post of
 * the car; the map counts the vehicle once at its newest observation.
 */
import { imageKey } from "../_shared/craigslistImages.ts";

export const MIN_SHARED = 5;
export const MIN_RATIO = 0.5;
const CANDIDATE_LIMIT = 40;
const IMAGE_ROW_LIMIT = 4000;

type Client = { from: (table: string) => any };

export interface RepostPost {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
  imageUrls?: string[] | null;
}

export interface RepostCandidate {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  user_id: string | null;
  status: string | null;
  deleted_at: string | null;
  created_at: string | null;
  photoKeys: Set<string>;
}

export interface RepostMatch {
  vehicleId: string;
  shared: number;
  ratio: number;
  postPhotos: number;
  candidatePhotos: number;
}

/** The Craigslist photo ids of a gallery (size suffix dropped). Only images.craigslist.org files count. */
export function craigslistPhotoKeys(urls: string[] | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const u of urls ?? []) {
    if (typeof u === "string" && /^https?:\/\/images\.craigslist\.org\//i.test(u)) {
      const k = imageKey(u);
      if (k) keys.add(k);
    }
  }
  return keys;
}

const word = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
const vinOf = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** The pure decision: which candidate, if any, is this post a re-post of. */
export function decideRepost(post: RepostPost, candidates: RepostCandidate[]): RepostMatch | null {
  const postKeys = craigslistPhotoKeys(post.imageUrls);
  if (postKeys.size < MIN_SHARED || !post.year || !post.make) return null;
  const postVin = vinOf(post.vin);
  const best: Array<RepostMatch & { created: string }> = [];
  for (const c of candidates) {
    if (c.status === "merged" || c.deleted_at || c.user_id) continue;
    if (c.year !== post.year || word(c.make) !== word(post.make)) continue;
    if (word(post.model) && word(c.model) && word(post.model) !== word(c.model)) continue;
    const cVin = vinOf(c.vin);
    if (postVin && cVin && postVin !== cVin) continue;
    let shared = 0;
    for (const k of postKeys) if (c.photoKeys.has(k)) shared++;
    const smaller = Math.min(postKeys.size, c.photoKeys.size);
    if (shared < MIN_SHARED || smaller === 0 || shared / smaller < MIN_RATIO) continue;
    best.push({ vehicleId: c.id, shared, ratio: shared / smaller, postPhotos: postKeys.size, candidatePhotos: c.photoKeys.size, created: c.created_at ?? "" });
  }
  if (!best.length) return null;
  best.sort((a, b) => b.shared - a.shared || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0) || (a.vehicleId < b.vehicleId ? -1 : 1));
  const { created: _created, ...match } = best[0];
  return match;
}

/**
 * The lookup: live, unowned vehicles of the same year, make and model (as Tier 3 reads them), then their Craigslist photo rows.
 * Bounded; any read error means no match (the caller falls through to creation), never a throw.
 */
export async function findCraigslistRepost(supabase: Client, post: RepostPost): Promise<RepostMatch | null> {
  try {
    if (craigslistPhotoKeys(post.imageUrls).size < MIN_SHARED || !post.year || !post.make) return null;
    let q = supabase.from("vehicles")
      .select("id, year, make, model, vin, user_id, status, deleted_at, created_at")
      .eq("year", post.year).eq("make", post.make)
      .is("deleted_at", null).is("user_id", null).neq("status", "merged");
    if (post.model) q = q.eq("model", post.model);
    const { data: vehicles, error } = await q.order("created_at", { ascending: true }).limit(CANDIDATE_LIMIT);
    if (error || !vehicles?.length) return null;
    const ids = vehicles.map((v: { id: string }) => v.id);
    const { data: images, error: imgErr } = await supabase.from("vehicle_images")
      .select("vehicle_id, image_url").in("vehicle_id", ids).like("image_url", "https://images.craigslist.org/%").limit(IMAGE_ROW_LIMIT);
    if (imgErr || !images?.length) return null;
    const byVehicle = new Map<string, string[]>();
    for (const r of images as Array<{ vehicle_id: string; image_url: string }>) {
      byVehicle.set(r.vehicle_id, [...(byVehicle.get(r.vehicle_id) ?? []), r.image_url]);
    }
    const candidates: RepostCandidate[] = vehicles.map((v: any) => ({ ...v, photoKeys: craigslistPhotoKeys(byVehicle.get(v.id)) }));
    return decideRepost(post, candidates);
  } catch (e) {
    console.warn(`[ingest] repost match skipped: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
