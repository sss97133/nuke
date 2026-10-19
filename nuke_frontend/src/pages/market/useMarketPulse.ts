import { useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// One live auction as market_pulse_live() returns it (compact array, see
// supabase/migrations/20260927193000_market_pulse_live_board.sql).
export interface LiveAuction {
  id: string;
  year: number | null;
  make: string;
  model: string | null;
  currentBid: number | null;
  endsAt: number; // epoch ms
  updatedAt: number; // epoch ms — vehicles.updated_at, the last write to the row by any process
  listedAt: number; // epoch ms — first time Nuke saw the listing
  imageUrl: string | null;
  noReserve: boolean;
  listingUrl: string | null;
  title: string | null; // the listing's own title as BaT publishes it
  // Expected-price band from comparable BaT sales on the lot's model page (hammer_predictions, model 31;
  // scripts/market/live-bands.mjs). Null when the lot isn't priced (no confident model page or < 5 comps).
  band: { p10: number; p50: number; p90: number; tier: string; comps: number } | null;
  // The verdict the read computed (market_pulse_live v3, slot 17, heat_of() with the server's clock); null when the
  // read made none. Absent on older payloads, where the page computes it with heatOf.
  serverHeat?: ServerHeat | null;
}

export interface ServerHeat { ratio: number; state: 'hot' | 'cold' | 'in line'; typicalNow: number; share: number; hoursLeft: number }

/** One horizon of the hot/cold track record (heat_tag_backtest, latest run), as the read sends it. */
export interface BacktestRow {
  horizonHours: number; label: string; hotAbove: number; coldBelow: number;
  nHot: number | null; nCold: number | null; runAt: string | null; population: string | null; lotsSold: number | null; source: string | null;
}

// Median share of the final price that sold BaT cars had been bid at each hours-left mark, per price tier.
export type BidCurve = Record<string, [number, number][]>;

// The same board, read at an earlier moment (BAT-LIVE-BIDS index, migration 20260927210000).
export interface BoardReading {
  at: number; // epoch ms
  bids: number;
  n: number;
  byMake: Record<string, [number, number]> | null; // make -> [bids, auctions with a bid]; live readings only
  source: 'live' | 'archive' | string; // archive = rebuilt from BaT bid history (96% of auctions)
}

export interface SameHourRange {
  hourUtc: string;
  weekdayUtc: string;
  low: number;
  high: number;
  weeks: number;
  firstDay: string;
  readings: { day: string; bids: number }[]; // the same weekday and hour in each earlier week
}

export interface MarketPulse {
  syncedAt: number | null;
  source: string;
  auctions: LiveAuction[];
  weekAgo: BoardReading | null;
  sameHour: SameHourRange | null;
  curve: BidCurve | null;
  /** v3 payloads: the three numbers the verdict uses and the track record behind its sentence; null before v3. */
  thresholds: { hot: number; cold: number; maxHours: number } | null;
  backtest: BacktestRow[] | null;
}

// Lots BaT lists without a parsed make (wheel sets, replicas) are grouped under this label.
export const NO_MAKE = 'NO MAKE';

// Disjoint ranges of the current bid in US dollars; missing is not zero.
export const BID_BUCKETS = [
  { id: 'under10k', label: 'Under $10,000' },
  { id: '10k25k', label: '$10,000–24,999' },
  { id: '25k50k', label: '$25,000–49,999' },
  { id: '50k100k', label: '$50,000–99,999' },
  { id: '100kplus', label: '$100,000+' },
  { id: 'unknown', label: 'Unrecorded' },
] as const;
export type BidBucket = typeof BID_BUCKETS[number]['id'];

export function bidBucket(bid: number | null): BidBucket {
  if (bid == null || !Number.isFinite(bid) || bid < 0) return 'unknown';
  if (bid < 10_000) return 'under10k';
  if (bid < 25_000) return '10k25k';
  if (bid < 50_000) return '25k50k';
  if (bid < 100_000) return '50k100k';
  return '100kplus';
}

export function currentBidDistribution(auctions: LiveAuction[]) {
  const counts = Object.fromEntries(BID_BUCKETS.map(b => [b.id, 0])) as Record<BidBucket, number>;
  const bids: number[] = [];
  for (const a of auctions) {
    const bucket = bidBucket(a.currentBid);
    counts[bucket] += 1;
    if (bucket !== 'unknown') bids.push(a.currentBid as number);
  }
  bids.sort((a, b) => a - b);
  const mid = Math.floor(bids.length / 2);
  return {
    counts, recorded: bids.length, total: bids.reduce((sum, bid) => sum + bid, 0),
    median: bids.length === 0 ? null : bids.length % 2 ? bids[mid] : (bids[mid - 1] + bids[mid]) / 2,
  };
}

type Row = [
  string, number | null, string | null, string | null, number | null, string, string, string, string | null, boolean,
  string | null, (string | null)?, (number | null)?, (number | null)?, (number | null)?, (string | null)?, (number | null)?,
];

/** Slot 17 of a v3 row: the read's verdict, or null. Anything that is not that shape reads as no verdict. */
function serverHeatOf(v: unknown): ServerHeat | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Record<string, unknown>;
  const state = h.state;
  if (state !== 'hot' && state !== 'cold' && state !== 'in line') return null;
  const ratio = Number(h.ratio), typicalNow = Number(h.typical_now), share = Number(h.share), hoursLeft = Number(h.hours_left);
  if (![ratio, typicalNow, share, hoursLeft].every(Number.isFinite)) return null;
  return { ratio, state, typicalNow, share, hoursLeft };
}

