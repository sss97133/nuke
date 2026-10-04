import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../lib/supabase';

// The latest bids and comments on a handful of live lots (the homepage's Ending next panel), each weighted against
// observed median bid increment. The current-listing reader gates each public vehicle and accepts the source URL's
// trailing-slash alias, then returns at most 40 posted interactions per lot, for at most 8 lots. Historical
// auctions on the same vehicle cannot enter the current window. Refreshing every minute is a reader cadence;
// source freshness is separately known or unknown. Authors are never selected, so never shown.

export const MOVEMENT_ROWS = 40;

export interface MovementItem {
  at: number; // epoch ms, posted on the listing
  kind: 'bid' | 'comment' | 'question' | 'seller';
  amount: number | null; // bids only
  step: number | null; // this bid minus the lot's previous bid in view
  weight: number | null; // step / median step, when 2 or more steps are in view
}

export interface LotMovement {
  items: MovementItem[]; // newest first
  medianStep: number | null;
  steps: number; // increments the median is taken over
  lastHour: number; // comments and bids posted in the last hour
  lastHourFloor: boolean; // true when the 40-row window may have cut the hour short
  total: number | null; // the lot's comment count so far (highest sequence number in view)
  hoursListed: number | null; // legacy close-minus-seven-days assumption; never observed opening time
  burst: number | null; // legacy assumed-duration ratio; not a supported bid-velocity measure
  sourceReadAt: number | null; // actual page read; never the browser/vehicle-row write clock
  sourceReadBasis: 'direct_fetch' | 'cached_snapshot' | 'unknown';
  readAsOf: number;
}

export interface Row {
  vehicle_id: string;
  posted_at: string;
  comment_type: string | null;
  bid_amount: number | string | null;
  sequence_number: number | null;
  source_url?: string;
  window_truncated?: boolean;
  read_as_of?: string;
  source_read_at?: string | null;
  source_read_basis?: LotMovement['sourceReadBasis'];
}

export interface ActivityReceipt {
  as_of: string;
  max_lots: number;
  per_lot_limit: number;
  input_truncated: boolean;
  eligible_lots: number;
  scope: string;
  lots: Array<{
    vehicle_id: string;
    source_url: string;
    source_read_at: string | null;
    source_read_basis: LotMovement['sourceReadBasis'];
    source_auction_event_id?: string | null; // auction row, not an observation UUID
    source_bid_amount?: number | null; // bound live bid on the source page at source_read_at
    source_bid_ingested_at?: string | null; // auction event's latest write; not bid posted_at
    current_bid_at_capture?: number | null; // vehicle current bid sampled at receipt.as_of
    source_bid_match?: 'matched' | 'mismatched' | 'unknown'; // numeric agreement only; not money/freshness
    source_bid_currency?: string | null; // currently unverified; no USD default
    current_bid_currency_at_capture?: string | null;
    source_bid_match_basis?: 'numeric_amount_only_currency_unverified' | 'unknown';
    activity_rows: number;
    has_more: boolean;
    activity: Row[];
  }>;
}

/** Keep the existing hook's row contract while carrying the bounded per-lot read receipt. */
export function activityRows(receipt: ActivityReceipt): Row[] {
  return receipt.lots.flatMap(lot => lot.activity.map(row => ({
    ...row, window_truncated: lot.has_more, read_as_of: receipt.as_of,
    source_read_at: lot.source_read_at, source_read_basis: lot.source_read_basis,
  })));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function kindOf(t: string | null): MovementItem['kind'] {
  if (t === 'bid') return 'bid';
  if (t === 'question') return 'question';
  if (t === 'seller_response') return 'seller';
  return 'comment';
}

const HOUR = 3_600_000;

// A lot's own hourly rate runs from when it opened: its close less BaT's standard 7-day run. (vehicles' first-seen
// time can't stand in: most live lots carry one backfill timestamp.)
export const RUN_MS = 7 * 24 * HOUR;

export function weigh(rows: Row[], endsAt: Map<string, number>, now: number): Map<string, LotMovement> {
  const byLot = new Map<string, Row[]>();
  for (const r of rows) {
    const at = Date.parse(r.posted_at);
    if (!Number.isFinite(at)) continue;
    byLot.set(r.vehicle_id, [...(byLot.get(r.vehicle_id) ?? []), r]);
  }
  const out = new Map<string, LotMovement>();
  for (const [id, lotRows] of byLot) {
    const stamp = Date.parse(lotRows[0].read_as_of ?? '');
    const asOf = Number.isFinite(stamp) ? stamp : now;
    const oldest = Math.min(...lotRows.map(r => Date.parse(r.posted_at)));
    const truncated = (lotRows[0].window_truncated ?? lotRows.length >= MOVEMENT_ROWS) && oldest > asOf - HOUR;
    const asc = [...lotRows].sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at));
    const items: MovementItem[] = [];
    const steps: number[] = [];
    let prevBid: number | null = null;
    for (const r of asc) {
      const kind = kindOf(r.comment_type);
      const amount = kind === 'bid' && r.bid_amount != null && Number(r.bid_amount) > 0 ? Number(r.bid_amount) : null;
      const step = amount != null && prevBid != null && amount > prevBid ? amount - prevBid : null;
      if (step != null) steps.push(step);
      if (amount != null) prevBid = amount;
      items.push({ at: Date.parse(r.posted_at), kind, amount, step, weight: null });
    }
    const med = steps.length >= 2 ? median(steps) : null;
    for (const it of items) if (it.step != null && med) it.weight = it.step / med;
    const seqs = lotRows.map((r) => r.sequence_number).filter((n): n is number => n != null);
    const total = seqs.length ? Math.max(...seqs) : null;
    const end = endsAt.get(id);
    const hoursListed = end != null ? Math.min(RUN_MS, asOf - (end - RUN_MS)) / HOUR : null;
    const lastHour = items.filter((i) => i.at > asOf - HOUR && i.at <= asOf).length;
    const rate = total != null && hoursListed != null && hoursListed >= 1 ? total / hoursListed : null;
    out.set(id, {
      items: items.reverse(),
      medianStep: med,
      steps: steps.length,
      lastHour,
      lastHourFloor: truncated,
      total,
      hoursListed,
      burst: rate && rate > 0 ? lastHour / rate : null,
      sourceReadAt: Number.isFinite(Date.parse(lotRows[0].source_read_at ?? '')) ? Date.parse(lotRows[0].source_read_at!) : null,
      sourceReadBasis: lotRows[0].source_read_basis ?? 'unknown',
      readAsOf: asOf,
    });
  }
  return out;
}

async function fetchMovement(ids: string[]): Promise<ActivityReceipt> {
  const { data, error } = await supabase.rpc('market_lot_activity', {
    p_vehicle_ids: ids.slice(0, 8), p_limit_per_lot: MOVEMENT_ROWS,
  });
  if (error) throw error;
  return data as ActivityReceipt;
}

export function useLotMovement(ids: string[]) {
  const query = useQuery({
    queryKey: ['lot-movement', ids.join(',')],
    queryFn: () => fetchMovement(ids),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const data = useMemo(() => query.data ? activityRows(query.data) : undefined, [query.data]);
  return { ...query, data, coverage: query.data };
}
