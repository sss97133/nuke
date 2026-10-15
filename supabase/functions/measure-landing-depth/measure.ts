/**
 * measureSource: one source's raw-vs-model test (index.ts is the HTTP wrapper the nightly cron posts to).
 *
 * measureSource(sb, { source, sample?: 30, min_age_hours?: 2, max_age_days?: 4, dry_run? })
 *   1. draw `sample` lot pages from the source's retained captures (listing_page_snapshots, one per listing url)
 *   2. read each capture with the independent probes (_shared/landingDepthProbes.ts)
 *   3. resolve the lot to its vehicle by url and read what the canonical model holds for it
 *   4. write one landing_depth_measurements row per field: raw-present, model-present, profile-present
 *
 * It reads captures and the model and writes only its own measurement table. Values are never stored.
 */
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import {
  DEPTH_FIELDS, type DepthField, isLotUrl, type ModelCtx, modelHolds, type RawFields, readRaw,
} from "../_shared/landingDepthProbes.ts";

const PROBE_VERSION = "2026-10-15.1";
const VEHICLE_COLS = [
  "id", "year", "make", "model", "vin", "mileage", "transmission", "transmission_type", "engine_size", "engine_type",
  "engine_displacement", "engine_liters", "color", "color_primary", "interior_color", "description", "city", "state",
  "zip_code", "gps_latitude", "seller_name", "bat_seller", "sale_price", "winning_bid", "high_bid", "asking_price",
  "price", "bat_sold_price", "sold_price", "sale_date", "bat_sale_date", "bid_count", "bat_bid_count",
].join(",");

// deno-lint-ignore no-explicit-any
type Sb = any;

