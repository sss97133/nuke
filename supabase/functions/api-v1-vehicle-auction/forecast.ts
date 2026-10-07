/**
 * api-v1-vehicle-auction / forecast: the route behind `nuke lot` (the CLI auction coach, case ledger 13.7 step 2).
 *
 *   GET /api-v1-vehicle-auction/forecast
 *       ?url=<Bring a Trailer lot URL>  |  &vehicle_id=<uuid>  |  &lot=<auction_events id>     exactly one
 *       &bid=<number>          the standing bid the lot page shows (omit when the lot has no bid)
 *       &bidders=<integer>     distinct bidders the page shows
 *       &at=<ISO 8601 + offset>        when the page's numbers were true (default: the server's clock now)
 *       &ends_at=<ISO 8601 + offset>   the close the PAGE shows, which already includes any soft-close extension
 *       &extensions=<integer>          how many bids have moved the close so far (omit when the caller cannot tell)
 *
 * It resolves the lot, calls public.live_lot_temperature_at (PR #771, EXECUTE for service_role only) with the function's
 * service_role client, and returns the reader's jsonb untouched beside the resolution path and the clocks.
 * auction_events.auction_end_date is the FINAL close after soft-close extensions, so the caller passes the close the page
 * shows; the stored one is returned for comparison and is never the clock of the last minutes.
 *
 * Auth and usage log are the function's own (authenticateRequest and logApiUsage from _shared/apiKeyAuth.ts); index.ts
 * runs them before this module is reached, so an anonymous caller never gets here. This route writes nothing itself.
 */

export const FORECAST_SEGMENT = "forecast";
export const READER = "live_lot_temperature_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The reader's own test of auction_events.source_url. */
const BAT_LOT_URL = /bringatrailer\.com\/listing\/[^/?#]+/;
/** BaT slugs are lowercase words and hyphens; a non-ASCII character is stored percent-encoded in lowercase (4x4%c2%b2). */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]|%[0-9a-f]{2}){0,200}$/;
/** A strict ISO 8601 instant with an offset: a local time with no offset is ambiguous, and this API grades by the clock. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** A caller whose clock runs ahead of the server's by more than this is refused: the time left would be wrong. */
export const MAX_AT_AHEAD_S = 120;

// deno-lint-ignore no-explicit-any
type Db = any;

export interface BatLotKey {
  /** public.normalize_listing_url_key of the lot URL: bringatrailer.com/listing/<slug> */
  key: string;
  slug: string;
  /** https://bringatrailer.com/listing/<slug>, the form auction_events.source_url holds for 99.9% of live lots */
  canonical: string;
  variants: [string, string];
}

/**
 * public.normalize_listing_url_key (supabase/migrations/20260112000002_external_listings_url_key_dedupe.sql), step for step:
 * lower(trim(url)), drop ?query and #hash, drop http(s)://, drop www., drop trailing slashes. SQL trim() removes spaces only.
 */
export function normalizeListingUrlKey(url: string | null | undefined): string | null {
  if (url == null) return null;
  const key = url.replace(/^ +| +$/g, "").toLowerCase()
    .replace(/[?#][\s\S]*$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
  return key === "" ? null : key;
}

/** The canonical key of a pasted Bring a Trailer lot URL, or null when the text is not one. */
export function batLotKey(input: string): BatLotKey | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 400) return null;
  let href: string;
  try {
    // The URL parser percent-encodes a pasted non-ASCII character the way the browser did when BaT stored the slug.
    href = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).href;
  } catch {
    return null;
  }
  const key = normalizeListingUrlKey(href);
  const m = key?.match(/^bringatrailer\.com\/listing\/([^/]+)$/);
  if (!key || !m || !SLUG_RE.test(m[1])) return null;
  const canonical = `https://bringatrailer.com/listing/${m[1]}`;
  return { key, slug: m[1], canonical, variants: [canonical, `${canonical}/`] };
}

export type Locator =
  | { by: "url"; lot: BatLotKey }
  | { by: "vehicle_id"; id: string }
  | { by: "lot"; id: string };

export interface ForecastInput {
  locator: Locator;
  bid: number | null;
  bidders: number | null;
  at: Date;
  atSource: "argument" | "server_now";
  endsAt: Date | null;
  extensions: number | null;
}

