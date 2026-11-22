/**
 * evaluate_listing's public answer → the one card /check draws. Pure, so the states are unit-tested.
 * The card states what the advisor recorded and nothing else: a missing value stays missing, and a thin
 * comparable set is called thin rather than turned into a verdict.
 */

/** Below this confidence, or with fewer than MIN_COMPS sales behind the range, the card makes no call. */
export const LOW_CONFIDENCE = 0.3;
export const MIN_COMPS = 5;

export type PriceKind = 'sold' | 'rnm' | 'live' | 'ask' | 'none';
export type Relation = 'below' | 'inside' | 'above';

export type Comp = { title: string; price: number; date: string | null; url: string; platform: string };
export type FeeLine = { label: string; amount: number; estimate: boolean; sourceUrl: string | null };
export type PriorSale = { price: number | null; date: string | null; url: string | null; label: string };

export type CheckCard = {
  kind: 'card';
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  details: string[];
  priceKind: PriceKind;
  price: number | null;
  priceDate: string | null;
  endsAt: string | null;
  band: { low: number; high: number; confidence: number | null; n: number | null } | null;
  /** True when the advisor's range is too thin to call: the card says so instead of a verdict. */
  lowConfidence: boolean;
  relation: Relation | null;
  position: { percentile: number; n: number; min: number; median: number; max: number; note: string | null } | null;
  trend: { direction: 'up' | 'down' | 'flat'; changePct: number; recentN: number; priorN: number; recentMedian: number; priorMedian: number } | null;
  allIn: { total: number; label: string; lines: FeeLine[] } | null;
  comps: Comp[];
  priorSales: PriorSale[];
  notes: string[];
  matchedAssetId: string | null;
  asOf: string | null;
};
export type CheckRefusal = { kind: 'refused'; message: string };
export type CheckFailure = { kind: 'error'; message: string };
export type CheckOutcome = CheckCard | CheckRefusal | CheckFailure;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const BAT_HOSTS = new Set(['bringatrailer.com', 'www.bringatrailer.com']);

/** What the paste box accepts before any request: a Bring a Trailer listing URL. Null = fine to send. */
export function pasteRefusal(input: string): string | null {
  const raw = input.trim();
  if (!raw) return 'Paste a Bring a Trailer listing link.';
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return 'That is not a link. Paste a Bring a Trailer listing link, like https://bringatrailer.com/listing/…';
  }
  if (!BAT_HOSTS.has(u.hostname.toLowerCase())) {
    const site = /carsandbids\.com$/i.test(u.hostname) ? 'Cars & Bids' : /mecum\.com$/i.test(u.hostname) ? 'Mecum' : u.hostname.replace(/^www\./, '');
    return `Bring a Trailer only for now. ${site} listings aren't supported yet. Paste a bringatrailer.com/listing/… link.`;
  }
  if (!/^\/listing\/[^/]+/i.test(u.pathname)) return 'Bring a Trailer only for now, and only listing pages. Paste a bringatrailer.com/listing/… link.';
  return null;
}

/** The URL sent to the advisor: https, as pasted otherwise. */
export function normalizePaste(input: string): string {
  const raw = input.trim();
  return /^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, 'https:') : `https://${raw}`;
}

function priceKindOf(listing: Obj): PriceKind {
  const k = str(listing.price_kind);
  if (k === 'sold') return 'sold';
  if (k === 'high_bid_reserve_not_met') return 'rnm';
  if (k === 'current_bid' || str(listing.listing_kind) === 'auction_live') return 'live';
  if (k === 'ask') return 'ask';
  return 'none';
}

export function relationOf(price: number, low: number, high: number): Relation {
  return price < low ? 'below' : price > high ? 'above' : 'inside';
}

function compTitle(c: Obj): string {
  return str(c.title) ?? [c.year, c.make, c.model].filter(v => v != null && String(v).trim()).join(' ');
}

