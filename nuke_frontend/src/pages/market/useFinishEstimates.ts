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
  model: number | null; // the hammer_predictions model_version that wrote it (32 or 33)
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
        compsThrough: str(get('comps_through')), model: num(get('model')) });
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

// How often the estimates were right: finish_track_record() (migration 20261108213000) grades each model's estimates by
// how many hours before the close they were made, against the final bid (the hammer, or the high bid when the reserve was
// not met). Aggregates only.
export interface FinishTrack {
  model: number; fromHours: number; toHours: number | null; lots: number; inside: number; medianMissPct: number | null;
  firstClose: number; lastClose: number;
}

export function decodeFinishTrack(raw: unknown): FinishTrack[] {
  const r = (raw ?? {}) as { columns?: unknown; rows?: unknown };
  const cols = Array.isArray(r.columns) ? r.columns.map(String) : [];
  if (!Array.isArray(r.rows)) return [];
  return (r.rows as unknown[]).flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const get = (name: string) => (cols.indexOf(name) >= 0 ? row[cols.indexOf(name)] : undefined);
    const model = num(get('model')), fromHours = num(get('from_hours')), lots = num(get('lots')), inside = num(get('inside'));
    const firstClose = time(get('first_close')), lastClose = time(get('last_close'));
    if (model == null || fromHours == null || !lots || inside == null || inside > lots || firstClose == null || lastClose == null) return [];
    return [{ model, fromHours, toHours: num(get('to_hours')), lots, inside, medianMissPct: num(get('median_miss_pct')), firstClose, lastClose }];
  });
}

/** The record for an estimate: same model, made as many hours before the close as this one was. */
export function trackFor(track: FinishTrack[] | undefined, e: Pick<FinishEstimate, 'model' | 'estimatedAt'>, endsAt: number | null | undefined): FinishTrack | null {
  if (!track || e.model == null || endsAt == null || !Number.isFinite(endsAt)) return null;
  const hours = Math.max(0, (endsAt - e.estimatedAt) / 3_600_000);
  return track.find(t => t.model === e.model && hours >= t.fromHours && (t.toHours == null || hours < t.toHours)) ?? null;
}

const WINDOW: Record<number, string> = { 0: 'in the last hour', 1: '1–6 hours out', 6: '6–24 hours out', 24: '1–3 days out', 72: 'over 3 days out' };
const shortDay = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });

/** "So far, estimated 1–3 days out: 448 of 555 finished inside the range, half within 17% (lots closed Oct 17–Oct 20)." */
export function trackSentence(t: FinishTrack): string {
  const when = WINDOW[t.fromHours] ?? `${t.fromHours}+ hours out`;
  const span = shortDay(t.firstClose) === shortDay(t.lastClose) ? shortDay(t.firstClose) : `${shortDay(t.firstClose)}–${shortDay(t.lastClose)}`;
  const miss = t.medianMissPct != null ? `, half within ${Math.round(t.medianMissPct)}%` : '';
  return `So far, estimated ${when}: ${t.inside.toLocaleString('en-US')} of ${t.lots.toLocaleString('en-US')} finished inside the range${miss} (lots closed ${span}).`;
}

export function useFinishTrackRecord(enabled = true) {
  return useQuery({
    queryKey: ['finish-track-record'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('finish_track_record', {}).abortSignal(signal);
      if (error) throw error;
      return decodeFinishTrack(data);
    },
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
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
