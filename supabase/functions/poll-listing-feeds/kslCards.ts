/**
 * Search-card facts from a KSL Cars search page, read from the page the poller already fetched (free direct fetch).
 * The Next.js flight payload carries each result card: id, makeYear, sellerType (Private / Dealership), createdAt, price.
 * They are written to source_targets as discovered-not-fetched rows, so a paused source can still show its supply and its
 * tier share without a Firecrawl credit.
 */
export interface KslCard {
  listing_id: string;
  url: string;
  year: number | null;
  /** The card's own sellerType word, lower-cased: private | dealership | ... */
  seller_type: string | null;
  created_at: string | null;
  price: number | null;
}

function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* skip */ }
  }
  return out;
}

function balanced(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

export function parseKslSearchCards(html: string): KslCard[] {
  const flight = flightText(html);
  const at = flight.indexOf('"results":[[');
  if (at < 0) return [];
  let pos = at + '"results":[['.length;
  const cards: KslCard[] = [];
  while (flight[pos] === "{") {
    const raw = balanced(flight, pos);
    if (!raw) break;
    pos += raw.length;
    if (flight[pos] === ",") pos++;
    try {
      const c = JSON.parse(raw);
      if (!c?.id) continue;
      const year = Number.isInteger(c.makeYear) && c.makeYear > 1885 && c.makeYear < 2100 ? c.makeYear : null;
      cards.push({
        listing_id: String(c.id),
        url: `https://cars.ksl.com/listing/${c.id}`,
        year,
        seller_type: typeof c.sellerType === "string" && c.sellerType.trim() ? c.sellerType.trim().toLowerCase() : null,
        created_at: typeof c.createdAt === "number" && c.createdAt > 1e9 ? new Date(c.createdAt * 1000).toISOString() : null,
        price: typeof c.price === "number" && c.price > 0 ? c.price : null,
      });
    } catch { /* skip a card that does not parse */ }
  }
  return cards;
}

/** KSL's published result count, not the number of cards on this page. Refuse conflicting counts and challenge pages. */
export function parseKslSearchCount(html: string): number | null {
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  if (/confirm you are|verify you are|captcha/i.test(visible)) return null;
  const counts = [...visible.matchAll(/(?<![\d,])(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*) results?\b/g)]
    .map((m) => Number(m[1].replaceAll(",", "")));
  return counts.length && counts.every((n) => Number.isSafeInteger(n) && n === counts[0]) ? counts[0] : null;
}
