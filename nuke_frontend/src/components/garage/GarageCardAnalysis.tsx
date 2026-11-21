/**
 * The last frame of a garage card's reel: what the database's own readers say about this car, one line each,
 * every line with the reader that returned it. A reader with nothing to say leaves no line, and a car with no
 * lines gets no frame. Nothing here appraises, adds lenses together or fills a gap: the hours on shop paper,
 * the reference hours and the stage hours are three rows, and owner-confirmed and inferred work are two.
 */
import React from 'react';
import { supabase } from '../../lib/supabase';
import { day, plural } from '../../kit';
import { answerOf, evidenceOf, parseFamilyIndex, type FamilyIndex } from '../../pages/market/FamilyPriceIndex';
import type { BuildReconstruction } from '../../pages/vehicle-profile/hooks/useBuildReconstruction';

/** Where a line sits on the frame: the money figures (spent and quoted apart), the hour lenses, logged work, the market, the record. */
export type AnalysisGroup = 'money' | 'hours' | 'work' | 'market' | 'record';
/** `cite` is the evidence in plain words; `title` (the tooltip) carries the reader's name and rule. */
export interface AnalysisLine { key: string; group: AnalysisGroup; label: string; value: string; cite: string; title?: string }

/**
 * One row of `get_vehicle_class_prices`: the stored class price (vehicle_class_price), the median, p25 and p75 of the sold
 * comps of this car's own build class in its year/make/model cohort, or the reason it is not priced.
 */
export interface ClassPrice { vehicle_id?: string; status?: string | null; value?: number | string | null; value_low?: number | string | null;
  value_high?: number | string | null; n?: number | string | null; subject_class?: string | null; basis?: string | null;
  blocked_reason?: string | null; computed_at?: string | null }

export interface WorkSessionRow { session_date: string | null; duration_minutes: number | null; owner_confirmed_at: string | null }
export interface TestimonySummary { total: number; by_kind?: Record<string, number> | null; first_observed?: string | null; last_observed?: string | null }
export interface DayDepthRow { day: string; photos: number; seen: number; placed: number }
export interface OpenQuestions { as_of?: string | null; counts?: { open?: number; answered?: number; questions?: number } | null }

/**
 * vehicle_build_reconstruction's `quoted` lens: estimates, quotes and agreements linked to the car (receipt_doc_kind quote).
 * Quoted money is never spent money, so it is its own line and never added to the receipts. `amount` is null when several
 * options stand with none accepted, when there are several quote documents, or for a viewer who may not see amounts.
 */
export interface QuotedRead {
  documents: number | string; first_day?: string | null; last_day?: string | null; amount?: number | string | null;
  amount_basis?: string | null; rule?: string | null; quotes?: { options?: unknown[] | null }[] | null;
}