export type Parsed = { ok: true; input: ForecastInput } | { ok: false; error: string };

const present = (q: URLSearchParams, name: string): string | null => {
  const v = q.get(name);
  return v == null || v.trim() === "" ? null : v.trim();
};

function instant(raw: string, name: string): Date | string {
  if (!ISO_INSTANT_RE.test(raw)) return `${name} must be an ISO 8601 instant with an offset, e.g. 2026-10-07T15:56:00Z`;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : `${name} is not a valid instant`;
}

/** Everything the route accepts, validated and typed; nothing is guessed, and a malformed value is refused, not dropped. */
export function parseForecastQuery(q: URLSearchParams, now: Date): Parsed {
  const url = present(q, "url"), vehicleId = present(q, "vehicle_id"), lotId = present(q, "lot");
  const given = [url, vehicleId, lotId].filter((v) => v !== null).length;
  if (given !== 1) {
    return { ok: false, error: "give exactly one of url (a Bring a Trailer lot URL), vehicle_id (uuid) or lot (auction_events id, uuid)" };
  }
  let locator: Locator;
  if (url !== null) {
    const lot = batLotKey(url);
    if (!lot) return { ok: false, error: "url is not a Bring a Trailer lot URL (https://bringatrailer.com/listing/<slug>)" };
    locator = { by: "url", lot };
  } else if (vehicleId !== null) {
    if (!UUID_RE.test(vehicleId)) return { ok: false, error: "vehicle_id must be a uuid" };
    locator = { by: "vehicle_id", id: vehicleId.toLowerCase() };
  } else {
    if (!UUID_RE.test(lotId!)) return { ok: false, error: "lot must be a uuid (auction_events.id)" };
    locator = { by: "lot", id: lotId!.toLowerCase() };
  }

  let bid: number | null = null;
  const bidRaw = present(q, "bid");
  if (bidRaw !== null) {
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(bidRaw)) return { ok: false, error: "bid must be a plain number, e.g. 11250 or 11250.50" };
    bid = Number(bidRaw);
  }
  let bidders: number | null = null;
  const biddersRaw = present(q, "bidders");
  if (biddersRaw !== null) {
    if (!/^\d{1,6}$/.test(biddersRaw)) return { ok: false, error: "bidders must be a whole number" };
    bidders = Number.parseInt(biddersRaw, 10);
  }
  let extensions: number | null = null;
  const extRaw = present(q, "extensions");
  if (extRaw !== null) {
    if (!/^\d{1,3}$/.test(extRaw)) return { ok: false, error: "extensions must be a whole number" };
    extensions = Number.parseInt(extRaw, 10);
  }

  let at = now;
  let atSource: ForecastInput["atSource"] = "server_now";
  const atRaw = present(q, "at");
  if (atRaw !== null) {
    const v = instant(atRaw, "at");
    if (typeof v === "string") return { ok: false, error: v };
    if (v.getTime() - now.getTime() > MAX_AT_AHEAD_S * 1000) {
      return { ok: false, error: `at is ${Math.round((v.getTime() - now.getTime()) / 1000)} s ahead of the server's clock (limit ${MAX_AT_AHEAD_S} s): the caller's clock is wrong, and the time left would be too` };
    }
    at = v;
    atSource = "argument";
  }
  let endsAt: Date | null = null;
  const endsRaw = present(q, "ends_at");
  if (endsRaw !== null) {
    const v = instant(endsRaw, "ends_at");
    if (typeof v === "string") return { ok: false, error: v };
    endsAt = v;
  }
  return { ok: true, input: { locator, bid, bidders, at, atSource, endsAt, extensions } };
}

export interface LotRow {
  id: string;
  vehicle_id: string | null;
  source: string | null;
  source_url: string;
  outcome: string | null;
  auction_end_date: string | null;
  updated_at: string | null;
  high_bid: number | string | null;
  total_bids: number | null;
}

const LOT_COLUMNS = "id,vehicle_id,source,source_url,outcome,auction_end_date,updated_at,high_bid,total_bids";
const BAT_SOURCES = ["bat", "bringatrailer"];

