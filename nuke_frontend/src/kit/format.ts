import { RANK_FLOOR, type Measure } from './types';

/** A date for humans: short month, day, year; 'unknown date' when the clock is missing or unparseable. A calendar day
 *  ('2024-01-08') is printed as that day. A timestamp is printed in the viewer's own time zone: a reader stamped
 *  02:48 UTC on Nov 25 is Nov 24 for a viewer in Las Vegas (lead, 2026-11-24). */
export function day(iso: string | null | undefined): string {
  if (!iso) return 'unknown date';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown date';
  const calendarDay = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(calendarDay ? { timeZone: 'UTC' } : {}) });
}

/** A value in its unit. USD gets a dollar sign, percentages one decimal, counts their separators. */
export function formatMeasure(value: number, unit: string): string {
  if (!Number.isFinite(value)) return 'unknown';
  if (unit === 'USD') return '$' + Math.round(value).toLocaleString('en-US');
  if (unit === '%') return `${value.toFixed(1)}%`;
  if (unit === 'count' || unit === '') return value.toLocaleString('en-US');
  return `${value.toLocaleString('en-US')} ${unit}`;
}

/** A percentile label only when enough peers were measured. Below the floor the answer is null, never a number. */
export function rankLabel(rank: Measure['rank'], floor: number = RANK_FLOOR): string | null {
  if (!rank || !Number.isFinite(rank.p) || rank.n < floor) return null;
  return `P${Math.round(Math.min(100, Math.max(0, rank.p)))}`;
}

/** A count with its noun: "1 row", "2 rows", "1,204 rows". A noun whose plural is not "s" gives it: plural(2, 'row needs', 'rows need'). */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