/** Methodology sentences the card already shows as structure; the rest (missing records, conflicts) are notes. */
const STRUCTURAL_NOTE = /^(Value comes from comparable sales|Comparable sales are adjusted|This car's own sale is not used|Value range comes from the last 12 months)/i;

export function toCheckOutcome(result: { structuredContent?: unknown; isError?: boolean; content?: Array<{ text?: string }> } | null | undefined): CheckOutcome {
  const sc = obj(result?.structuredContent);
  if (!sc) return { kind: 'error', message: 'The advisor sent an answer this page could not read.' };
  if (result?.isError) {
    const msg = str(sc.error) ?? str(result.content?.[0]?.text) ?? 'The advisor could not read this listing.';
    if (str(sc.unsupported_source) || /only for now|aren't supported|isn't supported/i.test(msg)) return { kind: 'refused', message: msg };
    return { kind: 'error', message: msg };
  }
  const listing = obj(sc.listing) ?? {};
  const value = obj(sc.value);
  const priceKind = priceKindOf(listing);
  const price = num(listing.price) ?? num(listing.current_bid) ?? num(listing.sold_price) ?? null;
  const low = num(value?.low);
  const high = num(value?.high);
  const confidence = num(value?.confidence);
  const n = num(value?.n);
  const band = low != null && high != null ? { low, high, confidence, n } : null;
  const comps: Comp[] = arr(sc.comps).map(obj).filter((c): c is Obj => !!c && !!str(c.listing_url) && num(c.sale_price) != null).map(c => ({
    title: compTitle(c),
    price: num(c.sale_price) as number,
    date: str(c.sold_date),
    url: str(c.listing_url) as string,
    platform: str(c.platform) ?? 'bat',
  }));
  const lowConfidence = !band || (confidence != null && confidence < LOW_CONFIDENCE) || (n ?? comps.length) < MIN_COMPS;
  const relation = band && price != null && price > 0 && priceKind !== 'none' ? relationOf(price, band.low, band.high) : null;

  const pos = obj(sc.position);
  const position = pos && str(pos.status) === 'recorded' && num(pos.percentile) != null && num(pos.n) ? {
    percentile: num(pos.percentile) as number, n: num(pos.n) as number, min: num(pos.min) ?? 0, median: num(pos.median) ?? 0, max: num(pos.max) ?? 0, note: str(pos.note),
  } : null;

  const tr = obj(sc.trend);
  const recent = obj(tr?.window_recent);
  const prior = obj(tr?.window_prior);
  const trend = tr && str(tr.status) === 'recorded' && num(tr.change_pct) != null && recent && prior ? {
    direction: (Math.abs(num(tr.change_pct) as number) < 2 ? 'flat' : (num(tr.change_pct) as number) > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat',
    changePct: num(tr.change_pct) as number,
    recentN: num(recent.n) ?? 0, priorN: num(prior.n) ?? 0,
    recentMedian: num(recent.median) ?? 0, priorMedian: num(prior.median) ?? 0,
  } : null;

  const ai = obj(sc.all_in);
  let allIn: CheckCard['allIn'] = null;
  if (ai && str(ai.status) === 'recorded' && num(ai.total) != null) {
    const lines: FeeLine[] = [];
    const cite = (o: Obj | null) => str(obj(o?.citation)?.source_url) ?? str(obj(ai.price_citation)?.source_url);
    if (num(ai.price) != null) lines.push({ label: priceKind === 'sold' ? 'Winning bid' : priceKind === 'rnm' ? 'High bid' : 'Current bid', amount: num(ai.price) as number, estimate: false, sourceUrl: str(obj(ai.price_citation)?.source_url) });
    const fee = obj(ai.buyer_fee);
    if (fee && num(fee.amount) != null) lines.push({ label: 'Buyer fee', amount: num(fee.amount) as number, estimate: false, sourceUrl: cite(fee) });
    const tp = obj(ai.transport);
    if (tp && num(tp.amount) != null) lines.push({ label: 'Transport (estimate)', amount: num(tp.amount) as number, estimate: true, sourceUrl: cite(tp) });
    const pw = obj(ai.paperwork);
    if (pw && num(pw.amount) != null) lines.push({ label: 'Title and registration (estimate)', amount: num(pw.amount) as number, estimate: true, sourceUrl: null });
    allIn = { total: num(ai.total) as number, label: str(ai.label) ?? 'all-in', lines };
  }

  const priorSales: PriorSale[] = arr(sc.prior_sales).map(obj).filter((p): p is Obj => !!p).map(p => ({
    price: num(p.amount) ?? num(p.sale_price) ?? num(p.price),
    date: str(p.on) ?? str(p.sold_date) ?? str(p.date),
    url: str(p.source_url) ?? str(p.listing_url),
    label: str(p.label) ?? str(p.result_type) ?? 'sale',
  }));

  const notes = arr(sc.red_flags).map(str).filter((s): s is string => !!s && !STRUCTURAL_NOTE.test(s));
  const details = [
    num(listing.mileage) != null ? `${(num(listing.mileage) as number).toLocaleString('en-US')} ${listing.mileage_km ? 'km' : 'mi'}${listing.mileage_tmu ? ' (TMU)' : ''}` : null,
    str(listing.transmission),
  ].filter((s): s is string => !!s);

  return {
    kind: 'card',
    url: str(listing.url) ?? '',
    title: str(listing.title) ?? [listing.year, listing.make, listing.model].filter(Boolean).join(' '),
    year: num(listing.year),
    make: str(listing.make),
    model: str(listing.model),
    details,
    priceKind,
    price: price != null && price > 0 ? price : null,
    priceDate: str(obj(sc.subject_sale)?.on) ?? (priceKind === 'sold' || priceKind === 'rnm' ? str(listing.end_at)?.slice(0, 10) ?? str(listing.auction_end_at)?.slice(0, 10) ?? null : null),
    endsAt: priceKind === 'live' ? str(listing.auction_end_at) ?? str(listing.end_at) : null,
    band,
    lowConfidence,
    relation: lowConfidence ? null : relation,
    position,
    trend,
    allIn,
    comps,
    priorSales,
    notes,
    matchedAssetId: str(sc.matched_asset_id),
    asOf: str(sc.as_of),
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (n: number) => usd.format(n);
export function moneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return usd.format(n);
}

/** Why a low-confidence card makes no call, in one plain sentence. */
export function thinReason(c: CheckCard): string {
  if (!c.band) return 'Nuke has no close sales of this one to compare it with, so it won\u2019t name a fair price.';
  const n = c.band.n ?? c.comps.length;
  if (n < MIN_COMPS) return `Nuke found only ${n} close ${n === 1 ? 'sale' : 'sales'}, too few to name a fair price.`;
  return `The ${n} closest sales are too far apart to name a fair price for this one.`;
}

/** The headline sentence: what the price is, against the range; or that there is no call to make. */
export function verdictLine(c: CheckCard): string {
  if (c.lowConfidence) return c.band ? 'Not enough close sales to call this one' : 'Not enough sales to price this one';
  const where = c.relation === 'below' ? 'below' : c.relation === 'above' ? 'above' : 'within';
  if (c.priceKind === 'sold') return `Sold ${where} what similar cars sold for`;
  if (c.priceKind === 'rnm') return `Bidding stopped ${where} the range; reserve not met`;
  if (c.priceKind === 'live') return c.price ? `Current bid is ${where} what similar cars sold for` : 'No bids yet';
  return `Similar cars sold ${moneyShort(c.band!.low)}–${moneyShort(c.band!.high)}`;
}

export function priceLabel(c: CheckCard): string {
  if (c.priceKind === 'sold') return 'Sold for';
  if (c.priceKind === 'rnm') return 'Bid to (reserve not met)';
  if (c.priceKind === 'live') return c.price ? 'Current bid' : 'Live auction';
  if (c.priceKind === 'ask') return 'Asking';
  return 'Price';
}

/** "ends in 2d 4h" / "ends in 35m" / "ended"; null without a clock. */
export function endsIn(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) return 'ending now';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return `ends in ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`}`;
}

/** 0–100 position of a value on the rail spanning the comps and the range. */
export function railSpan(c: CheckCard): { min: number; max: number } | null {
  const vals = [...c.comps.map(x => x.price), c.band?.low, c.band?.high, c.price].filter((v): v is number => typeof v === 'number' && v > 0);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  return max > min ? { min, max } : null;
}
export const railPct = (v: number, s: { min: number; max: number }) => Math.max(0, Math.min(100, ((v - s.min) / (s.max - s.min)) * 100));
