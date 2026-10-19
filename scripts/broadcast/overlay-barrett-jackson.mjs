/** Read one Barrett-Jackson livestream lower-third ("LOT #948.1   $16,000" over "1982 CHEVROLET C10 CUSTOM PICKUP").
 * Input is OCR lines for a frame cropped to the lower-right box; boxes are [x, y, w, h] in 0..1 of that crop.
 * Returns null when the frame carries no settled lot overlay. The livestream box shows no sale name and no
 * status (no SOLD, reserve or no-sale text), so sale and status are always null here; the sale comes from
 * the video title through barrettJacksonSaleFromMeta. A displayed number is reported as shown, never as an
 * accepted bid or a sale.
 */

// The box always renders "LOT #<n>". Vision reads the "#" as "$", ":", "·", "-" or "=" at times, which is
// kept, and as a digit at others ("LOT 8401" for #401), which is why a bare "LOT <digits>" is refused.
const LOT = /(?:L[O0D]|^[O0О])T\s*[#$S:·.=-]\s*(\d{1,4}(?:\.\d{1,2})?)$/;
const MONEY = /^(?:\$\s?(\d{1,3}(?:[,.]\d{3})+|\d{2,4})|S(\d{1,3}(?:[,.]\d{3})+))$/;
// Before the box slides fully in, the label sits further right and its text is clipped.
const LOT_X_MAX = 0.65;
const LOT_Y_MAX = 0.45;

const money = digits => Number(digits.replace(/[,.]/g, ''));

export function parseBarrettJacksonOverlay(lines) {
  const text = lines.map(l => ({ ...l, t: l.text.trim().toUpperCase() })).filter(l => l.t);
  let lotLine = null; let lot = null;
  for (const l of text) {
    const m = l.t.match(LOT);
    if (m && l.box[0] < LOT_X_MAX && l.box[1] < LOT_Y_MAX) { lotLine = l; lot = m[1]; break; }
  }
  if (!lot) return null;
  const [lx, ly, , lh] = lotLine.box;

  let bid = null;
  const bidLine = text.find(l => l !== lotLine && l.box[0] > lx && Math.abs(l.box[1] - ly) < lh && MONEY.test(l.t));
  if (bidLine) {
    const [, dollars, sDollars] = bidLine.t.match(MONEY);
    // "$0" is the placeholder shown before the first bid.
    bid = money(dollars ?? sDollars) || null;
  }

  const titleLines = text
    .filter(l => l.box[1] > ly + lh * 0.8 && l.box[0] + l.box[2] > 0.8 && !MONEY.test(l.t))
    .sort((a, b) => a.box[1] - b.box[1]);
  const title = titleLines.length ? titleLines.map(l => l.t).join(' ') : null;

  return { publisher: 'barrett_jackson', lot, title, sale: null, displayed_bid: bid, displayed_ask: null, status: null };
}

const VENUES = [
  ['scottsdale', /\b(?:scottsdale|westworld)\b/],
  ['palm-beach', /\bpalm[\s-]*beach\b/],
  ['las-vegas', /\blas[\s-]*vegas\b/],
  ['houston', /\bhouston\b/],
  ['new-orleans', /\bnew[\s-]*orleans\b/],
  ['northeast', /\b(?:northeast|uncasville|mohegan)\b/],
  ['reno', /\breno\b/],
  ['orange-county', /\borange[\s-]*county\b/],
  ['petersen-museum', /\bpetersen\b/],
];

/** One key per Barrett-Jackson sale ("scottsdale-fall-2024") from a docket URL slug, a video title or an
 * on-screen sale name. Null unless exactly one venue and one year are named. Online sales are left out:
 * several share a venue and year, and the stored slugs do not tell them apart from a title. */
export function barrettJacksonSaleKey(value) {
  const s = String(value ?? '').toLowerCase();
  if (/\bonline\b|\beclassics\b/.test(s)) return null;
  const venues = VENUES.filter(([, re]) => re.test(s)).map(([name]) => name);
  const years = [...new Set(s.match(/\b20\d{2}\b/g) ?? [])];
  if (venues.length !== 1 || years.length !== 1) return null;
  const season = /\bfall\b/.test(s) ? 'fall' : venues[0] === 'scottsdale' && /\bmarch\b/.test(s) ? 'march' : null;
  return [venues[0], season, years[0]].filter(Boolean).join('-');
}

/** The sale named by a livestream's title, or by meta.sale_hint ({ value, source }) when the title names
 * none ("Barrett-Jackson 2025 Fall Auction" has no venue). A hint that disagrees with the title, or a sale
 * whose year is not the year the video was published, gives null. */
export function barrettJacksonSaleFromMeta(meta) {
  const fromTitle = barrettJacksonSaleKey(meta?.title);
  const fromHint = barrettJacksonSaleKey(meta?.sale_hint?.value);
  if (fromTitle && fromHint && fromTitle !== fromHint) return null;
  const sale = fromTitle ?? fromHint;
  if (!sale || (meta.published_at && !sale.endsWith(`-${meta.published_at.slice(0, 4)}`))) return null;
  return { sale, basis: fromTitle ? 'video_title' : meta.sale_hint.source };
}

export function barrettJacksonEventSaleKey(event) {
  try { return barrettJacksonSaleKey(new URL(event.source_url).pathname.split('/')[1]); } catch { return null; }
}
