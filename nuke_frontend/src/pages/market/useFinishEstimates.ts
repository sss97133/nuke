import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// Where a live BaT lot should finish: live_finish_estimates() (migration 20261015100000) reads each public live lot's
// latest prediction-ledger row of model 32, the analog estimator written hourly by scripts/market/live-finish. The
// reader withholds every estimate when the writer has not run for two hours, so an empty map means "no estimate",
// never "zero". Backtest and calibration: docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md, "The live auction board".

export type FinishGrade = 'A' | 'B' | 'C';
export interface FinishEstimate {
  vehicleId: string;
  estimate: number;
  low: number;
  high: number;
  grade: FinishGrade | null;
  coverage: number | null; // measured share of finals inside the 80% range for this grade and horizon
  sentence: string | null; // the plain-language confidence built from that measurement
  estimatedAt: number; // epoch ms
  bidAtEstimate: number | null;
  compsThrough: string | null; // last close date of the sales the estimate rests on
}
export interface FinishAnalog { url: string | null; title: string; closed: string | null; bid: number | null; final: number | null; outcome: string | null }
export interface FinishBoard { fresh: boolean; writerAt: number | null; byId: Map<string, FinishEstimate> }

const num = (x: unknown): number | null => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const time = (x: unknown): number | null => { const t = typeof x === 'string' ? Date.parse(x) : NaN; return Number.isFinite(t) ? t : null; };

/** Rows are read by the column names the payload sends, so a reordered or added column cannot shift a price. */
export function decodeFinishBoard(raw: unknown): FinishBoard {
  const r = (raw ?? {}) as { fresh?: unknown; writer_at?: unknown; columns?: unknown; rows?: unknown };
  const cols = Array.isArray(r.columns) ? r.columns.map(String) : [];
  const at = (name: string) => cols.indexOf(name);
  const byId = new Map<string, FinishEstimate>();
  if (r.fresh === true && Array.isArray(r.rows)) {
    for (const row of r.rows as unknown[][]) {
      if (!Array.isArray(row)) continue;
      const get = (name: string) => (at(name) >= 0 ? row[at(name)] : undefined);
      const id = str(get('vehicle_id'));
      const estimate = num(get('estimate')), low = num(get('low')), high = num(get('high')), estimatedAt = time(get('estimated_at'));
      // An estimate without its range or its time is not shown.
      if (!id || estimate == null || low == null || high == null || estimatedAt == null || !(low <= estimate && estimate <= high)) continue;
      const grade = str(get('grade'));
      byId.set(id, { vehicleId: id, estimate, low, high, grade: grade === 'A' || grade === 'B' || grade === 'C' ? grade : null,
        coverage: num(get('coverage')), sentence: str(get('sentence')), estimatedAt, bidAtEstimate: num(get('bid_at_estimate')),
        compsThrough: str(get('comps_through')) });
    }
  }
  return { fresh: r.fresh === true, writerAt: time(r.writer_at), byId };
}

export function decodeFinishAnalogs(raw: unknown, vehicleId: string): FinishAnalog[] {
  const list = ((raw ?? {}) as { analogs?: Record<string, unknown> }).analogs?.[vehicleId];
  if (!Array.isArray(list)) return [];
  return list.flatMap((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const title = str(o.title);
    if (!title) return [];
    const url = str(o.url);
    return [{ url: url && /^https:\/\/bringatrailer\.com\/listing\//.test(url) ? url : null, title, closed: str(o.closed),
      bid: num(o.bid), final: num(o.final), outcome: str(o.outcome) }];
  });
}

export function useFinishEstimates(enabled = true) {
  return useQuery({
    queryKey: ['live-finish-estimates'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('live_finish_estimates', {}).abortSignal(signal);
      if (error) throw error;
      return decodeFinishBoard(data);
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
    retry: false,
  });
}

export function useFinishAnalogs(vehicleId: string, enabled = true) {
  return useQuery({
    queryKey: ['live-finish-analogs', vehicleId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('live_finish_estimates', { p_vehicle_ids: [vehicleId] }).abortSignal(signal);
      if (error) throw error;
      return { board: decodeFinishBoard(data), analogs: decodeFinishAnalogs(data, vehicleId) };
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
