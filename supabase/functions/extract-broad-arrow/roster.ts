// Broad Arrow's public roster, read without a lot page: the /vehicles listing (cards: lot code, year make model, sale name,
// estimate, first images) and each sale's /events/event/<name> page (run day and place). The site is server-rendered, so a plain
// fetch of those pages carries everything the calendar needs. Pure functions, tested in roster.test.ts.

export interface RosterCard {
  url: string;          // https://www.broadarrowauctions.com/vehicles/lv26_r0006/2003-ferrari-enzo
  code: string;         // lv26
  lot_id: string;       // r0006
  lot_number: string;   // "6"
  slug: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_name: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  currency: string | null;
  image_urls: string[];
}

const CURRENCY: Array<[RegExp, string]> = [[/€/, 'EUR'], [/£/, 'GBP'], [/CHF/i, 'CHF'], [/\$/, 'USD']];

function text(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function money(s: string): number | null {
  const m = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : null;
}

/** The lot cards of a /vehicles listing page. A card without a lot link is skipped. */
export function parseListingCards(html: string): RosterCard[] {
  const out: RosterCard[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split("<div class='ft-vehicle-item grid-block'").slice(1)) {
    const href = chunk.match(/href="(\/vehicles\/([a-z0-9]+)_([a-z0-9]+)\/([a-z0-9-]+))"/i);
    if (!href || seen.has(href[1])) continue;
    seen.add(href[1]);
    const spans = [...(chunk.match(/<div class='name-auto'>([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/<span>([^<]*)<\/span>/g)].map((m) => text(m[1]));
    const year = /^\d{4}$/.test(spans[0] ?? '') ? Number(spans[0]) : null;
    const sale = text(chunk.match(/<div class='top'>\s*<span>([\s\S]*?)<\/span>\s*<\/div>\s*<div class='mid'>/)?.[1] ?? '') || null;
    const est = text(chunk.match(/<div class='bot'>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const nums = [...est.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Math.round(Number(m[0])));
    const images = (chunk.match(/data-images='([^']*)'/)?.[1] ?? '').split(',').filter((u) => /^https:\/\//.test(u));
    out.push({
      url: `https://www.broadarrowauctions.com${href[1]}`,
      code: href[2].toLowerCase(), lot_id: href[3].toLowerCase(), slug: href[4],
      lot_number: String(Number(href[3].replace(/\D/g, '')) || ''),
      year, make: spans[1] || null, model: spans.slice(2).filter(Boolean).join(' ') || null, sale_name: sale,
      estimate_low: nums.length >= 1 ? nums[0] : null, estimate_high: nums.length >= 2 ? nums[1] : null,
      currency: CURRENCY.find(([re]) => re.test(est))?.[1] ?? null,
      image_urls: images,
    });
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export interface RosterEvent { starts_on: string | null; ends_on: string | null; days: string[]; location: string | null }

/** Run day(s) and place of a sale from its event page: "7 November 2026", "13 - 15 August 2026", then "The Dolder Grand - Zürich, Switzerland". */
export function parseEventPage(html: string, saleName: string): RosterEvent {
  // Fold accents to find the sale name ("Zürich" on a card, "Zurich" on its page); the text itself keeps its accents. Folding
  // precomposed letters keeps the length, so an index in the folded text is an index in the original.
  const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const t = text(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' '));
  const ft = fold(t);
  const name = fold(saleName);
  let starts: string | null = null, ends: string | null = null, at = -1;
  // The page title also names the sale; the occurrence that has a date just before it is the heading.
  for (let i = ft.indexOf(name); i >= 0; i = ft.indexOf(name, i + 1)) {
    const m = ft.slice(Math.max(0, i - 40), i).match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+([A-Za-z]+)\s+(\d{4})\s*$/);
    if (!m) continue;
    const mo = MONTHS.indexOf(m[3].toLowerCase());
    if (mo < 0) continue;
    const iso = (d: string) => `${m[4]}-${String(mo + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
    starts = iso(m[1]);
    ends = iso(m[2] ?? m[1]);
    at = i;
    break;
  }
  const days: string[] = [];
  if (starts && ends) {
    for (let d = Date.parse(`${starts}T00:00:00Z`); d <= Date.parse(`${ends}T00:00:00Z`) && days.length < 14; d += 86400000) days.push(new Date(d).toISOString().slice(0, 10));
  }
  const loc = at >= 0 ? t.slice(at + name.length).match(/^\s*(.{3,90}?)\s+Back to Auctions/) : null;
  return { starts_on: starts, ends_on: ends, days, location: loc ? loc[1].trim() : null };
}

export { money };
