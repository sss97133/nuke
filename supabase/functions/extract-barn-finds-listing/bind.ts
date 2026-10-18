/**
 * One vehicle, many citations: join a Barn Finds post to the record of the listing it links to.
 *
 * The listing (eBay, Craigslist, Facebook...) is the car's own blip; the post is an editorial observation about it. When the
 * listing is held, the post belongs on that vehicle. A post vehicle minted earlier for the same car is folded into the
 * listing's vehicle through the sanctioned merge (a vehicle_merge_proposals row, then merge_into_primary, which journals the
 * move and can be undone by unmerge_vehicle).
 */

import type { CitedListing, ListingLink, ListingPlatform } from "./citations.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";

type Supabase = any;

/** vehicle_events.source_platform spellings each cited platform's records are held under. */
export const HELD_PLATFORMS: Record<ListingPlatform, string[]> = {
  ebay_motors: ["ebay_motors", "ebay-motors", "ebay"],
  craigslist: ["craigslist"],
  facebook_marketplace: ["facebook_marketplace"],
  bat: ["bat"],
  cars_and_bids: ["cars_and_bids"],
  hemmings: ["hemmings"],
  "classiccars-com": ["classiccars", "classiccars-com", "ClassicCars.com"],
};

/** Platforms whose listing key may be looked up by (source_platform, source_listing_id): small enough for the platform index. */
const KEY_LOOKUP = new Set<ListingPlatform>(["ebay_motors", "craigslist", "facebook_marketplace", "classiccars-com"]);

/** The spellings a held record may carry for one listing URL: www or not, trailing slash or not. */
export function urlVariants(url: string): string[] {
  const out = new Set<string>();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    for (const h of [host, `www.${host}`]) for (const t of ["", "/"]) out.add(`https://${h}${path}${t}`);
  } catch { out.add(url); }
  return [...out];
}

export interface HeldTarget { id: string; year: number | null; make: string | null; via: string }
export type Resolution = { held: HeldTarget | null; ambiguous?: string[]; error?: string };

/** The vehicle we hold for a cited listing: by its listing record (URL or key), then by the vehicle's discovery URL. */
export async function resolveCitedListing(supabase: Supabase, link: ListingLink): Promise<Resolution> {
  const platforms = HELD_PLATFORMS[link.platform] ?? [];
  const urls = urlVariants(link.url);
  const found = new Map<string, string>();
  const byUrl = await supabase.from("vehicle_events").select("vehicle_id, source_platform").in("source_url", urls).not("vehicle_id", "is", null).limit(10);
  if (byUrl.error) return { held: null, error: `listing url lookup: ${byUrl.error.message}` };
  for (const r of byUrl.data ?? []) if (platforms.includes(r.source_platform)) found.set(r.vehicle_id, "vehicle_events.source_url");
  if (link.listing_key && KEY_LOOKUP.has(link.platform)) {
    const byKey = await supabase.from("vehicle_events").select("vehicle_id").in("source_platform", platforms).eq("source_listing_id", link.listing_key).not("vehicle_id", "is", null).limit(10);
    if (byKey.error) return { held: null, error: `listing key lookup: ${byKey.error.message}` };
    for (const r of byKey.data ?? []) if (!found.has(r.vehicle_id)) found.set(r.vehicle_id, "vehicle_events.source_listing_id");
  }
  const byDiscovery = await supabase.from("vehicles").select("id").in("discovery_url", urls).limit(10);
  if (byDiscovery.error) return { held: null, error: `discovery url lookup: ${byDiscovery.error.message}` };
  for (const r of byDiscovery.data ?? []) if (!found.has(r.id)) found.set(r.id, "vehicles.discovery_url");
  if (found.size === 0) return { held: null };

  // A merged vehicle stands for the vehicle it was merged into.
  const rows = await supabase.from("vehicles").select("id, year, make, status, merged_into_vehicle_id, deleted_at").in("id", [...found.keys()]);
  if (rows.error) return { held: null, error: `vehicle read: ${rows.error.message}` };
  const live = new Map<string, HeldTarget>();
  for (const v of rows.data ?? []) {
    if (v.status === "merged" && v.merged_into_vehicle_id) {
      if (!live.has(v.merged_into_vehicle_id)) {
        const m = await supabase.from("vehicles").select("id, year, make, status, deleted_at").eq("id", v.merged_into_vehicle_id).maybeSingle();
        if (m.data && m.data.status !== "merged" && !m.data.deleted_at) live.set(m.data.id, { id: m.data.id, year: m.data.year, make: m.data.make, via: `${found.get(v.id)} (merged)` });
      }
    } else if (!v.deleted_at) live.set(v.id, { id: v.id, year: v.year, make: v.make, via: found.get(v.id) ?? "" });
  }
  if (live.size > 1) return { held: null, ambiguous: [...live.keys()] };
  return { held: [...live.values()][0] ?? null };
}

