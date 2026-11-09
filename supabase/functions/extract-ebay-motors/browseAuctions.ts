/**
 * Open eBay Motors auctions -> the live board (market_pulse_live_houses, house 'ebay-motors').
 *
 * One Browse search page holds 200 auction summaries with currentBidPrice, bidCount and itemEndDate (field names read
 * off a production response 2026-10-20), so a lot's live state needs no getItem. A run reads the open auction-format
 * listings of category 6001, ending soonest first (filter buyingOptions:{AUCTION}; a FIXED_PRICE+AUCTION lot is an
 * auction with a Buy It Now beside the bid), then:
 *   held     a lot whose own vehicles row we hold (listing_url = the item URL, platform_source 'ebay-motors') gets its live
 *            state through upsert_live_auction_vehicles, the writer the other live houses use: sale_status 'auction_live',
 *            auction_status 'active', auction_end_date = itemEndDate, high_bid = currentBidPrice when bidCount > 0 (with no
 *            bid, currentBidPrice is the opening price and high_bid stays empty), origin_metadata.currency and bid_count
 *            merged into the row's own metadata. Only rows whose value changed are sent. A lot linked to a vehicle another
 *            source holds (by VIN) is never written here: that row is the other house's.
 *   unheld   lands through landItem (the sweep's path: snapshot, ingest, observation, episode) within the run's call cap,
 *            vintage (1930-2005 by title year) first, then ending soonest; the report says how many are left.
 *   ended    only after a complete pass (every page of the open list read): a held auction_live lot absent from it and
 *            past its end becomes 'ended' through end_live_auctions_absent, and its listing episode 'ended' through
 *            writeVehicleEventByKey. No outcome is written: the Browse API does not say whether an ended auction sold
 *            (Marketplace Insights is not granted), so the result stays unknown.
 *
 * Budget: max_pages searches + max_items getItem calls per run; at most daily_cap Browse calls a Pacific day, counted
 * before each call in rate_limits (key ebay-auctions:browse:<Pacific date>, the parts finder's ledger pattern); never
 * under `floor` calls left today by eBay's own counter. The schedule (migration *_ebay_motors_auctions_cron.sql) spends
 * about 370 a day of the app's 5,000.
 */
import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
const writeVehicleEventByKey = vehicleEventWriterFor("extract-ebay-motors:browse-auctions");
import { BrowseClient, ItemGone, QuotaExceeded, CATEGORY_CARS_TRUCKS, type SearchSummary } from "./browseApi.ts";
import { listingKey, yearOf, type EbayItem } from "./browseMap.ts";
import { emptyReport, heldKeys, landItem, PLATFORM, pool, type Report } from "./browseSweep.ts";
import { admitAuctionSnapshot, snapshotFields, type SnapshotWriter, type SnapshotReceipt } from "./auctionSnapshot.ts";
import { quotaDay } from "./partsFinder.ts";
import { auctionReplayStore, closingFirst, type AuctionRead, type ReplayCandidate, type ReplayEntry, type ReplayStore } from "./auctionReplay.ts";

/** Counts one Browse call before it is made; returns why not when the day's cap is used or the ledger cannot be written. */
export interface CallLedger { take(): Promise<string | null> }
export function auctionLedger(supabase: any, cap: number, now = new Date(), name = "ebay-auctions"): CallLedger {
  const key = `${name}:browse:${quotaDay(now)}`;   // ebay-auctions, ebay-bulk (browseBulk.ts): one day's counter per action
  return {
    async take() {
      const { data, error } = await supabase.rpc("rate_limit_increment", {
        p_key: key, p_window_start: now.toISOString(), p_expires_at: new Date(now.getTime() + 26 * 3_600_000).toISOString(),
      });
      if (error || typeof data !== "number") return `ledger: the ${name} call ledger could not be written, so no eBay call was made`;
      if (data > cap) return `daily cap: the ${cap} Browse calls the ${name} action may spend today are used (reset at midnight Pacific)`;
      return null;
    },
  };
}

export const HOUSE = "ebay-motors";                 // vehicles.platform_source and live_board_houses.house
export const AUCTION_FILTER = "buyingOptions:{AUCTION}";
const PAGE = 200;
const MAX_OFFSET = 10_000;                          // Browse refuses offset + limit beyond 10,000
const HORIZON_MS = 14 * 86_400_000;                 // no eBay auction runs past 10 days; a later end is a feed fault
const TERMINAL = new Set(["sold", "not_sold", "unsold", "bid_to", "reserve_not_met", "cancelled", "withdrawn"]);   // a result on record is not re-lived
const VINTAGE = { from: 1930, to: 2005 };           // the sweep's tiers

