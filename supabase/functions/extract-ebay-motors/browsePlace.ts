/**
 * Where an eBay listing says the car is: one vehicle_location_observations row per landed listing, the table the map
 * (map-vehicles, fold_map_facts_listing) and the county and ZIP keys already read.
 *
 * The claim is the listing's own statement, kept as eBay gave it: getItem's itemLocation (city, state name, postal code,
 * country) and any "City, ST 12345" the seller wrote in the description. eBay masks the postal code to its first three
 * digits ('801**', 162 of 162 getItem captures on 2026-10-20), so the listing places the car at a city, not a ZIP:
 *   - a full five-digit code (from itemLocation, or the one ZIP the description states that agrees with eBay's state and
 *     three-digit prefix) is written as postal_code, and the database keys it to county (zip_to_fips) and ZCTA exactly;
 *   - otherwise the city's point (city_band_geocode over city_geocode_lookup, precision 'city') is written, county comes
 *     from point-in-county, and the row has no ZIP (the ZCTA key never reads a point);
 *   - the point is kept only when eBay's own data agrees with it: its county is in the stated state and holds a ZIP with
 *     eBay's three-digit prefix (on 2026-10-20 the lookup put Biloxi MS in Alabama, Saint Louis MO in Illinois and Sherman
 *     TX in Sherman County; all three fail the check and land at state only);
 *   - a description ZIP outside the stated state or prefix contradicts the listing: the row is disputed and placed only
 *     where both statements agree (the state, or nowhere), never at a county.
 * metadata.place says which: {grain, postal_basis, checks, dispute}. Photos cannot check it yet: eBay serves its photos
 * without EXIF, so no eBay image carries GPS (0 of 33,981 on 2026-10-20).
 */
import { mustWrite } from "../_shared/writeResult.ts";

const PLATFORM = "ebay_motors";

export interface StateRow { fips: string; usps: string; name: string }
export interface ItemLocation { city?: string; stateOrProvince?: string; postalCode?: string; country?: string }

export interface Stated {
  city: string | null; state_text: string | null; usps: string | null; state_fips: string | null;
  postal: string | null;       // five digits, only when eBay gave all five
  prefix: string | null;       // eBay's visible digits of the postal code ('801' of '801**'), or the first three of a full code
  postal_raw: string | null;   // the postal code exactly as eBay returned it
  country: string | null;
}

const clean = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim().replace(/\s+/g, " ") : null);

/** The stated place, read as eBay returned it; the state is matched to us_states by name or USPS code. */
export function statedPlace(loc: ItemLocation | null | undefined, states: StateRow[]): Stated {
  const city = clean(loc?.city), stateText = clean(loc?.stateOrProvince), raw = clean(loc?.postalCode);
  const country = clean(loc?.country)?.toUpperCase() ?? null;
  const st = stateText && (country === null || country === "US")
    ? states.find((s) => s.name.toLowerCase() === stateText.toLowerCase() || s.usps === stateText.toUpperCase()) ?? null
    : null;
  const full = raw?.match(/^(\d{5})(?:-\d{4})?$/)?.[1] ?? null;
  const prefix = full ? full.slice(0, 3) : raw?.match(/^(\d{3})\*{2}$/)?.[1] ?? null;
  return { city, state_text: stateText, usps: st?.usps ?? null, state_fips: st?.fips ?? null, postal: full, prefix, postal_raw: raw, country };
}

export interface Mention { usps: string; zip: string; text: string }

/** Every "…, ST 12345" in the seller's description (a US state code, then five digits), each ZIP once, with its words. */
export function describedPlaces(text: string | null | undefined, states: StateRow[]): Mention[] {
  if (!text || !states.length) return [];
  const codes = states.map((s) => s.usps).join("|");
  const re = new RegExp(`([A-Za-z][A-Za-z.'\\- ]{0,40}?[A-Za-z.]),?\\s+(${codes})\\s+(\\d{5})(?:-\\d{4})?(?!\\d)`, "g");
  const out: Mention[] = [];
  for (const m of text.matchAll(re)) {
    if (!out.some((x) => x.zip === m[3])) out.push({ usps: m[2], zip: m[3], text: m[0].trim().slice(-60) });
    if (out.length >= 8) break;
  }
  return out;
}

