// Plain words for job_market_health_read (aggregates only): counts as sentences, medians only when the server gave one.
import { num, obj, type JsonObject } from '../jobs/jobRead';

/** "39 open requests", "1 technician", "0 businesses". */
export function count(n: number | null | undefined, one: string, many: string): string {
  const v = n ?? 0;
  return `${v.toLocaleString('en-US')} ${v === 1 ? one : many}`;
}

/** "3.5 h" / "2 days" from the server's median hours; null when it gave none (fewer than 2 samples). */
export function hoursText(h: number | null): string | null {
  if (h === null || !Number.isFinite(h)) return null;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export const STEP_WORDS: Record<string, string> = {
  offer_to_acceptance: 'Offer to acceptance',
  quote_to_acceptance: 'Quote to acceptance',
  quote_acceptance_to_start: 'Accepted quote to work started',
  start_to_completion: 'Work started to marked done',
  completion_to_acceptance: 'Marked done to confirmed',
  invoice_to_payment_witness: 'Invoice to payment recorded',
};

export const FLOW_WORDS: Array<[string, string, string]> = [
  ['offers', 'offer made', 'offers made'],
  ['offers_accepted', 'offer accepted', 'offers accepted'],
  ['quotes_issued', 'quote issued', 'quotes issued'],
  ['quotes_accepted', 'quote accepted', 'quotes accepted'],
  ['starts', 'job started', 'jobs started'],
  ['completions_attested', 'job marked done', 'jobs marked done'],
  ['completions_accepted', 'completion confirmed', 'completions confirmed'],
  ['invoices', 'invoice issued', 'invoices issued'],
  ['payment_witnesses', 'payment recorded', 'payments recorded'],
];

export const UNKNOWN_WORDS: Record<string, string> = {
  skill: 'skill', tools: 'tools', facility: 'shop space', area: 'area', availability: 'availability', evidence_rung: 'technician link',
};

/** The history series for one field, oldest first; empty when the server kept fewer than two days. */
export function series(read: JsonObject | null, field: string): Array<{ date: string; value: number }> {
  const rows = Array.isArray(read?.history) ? (read!.history as unknown[]) : [];
  return rows.map(r => obj(r)).filter((r): r is JsonObject => !!r && typeof r.date === 'string')
    .map(r => ({ date: r.date as string, value: num(r[field]) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** SVG polyline points for a sparkline of `values` in a width × height box. */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`).join(' ');
}