/** The 17 slots of a market_pulse_live row, in the order this decode reads them. A v2 payload names its slots in
 *  'columns'; the names must be these, or the payload is refused rather than decoded into the wrong fields.
 *  supabase/sql/test_market_pulse_live_columns.sql pins the same list on the read. */
export const PULSE_COLUMNS = [
  'id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
  'image_url', 'no_reserve', 'listing_url', 'title',
  'band_p10', 'band_p50', 'band_p90', 'band_tier', 'band_comps',
] as const;

/** A payload that names its slots must name these first, in this order. Slots appended after them are fine (a
 *  later version may add a server-computed verdict at the end); a slot moved, renamed or missing is refused. The
 *  phone's BoardContract applies the same rule. */
export function assertPulseColumns(columns: unknown): void {
  if (!Array.isArray(columns)) return; // a v1 payload names nothing; the positions are taken on trust as before
  const got = columns.map(String);
  if (got.length < PULSE_COLUMNS.length || PULSE_COLUMNS.some((c, i) => c !== got[i])) {
    throw new Error(`market_pulse_live names its slots [${got.join(', ')}]; this reader expects [${PULSE_COLUMNS.join(', ')}] first`);
  }
}

export async function fetchPulse(): Promise<MarketPulse> {
  const { data, error } = await supabase.rpc('market_pulse_live');
  if (error) throw error;
  assertPulseColumns(data?.columns);
  const rows = ((data?.auctions ?? []) as Row[]);
  const wk = data?.baseline?.week_ago;
  const sh = data?.baseline?.same_hour;
  return {
    syncedAt: data?.synced_at ? Date.parse(data.synced_at) : null,
    source: data?.source ?? '',
    weekAgo: wk && wk.bids != null
      ? { at: Date.parse(wk.at), bids: Number(wk.bids), n: Number(wk.n), byMake: wk.by_make ?? null, source: wk.source ?? 'live' }
      : null,
    sameHour: sh && sh.low != null && sh.high != null && Number(sh.weeks) > 0
      ? {
          hourUtc: sh.hour_utc, weekdayUtc: sh.weekday_utc, low: Number(sh.low), high: Number(sh.high), weeks: Number(sh.weeks), firstDay: sh.first_day,
          readings: Array.isArray(sh.readings) ? sh.readings.map((r: [string, number]) => ({ day: r[0], bids: Number(r[1]) })) : [],
        }
      : null,
    auctions: rows.map((r) => ({
      id: r[0],
      year: r[1],
      make: r[2] ? r[2].toUpperCase() : NO_MAKE,
      model: r[3],
      currentBid: r[4] == null ? null : Number(r[4]),
      endsAt: Date.parse(r[5]),
      updatedAt: Date.parse(r[6]),
      listedAt: Date.parse(r[7]),
      imageUrl: r[8],
      noReserve: r[9] === true,
      listingUrl: r[10],
      title: r[11] ?? null,
      band: r[13] != null && r[12] != null && r[14] != null
        ? { p10: Number(r[12]), p50: Number(r[13]), p90: Number(r[14]), tier: String(r[15] ?? ''), comps: Number(r[16] ?? 0) }
        : null,
      serverHeat: serverHeatOf(r[17]),
    })),
    curve: (data?.curve as BidCurve | undefined) ?? null,
    thresholds: data?.thresholds && data.thresholds.hot != null
      ? { hot: Number(data.thresholds.hot), cold: Number(data.thresholds.cold), maxHours: Number(data.thresholds.max_hours) }
      : null,
    backtest: Array.isArray(data?.backtest)
      ? (data.backtest as any[]).map((b) => ({
          horizonHours: Number(b.horizon_hours), label: String(b.label ?? ''), hotAbove: Number(b.hot_above), coldBelow: Number(b.cold_below),
          nHot: b.n_hot == null ? null : Number(b.n_hot), nCold: b.n_cold == null ? null : Number(b.n_cold),
          runAt: b.run_at ?? null, population: b.population ?? null, lotsSold: b.lots_sold == null ? null : Number(b.lots_sold), source: b.source ?? null,
        })).filter((b) => Number.isFinite(b.horizonHours) && Number.isFinite(b.hotAbove) && Number.isFinite(b.coldBelow))
      : null,
  };
}

