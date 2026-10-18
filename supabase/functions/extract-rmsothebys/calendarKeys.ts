// The auction-calendar keys an RM Sotheby's lot episode carries, so a lot read before its sale can be placed on the
// calendar: the same contract as Mecum and Gooding (ended_at, metadata.auction_session_days, auction_name, sale_key,
// sale_starts_on, sale_ends_on, sale_location, lot_number, estimate_low / estimate_high as numbers with currency).
// Sale days come from knownAuctions.ts (each line cites the auction page); nothing here is guessed.
import { getKnownAuctions } from './knownAuctions.ts';

export interface SaleCalendar {
  sale_key: string;
  auction_name: string | null;
  sale_starts_on: string;
  sale_ends_on: string;
  auction_session_days: string[];
  sale_location: string | null;
}

/** Days from `first` to `last` inclusive, as YYYY-MM-DD. */
export function sessionDays(first: string, last: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= end && out.length < 14; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The place in an auction's name ("Monterey 2026" -> "Monterey"); null where the name is not a place. */
export function saleLocation(name: string): string | null {
  const place = name.replace(/\s+\d{4}$/, '').trim();
  return !place || /sealed|cavallino/i.test(place) ? null : place;
}

/** Null for a code the table does not hold: the keys are then left off, never made up. */
export function saleCalendar(auctionCode: string, auctionName: string | null): SaleCalendar | null {
  const a = getKnownAuctions().find((k) => k.code === auctionCode.toUpperCase());
  if (!a) return null;
  const last = a.lastDate && a.lastDate >= a.date ? a.lastDate : a.date;
  return {
    sale_key: a.code.toLowerCase(),
    auction_name: auctionName || a.name,
    sale_starts_on: a.date,
    sale_ends_on: last,
    auction_session_days: sessionDays(a.date, last),
    sale_location: saleLocation(a.name),
  };
}

const CURRENCIES: [RegExp, string][] = [[/EUR|€/, 'EUR'], [/USD|\$/, 'USD'], [/GBP|£/, 'GBP'], [/CHF/, 'CHF']];

/** "£500,000 - £800,000 GBP" -> { low: 500000, high: 800000, currency: 'GBP' }. Anything else ("On request") -> nulls. */
export function parseEstimate(text: string | null | undefined): { low: number | null; high: number | null; currency: string | null } {
  const none = { low: null, high: null, currency: null };
  if (!text) return none;
  const nums = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0 || nums.length > 2) return none;
  const currency = CURRENCIES.find(([re]) => re.test(text))?.[1] ?? null;
  const low = nums[0];
  const high = nums.length === 2 ? nums[1] : null;
  if (high !== null && high < low) return none;
  return { low, high, currency };
}