export interface CardAnalysisReads {
  build?: BuildReconstruction | null;
  sessions?: WorkSessionRow[] | null;
  testimony?: TestimonySummary | null;
  depth?: DayDepthRow[] | null;
  family?: { brand: string; index: FamilyIndex } | null;
  questions?: OpenQuestions | null;
  classPrice?: ClassPrice | null;
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
/** A month and year, for a span that has to fit one line of the frame; the full days stay in the tooltip. */
const month = (iso: string) => { const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const monthSpan = (first: string | null | undefined, last: string | null | undefined) =>
  first && last ? (month(first) === month(last) ? month(first) : `${month(first)} – ${month(last)}`) : null;

/** Owner-confirmed or inferred work: the sessions, the hours they record, and their days. One group, never both summed. */
function workLine(key: string, label: string, rows: WorkSessionRow[]): AnalysisLine | null {
  if (!rows.length) return null;
  const timed = rows.filter(row => num(row.duration_minutes) != null && num(row.duration_minutes)! > 0);
  const minutes = timed.reduce((sum, row) => sum + num(row.duration_minutes)!, 0);
  const days = rows.map(row => row.session_date).filter((d): d is string => !!d).sort();
  return {
    key, group: 'work', label,
    value: timed.length ? hours(minutes / 60) : plural(rows.length, 'session'),
    cite: [`${timed.length.toLocaleString('en-US')} of ${plural(rows.length, 'session')} timed`, span(days[0], days[days.length - 1])]
      .filter(Boolean).join(' · '),
    title: 'Logged work sessions (work_sessions)',
  };
}

/** The lines the reads support, in reading order. Pure: the card and its tests share it. */
export function analysisLines(reads: CardAnalysisReads): AnalysisLine[] {
  const lines: (AnalysisLine | null)[] = [];
  const band = (low: unknown, high: unknown) => num(low) != null && num(high) != null ? `${usd(num(low)!)} – ${usd(num(high)!)}` : null;
  const cp = reads.classPrice;
  if (cp && cp.status === 'priced' && num(cp.value) != null) {
    const n = num(cp.n);
    lines.push({ key: 'class-value', group: 'money', label: n != null ? `Class · ${plural(n, 'comp')}` : 'Class value', value: usd(num(cp.value)!),
      cite: band(cp.value_low, cp.value_high) ?? '',
      title: [cp.basis, cp.computed_at ? `computed ${day(cp.computed_at)}` : null, 'get_vehicle_class_prices'].filter(Boolean).join('. ') });
  }
  const build = reads.build;
  const t = build?.totals;
  if (build && t && t.lines > 0) {
    const title = [plural(t.part_lines, 'part line'), span(t.first_day, t.last_day), build.rule, `vehicle_build_reconstruction, as of ${day(build.as_of)}`].filter(Boolean).join('. ');
    const paper = [plural(t.receipts, 'receipt'), monthSpan(t.first_day, t.last_day)].filter(Boolean).join(' · ');
    if (build.amounts_visible && num(t.recorded_amount) != null) {
      lines.push({ key: 'amount', group: 'money', label: `On ${plural(t.receipts, 'receipt')}`, value: usd(num(t.recorded_amount)!),
        cite: monthSpan(t.first_day, t.last_day) ?? '', title });
    } else {
      lines.push({ key: 'receipts', group: 'record', label: 'Receipts', value: paper, cite: '', title });
    }
    if (num(t.paper_hours) != null && t.paper_work_lines > 0) {
      lines.push({ key: 'paper-hours', group: 'hours', label: 'Shop paper', value: hours(num(t.paper_hours)!),
        cite: `${plural(t.paper_work_lines, 'work line')} on shop paper`, title });
    }
    if (num(t.reference_hours) != null && t.reference_operations > 0) {
      lines.push({ key: 'reference-hours', group: 'hours', label: 'Book time', value: hours(num(t.reference_hours)!),
        cite: `${plural(t.reference_operations, 'operation')} at reference hours`, title });
    }
    const stage = t.stage_hours;
    if (stage && stage.stages > 0 && num(stage.typical) != null) {
      const range = num(stage.min) != null && num(stage.max) != null ? ` (${num(stage.min)}–${num(stage.max)})` : '';
      lines.push({ key: 'stage-hours', group: 'hours', label: 'Photo stages', value: `${hours(num(stage.typical)!)}${range}`,
        cite: `${plural(stage.stages, 'stage')}${t.stage_images ? ` in ${plural(t.stage_images, 'photo')}` : ''}`, title });
    }
  }
  // Beside the receipts line, in its group: a quote is stated as quoted, never summed into what was spent.
  const quoted = (build as (BuildReconstruction & { quoted?: QuotedRead | null }) | null | undefined)?.quoted;
  const quotes = num(quoted?.documents);
  if (build && quoted && quotes != null && quotes > 0) {
    const options = quotes === 1 && Array.isArray(quoted.quotes?.[0]?.options) ? quoted.quotes![0].options!.length : 0;
    const amount = build.amounts_visible ? num(quoted.amount) : null;
    const count = quotes > 1 ? plural(quotes, 'quote') : options > 1 ? `${options} options` : plural(1, 'quote');
    const title = [quoted.rule, `vehicle_build_reconstruction, as of ${day(build.as_of)}`].filter(Boolean).join('. ');
    const months = monthSpan(quoted.first_day, quoted.last_day);
    if (build.amounts_visible) {
      // a stated amount among several options is the one the paper marks accepted (the reader states none otherwise)
      const note = amount != null && options > 1 ? `accepted of ${options}` : null;
      lines.push({ key: 'quoted', group: 'money', label: 'Quoted', value: amount != null ? usd(amount) : count,
        cite: [months, note].filter(Boolean).join(' · '), title });
    } else {
      lines.push({ key: 'quoted', group: 'record', label: 'Quoted', value: [count, months].filter(Boolean).join(' · '), cite: '', title });
    }
  }
  const sessions = reads.sessions ?? [];
  lines.push(workLine('work-confirmed', 'Confirmed work', sessions.filter(row => row.owner_confirmed_at)));
  lines.push(workLine('work-inferred', 'Inferred work', sessions.filter(row => !row.owner_confirmed_at)));
  if (reads.family) {
    const { brand, index } = reads.family;
    lines.push({
      key: 'family', group: 'market', label: `${brand} family, same car and miles`, value: answerOf(index),
      cite: [evidenceOf({ ...index, stale: false }), index.fittedAt ? `fitted ${day(index.fittedAt)}` : null].filter(Boolean).join(' · '),
      title: 'Family price index (family_price_index_read)',
    });
  }
  const q = reads.questions?.counts;
  if (q && (q.questions ?? 0) > 0) {
    lines.push({ key: 'questions', group: 'record', label: 'Questions', value: `${(q.open ?? 0).toLocaleString('en-US')} open, ${(q.answered ?? 0).toLocaleString('en-US')} answered`,
      cite: '', title: `vehicle_open_questions, as of ${day(reads.questions?.as_of)}` });
  }
  const testimony = reads.testimony;
  if (testimony && num(testimony.total) && num(testimony.total)! > 0) {
    const kinds = Object.entries(testimony.by_kind ?? {}).filter(([, n]) => num(n)).sort((a, b) => num(b[1])! - num(a[1])!).slice(0, 3)
      .map(([kind, n]) => `${words(kind)} ${num(n)!.toLocaleString('en-US')}`);
    lines.push({ key: 'testimony', group: 'record', label: 'Observations', value: num(testimony.total)!.toLocaleString('en-US'),
      cite: '', title: [...kinds, span(testimony.first_observed, testimony.last_observed), 'vehicle_testimony_summary'].filter(Boolean).join(' · ') });
  }
  const depth = (reads.depth ?? []).filter(row => row && typeof row.day === 'string');
  if (depth.length) {
    const photos = depth.reduce((sum, row) => sum + (num(row.photos) ?? 0), 0);
    const seen = depth.reduce((sum, row) => sum + (num(row.seen) ?? 0), 0);
    const days = depth.map(row => row.day).sort();
    if (photos > 0) {
      lines.push({ key: 'photo-days', group: 'record', label: 'Photos read', value: `${seen.toLocaleString('en-US')} of ${photos.toLocaleString('en-US')}`,
        cite: '', title: [plural(depth.length, 'day'), span(days[0], days[days.length - 1]), 'get_vehicle_day_depth'].filter(Boolean).join(' · ') });
    }
  }
  return lines.filter((line): line is AnalysisLine => line !== null);
}

/**
 * Every reader the frame cites, read once per card. A failed reader leaves its lines out; it never fails the frame.
 * `classPrice` is the garage's own row from get_vehicle_class_prices (null when the reader has none for this car); left
 * undefined, the frame reads it for this one car.
 */
export async function readCardAnalysis(vehicleId: string, classPrice?: ClassPrice | null): Promise<AnalysisLine[]> {
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
  const [build, sessions, testimony, depth, questions, familyRead, storedClass] = await Promise.all([
    settle(supabase.rpc('vehicle_build_reconstruction', id),
      data => (data as BuildReconstruction | null)?.version === 1 && (data as BuildReconstruction).totals ? data as BuildReconstruction : null),
    settle(supabase.from('work_sessions').select('session_date, duration_minutes, owner_confirmed_at').eq('vehicle_id', vehicleId).limit(1000),
      data => Array.isArray(data) ? data as WorkSessionRow[] : null),
    settle(supabase.rpc('vehicle_testimony_summary', id), data => data && typeof data === 'object' ? data as TestimonySummary : null),
    settle(supabase.rpc('get_vehicle_day_depth', id), data => Array.isArray(data) ? data as DayDepthRow[] : null),
    settle(supabase.rpc('vehicle_open_questions', id), data => data && typeof data === 'object' ? data as OpenQuestions : null),
    family().catch(() => null),
    // The stored class price, the same row the card's price reads (vehicle_class_price, written by
    // refresh_vehicle_class_price). The inline reader (get_class_stratified_price) is never called from the browser:
    // measured 2026-11-20 as a signed-in user it ran 15 s and answered 500.
    classPrice !== undefined ? Promise.resolve(classPrice)
      : settle(supabase.rpc('get_vehicle_class_prices', { p_vehicle_ids: [vehicleId] }),
        data => Array.isArray(data) ? (data as ClassPrice[]).find(row => row?.vehicle_id === vehicleId) ?? null : null),
  ]);
  return analysisLines({ build, sessions, testimony, depth, questions, family: familyRead, classPrice: storedClass });
}

/**
 * The frame, laid out like a receipt the size of a photo: the money figures on top (spent and quoted apart), the hour lenses side by
 * side (three readings, never added), logged work, the market line, then the record in one closing line.
 */
export function GarageCardAnalysis({ lines }: { lines: AnalysisLine[] }) {
  if (!lines.length) return null;
  const of = (group: AnalysisGroup) => lines.filter(line => line.group === group);
  const cells = (group: AnalysisGroup, cite: boolean, ...more: AnalysisGroup[]) => {
    const rows = [group, ...more].flatMap(of);
    return rows.length ? <dl className={`garage-analysis-${group}`}>
      {rows.map(line => <div key={line.key} title={[line.cite, line.title].filter(Boolean).join('. ')}>
        <dt>{line.label}</dt>
        <dd>{line.value}</dd>
        {cite && line.cite && <dd className="garage-analysis-cite">{line.cite}</dd>}
      </div>)}
    </dl> : null;
  };
  const record = of('record');
  return <div className="garage-card-analysis" role="group" aria-label="Analysis">
    {cells('money', true)}
    {/* Hour lenses and logged work share one wrapping strip: each keeps its own name and none is added to another. */}
    {cells('hours', false, 'work')}
    {cells('market', false)}
    {record.length > 0 && <p className="garage-analysis-record">
      {record.map((line, i) => <span key={line.key} title={line.title}>{i > 0 && ' · '}{line.label} {line.value}</span>)}
    </p>}
  </div>;
}