export type Grain = "zip" | "city" | "region";
export interface Decision {
  grain: Grain | null;                         // the finest place the listing supports, before the point check
  postal: string | null; postal_basis: "item_location" | "description" | null;
  usps: string | null;                         // the state both statements agree on (null when they do not)
  city: string | null;
  dispute: { reason: string; stated: string; described: Mention[] } | null;
}

/** What the listing's statements support, from the text alone (no lookups). */
export function decide(s: Stated, mentions: Mention[]): Decision {
  const stated = [[s.city, s.state_text].filter(Boolean).join(", "), s.postal_raw].filter(Boolean).join(" ");
  if (!s.usps) return { grain: null, postal: null, postal_basis: null, usps: null, city: null, dispute: null };
  const foreign = mentions.filter((m) => m.usps !== s.usps || (s.prefix !== null && m.zip.slice(0, 3) !== s.prefix));
  if (foreign.length) {
    const sameState = foreign.every((m) => m.usps === s.usps);
    return {
      grain: sameState ? "region" : null, postal: null, postal_basis: null, usps: sameState ? s.usps : null, city: null,
      dispute: {
        reason: sameState ? `the description places the car at a ZIP outside the stated prefix ${s.prefix}`
          : "the description places the car in another state",
        stated, described: foreign,
      },
    };
  }
  if (s.postal) return { grain: "zip", postal: s.postal, postal_basis: "item_location", usps: s.usps, city: s.city, dispute: null };
  // a seller's ZIP is taken only when eBay's own prefix vouches for it; with no prefix it cannot be checked
  if (mentions.length === 1 && s.prefix) return { grain: "zip", postal: mentions[0].zip, postal_basis: "description", usps: s.usps, city: s.city, dispute: null };
  return { grain: s.city ? "city" : "region", postal: null, postal_basis: null, usps: s.usps, city: s.city, dispute: null };
}

export interface PointCheck { point: { latitude: number; longitude: number } | null; state: string; zip_prefix: string; county: string | null }

export interface PlaceInput {
  vehicleId: string; url: string; observedAt: string; loc: ItemLocation | null | undefined; description: string | null | undefined;
  observationId?: string | null; snapshotId?: string | null;
}

/** The row, from the decision and the checked point; null when the listing gives no US state and no dispute. */
export function placeRow(i: PlaceInput, s: Stated, d: Decision, pc: PointCheck, mentions: Mention[] = []): Record<string, unknown> | null {
  if (!d.usps && !d.dispute) return null;
  const point = d.dispute ? null : pc.point;
  const keyed = point !== null || d.postal !== null;
  const raw = [[s.city, s.state_text].filter(Boolean).join(", "), s.postal_raw].filter(Boolean).join(" ") || null;
  const cleanText = d.usps ? [[d.city, d.usps].filter(Boolean).join(", "), d.postal].filter(Boolean).join(" ") : null;
  const grain: Grain | null = d.dispute ? (d.usps ? "region" : null) : d.grain === "city" && !point ? "region" : d.grain;
  return {
    vehicle_id: i.vehicleId, source_type: "listing", source_platform: PLATFORM, source_url: i.url, observed_at: i.observedAt,
    location_text_raw: raw, location_text_clean: cleanText, country_code: d.usps ? "US" : null, region_code: d.usps, city: d.city,
    postal_code: d.postal, latitude: point?.latitude ?? null, longitude: point?.longitude ?? null,
    // precision describes the point when there is one (a city centroid), else the finest key the row carries
    precision: point ? "city" : d.postal ? "zip" : d.usps ? "region" : null,
    confidence: d.dispute ? 0.5 : keyed ? 0.8 : 0.6,
    metadata: {
      method: "ebay_item_location", stated: i.loc ?? null,
      // grain: the finest place the listing supports (zip: county and ZCTA exact; city: county from the city's point,
      // no ZIP; region: state only; null: nowhere). checks: how eBay's own fields judged the city's point.
      place: {
        grain, postal_basis: d.postal_basis, prefix: s.prefix,
        checks: { point_state: pc.state, point_zip_prefix: pc.zip_prefix },
        dispute: d.dispute, described: mentions.length ? mentions : undefined,
      },
      geocode: point ? "city_band_geocode" : null,
      ...(i.observationId ? { observation_id: i.observationId } : {}), ...(i.snapshotId ? { snapshot_id: i.snapshotId } : {}),
    },
  };
}

