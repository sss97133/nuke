import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
import type { IntakeBudget } from "./ledger.ts";
import { purplewaveDescription } from "./purplewaveDescription.ts";
import { retainFetchedCapture } from "../_shared/archiveFetch.ts";

export const PURPLEWAVE_METHOD = "purplewave_public_snapshot_v1";
// Publisher payment terms inspected 2026-11-08; this is house currency evidence, not an API currency field.
const CURRENCY_SOURCE = "https://www.purplewave.com/auction/legal/terms";
const PAGE_SIZE = 25;
// A lot invokes identity intake plus observation intake (and their nested calls).
// The first live pass hit the platform trace limit at attempt18. Leave headroom
// under that shared call budget; the existing cursor resumes the same page.
const MAX_NATIVE_LOTS = 8;
const writeEpisode = vehicleEventWriterFor("poll-listing-feeds:purplewave");
type Row = Record<string, unknown>;
type PageCapture = { id: string; sha256: string; read_at: string; page: number };
const digest = async (body: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("");
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 10_000_000_000
  ? new Date(v * 1000).toISOString() : null;

/** The publisher's passenger-vehicle category, not its general equipment inventory. */
export function purplewavePageUrl(page: number): string {
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw Error("invalid PurpleWave page");
  const params = new URLSearchParams({ searchType: "all", dateType: "upcoming",
    filters: "industry_category_id:277", page: String(page), perPage: String(PAGE_SIZE), showHalted: "false" });
  params.sort();
  return `https://www.purplewave.com/v1/search/search?${params}`;
}

/** Resolve publisher-supplied filenames against its supplied photo directory. */
export function purplewaveImages(r: Row, item: string): string[] {
  const base = text(r.image_url) ?? text(r.securebaseurl);
  if (!base) return [];
  let directory: URL;
  try { directory = new URL(base); } catch { return []; }
  if (directory.protocol !== "https:" || directory.hostname !== "d323w7klwy72q3.cloudfront.net"
    || directory.port || directory.username || directory.password || directory.search || directory.hash
    || !/^\/i\/a\/\d{4}\/[A-Za-z0-9_-]+\/?$/.test(directory.pathname)) return [];
  const files = Array.isArray(r.image_files) ? r.image_files
    : typeof r.images === "string" ? r.images.trim().split(/\s+/) : [];
  const primary = text(r.image);
  const names = primary ? [primary, ...files] : files;
  const ownPhoto = new RegExp(`^${item}[A-Z]*\\.(?:JPG|JPEG|PNG)$`, "i");
  return [...new Set(names.filter((name): name is string =>
    typeof name === "string" && ownPhoto.test(name)))].map(name => `${base.replace(/\/$/, "")}/${name}`);
}

export function purplewaveLot(raw: unknown, readAt: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("invalid PurpleWave lot");
  const r = raw as Row, auction = text(r.auction), item = text(r.item);
  const year = number(r.year), make = text(r.make), model = text(r.model), end = time(r.endtime);
  const bid = number(r.current_bid), count = number(r.bid_count);
  if (!auction || !/^\d{6}[A-Z]?$/.test(auction) || !item || !/^[A-Z]{2}\d{4}$/.test(item)
    || (year !== null && year !== 0 && (!Number.isInteger(year) || year < 1885 || year > new Date(readAt).getUTCFullYear() + 2))
    || !end || !Number.isFinite(Date.parse(readAt)) || bid === null || bid < 0 || count === null || !Number.isInteger(count) || count < 0
    || ![0, 1].includes(r.closed as number) || ![0, 1].includes(r.auction_closed as number) || r.halted !== 0
    || r.industry_category_id !== 277) throw Error("PurpleWave lot identity/state incomplete");
  const url = `https://www.purplewave.com/auction/${auction}/item/${item}`;
  const images = purplewaveImages(r, item);
  return { raw: r, auction, item, key: `${auction}:${item}`, url, year, make, model, end, bid, count, pageCapture: null as PageCapture | null,
    title: [year || null, make, model].filter(Boolean).join(" ") || `PurpleWave ${item}`, readAt, bidAt: time(r.winning_bid_time),
    ...purplewaveDescription(r.new_description, r.vin), image: images[0] ?? null, images,
    // Soft-close extension clocks can move. Only the publisher's terminal flags end a lot.
    closed: r.closed === 1 || r.auction_closed === 1 };
}

export function purplewaveObservation(lot: ReturnType<typeof purplewaveLot>, vehicleId?: string) {
  return { source_slug: "purplewave", kind: "listing", vehicle_id: vehicleId, observed_at: lot.readAt,
    source_url: lot.url, source_identifier: `${PURPLEWAVE_METHOD}:${lot.key}:${lot.readAt}`,
    extraction_method: PURPLEWAVE_METHOD, defer_analysis: true,
    ...(lot.pageCapture ? { raw_source_ref: `listing_page_snapshots:${lot.pageCapture.id}` } : {}),
    content_text: lot.description || lot.title,
    structured_data: { capture_kind: "auction_state_snapshot", individual_bid: false, source_claims_only: true,
      auction_id: lot.auction, native_item_id: lot.item, current_bid: lot.bid, bid_count: lot.count,
      currency: "USD", currency_source: CURRENCY_SOURCE,
      vin: lot.vin, vin_evidence: lot.vin_evidence,
      auction_end_date: lot.end, latest_bid_at: lot.bidAt, source_event_time_status: "snapshot_not_event",
      source_payload: lot.raw },
    extraction_metadata: { clock_basis: "public_api_received_at", received_at: lot.readAt, source_page_capture: lot.pageCapture,
      coverage: "paged_passenger_vehicle_inventory; not complete bid history", paid_calls: 0 } };
}

export function purplewaveProjection(lot: ReturnType<typeof purplewaveLot>, row: any, observationId: string) {
  if (row?.platform_source !== "purplewave" || typeof row.listing_url !== "string"
    || row.listing_url.replace("https://purplewave.com/", "https://www.purplewave.com/").replace(/\/$/, "") !== lot.url
    || row.deleted_at != null || ["sold", "not_sold", "no_sale", "reserve_not_met", "cancelled", "withdrawn"].includes(row.sale_status)) return null;
  const prior = Date.parse(row.origin_metadata?.purplewave_observed_at ?? "");
  if (Number.isFinite(prior) && prior > Date.parse(lot.readAt)) return null;
  return { high_bid: lot.count > 0 ? Math.floor(lot.bid) : null, auction_end_date: lot.end,
    ...(lot.description && row.description === lot.raw.new_description && row.description !== lot.description
      ? { description: lot.description } : {}),
    auction_status: lot.closed ? "ended" : "active", sale_status: lot.closed ? "ended" : "auction_live",
    origin_metadata: { ...(row.origin_metadata ?? {}), purplewave_observed_at: lot.readAt,
      purplewave_observation_id: observationId, current_bid: lot.bid, bid_count: lot.count, currency: "USD", currency_source: CURRENCY_SOURCE }, updated_at: lot.readAt };
}

/** Apply the same invocation deadline to every query, including the shared episode writer. */
function boundedDb(db: any, signal: AbortSignal) {
  return { functions: { invoke: (name: string, options: any) => db.functions.invoke(name, { ...options, signal }) },
    from: (table: string) => new Proxy(db.from(table), { get(target, name) {
      const member = target[name];
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => { const next = member.apply(target, args); return next?.abortSignal ? next.abortSignal(signal) : next; };
    } }) };
}

/** Reuse the intake's identity resolver; never submit the current bid as an asking/sale price. */
export async function landPurplewaveLot(client: any, lot: ReturnType<typeof purplewaveLot>, signal = AbortSignal.timeout(30_000)) {
  signal.throwIfAborted();
  const db = boundedDb(client, signal);
  if (!lot.year || !lot.make || !lot.model) {
    // A source with an unknown year/make stays an attributed unresolved blip.
    // Do not invent identity from an equipment title or use a fuzzy YMM match.
    const pending = await db.functions.invoke("ingest-observation", { body: purplewaveObservation(lot) });
    if (pending.error || pending.data?.success !== true || !pending.data.observation_id) throw Error("PurpleWave unresolved snapshot admission failed");
    return { vehicle_id: null, observation_id: pending.data.observation_id, episode_id: null, created: false };
  }
  const identity = await db.functions.invoke("ingest", { body: { url: lot.url, enrich: false,
    year: lot.year, make: lot.make, model: lot.model, description: lot.description || lot.title,
    ...(lot.vin ? { vin: lot.vin } : {}),
    ...(lot.image ? { image_url: lot.image, image_urls: lot.images } : {}) } });
  const vehicleId = identity.data?.vehicle_id;
  if (identity.error || !vehicleId || !["created", "matched", "updated", "duplicate"].includes(identity.data?.status))
    throw Error(`PurpleWave identity unresolved: ${identity.data?.reason ?? identity.error?.message ?? identity.data?.status}`);
  const payload = purplewaveObservation(lot, vehicleId);
  const admitted = await db.functions.invoke("ingest-observation", { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data.observation_id) throw Error("PurpleWave snapshot admission failed");
  const observationId = admitted.data.observation_id;
  const read = await db.from("vehicle_observations").select("id,vehicle_id,source_url,structured_data")
    .eq("id", observationId).eq("observed_at", lot.readAt).eq("is_superseded", false).maybeSingle();
  if (read.error || read.data?.vehicle_id !== vehicleId || read.data?.source_url !== lot.url
    || read.data?.structured_data?.current_bid !== lot.bid) throw Error("PurpleWave snapshot readback failed");
  const episode = await writeEpisode(db, { vehicle_id: vehicleId, source_platform: "purplewave",
    source_listing_id: lot.key, source_url: lot.url, event_type: "auction", event_status: lot.closed ? "ended" : "active",
    current_price: lot.count > 0 ? lot.bid : null, high_bid: lot.count > 0 ? lot.bid : null, bid_count: lot.count,
    currency_code: "USD", currency_source: CURRENCY_SOURCE,
    metadata: { source_observation_id: observationId, source_observed_at: lot.readAt,
      auction_end_date: lot.end, latest_bid_at: lot.bidAt, currency: "USD", currency_source: CURRENCY_SOURCE,
      capture_kind: "auction_state_snapshot", sale_outcome: "unknown" },
  }, { sourceObservedAt: lot.readAt });
  if (!("id" in episode) || !episode.id) throw Error("PurpleWave episode projection failed");
  // Mutable discovery projection, only after the attributed observation and episode were acknowledged.
  const vehicle = await db.from("vehicles").select("id,platform_source,listing_url,sale_status,origin_metadata,deleted_at,description").eq("id", vehicleId).maybeSingle();
  if (vehicle.error || !vehicle.data) throw Error("PurpleWave vehicle ownership read failed");
  const patch = purplewaveProjection(lot, vehicle.data, observationId);
  if (patch) {
    let update = db.from("vehicles").update(patch).eq("id", vehicleId).eq("platform_source", "purplewave")
      .eq("listing_url", vehicle.data.listing_url).is("deleted_at", null);
    update = vehicle.data.sale_status == null ? update.is("sale_status", null) : update.eq("sale_status", vehicle.data.sale_status);
    if (patch.description) update = update.eq("description", vehicle.data.description);
    update = vehicle.data.origin_metadata == null ? update.is("origin_metadata", null) : update.eq("origin_metadata", JSON.stringify(vehicle.data.origin_metadata));
    const projection = await update.select("id");
    if (projection.error || projection.data?.length !== 1) throw Error("PurpleWave auction projection changed concurrently; retry");
  }
  return { vehicle_id: vehicleId, observation_id: observationId, episode_id: episode.id, created: identity.data.status === "created" };
}

/** Rotating bounded snapshots under the existing feed allocation; not a full-stream coverage claim. */
export async function pollPurplewave(db: any, feed: any, budget: IntakeBudget, allocation: number, fetcher = fetch) {
  const result = { feed: feed.display_name, source: "purplewave", items_found: 0, new_ingested: 0,
    snapshots_admitted: 0, unresolved: 0, native_limit: MAX_NATIVE_LOTS, error: null as string | null, coverage: "paged snapshots; individual bids and full inventory unverified" };
  let config = feed.search_criteria ?? {};
  let page = Number(config.native_page ?? 1), offset = Number(config.native_offset ?? 0);
  let capture: PageCapture | null = config.native_capture ?? null;
  const checkpoint = async (next: Row, fields: Row = {}) => {
    const progressDb = boundedDb(db, AbortSignal.timeout(5000));
    let query = progressDb.from("listing_feeds").update({ ...fields, search_criteria: next, updated_at: new Date().toISOString() }).eq("id", feed.id);
    query = feed.search_criteria == null && Object.keys(config).length === 0
      ? query.is("search_criteria", null) : query.eq("search_criteria", JSON.stringify(config));
    const saved = await query.select("id");
    if (saved.error || saved.data?.length !== 1) throw Error("PurpleWave progress changed concurrently or could not be saved");
    config = next;
  };
  try {
    if (!feed.enabled || allocation <= 0 || budget.refusal("purplewave")) throw Error("PurpleWave intake held or allocation exhausted");
    const preparationSignal = AbortSignal.timeout(15_000);
    const pageDb = { ...boundedDb(db, preparationSignal),
      storage: { from: () => ({ download: async () => ({ data: null, error: "page capture must retain inline JSON" }) }) } };
    const source = await pageDb.from("observation_sources").select("species,supported_observations").eq("slug", "purplewave").maybeSingle();
    if (source.error || source.data?.species !== "timed_auction" || !source.data?.supported_observations?.includes("listing")) throw Error("PurpleWave source not registered");
    if (!Number.isInteger(offset) || offset < 0 || offset >= PAGE_SIZE) throw Error("invalid PurpleWave offset");
    const url = purplewavePageUrl(page);
    let raw: unknown, readAt: string;
    if (capture) {
      if (capture.page !== page || !/^[0-9a-f-]{36}$/i.test(capture.id) || !/^[0-9a-f]{64}$/.test(capture.sha256)
        || !Number.isFinite(Date.parse(capture.read_at))) throw Error("invalid PurpleWave page receipt");
      const held = await pageDb.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html,html_sha256,success,http_status").eq("id", capture.id).maybeSingle();
      const row = held.data;
      if (held.error || !row || row.platform !== "purplewave" || row.listing_url !== url || row.success !== true || row.http_status !== 200
        || Date.parse(row.fetched_at) !== Date.parse(capture.read_at) || row.html_sha256 !== capture.sha256
        || typeof row.html !== "string" || new TextEncoder().encode(row.html).length > 2_097_152
        || await digest(row.html) !== capture.sha256) throw Error("PurpleWave retained page verification failed");
      const body = JSON.parse(row.html);
      if (body.page !== page || body.read_at !== capture.read_at) throw Error("PurpleWave retained page attribution differs");
      raw = body.lots; readAt = capture.read_at;
    } else {
      const response = await fetcher(url, { signal: preparationSignal,
        headers: { Accept: "application/json", "User-Agent": "NukeListingCollector/1.0 (+https://nuke.ag)" } }); // guardrail-allow: raw-fetch (public JSON API)
      if (!response.ok) throw Error(`PurpleWave HTTP ${response.status}; no fallback`);
      raw = await response.json(); readAt = new Date().toISOString();
    }
    if (!Array.isArray(raw) || raw.length > PAGE_SIZE) throw Error("PurpleWave response is not a bounded lot array");
    if (capture && offset > raw.length) throw Error("PurpleWave offset exceeds retained page");
    result.items_found = raw.length;
    // Validate the entire returned page before any write. No silent dropped source rows.
    const lots = raw.map(r => purplewaveLot(r, readAt));
    if (new Set(lots.map(lot => lot.key)).size !== lots.length) throw Error("PurpleWave page has duplicate native lots");
    if (!capture) {
      const retained = await retainFetchedCapture(pageDb, { platform: "purplewave", url,
        html: JSON.stringify({ page, read_at: readAt, lots: raw }), httpStatus: 200, fetchedAt: readAt,
        metadata: { capture_kind: "purplewave_inventory_page", representation: "native_json_with_capture_clock" } });
      if ("reason" in retained) throw Error(`PurpleWave page retention failed: ${retained.reason}`);
      capture = { id: retained.snapshot_id, sha256: retained.html_sha256, read_at: readAt, page };
      preparationSignal.throwIfAborted();
      // A legacy offset has no fixed page membership. Restart that page once;
      // never apply an old offset to a newly reordered publisher response.
      offset = 0;
      await checkpoint({ ...config, native_page: page, native_offset: offset, native_capture: capture });
    }
    for (const lot of lots) lot.pageCapture = capture;
    let attempts = 0;
    while (offset < lots.length && attempts < Math.min(allocation, MAX_NATIVE_LOTS)) {
      const grant = budget.reserve("purplewave");
      if (!grant) break;
      attempts++;
      const started = Date.now();
      let landed: Awaited<ReturnType<typeof landPurplewaveLot>>;
      try {
        landed = await landPurplewaveLot(db, lots[offset], AbortSignal.timeout(grant.timeout_ms));
        budget.record("purplewave", Date.now() - started, { status: landed.created ? "created" : "matched", vehicle_id: landed.vehicle_id ?? undefined });
      } catch (error) {
        budget.record("purplewave", Date.now() - started, { status: "error", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      if (!landed.vehicle_id) result.unresolved++;
      if (landed.created) result.new_ingested++;
      result.snapshots_admitted++;
      offset++;
    }
    if (offset >= lots.length) { page = raw.length < PAGE_SIZE ? 1 : page + 1; offset = 0; capture = null; }
  } catch (e) { result.error = e instanceof Error ? e.message : String(e); }
  try { await checkpoint({ ...config, native_page: page, native_offset: offset, native_capture: capture }, { last_polled_at: new Date().toISOString(),
    last_poll_count: result.items_found, last_error: result.error,
    error_count: result.error ? (feed.error_count ?? 0) + 1 : 0 }); }
  catch (e) { result.error = e instanceof Error ? e.message : String(e); }
  return result;
}