export interface AuctionOptions {
  replayStore?: ReplayStore; // dependency seam; production uses retained pages and owned system_state
  snapshotWriter?: SnapshotWriter; // dependency seam; production uses canonical admission
  maxSnapshots?: number;    // bounded internal admissions, default 20; no additional eBay calls
  maxPages?: number;       // search pages this run; a full pass needs ceil(total / 200)
  maxItems?: number;       // getItem landings of unheld lots this run
  maxCalls?: number;       // Browse calls this run (searches + getItem); default maxPages + maxItems
  dailyCap?: number;       // Browse calls this action may spend in a Pacific day (rate_limits ledger)
  ledger?: CallLedger;     // tests pass one; default the rate_limits ledger
  floor?: number;          // calls left today (eBay's counter) this run never goes under
  blindCap?: number;       // calls allowed when eBay does not report what is left
  maxEnded?: number;       // listing episodes ended per complete pass
  minMinutesLeft?: number; // an unheld lot ending sooner is not worth a getItem
  dryRun?: boolean;        // read and classify only: no getItem, no writes
  now?: () => number;
}

export interface AuctionCounts {
  open_total: number | null; pages_read: number; complete: boolean; seen: number; bad_end: number; with_bids: number; ending_24h: number;
  held_rows: number; held_elsewhere: number; held_terminal: number; written_live: number; unchanged: number;
  unheld: { vintage: number; other: number }; land_attempts: number; landed_live: number; left: { vintage: number; other: number };
  snapshots_admitted: number; snapshots_deferred: number; written_episodes: number;
  replay: { queued: number; pending: number; admitted: number; acknowledged: number; overflow: number; retention_failed: number; obsolete: number; terminal_or_expired: number; identity_refused: number };
  ended_vehicles: number; ended_episodes: number; episodes_past_end: number; browse_calls: number;
}
export interface AuctionReport extends Report { auctions: AuctionCounts }

interface VehicleRow {
  id: string; listing_url: string; platform_source: string | null; sale_status: string | null; auction_status: string | null;
  high_bid: number | null; auction_end_date: string | null; origin_metadata: Record<string, unknown> | null; title: string | null;
  year: number | null; make: string | null; model: string | null;
}

/** The two spellings a held row's listing_url can carry (ingest stores the bare host). */
export const itemUrls = (key: string) => [`https://ebay.com/itm/${key}`, `https://www.ebay.com/itm/${key}`];
const keyOfUrl = (u: string) => u.match(/\/itm\/(\d+)/)?.[1] ?? null;

/** The live state a summary (or a getItem body) states. high_bid only when someone has bid. */
export function liveState(s: EbayItem) {
  const ends = s.itemEndDate && Number.isFinite(Date.parse(s.itemEndDate)) ? new Date(s.itemEndDate).toISOString() : null;
  const bidCount = s.bidCount != null && Number.isInteger(Number(s.bidCount)) && Number(s.bidCount) >= 0 ? Number(s.bidCount) : null;
  const v = Number(s.currentBidPrice?.value);
  const highBid = (bidCount ?? 0) > 0 && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;   // vehicles.high_bid is whole dollars; never rounded up
  return {
    endsAt: ends, highBid, bidCount, currency: s.currentBidPrice?.currency ?? s.price?.currency ?? null,
    currentBid: s.currentBidPrice?.value ?? null,
    buyItNow: s.buyingOptions?.includes("FIXED_PRICE") ? s.price?.value ?? null : null,
  };
}

/** The upsert_live_auction_vehicles row for a held vehicle, or null when nothing the writer compares has changed. */
export function liveRow(v: VehicleRow, s: EbayItem, nowIso: string): Record<string, unknown> | null {
  const st = liveState(s);
  if (!st.endsAt) return null;
  const meta = v.origin_metadata ?? {};
  const fields = snapshotFields(s, nowIso);
  const sameMetadata = ["bid_count", "currency", "current_bid", "current_bid_kind", "buy_it_now"].every(k => meta[k] === (fields as any)[k])
    && JSON.stringify(meta.buying_options ?? []) === JSON.stringify(fields.buying_options)
    && typeof meta.auction_observation_id === "string";
  const same = sameMetadata && v.sale_status === "auction_live" && v.auction_status === "active"
    && (v.high_bid ?? null) === st.highBid
    && v.auction_end_date != null && Date.parse(v.auction_end_date) === Date.parse(st.endsAt);
  if (same) return null;
  return {
    listing_url: v.listing_url,                       // the row's own spelling: the upsert updates it, never inserts
    title: v.title ?? s.title ?? null, year: v.year, make: v.make, model: v.model,
    auction_status: "active", sale_status: "auction_live", auction_end_date: st.endsAt,
    sale_price: st.highBid,                           // the payload's name for the current bid; the writer puts it in high_bid
    platform_source: HOUSE,
    origin_metadata: {
      ...(v.origin_metadata ?? {}), platform: HOUSE, external_id: keyOfUrl(v.listing_url), item_id: s.itemId ?? null,
      bid_count: st.bidCount, currency: st.currency, current_bid: st.currentBid,
      current_bid_kind: (st.bidCount ?? 0) > 0 ? "high_bid" : st.bidCount === 0 ? "opening_price" : "unknown", buy_it_now: st.buyItNow,
      buying_options: s.buyingOptions ?? [], last_sync: nowIso, reader: "extract-ebay-motors auctions (Browse search)",
    },
    updated_at: nowIso,
  };
}

