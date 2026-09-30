import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// A live BaT lot's price and activity as live_lot_temperature() counts them
// (supabase/migrations/20260930150000_live_lot_temperature.sql): each against comparable past lots, same make and
// model, at the same hours to close, as of the lot's last read by bat-live-pull.

export interface CohortCount {
  n: number; // comparable lots
  below: number; // comparable lots strictly below this lot
  same: number; // comparable lots level with it
  comps: number[]; // their values, ascending
  firstClose: number | null; // epoch ms, oldest comparable close
  lastClose: number | null;
}

export interface LiveLotTemperature {
  make: string;
  model: string;
  readAt: number; // epoch ms
  endsAt: number; // epoch ms
  hoursLeft: number; // at the read
  minComparables: number;
  vehiclesCap: number;
  price: CohortCount & { bid: number | null };
  bids: CohortCount & { value: number };
  bidders: CohortCount & { value: number };
}

const num = (x: unknown): number | null => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const time = (x: unknown): number | null => {
  const t = typeof x === 'string' ? Date.parse(x) : NaN;
  return Number.isFinite(t) ? t : null;
};
const list = (x: unknown): number[] => (Array.isArray(x) ? x.map(Number).filter(Number.isFinite) : []);

function parse(d: any): LiveLotTemperature | null {
  if (!d || d.status !== 'ok' || !d.price || !d.activity) return null;
  const readAt = time(d.read_at);
  const endsAt = time(d.ends_at);
  const hoursLeft = num(d.hours_left);
  if (readAt == null || endsAt == null || hoursLeft == null) return null;
  const p = d.price;
  const a = d.activity;
  const window = (o: any) => ({ firstClose: time(o.first_close), lastClose: time(o.last_close) });
  return {
    make: String(d.make ?? ''),
    model: String(d.model ?? ''),
    readAt,
    endsAt,
    hoursLeft,
    minComparables: num(d.min_comparables) ?? 8,
    vehiclesCap: num(d.vehicles_cap) ?? 300,
    price: { bid: num(p.bid), n: num(p.n) ?? 0, below: num(p.below) ?? 0, same: num(p.same) ?? 0, comps: list(p.comps), ...window(p) },
    bids: { value: num(a.bids) ?? 0, n: num(a.n) ?? 0, below: num(a.bids_below) ?? 0, same: num(a.bids_same) ?? 0, comps: list(a.comps), ...window(a) },
    bidders: { value: num(a.bidders) ?? 0, n: num(a.n) ?? 0, below: num(a.bidders_below) ?? 0, same: num(a.bidders_same) ?? 0, comps: list(a.comps_bidders), ...window(a) },
  };
}

// Any error (the function not deployed yet, a timeout) reads as "no reading": the strips don't render.
async function fetchTemperature(vehicleId: string): Promise<LiveLotTemperature | null> {
  const { data, error } = await supabase.rpc('live_lot_temperature', { p_vehicle_id: vehicleId });
  if (error) return null;
  return parse(data);
}

export function useLiveLotTemperature(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['live-lot-temperature', vehicleId],
    queryFn: () => fetchTemperature(vehicleId as string),
    enabled: Boolean(vehicleId),
    // bat-live-pull reads a lot at most hourly (every hour in the last 12 h), so a few minutes is fresh enough.
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