// ---- lookups and the write ---------------------------------------------------------------------------------------

export interface PlaceCtx { states: StateRow[] | null; points: Map<string, PointCheck>; zips: Map<string, string | null> }
export const newPlaceCtx = (): PlaceCtx => ({ states: null, points: new Map(), zips: new Map() });

async function statesOf(supabase: any, ctx: PlaceCtx): Promise<StateRow[]> {
  if (!ctx.states) ctx.states = (mustWrite("us_states read", await supabase.from("us_states").select("fips,usps,name").limit(100)).data ?? []) as StateRow[];
  return ctx.states;
}

/**
 * Keeps a mention only when its ZIP is a ZIP of its state in zip_to_fips: "please mention ID 71469" is a stock number, not
 * an Idaho address (on 2026-10-20, 19 of the 29 cross-state mentions in held eBay descriptions were that phrase).
 */
export async function validMentions(supabase: any, ctx: PlaceCtx, mentions: Mention[], states: StateRow[]): Promise<Mention[]> {
  if (!mentions.length) return mentions;
  const need = [...new Set(mentions.map((m) => m.zip).filter((z) => !ctx.zips.has(z)))];
  if (need.length) {
    const r = mustWrite("zip_to_fips read", await supabase.from("zip_to_fips").select("zip,fips").in("zip", need));
    for (const z of need) ctx.zips.set(z, null);
    for (const row of r.data ?? []) ctx.zips.set(row.zip, row.fips);
  }
  const stateFips = new Map(states.map((s) => [s.usps, s.fips]));
  return mentions.filter((m) => ctx.zips.get(m.zip)?.slice(0, 2) === stateFips.get(m.usps));
}

/** The city's point, kept only when its county is in the stated state and, when eBay shows a prefix, holds a ZIP with it. */
export async function checkedPoint(supabase: any, ctx: PlaceCtx, s: Stated): Promise<PointCheck> {
  if (!s.city || !s.usps || !s.state_fips) return { point: null, state: "no_city", zip_prefix: "no_city", county: null };
  const key = `${s.city.toLowerCase()}|${s.usps}|${s.prefix ?? ""}`;
  const hit = ctx.points.get(key);
  if (hit) return hit;
  const g = mustWrite("city_band_geocode", await supabase.rpc("city_band_geocode", { p_city: s.city, p_state: s.usps }));
  const row = Array.isArray(g.data) ? g.data[0] : g.data;
  const lat = Number(row?.latitude), lon = Number(row?.longitude);
  let out: PointCheck;
  if (row?.latitude == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    out = { point: null, state: "no_geocode", zip_prefix: "no_geocode", county: null };
  } else {
    const c = mustWrite("map_point_county", await supabase.rpc("map_point_county", { p_lon: lon, p_lat: lat }));
    const county = typeof c.data === "string" ? c.data : null;
    if (!county || county.slice(0, 2) !== s.state_fips) {
      out = { point: null, state: county ? "disagrees" : "no_county", zip_prefix: "not_checked", county };
    } else if (!s.prefix) {
      out = { point: { latitude: lat, longitude: lon }, state: "agrees", zip_prefix: "not_given", county };
    } else {
      const z = mustWrite("zip_to_fips read", await supabase.from("zip_to_fips").select("zip").eq("fips", county).like("zip", `${s.prefix}%`).limit(1));
      out = (z.data ?? []).length
        ? { point: { latitude: lat, longitude: lon }, state: "agrees", zip_prefix: "agrees", county }
        : { point: null, state: "agrees", zip_prefix: "disagrees", county };
    }
  }
  ctx.points.set(key, out);
  return out;
}

export type PlaceOutcome = "written" | "duplicate" | "no_state";