const isVintage = (s: EbayItem) => { const y = yearOf(s); return y != null && y >= VINTAGE.from && y <= VINTAGE.to; };

async function heldRows(supabase: any, keys: string[], deadline?: number): Promise<Map<string, VehicleRow[]>> {
  const urls = keys.flatMap(itemUrls);
  const m = new Map<string, VehicleRow[]>();
  for (let i = 0; i < urls.length; i += 100) {
    if (deadline != null && Date.now() >= deadline) throw Error("replay ownership deadline");
    let query = supabase.from("vehicles")
      .select("id,listing_url,platform_source,sale_status,auction_status,high_bid,auction_end_date,origin_metadata,title,year,make,model")
      .in("listing_url", urls.slice(i, i + 100)).is("deleted_at", null).limit(1000);
    if (deadline != null) query = query.abortSignal(AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))));
    const r = await query;
    if (r.error) throw new Error(`held vehicles read failed: ${r.error.message}`);
    for (const v of (r.data ?? []) as VehicleRow[]) { const k = keyOfUrl(v.listing_url); if (k) m.set(k, [...(m.get(k) ?? []), v]); }
  }
  return m;
}

interface EpisodeRow { vehicle_id: string; source_listing_id: string; source_url: string; event_status: string; metadata: Record<string, unknown> | null; ended_at: string | null; sold_at: string | null; identity_check?: string | null; source_suspect?: string[] | null }
async function heldEpisodes(sb: any, keys: string[], deadline?: number, includeUntrusted = false): Promise<Map<string, EpisodeRow[]>> {
  const out = new Map<string, EpisodeRow[]>();
  for (let i = 0; i < keys.length; i += 100) {
    if (deadline != null && Date.now() >= deadline) throw Error("replay episode deadline");
    let query = sb.from("vehicle_events").select("vehicle_id,source_listing_id,source_url,event_status,metadata,ended_at,sold_at,identity_check,source_suspect")
      .eq("source_platform", PLATFORM).in("source_listing_id", keys.slice(i, i + 100)).limit(1000);
    if (deadline != null) query = query.abortSignal(AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))));
    const r = await query;
    if (r.error) throw new Error(`held episodes read failed: ${r.error.message}`);
    for (const e of (r.data ?? []) as EpisodeRow[]) {
      if (!includeUntrusted && (e.identity_check === "mismatch" || e.source_suspect?.includes("vehicle_id"))) continue;
      if (!includeUntrusted && (!e.vehicle_id || !itemUrls(e.source_listing_id).includes(e.source_url))) continue;
      out.set(e.source_listing_id, [...(out.get(e.source_listing_id) ?? []), e]);
    }
  }
  return out;
}
const episodeClosed = (e: EpisodeRow) => Boolean(e.ended_at || e.sold_at || TERMINAL.has(e.event_status) || e.event_status === "ended");
const episodeChanged = (e: EpisodeRow, s: EbayItem) => {
  const f = snapshotFields(s, ""), m = e.metadata ?? {};
  return !m.auction_observation_id || ["current_bid", "bid_count", "currency", "current_bid_kind", "buy_it_now", "item_end_date"]
    .some(k => m[k] !== (f as any)[k]) || JSON.stringify(m.buying_options ?? []) !== JSON.stringify(f.buying_options);
};

async function upsertLive(supabase: any, rows: Record<string, unknown>[], errors: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 50) {   // sync-live-auctions sends 100; the vehicles trigger chain is the cost
    const { data, error } = await supabase.rpc("upsert_live_auction_vehicles", { p_rows: rows.slice(i, i + 50) });
    if (error) errors.push(`upsert_live_auction_vehicles: ${error.message}`.slice(0, 300));
    else n += typeof data === "number" ? data : 0;
  }
  return n;
}