const makeKey = (m: string | null | undefined) => {
  if (!m) return null;
  const n = String(normalizeVehicleFields({ make: m }).make ?? m).toLowerCase().replace(/[^a-z0-9]/g, "");
  return n || null;
};

/** The post's headline and the listing's vehicle name the same car: years equal and makes agree where both are stated. */
export function identityAgrees(post: { year: number | null; make: string | null }, held: { year: number | null; make: string | null }): boolean {
  if (post.year && held.year && Number(post.year) !== Number(held.year)) return false;
  const a = makeKey(post.make), b = makeKey(held.make);
  if (a && b && !(a.startsWith(b) || b.startsWith(a))) return false;
  return true;
}

export type MergeOutcome = { outcome: "merged" | "proposed" | "skipped" | "error"; detail?: unknown };

/**
 * Fold a vehicle minted from this post into the listing's vehicle. Only a vehicle that came from this Barn Finds post and
 * holds no other platform's listing is merged automatically; anything else is left as a 'detected' proposal for review.
 */
export async function mergePostVehicle(supabase: Supabase, o: { primaryId: string; dupId: string; postUrl: string; subject: ListingLink; via: string }): Promise<MergeOutcome> {
  const dup = await supabase.from("vehicles").select("id, status, discovery_url, discovery_source, profile_origin, user_id").eq("id", o.dupId).maybeSingle();
  if (dup.error || !dup.data) return { outcome: "error", detail: dup.error?.message ?? "post vehicle not found" };
  if (dup.data.status === "merged") return { outcome: "skipped", detail: "post vehicle already merged" };
  const fromPost = (dup.data.discovery_source === "barnfinds" || dup.data.profile_origin === "barnfinds")
    && urlVariants(o.postUrl).includes(String(dup.data.discovery_url ?? "").replace(/\/+$/, "").replace(/^http:/, "https:"));
  const other = await supabase.from("vehicle_events").select("id").eq("vehicle_id", o.dupId).neq("source_platform", "barnfinds").limit(1);
  if (other.error) return { outcome: "error", detail: other.error.message };
  const clean = fromPost && !dup.data.user_id && (other.data ?? []).length === 0;
  const reasoning = {
    basis: "the Barn Finds post links to this listing (one vehicle, many citations)",
    post_url: o.postUrl, cited_platform: o.subject.platform, cited_listing_key: o.subject.listing_key, cited_url: o.subject.url,
    target_resolved_via: o.via, auto_merge_guard: { post_vehicle_from_this_post: fromPost, owned: !!dup.data.user_id, other_platform_events: (other.data ?? []).length },
  };
  const prop = await supabase.from("vehicle_merge_proposals").upsert({
    primary_vehicle_id: o.primaryId, duplicate_vehicle_id: o.dupId, match_type: "exact_listing_url", confidence_score: clean ? 95 : 70,
    status: clean ? "approved" : "detected", detected_by: "extract-barn-finds-listing", match_reasoning: reasoning,
    recommended_primary: o.primaryId, recommendation_reason: "the listing's own vehicle is primary; the post is an editorial citation of it",
  }, { onConflict: "primary_vehicle_id,duplicate_vehicle_id", ignoreDuplicates: true });
  if (prop.error) return { outcome: "error", detail: `proposal: ${prop.error.message}` };
  if (!clean) return { outcome: "proposed", detail: reasoning.auto_merge_guard };
  const res = await supabase.rpc("merge_into_primary", { primary_id: o.primaryId, dup_id: o.dupId });
  if (res.error) return { outcome: "error", detail: `merge_into_primary: ${res.error.message}` };
  if (res.data?.skipped) return { outcome: "skipped", detail: res.data };
  return { outcome: "merged", detail: res.data };
}