// One BAT-LIVE-BIDS reading at an hour (market_index_values, public read): current bids and live auctions with a
// bid across the board, and, on live readings (from 2026-09-27), the same two per make. Written hourly by the
// bat-live-bids-snapshot job; 100 readings from 2026-06-29 on 2026-10-13.
export interface HourReading {
  day: string; // value_date, UTC
  bids: number;
  n: number | null;
  byMake: Record<string, [number, number]> | null; // make -> [bids, auctions with a bid]
  source: string; // live | archive (rebuilt from BaT bid history, 96% of auctions)
}

const WEEK_MS = 7 * 86_400_000;

// The same UTC weekday and hour in each of the 12 weeks before today: the window market_pulse_live() uses for
// same_hour, read with every field of the reading instead of the bids alone.
async function fetchSameHour(hourUtc: string, todayUtc: string): Promise<HourReading[]> {
  const days = Array.from({ length: 12 }, (_, i) => new Date(Date.parse(todayUtc) - (i + 1) * WEEK_MS).toISOString().slice(0, 10));
  const { data, error } = await supabase
    .from('market_index_values')
    .select(`value_date, h:components_snapshot->hourly->"${hourUtc}", src:calculation_metadata->sources->>"${hourUtc}", src_all:calculation_metadata->>source, market_indexes!inner(index_code)`)
    .eq('market_indexes.index_code', 'BAT-LIVE-BIDS')
    .in('value_date', days)
    .order('value_date');
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((r) => r.h && r.h.bids != null)
    .map((r) => ({
      day: String(r.value_date),
      bids: Number(r.h.bids),
      n: r.h.n == null ? null : Number(r.h.n),
      byMake: r.h.by_make ?? null,
      source: String(r.src ?? r.src_all ?? 'live'),
    }));
}