export async function auctions(supabase: any, client: BrowseClient, o: AuctionOptions = {}): Promise<AuctionReport> {
  const now = o.now ?? Date.now;
  const nowIso = new Date(now()).toISOString();
  const maxPages = o.maxPages ?? 1, maxItems = o.maxItems ?? 2, floor = o.floor ?? 200;
  const ledger = o.ledger ?? auctionLedger(supabase, o.dailyCap ?? 400, new Date(now()));
  const a: AuctionCounts = {
    open_total: null, pages_read: 0, complete: false, seen: 0, bad_end: 0, with_bids: 0, ending_24h: 0,
    held_rows: 0, held_elsewhere: 0, held_terminal: 0, written_live: 0, unchanged: 0,
    unheld: { vintage: 0, other: 0 }, land_attempts: 0, landed_live: 0, left: { vintage: 0, other: 0 },
    snapshots_admitted: 0, snapshots_deferred: 0, written_episodes: 0,
    replay: { queued: 0, pending: 0, admitted: 0, acknowledged: 0, overflow: 0, retention_failed: 0, obsolete: 0, terminal_or_expired: 0, identity_refused: 0 },
    ended_vehicles: 0, ended_episodes: 0, episodes_past_end: 0, browse_calls: 0,
  };
  const rep: AuctionReport = { ...emptyReport(o.dryRun ? "auctions_dry_run" : "auctions"), auctions: a };
  let c0 = client.calls;
  const browse = () => client.calls - c0;          // Browse calls; the rate-limit reads before and after are the Analytics API's
  try {
    const q = await client.remainingToday();
    c0 = client.calls;
    rep.remaining_before = q?.remaining ?? null;
    const cap = o.maxCalls ?? maxPages + maxItems;
    const budget = Math.min(cap, q ? q.remaining - floor : (o.blindCap ?? cap));
    if (budget < 1) rep.stopped = `quota: ${q?.remaining ?? "?"} calls left today, ${floor} kept as the floor`;

    // 1. the open list, ending soonest first. `present` is every lot listed (it is open); `seen` the ones we can write.
    const seen = new Map<string, SearchSummary>();
    const present = new Set<string>();
    const readAt = new Map<string, string>();
    const itemReads = new Set<string>();
    const pageOf = new Map<string, AuctionRead>();
    for (let page = 0; page < maxPages; page++) {
      if (browse() >= budget) { rep.stopped ??= `budget: ${browse()} of ${budget} calls spent after ${page} pages`; break; }
      const why = await ledger.take();
      if (why) { rep.stopped = `${why}; after ${page} pages`; break; }
      const offset = page * PAGE;
      const res = await client.search({ filter: AUCTION_FILTER, sort: "endingSoonest", offset, limit: PAGE });
      const pageReadAt = new Date(now()).toISOString();
      a.pages_read++;
      a.open_total = res.total;
      const query = new URLSearchParams({ category_ids: CATEGORY_CARS_TRUCKS, filter: AUCTION_FILTER, sort: "endingSoonest", offset: String(offset), limit: String(PAGE) });
      const nativePage: AuctionRead = { url: `https://api.ebay.com/buy/browse/v1/item_summary/search?${query}`, readAt: pageReadAt,
        method: "search", response: res.raw ?? { total: res.total, next: res.next, itemSummaries: res.itemSummaries }, items: res.itemSummaries };
      for (const s of res.itemSummaries) {
        const k = listingKey(s);
        if (!k) continue;
        present.add(k);
        if (!s.buyingOptions?.includes("AUCTION")) continue;
        const t = Date.parse(s.itemEndDate ?? "");
        if (!Number.isFinite(t) || t > now() + HORIZON_MS) { a.bad_end++; continue; }
        seen.set(k, s);
        readAt.set(k, pageReadAt);
        pageOf.set(k, nativePage);
      }
      if (!res.next || offset + PAGE >= res.total || res.itemSummaries.length === 0) { a.complete = true; break; }
      if (offset + 2 * PAGE > MAX_OFFSET) { rep.stopped = `offset: the open list (${res.total}) is longer than Browse pages reach`; break; }
    }
    if (!a.complete && !rep.stopped) rep.stopped = `partial pass: ${a.pages_read} of ${Math.ceil((a.open_total ?? 0) / PAGE)} pages (max_pages ${maxPages}); nothing is ended`;
    a.seen = seen.size;
    for (const s of seen.values()) {
      if ((s.bidCount ?? 0) > 0) a.with_bids++;
      if (Date.parse(s.itemEndDate!) <= now() + 86_400_000) a.ending_24h++;
    }

    // 2. what we hold: a snapshot means the sweep or this action landed it; a vehicles row with the item's own URL and
    //    this house's platform_source is the row the board reads
    const keys = [...seen.keys()];
    const snap = new Set<string>();
    for (let i = 0; i < keys.length; i += 100) for (const k of await heldKeys(supabase, keys.slice(i, i + 100))) snap.add(k);
    const rows = await heldRows(supabase, keys);
    const episodes = await heldEpisodes(supabase, keys);
    const live: Record<string, unknown>[] = [];
    const unheld: SearchSummary[] = [];
    let snapshotAttempts = 0, admissionStopped = false;
    const admissionDeadline = Date.now() + 45_000;
    const maxSnapshots = Math.max(0, Math.min(20, o.maxSnapshots ?? 20));
    const replay = o.replayStore ?? auctionReplayStore(supabase);
    const queued: ReplayEntry[] = [];
    if (!o.dryRun) {
      // Retain complete native pages before the bounded admission loop can run out
      // of time. Only already-owned, changed lots enter the delivery queue.
      const groups = new Map<AuctionRead, ReplayCandidate[]>();
      for (const [k, summary] of seen) {
        const own = (rows.get(k) ?? []).filter(v => v.platform_source === HOUSE);
        const linked = episodes.get(k) ?? [];
        const episode = linked.length === 1 ? linked[0] : undefined;
        let vehicleId: string | undefined, url: string | undefined;
        if (own.length === 1 && !TERMINAL.has(String(own[0].sale_status)) && linked.length <= 1
          && (!episode || !episodeClosed(episode) && episode.vehicle_id === own[0].id)
          && (liveRow(own[0], summary, nowIso) || episode && episodeChanged(episode, summary))) {
          vehicleId = own[0].id; url = episode?.source_url ?? own[0].listing_url;
        } else if (own.length === 0 && episode && !episodeClosed(episode) && episodeChanged(episode, summary)) {
          vehicleId = episode.vehicle_id; url = episode.source_url;
        }
        const page = pageOf.get(k);
        if (vehicleId && url && page) groups.set(page, [...(groups.get(page) ?? []),
          { key: k, vehicleId, url, endAt: summary.itemEndDate! }]);
      }
      // Reserve at least 35s of the 45s stage for current evidence/projection.
      const retentionDeadline = Math.min(Date.now() + 8000, admissionDeadline - 35_000);
      for (const [page, candidates] of [...groups].slice(0, 20)) {
        if (Date.now() >= retentionDeadline) break;
        try { queued.push(...await replay.retain(page, candidates, retentionDeadline)); }
        catch (e) { a.replay.retention_failed += candidates.length; rep.errors.push(`replay retention: ${(e as Error).message}`.slice(0, 300)); }
        if (Date.now() >= retentionDeadline) break;
      }
      const expectedRetention = [...groups.values()].reduce((n, list) => n + list.length, 0);
      a.replay.retention_failed = Math.max(a.replay.retention_failed, expectedRetention - queued.length);
      a.replay.queued = queued.length;
      if (queued.length) {
        try {
          const saved = await replay.merge(queued, [], Math.min(Date.now() + 2000, admissionDeadline - 33_000));
          a.replay.pending = saved.pending; a.replay.overflow += saved.overflow;
        } catch (e) {
          rep.errors.push(`replay queue save: ${(e as Error).message}`.slice(0, 300));
        }
      }
    }
    const capture = async (vehicleId: string, url: string, s: EbayItem, previous: unknown, capturedAt?: string, method?: "search" | "getItem", sourceEntry?: ReplayEntry): Promise<SnapshotReceipt | null> => {
      if (admissionStopped || Date.now() >= admissionDeadline || snapshotAttempts >= maxSnapshots) { a.snapshots_deferred++; return null; }
      snapshotAttempts++;
      const observedAt = capturedAt ?? readAt.get(listingKey(s)!) ?? nowIso;
      const source = sourceEntry ?? queued.find(e => e.key === listingKey(s) && Date.parse(e.readAt) === Date.parse(observedAt));
      try {
        const receipt = await (o.snapshotWriter ?? admitAuctionSnapshot)(supabase, {
          vehicleId, url, summary: s, observedAt,
          ...(source ? { sourceCapture: { snapshot_id: source.snapshotId, html_sha256: source.sha256, fetched_at: source.readAt, source_url: source.pageUrl } } : {}),
          previousObservationId: typeof previous === "string" ? previous : null, readMethod: method ?? (itemReads.has(listingKey(s)!) ? "getItem" : "search"),
        });
        a.snapshots_admitted++;
        const fields = snapshotFields(s, receipt.observedAt);
        const ev = await writeVehicleEventByKey(supabase, {
          vehicle_id: vehicleId, source_platform: PLATFORM, source_listing_id: listingKey(s), source_url: url,
          event_type: "listing", event_status: "active", bid_count: fields.bid_count,
          currency_code: fields.currency && /^[A-Z]{3}$/.test(fields.currency) ? fields.currency : null,
          current_price: (fields.bid_count ?? 0) > 0 && Number.isFinite(Number(fields.current_bid)) && Number(fields.current_bid) > 0 ? Number(fields.current_bid) : null,
          metadata: { ...fields, listing_ends_at: fields.item_end_date, source_observed_at: receipt.observedAt,
            last_checked_at: receipt.observedAt, auction_observation_id: receipt.observationId, auction_snapshot_id: receipt.snapshotId },
        }, { preserveEventStatus: true, sourceObservedAt: receipt.observedAt });
        if (ev.action === "error") throw new Error(`episode projection: ${ev.error}`);
        if (ev.action === "skipped") return null; // a newer episode read wins; do not regress the scalar board either
        a.written_episodes++;
        return receipt;
      } catch (e) { admissionStopped = true; rep.errors.push(`auction evidence ${listingKey(s)}: ${(e as Error).message}`.slice(0, 300)); return null; }
    };
    const project = async (v: VehicleRow, s: EbayItem, episode?: EpisodeRow, capturedAt?: string, method?: "search" | "getItem", sourceEntry?: ReplayEntry): Promise<Record<string, unknown> | null> => {
      const row = liveRow(v, s, capturedAt ?? readAt.get(listingKey(s)!) ?? nowIso);
      if (o.dryRun) return row;
      const m = episode?.metadata;
      // A prior run may have admitted/projected the episode before its scalar upsert failed. Reuse that receipt.
      const retained = episode && !episodeChanged(episode, s) && typeof m?.auction_observation_id === "string"
        && typeof m?.auction_snapshot_id === "string" && typeof m?.source_observed_at === "string"
        ? { observationId: m.auction_observation_id, snapshotId: m.auction_snapshot_id, observedAt: m.source_observed_at } : null;
      const receipt = retained ?? await capture(v.id, episode?.source_url ?? v.listing_url, s,
        episode?.metadata?.auction_observation_id ?? v.origin_metadata?.auction_observation_id, capturedAt, method, sourceEntry);
      if (!receipt || !row) return null;
      row.origin_metadata = { ...(row.origin_metadata as Record<string, unknown>), auction_observation_id: receipt.observationId,
        auction_snapshot_id: receipt.snapshotId, source_observed_at: receipt.observedAt, last_sync: receipt.observedAt };
      return row;
    };
    // Changes to already admitted lots precede initial provenance baselines; within each group retain ending-soonest order.
    const ordered = [...seen].sort(([ka], [kb]) => Number(Boolean(rows.get(kb)?.[0]?.origin_metadata?.auction_observation_id ?? episodes.get(kb)?.[0]?.metadata?.auction_observation_id))
      - Number(Boolean(rows.get(ka)?.[0]?.origin_metadata?.auction_observation_id ?? episodes.get(ka)?.[0]?.metadata?.auction_observation_id)));
    for (const [k, s] of ordered) {
      const own = (rows.get(k) ?? []).filter((v) => v.platform_source === HOUSE);
      const linked = episodes.get(k) ?? [];
      const episode = linked.length === 1 ? linked[0] : undefined;
      if (own.length === 1) {
        a.held_rows++;
        if (TERMINAL.has(String(own[0].sale_status)) || (episode && episodeClosed(episode))) { a.held_terminal++; continue; }
        if (linked.length > 1 || (episode && episode.vehicle_id !== own[0].id)) { a.held_elsewhere++; continue; }
        const changed = Boolean(liveRow(own[0], s, nowIso)) || Boolean(episode && episodeChanged(episode, s));
        const row = changed ? await project(own[0], s, episode) : null;
        if (row) live.push(row); else if (!changed) a.unchanged++;
      } else if (episode && own.length === 0) {
        a.held_elsewhere++;
        if (episodeClosed(episode)) { a.held_terminal++; continue; }
        if (!episodeChanged(episode, s)) { a.unchanged++; continue; }
        if (!o.dryRun) await capture(episode.vehicle_id, episode.source_url, s, episode.metadata?.auction_observation_id);
      } else if (own.length > 1 || linked.length > 1 || rows.has(k) || snap.has(k)) {
        a.held_elsewhere++;                            // linked to another source's vehicle, a blip, or two rows: not this writer's
      } else {
        unheld.push(s);
        if (isVintage(s)) a.unheld.vintage++; else a.unheld.other++;
      }
    }
    if (o.dryRun) a.written_live = live.length;       // would be sent
    else if (live.length) a.written_live = await upsertLive(supabase, live, rep.errors);

    // 3. land unheld lots: vintage first, then ending soonest (the search order, kept by the stable sort)
    const minLeft = (o.minMinutesLeft ?? 30) * 60_000;
    const todo = unheld.filter((s) => Date.parse(s.itemEndDate!) - now() >= minLeft)
      .sort((x, y) => Number(isVintage(y)) - Number(isVintage(x)));
    const take = o.dryRun ? [] : todo.slice(0, Math.max(0, Math.min(maxItems, budget - browse())));
    const landedKeys: string[] = [];
    for (const s of take) {                          // one at a time: each landing calls ingest, and the cap is exact
      if (browse() >= budget) break;
      const why = await ledger.take();
      if (why) { rep.stopped = rep.stopped ? `${rep.stopped}; ${why}` : why; break; }
      a.land_attempts++;
      try {
        const raw = await client.getItem(s.itemId!);
        const itemReadAt = new Date(now()).toISOString();
        const r = await landItem(supabase, raw, rep, itemReadAt);
        readAt.set(listingKey(s)!, itemReadAt);
        if (r === "landed") landedKeys.push(listingKey(s)!);
        seen.set(listingKey(s)!, raw);   // retain the actual getItem body, not a composite of two reads
        itemReads.add(listingKey(s)!);
      } catch (e) {
        if (e instanceof QuotaExceeded) throw e;
        if (e instanceof ItemGone) continue;
        rep.errors.push(`land ${listingKey(s)}: ${(e as Error).message}`.slice(0, 300));
      }
    }
    if (landedKeys.length) {
      const fresh = await heldRows(supabase, landedKeys);
      const freshEpisodes = await heldEpisodes(supabase, landedKeys);
      const out: Record<string, unknown>[] = [];
      for (const k of landedKeys) {
        const own = (fresh.get(k) ?? []).filter((v) => v.platform_source === HOUSE);
        const linked = freshEpisodes.get(k) ?? [];
        const episode = linked.length === 1 ? linked[0] : undefined;
        if (linked.length > 1 || (episode && episodeClosed(episode))) continue;
        if (own.length === 1 && (!episode || episode.vehicle_id === own[0].id)) {
          const row = await project(own[0], seen.get(k)!, episode);
          if (row) out.push(row);
        } else if (own.length === 0 && episode && episodeChanged(episode, seen.get(k)!)) {
          await capture(episode.vehicle_id, episode.source_url, seen.get(k)!, episode.metadata?.auction_observation_id);
        }
      }
      if (out.length) a.landed_live = await upsertLive(supabase, out, rep.errors);
    }
    const tried = new Set(take.slice(0, a.land_attempts).map((s) => listingKey(s)));
    for (const s of unheld) if (!tried.has(listingKey(s))) { if (isVintage(s)) a.left.vintage++; else a.left.other++; }
    if (a.left.vintage + a.left.other > 0) {
      const wait = `${a.left.vintage + a.left.other} unheld open auctions in this read wait (vintage ${a.left.vintage}, other ${a.left.other})`;
      rep.stopped = rep.stopped ? `${rep.stopped}; ${wait}` : `budget: ${wait}`;
    }

    if (a.snapshots_deferred) rep.stopped = `${rep.stopped ? rep.stopped + "; " : ""}evidence budget: ${a.snapshots_deferred} changed auction states deferred`;

    // 4. ended: only on a complete pass, only past the end time, never an outcome
    if (a.complete && !o.dryRun) await endAbsent(supabase, present, rep, now, o.maxEnded ?? 200);

    // Drain old held-state debt using only slots left after current source reads.
    // Re-query current ownership/clocks: a newer projection or terminal lot wins.
    if (!o.dryRun && Date.now() < admissionDeadline - 2000) {
      const loaded = await replay.load(admissionDeadline);
      const pending = loaded.sort(closingFirst).slice(0, 200);
      a.replay.pending = loaded.length;
      const pendingKeys = pending.map(e => e.key);
      const [currentEpisodes, currentRows] = await Promise.all([
        heldEpisodes(supabase, pendingKeys, admissionDeadline - 2000, true),
        heldRows(supabase, pendingKeys, admissionDeadline - 2000),
      ]);
      const acknowledgements: ReplayEntry[] = [];
      for (const entry of pending) {
        if (Date.now() >= admissionDeadline - 2000) break;
        try {
          const matches = currentEpisodes.get(entry.key) ?? [];
          const episode = matches.length === 1 ? matches[0] : undefined;
          if (matches.length > 1 || episode && (episode.vehicle_id !== entry.vehicleId || episode.identity_check === "mismatch"
            || episode.source_suspect?.includes("vehicle_id") || !itemUrls(entry.key).includes(episode.source_url))) {
            a.replay.identity_refused++; acknowledgements.push(entry); continue; // no reassignment from a stale queue
          }
          if (episode && episodeClosed(episode) || Date.parse(entry.endAt) <= now()) {
            a.replay.terminal_or_expired++; acknowledgements.push(entry); continue;
          }
          const projectedAt = Date.parse(String(episode?.metadata?.source_observed_at));
          if (projectedAt > Date.parse(entry.readAt)) {
            a.replay.obsolete++; acknowledgements.push(entry); continue;
          }
          const own = (currentRows.get(entry.key) ?? []).filter(v => v.platform_source === HOUSE);
          if (own.length > 1 || own.length === 1 && (own[0].id !== entry.vehicleId || TERMINAL.has(String(own[0].sale_status)))) {
            a.replay.identity_refused++; acknowledgements.push(entry); continue;
          }
          const ownClock = own.length === 1 ? Date.parse(String(own[0].origin_metadata?.source_observed_at
            ?? own[0].origin_metadata?.last_sync)) : NaN;
          if (ownClock > Date.parse(entry.readAt)) {
            a.replay.obsolete++; acknowledgements.push(entry); continue;
          }
          if (!episode && own.length !== 1) { a.replay.identity_refused++; acknowledgements.push(entry); continue; }
          const summary = await replay.summary(entry, admissionDeadline - 2000);
          if (episode && !episodeChanged(episode, summary) && (own.length === 0 || !liveRow(own[0], summary, entry.readAt))) {
            a.replay.obsolete++; acknowledgements.push(entry); continue;
          }
          if (admissionStopped || snapshotAttempts >= maxSnapshots) continue;
          const before = a.snapshots_admitted;
          let delivered = false;
          if (own.length === 1) {
            const row = await project(own[0], summary, episode, entry.readAt, entry.method, entry);
            if (row) {
              const written = await upsertLive(supabase, [row], rep.errors);
              a.written_live += written; delivered = written === 1;
            }
          } else if (episode) delivered = Boolean(await capture(entry.vehicleId, entry.url, summary,
            episode.metadata?.auction_observation_id, entry.readAt, entry.method, entry));
          a.replay.admitted += a.snapshots_admitted - before;
          if (delivered) acknowledgements.push(entry);
        } catch (e) { rep.errors.push(`auction replay ${entry.key}: ${(e as Error).message}`.slice(0, 300)); break; }
      }
      if (acknowledgements.length) {
        const saved = await replay.merge([], acknowledgements, admissionDeadline);
        a.replay.pending = saved.pending; a.replay.overflow += saved.overflow;
        a.replay.acknowledged = acknowledgements.length;
      }
    }
    if (a.replay.pending || a.replay.overflow || a.replay.retention_failed)
      rep.stopped = `${rep.stopped ? rep.stopped + "; " : ""}held snapshot replay: ${a.replay.pending} pending, ${a.replay.overflow} outside queue cap, ${a.replay.retention_failed} retention failures`;
  } catch (e) {
    if (e instanceof QuotaExceeded) rep.stopped = `quota: ${e.message}`;
    else { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400)); }
  }
  a.browse_calls = browse();
  rep.calls = a.browse_calls;
  const after = await client.remainingToday().catch(() => null);
  rep.remaining_after = after?.remaining ?? null;
  if (rep.errors.length) rep.ok = false;
  return rep;
}

