/**
 * The last frame of a garage card's reel: what the database's own readers say about this car, one line each,
 * every line with the reader that returned it. A reader with nothing to say leaves no line, and a car with no
 * lines gets no frame. Nothing here appraises, adds lenses together or fills a gap: the hours on shop paper,
 * the reference hours and the stage hours are three rows, and owner-confirmed and inferred work are two.
 */
import React from 'react';
import { supabase } from '../../lib/supabase';
import { Text, day, plural } from '../../kit';
import { answerOf, evidenceOf, parseFamilyIndex, type FamilyIndex } from '../../pages/market/FamilyPriceIndex';
import type { BuildReconstruction } from '../../pages/vehicle-profile/hooks/useBuildReconstruction';

export interface AnalysisLine { key: string; label: string; value: string; cite: string; title?: string }

export interface WorkSessionRow { session_date: string | null; duration_minutes: number | null; owner_confirmed_at: string | null }
export interface TestimonySummary { total: number; by_kind?: Record<string, number> | null; first_observed?: string | null; last_observed?: string | null }
export interface DayDepthRow { day: string; photos: number; seen: number; placed: number }
export interface OpenQuestions { as_of?: string | null; counts?: { open?: number; answered?: number; questions?: number } | null }

export interface CardAnalysisReads {
  build?: BuildReconstruction | null;
  sessions?: WorkSessionRow[] | null;
  testimony?: TestimonySummary | null;
  depth?: DayDepthRow[] | null;
  family?: { brand: string; index: FamilyIndex } | null;
  questions?: OpenQuestions | null;
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const hours = (h: number) => `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const span = (first: string | null | undefined, last: string | null | undefined) =>
  first && last ? (day(first) === day(last) ? day(first) : `${day(first)} – ${day(last)}`) : null;
const words = (key: string) => key.replace(/_/g, ' ');

/** Owner-confirmed or inferred work: the sessions, the hours they record, and their days. One group, never both summed. */
function workLine(key: string, label: string, rows: WorkSessionRow[]): AnalysisLine | null {
  if (!rows.length) return null;
  const timed = rows.filter(row => num(row.duration_minutes) != null && num(row.duration_minutes)! > 0);
  const minutes = timed.reduce((sum, row) => sum + num(row.duration_minutes)!, 0);
  const days = rows.map(row => row.session_date).filter((d): d is string => !!d).sort();
  return {
    key, label,
    value: timed.length ? hours(minutes / 60) : plural(rows.length, 'session'),
    cite: ['work_sessions', `${timed.length.toLocaleString('en-US')} of ${plural(rows.length, 'session')} timed`, span(days[0], days[days.length - 1])]
      .filter(Boolean).join(' · '),
  };
}

/** The lines the reads support, in reading order. Pure: the card and its tests share it. */
export function analysisLines(reads: CardAnalysisReads): AnalysisLine[] {
  const lines: (AnalysisLine | null)[] = [];
  const build = reads.build;
  const t = build?.totals;
  if (build && t && t.lines > 0) {
    const cite = `vehicle_build_reconstruction · ${plural(t.lines, 'receipt line')} · as of ${day(build.as_of)}`;
    lines.push({ key: 'receipts', label: 'Receipts', value: `${plural(t.receipts, 'receipt')} · ${plural(t.part_lines, 'part line')}`, cite, title: build.rule });
    const paperDays = span(t.first_day, t.last_day);
    if (paperDays) lines.push({ key: 'receipt-days', label: 'Receipt days', value: paperDays, cite, title: build.rule });
    if (build.amounts_visible && num(t.recorded_amount) != null) {
      lines.push({ key: 'amount', label: 'Recorded on receipts', value: usd(num(t.recorded_amount)!), cite, title: build.rule });
    }
    if (num(t.paper_hours) != null && t.paper_work_lines > 0) {
      lines.push({ key: 'paper-hours', label: 'Hours on shop paper', value: hours(num(t.paper_hours)!),
        cite: `vehicle_build_reconstruction · ${plural(t.paper_work_lines, 'work line')}`, title: build.rule });
    }
    if (num(t.reference_hours) != null && t.reference_operations > 0) {
      lines.push({ key: 'reference-hours', label: 'Reference hours', value: hours(num(t.reference_hours)!),
        cite: `vehicle_build_reconstruction · ${plural(t.reference_operations, 'operation')} · labor_operations`, title: build.rule });
    }
    const stage = t.stage_hours;
    if (stage && stage.stages > 0 && num(stage.typical) != null) {
      const range = num(stage.min) != null && num(stage.max) != null ? ` (${num(stage.min)}–${num(stage.max)})` : '';
      lines.push({ key: 'stage-hours', label: 'Hours by photographed stage', value: `${hours(num(stage.typical)!)}${range}`,
        cite: `vehicle_build_reconstruction · ${plural(stage.stages, 'stage')}${t.stage_images ? ` · ${plural(t.stage_images, 'photo')}` : ''}`, title: build.rule });
    }
  }
  const sessions = reads.sessions ?? [];
  lines.push(workLine('work-confirmed', 'Work, owner-confirmed', sessions.filter(row => row.owner_confirmed_at)));
  lines.push(workLine('work-inferred', 'Work, inferred', sessions.filter(row => !row.owner_confirmed_at)));
  if (reads.family) {
    const { brand, index } = reads.family;
    lines.push({
      key: 'family', label: 'Same car, same miles', value: answerOf(index),
      cite: ['family_price_index_read', `${brand} family`, evidenceOf({ ...index, stale: false }), index.fittedAt ? `fitted ${day(index.fittedAt)}` : null]
        .filter(Boolean).join(' · '),
    });
  }
  const q = reads.questions?.counts;
  if (q && (q.questions ?? 0) > 0) {
    lines.push({ key: 'questions', label: 'Open questions', value: `${(q.open ?? 0).toLocaleString('en-US')} open · ${(q.answered ?? 0).toLocaleString('en-US')} answered`,
      cite: `vehicle_open_questions · ${plural(q.questions ?? 0, 'question')} · as of ${day(reads.questions?.as_of)}` });
  }
  const testimony = reads.testimony;
  if (testimony && num(testimony.total) && num(testimony.total)! > 0) {
    const kinds = Object.entries(testimony.by_kind ?? {}).filter(([, n]) => num(n)).sort((a, b) => num(b[1])! - num(a[1])!).slice(0, 3)
      .map(([kind, n]) => `${words(kind)} ${num(n)!.toLocaleString('en-US')}`);
    lines.push({ key: 'testimony', label: 'Observations', value: [num(testimony.total)!.toLocaleString('en-US'), ...kinds].join(' · '),
      cite: ['vehicle_testimony_summary', span(testimony.first_observed, testimony.last_observed)].filter(Boolean).join(' · ') });
  }
  const depth = (reads.depth ?? []).filter(row => row && typeof row.day === 'string');
  if (depth.length) {
    const photos = depth.reduce((sum, row) => sum + (num(row.photos) ?? 0), 0);
    const seen = depth.reduce((sum, row) => sum + (num(row.seen) ?? 0), 0);
    const days = depth.map(row => row.day).sort();
    if (photos > 0) {
      lines.push({ key: 'photo-days', label: 'Photos read', value: `${seen.toLocaleString('en-US')} of ${plural(photos, 'photo')}`,
        cite: ['get_vehicle_day_depth', plural(depth.length, 'day'), span(days[0], days[days.length - 1])].filter(Boolean).join(' · ') });
    }
  }
  return lines.filter((line): line is AnalysisLine => line !== null);
}

/** Every reader the frame cites, read once per card. A failed reader leaves its lines out; it never fails the frame. */
export async function readCardAnalysis(vehicleId: string): Promise<AnalysisLine[]> {
  const settle = async <T,>(read: PromiseLike<{ data: unknown; error: unknown }>, parse: (data: unknown) => T | null): Promise<T | null> => {
    try { const { data, error } = await read; return error ? null : parse(data); } catch { return null; }
  };
  const id = { p_vehicle_id: vehicleId };
  const family = async () => {
    // A car is in a family when the market's own sales table placed this car's sale there.
    const placed = await settle(supabase.from('mv_family_sales').select('brand, family_key').eq('vehicle_id', vehicleId).limit(1),
      data => Array.isArray(data) && data[0]?.brand && data[0]?.family_key ? data[0] as { brand: string; family_key: string } : null);
    if (!placed) return null;
    const index = await settle(supabase.rpc('family_price_index_read', { p_brand: placed.brand, p_family_key: placed.family_key }), parseFamilyIndex);
    return index ? { brand: placed.brand, index } : null;
  };
  const [build, sessions, testimony, depth, questions, familyRead] = await Promise.all([
    settle(supabase.rpc('vehicle_build_reconstruction', id),
      data => (data as BuildReconstruction | null)?.version === 1 && (data as BuildReconstruction).totals ? data as BuildReconstruction : null),
    settle(supabase.from('work_sessions').select('session_date, duration_minutes, owner_confirmed_at').eq('vehicle_id', vehicleId).limit(1000),
      data => Array.isArray(data) ? data as WorkSessionRow[] : null),
    settle(supabase.rpc('vehicle_testimony_summary', id), data => data && typeof data === 'object' ? data as TestimonySummary : null),
    settle(supabase.rpc('get_vehicle_day_depth', id), data => Array.isArray(data) ? data as DayDepthRow[] : null),
    settle(supabase.rpc('vehicle_open_questions', id), data => data && typeof data === 'object' ? data as OpenQuestions : null),
    family().catch(() => null),
  ]);
  return analysisLines({ build, sessions, testimony, depth, questions, family: familyRead });
}

/** The frame: a panel the size of a photo, its lines scrolling inside it. */
export function GarageCardAnalysis({ lines }: { lines: AnalysisLine[] }) {
  if (!lines.length) return null;
  return <div className="garage-card-analysis" role="group" aria-label="Analysis">
    <Text role="label" as="h3">Analysis</Text>
    <ul>
      {lines.map(line => <li key={line.key} title={line.title}>
        <Text role="label">{line.label}</Text>
        <Text role="measure" dense>{line.value}</Text>
        <Text role="caption">{line.cite}</Text>
      </li>)}
    </ul>
  </div>;
}
