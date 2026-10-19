/** Read one Mecum broadcast lower-third ("LOT S114 | 1967 CHEVROLET ... | $140,000 CURRENT BID").
 * Input is OCR lines for a frame cropped to the top band; boxes are [x, y, w, h] in 0..1 of that crop.
 * Returns null when the frame carries no lot overlay. Nothing here interprets a displayed number as an
 * accepted bid or a sale; it reports what the screen showed.
 */

const LOT = /^(?:LOT\s*)?([A-Z]{1,2}\d{1,4}(?:\.\d{1,2})?)$/;
const SALE = /^([A-Z][A-Z .'&-]{2,}?)\s+((?:19|20)\d{2})$/;
const TITLE = /^((?:19|20)\d{2})\s+[A-Z0-9]/;
const MONEY = /^\$\s?(\d{1,3}(?:[,.]\d{3})+|\d{3,})\b/;
const ASK = /^[*=+]\s?(\d{1,3}(?:[,.]\d{3})+)$/;

// The SOLD stamp animates over the right end of the lower-third (x ~0.60-0.70 of the band) and is often
// legible in a single frame; SOLD elsewhere in the band is stage signage.
const SOLD_STAMP_X = [0.55, 0.72];

const STATUS_RULES = [
  ['sold', /^SOLD\W{0,2}$/],
  ['reserve_off', /^RESERVE\s+OF[FE]$/],
  ['bid_goes_on', /GOES\s+ON/],
  ['no_sale', /^NO\s+SALE$/],
  ['high_bid', /^HIGH\s+BID$/],
  ['current_bid', /^CURRENT\s+BID$/],
];

const money = digits => Number(digits.replace(/[,.]/g, ''));

export function parseMecumOverlay(lines) {
  const text = lines.map(l => ({ ...l, t: l.text.trim().toUpperCase() })).filter(l => l.t);
  const lotLabel = text.find(l => l.t === 'LOT');
  let lot = null; let lotLine = null;
  for (const l of text) {
    const underLabel = lotLabel && Math.abs(l.box[0] - lotLabel.box[0]) < 0.04;
    // Under the SOLD animation the S prefix reads as "$" ("$99" for S99); only in the lot box.
    const token = underLabel ? l.t.replace(/^\$(?=\d{1,4}(?:\.\d{1,2})?$)/, 'S') : l.t;
    const m = token.match(LOT);
    if (!m || l.t === 'LOT') continue;
    if (l.t.startsWith('LOT') || underLabel) { lot = m[1]; lotLine = l; break; }
  }
  if (!lot) return null;

  const titleLine = text.find(l => TITLE.test(l.t) && !MONEY.test(l.t));
  let title = titleLine?.t ?? null;
  if (titleLine) {
    const [x, y, , h] = titleLine.box;
    const next = text.find(l => l !== titleLine && Math.abs(l.box[0] - x) < 0.02 && l.box[1] > y && l.box[1] - y < h * 2.2
      && !MONEY.test(l.t) && !STATUS_RULES.some(([, re]) => re.test(l.t)));
    if (next) title = `${title} ${next.t}`;
  }

  let bid = null; let ask = null; let status = null; let sale = null;
  for (const l of text) {
    if (l === lotLine) continue;
    const m = l.t.match(MONEY);
    if (m && bid === null) bid = money(m[1]);
    const a = l.t.match(ASK);
    if (a && ask === null) ask = money(a[1]);
    const s = l.t.match(SALE);
    if (s && !TITLE.test(l.t) && sale === null) sale = `${s[1].trim()} ${s[2]}`;
  }
  // STATUS_RULES is in priority order: an outcome stamp outranks the "RESERVE OFF" / "CURRENT BID" caption.
  for (const [name, re] of STATUS_RULES) {
    if (status !== null) break;
    if (text.some(l => re.test(l.t) && (name !== 'sold' || (l.box[0] >= SOLD_STAMP_X[0] && l.box[0] <= SOLD_STAMP_X[1])))) status = name;
  }
  return { publisher: 'mecum', lot, title, sale, displayed_bid: bid, displayed_ask: ask, status };
}