// Re-read when the UTC hour turns; within the hour the readings don't change. Off until the board names its hour.
export function useSameHourReadings(hourUtc: string, todayUtc: string) {
  return useQuery({
    queryKey: ['market-same-hour', todayUtc, hourUtc],
    queryFn: () => fetchSameHour(hourUtc, todayUtc),
    enabled: hourUtc !== '',
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

export interface InventoryTaxonomy {
  id: string;
  listing_url: string | null;
  canonical_vehicle_type: string | null;
  canonical_body_style: string | null;
}

// Current recorded taxonomy, read only when that lens is requested. Keep unknowns in the map;
// do not infer a body/type from a title, model name, or a different listing episode.
export async function readInventoryTaxonomy(ids: string[], signal?: AbortSignal): Promise<InventoryTaxonomy[]> {
  const rows: InventoryTaxonomy[] = [];
  // At most three bounded PK reads in flight; no unbounded URL or per-lot request.
  for (let offset = 0; offset < ids.length; offset += 300) {
    const batches = [0, 100, 200].map(start => ids.slice(offset + start, offset + start + 100)).filter(batch => batch.length);
    const results = await Promise.all(batches.map(async batch => {
      let query = supabase.from('vehicles')
        .select('id,listing_url,canonical_vehicle_type,canonical_body_style')
        .in('id', batch).eq('is_public', true).is('deleted_at', null)
        .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').limit(100);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }));
    rows.push(...results.flat());
  }
  return rows;
}

export function useInventoryTaxonomy(auctions: LiveAuction[], enabled: boolean) {
  const ids = [...new Set(auctions.map(a => a.id))].sort();
  return useQuery({
    queryKey: ['market-inventory-taxonomy', ids],
    queryFn: ({ signal }) => readInventoryTaxonomy(ids, signal),
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60_000, retry: 1,
  });
}

export function listingKey(auction: Pick<LiveAuction, 'id' | 'listingUrl'>): string | null {
  if (!/^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(auction.listingUrl ?? '')) return null;
  return `${auction.id}:${auction.listingUrl!.replace(/\/$/, '')}`;
}

/** A snapshot increase is not an individual bid event or evidence of source freshness. */
export function increasedBids(previous: LiveAuction[], current: LiveAuction[]): Set<string> {
  const before = new Map(previous.map(a => [listingKey(a), a.currentBid]));
  return new Set(current.filter(a => {
    const key = listingKey(a), prior = key ? before.get(key) : null;
    return prior != null && Number.isFinite(prior) && prior >= 0 && a.currentBid != null
      && Number.isFinite(a.currentBid) && a.currentBid > prior;
  }).map(a => a.id));
}

// This polls recorded state, not the source or a complete stream of bid events.
const REFETCH_MS = 60_000;

// Bids from Bring a Trailer's live feed as the live stream records them (live_bid_tape: each bid once, about a minute
// behind the source), read every 15 s. A tape bid lifts its lot's recorded bid while the board's 15-minute sync is
// behind it, so every reader of the board keeps one bid per lot, the newest Nuke holds.
const TAPE_MS = 15_000;
// A bid read more than this long after it was placed (a backgrounded tab, a stalled stream) shows at once.
const PLAYBACK_MAX_LAG_MS = 150_000;
export interface TapeBid { id: string; vehicleId: string; amount: number; bidAt: number; endAt: number | null }

export function parseTape(data: unknown): TapeBid[] {
  const bids = (data as { bids?: unknown } | null)?.bids;
  if (!Array.isArray(bids)) return [];
  return bids.flatMap((b) => {
    const r = (b ?? {}) as Record<string, unknown>;
    const amount = Number(r.amount);
    const bidAt = Date.parse(String(r.bid_at ?? ''));
    const endAt = r.end_at ? Date.parse(String(r.end_at)) : NaN;
    if (typeof r.id !== 'string' || typeof r.vehicle_id !== 'string' || !(amount > 0) || !Number.isFinite(bidAt)) return [];
    return [{ id: r.id, vehicleId: r.vehicle_id, amount, bidAt, endAt: Number.isFinite(endAt) ? endAt : null }];
  });
}

async function fetchTape(): Promise<TapeBid[]> {
  const { data, error } = await supabase.rpc('live_bid_tape', { p_minutes: 5 });
  if (error) throw error;
  return parseTape(data);
}

/** Each lot at the newest bid Nuke holds: the board's recorded bid, or a newer tape bid (and the end it moved to). */
export function withTapeBids(auctions: LiveAuction[], best: ReadonlyMap<string, TapeBid>): LiveAuction[] {
  if (!best.size) return auctions;
  return auctions.map((a) => {
    const b = best.get(a.id);
    if (!b || !(b.amount > (a.currentBid ?? 0))) return a;
    return { ...a, currentBid: b.amount, updatedAt: Math.max(a.updatedAt, b.bidAt),
      endsAt: b.endAt != null && b.endAt > a.endsAt ? b.endAt : a.endsAt };
  });
}

export function useMarketPulse() {
  const query = useQuery({
    queryKey: ['market-pulse-live'],
    queryFn: fetchPulse,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS / 2,
    retry: 1,
  });
  const tape = useQuery({
    queryKey: ['live-bid-tape'],
    queryFn: fetchTape,
    refetchInterval: TAPE_MS,
    staleTime: TAPE_MS / 2,
    retry: 0,
  });

  // The newest tape bid per lot; bids already read are not replayed. The first read sets the baseline quietly.
  // Later bids are played back at their own moments, one steady delay behind the source, instead of all at once
  // when the 15 s read lands: each shows at bid_at + lag, where lag is the slowest arrival seen recently.
  const best = useRef(new Map<string, TapeBid>());
  const seen = useRef<Set<string> | null>(null);
  const lag = useRef(0);
  const timers = useRef(new Set<number>());
  const shown = useRef(new Map<string, { amount: number; at: number }>());
  const [tapeTick, setTapeTick] = useState(0);
  const [tapeRisen, setTapeRisen] = useState<Set<string>>(new Set());
  const [newBids, setNewBids] = useState<TapeBid[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current.clear(); }, []);
  useEffect(() => {
    const bids = tape.data;
    if (!bids) return;
    const first = seen.current == null;
    const known = seen.current ?? new Set<string>();
    const fresh = bids.filter((b) => !known.has(b.id)).sort((a, b) => a.bidAt - b.bidAt);
    seen.current = known.size > 5000 ? new Set(bids.map((b) => b.id)) : known;
    for (const b of fresh) seen.current.add(b.id);
    if (!fresh.length) return;
    const land = (b: TapeBid) => {
      const cur = best.current.get(b.vehicleId);
      if (!cur || b.amount > cur.amount) best.current.set(b.vehicleId, b);
    };
    if (first) {
      fresh.forEach(land);
      setTapeTick((t) => t + 1);
      return;
    }
    const now = Date.now();
    const arrival = Math.max(...fresh.map((b) => now - b.bidAt));
    lag.current = arrival > PLAYBACK_MAX_LAG_MS ? lag.current : Math.max(lag.current * 0.9, arrival);
    for (const b of fresh) {
      const play = () => {
        land(b);
        shown.current.set(b.vehicleId, { amount: b.amount, at: Date.now() });
        setTapeTick((t) => t + 1);
        setNewBids([b]);
        setTapeRisen((prev) => new Set(prev).add(b.vehicleId));
        const off = window.setTimeout(() => {
          timers.current.delete(off);
          setTapeRisen((prev) => { const next = new Set(prev); next.delete(b.vehicleId); return next; });
        }, 1800);
        timers.current.add(off);
      };
      const wait = b.bidAt + lag.current - now;
      if (wait <= 0 || now - b.bidAt > PLAYBACK_MAX_LAG_MS) { play(); continue; }
      const t = window.setTimeout(() => { timers.current.delete(t); play(); }, wait);
      timers.current.add(t);
    }
  }, [tape.data]);
  const data = useMemo(() => {
    const d = query.data;
    if (!d) return d;
    // A tape bid stops lifting its lot once the board's own read has caught up with it.
    for (const a of d.auctions) {
      const b = best.current.get(a.id);
      if (b && (a.currentBid ?? 0) >= b.amount) best.current.delete(a.id);
    }
    return { ...d, auctions: withTapeBids(d.auctions, best.current) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, tapeTick]);

  // Bids that rose since the previous fetch. Motion on the page is driven by this set only.
  const prevBids = useRef<LiveAuction[] | null>(null);
  const [risenIds, setRisenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const auctions = query.data?.auctions;
    if (!auctions) return;
    const prev = prevBids.current;
    // A lot the tape already moved to this bid in the last two minutes is not flashed again when the board catches up.
    const cutoff = Date.now() - 120_000;
    const byId = new Map(auctions.map((a) => [a.id, a.currentBid ?? 0]));
    const rose = prev ? increasedBids(prev, auctions) : new Set<string>();
    for (const id of rose) {
      const s = shown.current.get(id);
      if (s && s.at >= cutoff && s.amount >= (byId.get(id) ?? 0)) rose.delete(id);
    }
    setRisenIds(rose);
    prevBids.current = auctions;
    const timer = window.setTimeout(() => setRisenIds(new Set()), 1800);
    return () => window.clearTimeout(timer);
  }, [query.data]);

  const risen = useMemo(() => (tapeRisen.size ? new Set([...risenIds, ...tapeRisen]) : risenIds), [risenIds, tapeRisen]);
  return { ...query, data, risenIds: risen, newBids };
}