/** After a complete pass: held lots absent from it and past their end are ended (vehicles and listing episode). */
export async function endAbsent(supabase: any, present: Set<string>, rep: AuctionReport, now: () => number, maxEnded: number) {
  const a = rep.auctions;
  const nowIso = new Date(now()).toISOString();
  // vehicles: the auction_live rows this house holds (idx_vehicles_auction_live); the absent, past-end ones end
  const lv = await supabase.from("vehicles").select("listing_url,auction_end_date")
    .eq("sale_status", "auction_live").eq("platform_source", HOUSE).is("deleted_at", null).limit(10000);
  if (lv.error) { rep.errors.push(`live rows read failed: ${lv.error.message}`); return; }
  const liveRows = (lv.data ?? []) as { listing_url: string; auction_end_date: string | null }[];
  const gone = (r: { listing_url: string; auction_end_date: string | null }) => {
    const k = keyOfUrl(r.listing_url ?? "");
    const t = Date.parse(r.auction_end_date ?? "");
    return !!k && !present.has(k) && Number.isFinite(t) && t < now();
  };
  if (liveRows.some(gone)) {
    // end_live_auctions_absent ends every auction_live row of the house missing from the list it is given, so the list
    // is everything that stays: the open lots in both spellings and every live row not ended here
    const keep = new Set<string>([...present].flatMap(itemUrls));
    for (const r of liveRows) if (!gone(r)) keep.add(r.listing_url);
    const { data, error } = await supabase.rpc("end_live_auctions_absent", { p_platform: HOUSE, p_live_urls: [...keep] });
    if (error) rep.errors.push(`end_live_auctions_absent: ${error.message}`.slice(0, 300));
    else a.ended_vehicles = Number(data) || 0;
  }

  // listing episodes: auction-format episodes still open past their end and absent from the pass
  const ev = await supabase.from("vehicle_events").select("vehicle_id,source_listing_id,source_url,metadata")
    .eq("source_platform", PLATFORM).eq("event_type", "listing").neq("event_status", "ended")
    .contains("metadata", { buying_options: ["AUCTION"] }).lt("metadata->>listing_ends_at", nowIso)
    .order("updated_at", { ascending: true }).limit(maxEnded);
  if (ev.error) { rep.errors.push(`auction episodes read failed: ${ev.error.message}`); return; }
  const eps = ((ev.data ?? []) as any[]).filter((e) => e.vehicle_id && !present.has(String(e.source_listing_id)));
  a.episodes_past_end = eps.length;
  await pool(eps, 4, async (e) => {
    const w = await writeVehicleEventByKey(supabase, {
      vehicle_id: e.vehicle_id, source_platform: PLATFORM, source_listing_id: String(e.source_listing_id), source_url: e.source_url,
      event_type: "listing", event_status: "ended", ended_at: nowIso, updated_at: nowIso,
      metadata: {
        source_observed_at: nowIso, last_checked_at: nowIso,
        removal: { basis: "absent_from_complete_auction_pass", observed_at: nowIso, scheduled_end: e.metadata?.listing_ends_at ?? null,
          outcome: "unknown: the Browse API does not say whether an ended auction sold" },
      },
    }, { sourceObservedAt: nowIso });
    if (w.action === "error") rep.errors.push(`ended ${e.source_listing_id}: ${w.error}`.slice(0, 300));
    else if (w.action !== "skipped") a.ended_episodes++;
  });
}