/** Every spelling of a listing url that a vehicle row might hold. */
function urlVariants(url: string): string[] {
  const key = normalizeListingUrlKey(url);
  const out = new Set<string>([url, url.toLowerCase()]);
  if (key) {
    const [host, ...rest] = key.split("/");
    const path = rest.length ? "/" + rest.join("/") : "";
    for (const scheme of ["https://", "http://"]) {
      for (const h of [host, `www.${host}`]) {
        for (const tail of ["", "/"]) out.add(`${scheme}${h}${path}${tail}`);
      }
    }
  }
  const trimmed = url.replace(/[?#].*$/, "");
  out.add(trimmed);
  out.add(trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed + "/");
  return [...out];
}

async function resolveVehicleId(sb: Sb, platform: string, url: string): Promise<string | null> {
  const vs = urlVariants(url);
  for (const col of ["listing_url", "discovery_url", "bat_auction_url"]) {
    const { data } = await sb.from("vehicles").select("id").in(col, vs).is("deleted_at", null).limit(1);
    if (data?.[0]) return (data[0] as { id: string }).id;
  }
  const { data: ev } = await sb.from("vehicle_events").select("vehicle_id").in("source_url", vs)
    .not("vehicle_id", "is", null).limit(1);
  if (ev?.[0]) return (ev[0] as { vehicle_id: string }).vehicle_id;
  const key = normalizeListingUrlKey(url);
  if (key) {
    const { data: el } = await sb.from("external_listings").select("vehicle_id").eq("platform", platform)
      .eq("listing_url_key", key).not("vehicle_id", "is", null).limit(1);
    if (el?.[0]) return (el[0] as { vehicle_id: string }).vehicle_id;
  }
  return null;
}

async function modelFor(sb: Sb, vehicleId: string): Promise<ModelCtx> {
  const [v, events, locObs, comments, images, obs] = await Promise.all([
    sb.from("vehicles").select(VEHICLE_COLS).eq("id", vehicleId).maybeSingle(),
    sb.from("vehicle_events").select("final_price,current_price,starting_price,ended_at,sold_at,bid_count,seller_identifier,seller_external_identity_id")
      .eq("vehicle_id", vehicleId).limit(20),
    sb.from("vehicle_location_observations").select("city,region_code,postal_code,latitude,location_text_clean")
      .eq("vehicle_id", vehicleId).limit(10),
    sb.from("auction_comments").select("id", { count: "estimated", head: true }).eq("vehicle_id", vehicleId),
    sb.from("vehicle_images").select("id", { count: "estimated", head: true }).eq("vehicle_id", vehicleId)
      .or("is_superseded.is.null,is_superseded.eq.false"),
    sb.from("vehicle_observations").select("content_text").eq("vehicle_id", vehicleId).eq("kind", "listing")
      .not("content_text", "is", null).limit(12),
  ]);
  return {
    v: (v.data as Record<string, unknown> | null) ?? null,
    events: (events.data as Record<string, unknown>[] | null) ?? [],
    locObs: (locObs.data as Record<string, unknown>[] | null) ?? [],
    commentCount: comments.count ?? 0,
    imageCount: images.count ?? 0,
    obsDescLen: Math.max(0, ...((obs.data as { content_text: string }[] | null) ?? []).map((o) => o.content_text.length)),
  };
}

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

const p50 = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return Math.round((a[Math.floor((a.length - 1) / 2)] ?? 0) * 100) / 100; };

interface Tally { raw: number; model: number; profile: number; examples: { snapshot_id: string; vehicle_id: string | null }[]; pRatios: number[]; mRatios: number[] }


export interface MeasureOpts { source: string; sample?: number; min_age_hours?: number; max_age_days?: number; dry_run?: boolean }

export async function measureSource(sb: Sb, body: MeasureOpts) {
    const source = body.source;
    const sample = Math.min(Math.max(Number(body.sample ?? 30), 1), 60);
    const windowEnd = new Date(Date.now() - Number(body.min_age_hours ?? 2) * 3600e3);
    const windowStart = new Date(Date.now() - Number(body.max_age_days ?? 4) * 86400e3);

    // 1. candidates: ids and urls only, one per listing url, lot pages only
    const { data: cands, error: cerr } = await sb.from("listing_page_snapshots").select("id,listing_url,fetched_at")
      .eq("platform", source).eq("success", true).not("html", "is", null).gte("fetched_at", windowStart.toISOString())
      .lte("fetched_at", windowEnd.toISOString()).order("fetched_at", { ascending: false }).limit(1500);
    if (cerr) throw new Error(`candidates: ${cerr.message}`);
    const byKey = new Map<string, { id: string; listing_url: string }>();
    for (const c of (cands ?? []) as { id: string; listing_url: string }[]) {
      const k = normalizeListingUrlKey(c.listing_url);
      if (k && isLotUrl(source, c.listing_url) && !byKey.has(k)) byKey.set(k, c);
    }
    const population = byKey.size;
    const picked = shuffle([...byKey.values()]).slice(0, sample * 2);

    // 2-3. read each capture, resolve the vehicle, compare
    const tallies = new Map<string, Tally>();
    const tally = (f: string) => {
      let t = tallies.get(f);
      if (!t) tallies.set(f, t = { raw: 0, model: 0, profile: 0, examples: [], pRatios: [], mRatios: [] });
      return t;
    };
    let n = 0;
    for (const c of picked) {
      if (n >= sample) break;
      const { data: snap } = await sb.from("listing_page_snapshots").select("html,markdown").eq("id", c.id).maybeSingle();
      const html = (snap as { html: string | null } | null)?.html;
      if (!html) continue; // capture body not retained inline: not a sample, not a drop
      n++;
      const raw: RawFields = readRaw(source, html, (snap as { markdown: string | null }).markdown);
      const vid = await resolveVehicleId(sb, source, c.listing_url);
      const link = tally("_linked");
      link.raw++;
      if (vid) { link.model++; link.profile++; } else if (link.examples.length < 3) link.examples.push({ snapshot_id: c.id, vehicle_id: null });
      const ctx = vid ? await modelFor(sb, vid) : null;
      for (const f of DEPTH_FIELDS) {
        const r = raw[f];
        if (!r) continue;
        const t = tally(f);
        t.raw++;
        const held = ctx ? modelHolds(f as DepthField, r, ctx) : { anywhere: false, profile: false };
        if (held.anywhere) t.model++;
        if (held.profile) t.profile++;
        if (held.profileRatio !== undefined) { t.pRatios.push(held.profileRatio); t.mRatios.push(held.modelRatio ?? 0); }
        if (!held.anywhere && t.examples.length < 3) t.examples.push({ snapshot_id: c.id, vehicle_id: vid });
      }
    }

    // 4. one row per field
    const runId = crypto.randomUUID();
    const rows = [...tallies.entries()].map(([field, t]) => ({
      run_id: runId, source, field, sample_n: n, raw_present: t.raw, model_present: t.model,
      profile_present: t.profile, population_n: population,
      window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(), examples: t.examples,
      detail: t.pRatios.length ? { held_length_over_raw_length: { profile_p50: p50(t.pRatios), model_p50: p50(t.mRatios), teaser_only_lots: t.pRatios.filter((r, i) => r < 0.5 && t.mRatios[i] >= 0.8).length, nothing_beyond_teaser_lots: t.mRatios.filter((r) => r < 0.5).length } } : {},
      probe_version: PROBE_VERSION,
    }));
    if (body.dry_run) return { run_id: null, source, sample_n: n, population, rows };
    if (rows.length) {
      const { error } = await sb.from("landing_depth_measurements").insert(rows);
      if (error) throw new Error(`insert: ${error.message}`);
    }
    return { run_id: runId, source, sample_n: n, population, rows };
}
