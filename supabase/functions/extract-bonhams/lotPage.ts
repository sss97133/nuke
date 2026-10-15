// A Bonhams lot page, read for what the search index does not carry: the whole photo gallery at full size, the sale's
// name, venue and dates, the footnotes and the condition-report link. The page is a Next.js shell whose __NEXT_DATA__ holds
// the lot and its auction; nothing is rendered. Pure functions, tested in lotPage.test.ts.
import { htmlToText } from '../_shared/htmlToText.ts';

export interface LotPage {
  images: Array<{ url: string; primary: boolean }>;
  catalog_text: string | null;
  footnotes: string | null;
  chassis: string | null;
  engine_number: string | null;
  registration: string | null;
  sale_name: string | null;
  sale_venue: string | null;
  sale_starts_on: string | null;
  sale_ends_on: string | null;
  number_of_lots: number | null;
  condition_report_url: string | null;
  hammer_price: number | null;
  hammer_premium: number | null;
  currency: string | null;
  without_reserve: boolean | null;
  raw: Record<string, unknown>;
}

/** A page that is not a lot page (a challenge, an error shell) comes back null; the caller must not treat it as data. */
export function parseLotPage(html: string): LotPage | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: any;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const lot = data?.props?.pageProps?.lot;
  const auction = data?.props?.pageProps?.auction;
  if (!lot || typeof lot !== 'object' || lot.iSaleLotNoUnique == null) return null;

  // Full size: the image URL with its crop parameters removed is the original (4315 x 2880 on the sampled lot).
  const seen = new Set<string>();
  const images: LotPage['images'] = [];
  for (const img of Array.isArray(lot.images) ? lot.images : []) {
    const raw = typeof img?.image_url === 'string' ? img.image_url : '';
    if (!/^https:\/\/[a-z0-9.-]*bonhams\.com\//i.test(raw)) continue;
    const url = raw.split('&')[0];
    if (seen.has(url)) continue;
    seen.add(url);
    images.push({ url, primary: !!img.lPrimary });
  }

  const catalog = typeof lot.sCatalogDesc === 'string' ? htmlToText(lot.sCatalogDesc) : '';
  const grab = (label: string) => catalog.match(new RegExp(`${label}\\s*:?\\s*([A-Z0-9*][A-Za-z0-9*./-]*(?: [A-Z0-9][A-Za-z0-9*./-]*)?)`, 'i'))?.[1] ?? null;
  const foot = [lot.footnote_sExtraDesc, lot.sExtraDesc].filter((x) => typeof x === 'string' && x.trim()).map((x: string) => htmlToText(x)).filter(Boolean);

  const starts: string[] = (auction?.dates?.start ?? []).map((s: any) => String(s?.date?.datetime ?? '').slice(0, 10)).filter(Boolean).sort();
  const end = String(auction?.dates?.end?.datetime ?? '').slice(0, 10);
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null);
  const cond = typeof lot.sCondition === 'string' && /^https:\/\//.test(lot.sCondition) ? lot.sCondition : null;

  return {
    images,
    catalog_text: catalog || null,
    footnotes: foot.length ? foot.join('\n\n') : null,
    chassis: grab('Chassis no\\.?')?.replace(/[./-]+$/, '').toUpperCase().split(' ')[0] ?? null,
    engine_number: grab('Engine no\\.?')?.toUpperCase().split(' ')[0] ?? null,
    registration: catalog.match(/Registration no\.?\s*:?\s*([^\n(]{2,20})/i)?.[1]?.trim() ?? null,
    sale_name: htmlToText(String(auction?.sSaleName ?? '')) || null,
    sale_venue: htmlToText(String(auction?.sVenue ?? '')) || null,
    sale_starts_on: starts[0] ?? null,
    sale_ends_on: end || starts[starts.length - 1] || null,
    number_of_lots: num(auction?.number_of_lots),
    condition_report_url: cond,
    hammer_price: num(lot.dHammerPrice),
    hammer_premium: num(lot.dHammerPremium),
    currency: lot.currency?.iso_code ?? null,
    without_reserve: typeof lot.lWithoutReserve === 'boolean' ? lot.lWithoutReserve : null,
    // The retained capture: the lot and its auction, without the neighbouring-lot and related-lot lists.
    raw: { lot: { ...lot, prev_next_lot: undefined, relatedLots: undefined }, auction: { ...auction, highlights: undefined, groups: undefined, aggregated: undefined } },
  };
}
