import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// The latest bids and comments on a handful of live lots (the homepage's Ending next panel), each weighted against
// the lot's own usual pace. One read of auction_comments for all the lots (index on vehicle_id; 1 ms as anon for
// 8 lots on 2026-09-30), newest 40 rows, refreshed every minute. Authors are never selected, so never shown.

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
  hoursListed: number | null; // since the lot opened
  burst: number | null; // lastHour / (total / hoursListed)
}

interface Row {
  vehicle_id: string;
  posted_at: string;
  comment_type: string | null;
  bid_amount: number | string | null;
  sequence_number: number | null;
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
  const oldest = rows.length ? Math.min(...rows.map((r) => Date.parse(r.posted_at))) : now;
  const truncated = rows.length >= MOVEMENT_ROWS && oldest > now - HOUR;
  const byLot = new Map<string, Row[]>();
  for (const r of rows) byLot.set(r.vehicle_id, [...(byLot.get(r.vehicle_id) ?? []), r]);
  const out = new Map<string, LotMovement>();
  for (const [id, lotRows] of byLot) {
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
    const hoursListed = end != null ? Math.min(RUN_MS, now - (end - RUN_MS)) / HOUR : null;
    const lastHour = items.filter((i) => i.at > now - HOUR).length;
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
    });
  }
  return out;
}

async function fetchMovement(ids: string[]): Promise<Row[]> {
  const { data, error } = await supabase
    .from('auction_comments')
    .select('vehicle_id, posted_at, comment_type, bid_amount, sequence_number')
    .in('vehicle_id', ids)
    .order('posted_at', { ascending: false })
    .limit(MOVEMENT_ROWS);
  if (error) throw error;
  return (data ?? []) as Row[];
}

export function useLotMovement(ids: string[]) {
  return useQuery({
    queryKey: ['lot-movement', ids.join(',')],
    queryFn: () => fetchMovement(ids),
    enabled: ids.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}
