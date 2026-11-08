import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
import type { IntakeBudget } from "./ledger.ts";

export const PURPLEWAVE_METHOD = "purplewave_public_snapshot_v1";
// Publisher payment terms inspected 2026-11-08; this is house currency evidence, not an API currency field.
const CURRENCY_SOURCE = "https://www.purplewave.com/auction/legal/terms";
const PAGE_SIZE = 25;
const writeEpisode = vehicleEventWriterFor("poll-listing-feeds:purplewave");
type Row = Record<string, unknown>;
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 10_000_000_000
  ? new Date(v * 1000).toISOString() : null;

/** The publisher's passenger-vehicle category, not its general equipment inventory. */
export function purplewavePageUrl(page: number): string {
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw Error("invalid PurpleWave page");
  return `https://www.purplewave.com/v1/search/search?${new URLSearchParams({ searchType: "all", dateType: "upcoming",
    filters: "industry_category_id:277", page: String(page), perPage: String(PAGE_SIZE), showHalted: "false" })}`;
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
  return { raw: r, auction, item, key: `${auction}:${item}`, url, year, make, model, end, bid, count,
    title: [year || null, make, model].filter(Boolean).join(" ") || `PurpleWave ${item}`, readAt, bidAt: time(r.winning_bid_time),
    description: text(r.new_description), image: null,
    // Soft-close extension clocks can move. Only the publisher's terminal flags end a lot.
    closed: r.closed === 1 || r.auction_closed === 1 };
}

export function purplewaveObservation(lot: ReturnType<typeof purplewaveLot>, vehicleId?: string) {
  return { source_slug: "purplewave", kind: "listing", vehicle_id: vehicleId, observed_at: lot.readAt,
    source_url: lot.url, source_identifier: `${PURPLEWAVE_METHOD}:${lot.key}:${lot.readAt}`,
    extraction_method: PURPLEWAVE_METHOD, defer_analysis: true,
    content_text: lot.description || lot.title,
    structured_data: { capture_kind: "auction_state_snapshot", individual_bid: false, source_claims_only: true,
      auction_id: lot.auction, native_item_id: lot.item, current_bid: lot.bid, bid_count: lot.count,
      currency: "USD", currency_source: CURRENCY_SOURCE,
      auction_end_date: lot.end, latest_bid_at: lot.bidAt, source_event_time_status: "snapshot_not_event",
      source_payload: lot.raw },
    extraction_metadata: { clock_basis: "public_api_received_at", received_at: lot.readAt,
      coverage: "paged_passenger_vehicle_inventory; not complete bid history", paid_calls: 0 } };
}

export function purplewaveProjection(lot: ReturnType<typeof purplewaveLot>, row: any, observationId: string) {
  if (row?.platform_source !== "purplewave" || typeof row.listing_url !== "string"
    || row.listing_url.replace("https://purplewave.com/", "https://www.purplewave.com/").replace(/\/$/, "") !== lot.url
    || row.deleted_at != null || ["sold", "not_sold", "reserve_not_met", "cancelled", "withdrawn"].includes(row.sale_status)) return null;
  const prior = Date.parse(row.origin_metadata?.purplewave_observed_at ?? "");
  if (Number.isFinite(prior) && prior > Date.parse(lot.readAt)) return null;
  return { high_bid: lot.count > 0 ? Math.floor(lot.bid) : null, auction_end_date: lot.end,
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
    ...(lot.image ? { image_url: lot.image } : {}) } });
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
  const vehicle = await db.from("vehicles").select("id,platform_source,listing_url,sale_status,origin_metadata,deleted_at").eq("id", vehicleId).maybeSingle();
  if (vehicle.error || !vehicle.data) throw Error("PurpleWave vehicle ownership read failed");
  const patch = purplewaveProjection(lot, vehicle.data, observationId);
  if (patch) {
    let update = db.from("vehicles").update(patch).eq("id", vehicleId).eq("platform_source", "purplewave")
      .eq("listing_url", vehicle.data.listing_url).is("deleted_at", null);
    update = vehicle.data.origin_metadata == null ? update.is("origin_metadata", null) : update.eq("origin_metadata", JSON.stringify(vehicle.data.origin_metadata));
    const projection = await update.select("id");
    if (projection.error || projection.data?.length !== 1) throw Error("PurpleWave auction projection changed concurrently; retry");
  }
  return { vehicle_id: vehicleId, observation_id: observationId, episode_id: episode.id, created: identity.data.status === "created" };
}

/** Rotating bounded snapshots under the existing feed allocation; not a full-stream coverage claim. */
export async function pollPurplewave(db: any, feed: any, budget: IntakeBudget, allocation: number, fetcher = fetch) {
  const result = { feed: feed.display_name, source: "purplewave", items_found: 0, new_ingested: 0,
    snapshots_admitted: 0, unresolved: 0, error: null as string | null, coverage: "paged snapshots; individual bids and full inventory unverified" };
  const config = feed.search_criteria ?? {};
  let page = Number(config.native_page ?? 1), offset = Number(config.native_offset ?? 0);
  try {
    if (!feed.enabled || allocation <= 0 || budget.refusal("purplewave")) throw Error("PurpleWave intake held or allocation exhausted");
    const source = await db.from("observation_sources").select("species,supported_observations").eq("slug", "purplewave").maybeSingle();
    if (source.error || source.data?.species !== "timed_auction" || !source.data?.supported_observations?.includes("listing")) throw Error("PurpleWave source not registered");
    if (!Number.isInteger(offset) || offset < 0 || offset >= PAGE_SIZE) throw Error("invalid PurpleWave offset");
    const response = await fetcher(purplewavePageUrl(page), { signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "User-Agent": "NukeListingCollector/1.0 (+https://nuke.ag)" } }); // guardrail-allow: raw-fetch (public JSON API)
    if (!response.ok) throw Error(`PurpleWave HTTP ${response.status}; no fallback`);
    const raw = await response.json(), readAt = new Date().toISOString();
    if (!Array.isArray(raw) || raw.length > PAGE_SIZE) throw Error("PurpleWave response is not a bounded lot array");
    result.items_found = raw.length;
    // Validate the entire returned page before any write. No silent dropped source rows.
    const lots = raw.map(r => purplewaveLot(r, readAt));
    let attempts = 0;
    while (offset < lots.length && attempts < allocation) {
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
    if (offset >= lots.length) { page = raw.length < PAGE_SIZE ? 1 : page + 1; offset = 0; }
  } catch (e) { result.error = e instanceof Error ? e.message : String(e); }
  const write = await db.from("listing_feeds").update({ last_polled_at: new Date().toISOString(),
    last_poll_count: result.items_found, last_error: result.error,
    error_count: result.error ? (feed.error_count ?? 0) + 1 : 0,
    search_criteria: { ...config, native_page: page, native_offset: offset }, updated_at: new Date().toISOString() }).eq("id", feed.id);
  if (write.error) result.error = `PurpleWave progress write failed: ${write.error.message}`;
  return result;
}