const isBatLot = (r: LotRow | null | undefined): r is LotRow => !!r && typeof r.source_url === "string" && BAT_LOT_URL.test(r.source_url);
const slugOf = (url: string): string | null => url.match(/bringatrailer\.com\/listing\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null;
const ms = (v: string | null): number => {
  const t = Date.parse(v ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};

export interface Resolution {
  by: Locator["by"];
  /** which relations answered, in order */
  path: string;
  /** the canonical lot key (url lookups only) */
  key: string | null;
  auction_event_id: string;
  vehicle_id: string | null;
  source_url: string;
  /** how many lot rows matched before one was chosen */
  candidates: number;
  rule: string;
}

export type Resolved =
  | { ok: true; resolution: Resolution; lot: LotRow }
  | { ok: false; status: 404 | 502; reason: string; tried: string[] };

const failed = (reason: string, tried: string[]): Resolved => ({ ok: false, status: 502, reason, tried });
const notFound = (reason: string, tried: string[]): Resolved => ({ ok: false, status: 404, reason, tried });

/**
 * lot -> auction_events by id. vehicle_id -> the vehicle's BaT lots, newest close first. url -> the canonical key, found through
 * vehicles.bat_auction_url (indexed; it equals the lot URL on all 1,300 live lots, read 2026-10-07) and then the vehicle's lots,
 * else, only on a miss, auction_events.source_url itself (an unindexed scan, about 0.35 s on 368k rows, because the slug
 * expression index idx_auction_events_bat_lot_slug cannot be reached through PostgREST). A caller that polls resolves once and
 * passes lot=<auction_event_id> afterwards.
 */
export async function resolveLot(db: Db, locator: Locator): Promise<Resolved> {
  const tried: string[] = [];
  if (locator.by === "lot") {
    tried.push("auction_events.id");
    const { data, error } = await db.from("auction_events").select(LOT_COLUMNS).eq("id", locator.id).limit(1);
    if (error) return failed("the lot lookup failed", tried);
    const lot = (data as LotRow[] | null)?.find(isBatLot);
    if (!lot) return notFound("no Bring a Trailer lot has this auction_events id", tried);
    return { ok: true, lot, resolution: describe(locator, "auction_events.id", null, lot, 1, "the id given") };
  }

  if (locator.by === "vehicle_id") {
    tried.push("auction_events.vehicle_id");
    const { data, error } = await db.from("auction_events").select(LOT_COLUMNS)
      .eq("vehicle_id", locator.id).in("source", BAT_SOURCES)
      .order("auction_end_date", { ascending: false, nullsFirst: false }).limit(20);
    if (error) return failed("the lot lookup failed", tried);
    const lots = ((data as LotRow[] | null) ?? []).filter(isBatLot);
    if (lots.length === 0) return notFound("this vehicle has no Bring a Trailer lot", tried);
    const lot = [...lots].sort((a, b) => ms(b.auction_end_date) - ms(a.auction_end_date) || ms(b.updated_at) - ms(a.updated_at))[0];
    return { ok: true, lot, resolution: describe(locator, "auction_events.vehicle_id", null, lot, lots.length, "the vehicle's newest Bring a Trailer lot by close") };
  }

  const { lot: k } = locator;
  tried.push("vehicles.bat_auction_url");
  const veh = await db.from("vehicles").select("id").in("bat_auction_url", k.variants).limit(5);
  if (veh.error) return failed("the vehicle lookup failed", tried);
  const vehicleIds = ((veh.data as { id: string }[] | null) ?? []).map((v) => v.id);
  let matches: LotRow[] = [];
  let path = "vehicles.bat_auction_url -> auction_events.vehicle_id";
  if (vehicleIds.length > 0) {
    tried.push("auction_events.vehicle_id");
    const ev = await db.from("auction_events").select(LOT_COLUMNS).in("vehicle_id", vehicleIds).in("source", BAT_SOURCES).limit(50);
    if (ev.error) return failed("the lot lookup failed", tried);
    matches = ((ev.data as LotRow[] | null) ?? []).filter((r) => isBatLot(r) && slugOf(r.source_url) === k.slug);
  }
  if (matches.length === 0) {
    tried.push("auction_events.source_url");
    path = "auction_events.source_url";
    const ev = await db.from("auction_events").select(LOT_COLUMNS).in("source_url", k.variants).limit(5);
    if (ev.error) return failed("the lot lookup failed", tried);
    matches = ((ev.data as LotRow[] | null) ?? []).filter(isBatLot);
  }
  if (matches.length === 0) return notFound(`Nuke holds no lot for ${k.key}`, tried);
  const exact = (r: LotRow) => (k.variants.includes(r.source_url) ? 1 : 0);
  const lot = [...matches].sort((a, b) => exact(b) - exact(a) || ms(b.updated_at) - ms(a.updated_at))[0];
  return { ok: true, lot, resolution: describe(locator, path, k.key, lot, matches.length, "the row whose source_url is the canonical URL, then the most recently read") };
}

function describe(locator: Locator, path: string, key: string | null, lot: LotRow, candidates: number, rule: string): Resolution {
  return { by: locator.by, path, key, auction_event_id: lot.id, vehicle_id: lot.vehicle_id, source_url: lot.source_url, candidates, rule };
}

export interface ForecastContext {
  /** CORS headers plus the auth result's rate limit headers */
  headers: Record<string, string>;
  /** the usage log write (apiKeyAuth.logApiUsage), called once with the lot's auction_events id after a successful read */
  logUsage: (resourceId: string) => Promise<void> | void;
  now?: () => Date;
}

const send = (ctx: ForecastContext, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    // a live forecast is never a cached object
    headers: { ...ctx.headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function handleForecast(req: Request, db: Db, ctx: ForecastContext): Promise<Response> {
  const now = (ctx.now ?? (() => new Date()))();
  const parsed = parseForecastQuery(new URL(req.url).searchParams, now);
  if (!parsed.ok) return send(ctx, { error: parsed.error }, 400);
  const { input } = parsed;

  const found = await resolveLot(db, input.locator);
  if (!found.ok) {
    return send(ctx, { error: found.reason, resolution: { by: input.locator.by, tried: found.tried } }, found.status);
  }

  const started = Date.now();
  const { data, error } = await db.rpc(READER, {
    p_auction_event_id: found.lot.id,
    p_bid: input.bid,
    p_bidders: input.bidders,
    p_at: input.at.toISOString(),
    p_ends_at: input.endsAt ? input.endsAt.toISOString() : null,
    p_extensions: input.extensions,
  });
  const elapsedMs = Date.now() - started;
  if (error) {
    const code = String(error.code ?? "");
    if (code === "PGRST202" || code === "42883") {
      return send(ctx, { error: "the forecast reader is not deployed on this database", reader: READER }, 503);
    }
    if (code === "57014") {
      return send(ctx, { error: "the forecast reader timed out; a cohort that has not been read recently can take several seconds, retry", reader: READER }, 504);
    }
    console.error("[api-v1-vehicle-auction/forecast] reader error:", code, error.message);
    return send(ctx, { error: "the forecast reader failed", reader: READER, code: code || null }, 502);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return send(ctx, { error: "the forecast reader returned no result", reader: READER }, 502);
  }
  // deno-lint-ignore no-explicit-any
  const forecast = data as Record<string, any>;
  if (forecast.status === "unknown_lot") {
    return send(ctx, { error: forecast.reason ?? "the reader does not know this lot", resolution: found.resolution, forecast }, 404);
  }

  await ctx.logUsage(found.lot.id);
  return send(ctx, {
    data: {
      forecast,
      resolution: found.resolution,
      clocks: {
        server_now: now.toISOString(),
        at: input.at.toISOString(),
        at_source: input.atSource,
        at_minus_server_now_s: round1((input.at.getTime() - now.getTime()) / 1000),
        ends_at_argument: input.endsAt ? input.endsAt.toISOString() : null,
        extensions_argument: input.extensions,
        // auction_events keeps only the FINAL close, so it is not the clock of the last minutes; it is returned for comparison
        stored_close: found.lot.auction_end_date,
        stored_lot_read_at: found.lot.updated_at,
        stored_outcome: found.lot.outcome,
        stored_high_bid: found.lot.high_bid == null ? null : Number(found.lot.high_bid),
        stored_total_bids: found.lot.total_bids,
      },
      reader: { name: READER, elapsed_ms: elapsedMs },
    },
  });
}