/** Land one listing's place. Throws on a failed read or write (the caller counts it as an error). */
export async function landPlace(supabase: any, ctx: PlaceCtx, i: PlaceInput): Promise<{ outcome: PlaceOutcome; grain: Grain | null; disputed: boolean }> {
  const states = await statesOf(supabase, ctx);
  const s = statedPlace(i.loc, states);
  const mentions = await validMentions(supabase, ctx, describedPlaces(i.description, states), states);
  const d = decide(s, mentions);
  const pc = d.grain && !d.dispute ? await checkedPoint(supabase, ctx, s) : { point: null, state: "not_checked", zip_prefix: "not_checked", county: null };
  const row = placeRow(i, s, d, pc, mentions);
  if (!row) return { outcome: "no_state", grain: null, disputed: false };
  const grain = (row.metadata as any).place.grain as Grain | null;
  let seen = supabase.from("vehicle_location_observations").select("id").eq("vehicle_id", i.vehicleId)
    .eq("source_platform", PLATFORM).eq("source_url", i.url);
  seen = row.location_text_raw === null ? seen.is("location_text_raw", null) : seen.eq("location_text_raw", row.location_text_raw);
  const prior = mustWrite("place duplicate read", await seen.limit(1));
  if ((prior.data ?? []).length) return { outcome: "duplicate", grain, disputed: d.dispute !== null };
  mustWrite("place insert", await supabase.from("vehicle_location_observations").insert(row));
  return { outcome: "written", grain, disputed: d.dispute !== null };
}

export interface PlaceReport { ok: boolean; scanned: number; next_after: string | null; outcomes: Record<string, number>; grains: Record<string, number>; disputed: number; errors: string[] }

/**
 * Back-fill: the place of every eBay listing episode landed before landing wrote it. Reads the episode's listing
 * observation (its observed_at, the raw itemLocation it kept, the description text) and lands it through landPlace, so
 * the row is the one landing would have written, on the listing's own clock. Resumable by episode id; idempotent.
 */
export async function placeBackfill(supabase: any, o: { max?: number; after?: string | null; dryRun?: boolean } = {}): Promise<PlaceReport> {
  const rep: PlaceReport = { ok: true, scanned: 0, next_after: null, outcomes: {}, grains: {}, disputed: 0, errors: [] };
  const max = Math.min(Math.max(Number(o.max) || 100, 1), 300);
  const ctx = newPlaceCtx();
  let q = supabase.from("vehicle_events").select("id,vehicle_id,source_url,metadata->>observation_id,metadata->>snapshot_id")
    .eq("source_platform", PLATFORM).eq("event_type", "listing").in("metadata->>source", ["ebay-browse-api", "ebay-firecrawl"])
    .not("vehicle_id", "is", null).order("id", { ascending: true }).limit(max);
  if (o.after) q = q.gt("id", o.after);
  const evs = mustWrite("episodes read", await q).data ?? [];
  rep.scanned = evs.length;
  rep.next_after = evs.length ? evs[evs.length - 1].id : null;
  const ids = evs.map((e: any) => e.observation_id).filter((x: unknown) => typeof x === "string");
  const obs = new Map<string, any>();
  for (let k = 0; k < ids.length; k += 100) {
    const r = mustWrite("observations read", await supabase.from("vehicle_observations")
      .select("id,observed_at,content_text,loc:extraction_metadata->raw->location").in("id", ids.slice(k, k + 100)));
    for (const row of r.data ?? []) obs.set(row.id, row);
  }
  const count = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  for (const e of evs) {
    const ob = obs.get(e.observation_id);
    if (!ob) { count(rep.outcomes, "no_observation"); continue; }
    if (o.dryRun) {
      const states = await statesOf(supabase, ctx);
      const s = statedPlace(ob.loc, states), d = decide(s, await validMentions(supabase, ctx, describedPlaces(ob.content_text, states), states));
      count(rep.outcomes, "dry_run"); count(rep.grains, String(d.grain)); if (d.dispute) rep.disputed++;
      continue;
    }
    try {
      const r = await landPlace(supabase, ctx, { vehicleId: e.vehicle_id, url: e.source_url, observedAt: ob.observed_at, loc: ob.loc,
        description: ob.content_text, observationId: ob.id, snapshotId: e.snapshot_id ?? null });
      count(rep.outcomes, r.outcome); count(rep.grains, String(r.grain)); if (r.disputed) rep.disputed++;
    } catch (err) {
      rep.errors.push(`${e.id}: ${(err as Error).message}`.slice(0, 300));
    }
  }
  if (rep.errors.length) rep.ok = false;
  return rep;
}