export type BindState = "bound" | "target_not_held" | "link_replaced" | "no_link" | "identity_conflict" | "ambiguous" | "merge_held" | "lookup_failed";
export interface Binding { state: BindState; target_vehicle_id: string | null; via: string | null; merge: MergeOutcome | null; detail?: unknown }

/** Decide where the post lands: the listing's vehicle when it is held and names the same car, else the post's own vehicle. */
export async function bindToListing(supabase: Supabase, o: {
  postUrl: string; postVehicleId: string | null; cites: CitedListing[]; subject: (CitedListing & ListingLink) | null; identity: { year: number | null; make: string | null };
}): Promise<Binding> {
  const none = { target_vehicle_id: null, via: null, merge: null };
  if (!o.subject) return { state: o.cites.some((c) => c.role === "subject") ? "link_replaced" : "no_link", ...none };
  const r = await resolveCitedListing(supabase, o.subject);
  if (r.error) return { state: "lookup_failed", ...none, detail: r.error };
  if (r.ambiguous) return { state: "ambiguous", ...none, detail: r.ambiguous };
  if (!r.held) return { state: "target_not_held", ...none };
  if (!identityAgrees(o.identity, r.held)) return { state: "identity_conflict", ...none, target_vehicle_id: r.held.id, via: r.held.via, detail: { held: r.held, post: o.identity } };
  if (o.postVehicleId && o.postVehicleId !== r.held.id) {
    const merge = await mergePostVehicle(supabase, { primaryId: r.held.id, dupId: o.postVehicleId, postUrl: o.postUrl, subject: o.subject, via: r.held.via });
    if (merge.outcome !== "merged") return { state: "merge_held", target_vehicle_id: r.held.id, via: r.held.via, merge };
    return { state: "bound", target_vehicle_id: r.held.id, via: r.held.via, merge };
  }
  return { state: "bound", target_vehicle_id: r.held.id, via: r.held.via, merge: null };
}

/** What the post's event and observation record about its citations. */
export function citationMetadata(cites: CitedListing[], subject: (CitedListing & ListingLink) | null, b: Binding, checkedAt: string) {
  const s = cites.find((c) => c.role === "subject") ?? null;
  return {
    cited_listing: s ? { platform: s.platform ?? null, listing_key: s.listing_key ?? null, url: s.url ?? null, link_state: s.link_state, named_platform: s.named_platform, anchor_text: s.anchor_text } : null,
    cited_listings: cites.slice(0, 25).map((c) => ({ role: c.role, platform: c.platform ?? null, listing_key: c.listing_key ?? null, url: c.url ?? null, link_state: c.link_state, anchor_text: c.anchor_text })),
    bind_state: b.state,
    bound_vehicle_via: b.state === "bound" ? b.via : null,
    bind_checked_at: checkedAt,
    ...(subject && b.state === "bound" && b.merge ? { bind_merge: { outcome: b.merge.outcome, proposal_id: (b.merge.detail as any)?.proposal_id ?? null } } : {}),
    ...(b.state === "identity_conflict" || b.state === "ambiguous" || b.state === "merge_held" ? { bind_detail: b.detail ?? b.merge ?? null } : {}),
  };
}
