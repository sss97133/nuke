// Pure readers for a retained Cars & Bids page capture (rendered html, scripts stripped). No I/O.
// parseCabDepth reads what the older parseCabHtml misses: the full description (balanced section blocks), the comment and
// bid stream, seller and buyer identities, the end moment, the outcome from the stats band and the gallery photos.

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };
// One pass, so "&amp;lt;" stops at "&lt;".
export const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, k: string) => {
    const key = k.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    const n = key.startsWith("#x") ? parseInt(key.slice(2), 16) : key.startsWith("#") ? parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });

const stripTags = (s: string) => { let prev; do { prev = s; s = s.replace(/<[^>]*>/g, " "); } while (s !== prev); return s; };

export const textOf = (html: string) => {
  const spaced = html.replace(/<svg[\s\S]*?<\/svg>/gi, "\u0001").replace(/<(?:\/p|\/li|\/h\d|br\s*\/?)>/gi, "\n")
    .replace(/<\/?(?:b|i|u|em|strong|a|span|small|sup|sub)\b[^>]*>/gi, "\u0001"); // sentinel, so removed tags cannot join into a new one
  // Strip, decode, strip again: an encoded "&lt;iframe" must not come out as a tag.
  return stripTags(decode(stripTags(spaced))).replace(/\u0001/g, "")
    .replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
};

/** Inner html of the element whose opening tag starts at `start` (tag name taken from the tag), balanced on nested same-name tags. */
export function balanced(html: string, start: number): string | null {
  const open = html.slice(start).match(/^<([a-z0-9]+)\b[^>]*>/i);
  if (!open) return null;
  const name = open[1].toLowerCase();
  const re = /<(\/?)([a-z0-9]+)\b[^>]*>/gi;
  re.lastIndex = start + open[0].length;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[2].toLowerCase() !== name) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start + open[0].length, m.index);
  }
  return null;
}

export interface CabSection { key: string; heading: string; text: string }
export interface CabComment {
  id: string; author: string; profileUrl: string | null; role: string | null; postedAt: string | null;
  text: string; likes: number; replyTo: string | null; bidAmount: number | null; isSeller: boolean; edited: boolean;
}
export interface CabDepth {
  sections: CabSection[];
  fullDescription: string | null;
  comments: CabComment[];
  seller: { name: string; profileUrl: string } | null;
  buyer: { name: string; profileUrl: string | null } | null;
  currentBidder: string | null;
  endedAt: string | null;
  endedPhrase: string | null;
  outcome: "sold" | "reserve_not_met" | "ended" | "active";
  amount: number | null;
  bidCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  watchingCount: number | null;
  photos: string[];
  photoCountClaimed: number | null;
}

const num = (s?: string | null) => { const n = parseInt((s ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; };

// Photo identity. A render is media.carsandbids.com/cdn-cgi/image/<options>/<hash>/photos/[<folder>/]<set>-<photo>...: the
// 8-character set id is shared by one listing's gallery; the hash is not (other lots share it). Seller-named files have no set id.
export const cabPhotoKey = (url: string) => url.replace(/^.*\/cdn-cgi\/image\/[^/]*\//, "").split("?")[0];
export const cabPhotoSet = (url: string): string | null => url.match(/\/photos\/(?:[a-z]+\/)?([A-Za-z0-9_-]{8})-/)?.[1] ?? null;
const MEDIA_URL = /https:\/\/media\.carsandbids\.com\/[^"'\s)>]+/gi;

/** Photo keys inside links to another auction: the similar-auctions, ending-soon and new-listings cards. */
export function cabOtherLotPhotoKeys(html: string, lotId: string | null): Set<string> {
  const keys = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(?:https:\/\/(?:www\.)?carsandbids\.com)?\/auctions\/([A-Za-z0-9]+)[^"]*"[^>]*>/gi)) {
    if (lotId && m[1].toLowerCase() === lotId.toLowerCase()) continue;
    const inner = balanced(html, m.index!);
    if (inner) for (const u of inner.matchAll(MEDIA_URL)) keys.add(cabPhotoKey(decode(u[0])));
  }
  return keys;
}

/** The photos inside the gallery element (div.gallery-preview), minus any card for another lot. */
function galleryUrls(html: string, foreign: Set<string>): string[] {
  const gAt = html.search(/<div class="gallery-preview\b[^"]*"/);
  const block = gAt >= 0 ? balanced(html, gAt) : null;
  if (!block) return [];
  return [...block.matchAll(/<img[^>]+src="(https:\/\/media\.carsandbids\.com\/[^"]+)"/g)]
    .map((m) => decode(m[1])).filter((u) => !foreign.has(cabPhotoKey(u)));
}

/** Every page photo of this lot: the gallery's, plus any other render of them or photo sharing their set id. Without a gallery, none. */
export function cabLotPhotos(html: string, lotId: string | null): string[] {
  const foreign = cabOtherLotPhotoKeys(html, lotId);
  const gallery = galleryUrls(html, foreign);
  const keys = new Set(gallery.map(cabPhotoKey));
  const sets = new Set(gallery.map(cabPhotoSet).filter((s): s is string => !!s));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(MEDIA_URL)) {
    const url = decode(m[0]);
    const key = cabPhotoKey(url);
    const set = cabPhotoSet(url);
    if (seen.has(key) || foreign.has(key) || !(keys.has(key) || (set && sets.has(set)))) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** "October 13, 2026 @ 10:16 PM" is Eastern wall time (the capture's browser zone); returns UTC ISO. */
export function easternToIso(label: string): string | null {
  const m = label.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+@\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const month = new Date(`${m[1]} 1, 2000 UTC`).getUTCMonth();
  if (Number.isNaN(month)) return null;
  let hour = parseInt(m[4], 10) % 12; if (m[6].toUpperCase() === "PM") hour += 12;
  const wall = Date.UTC(parseInt(m[3], 10), month, parseInt(m[2], 10), hour, parseInt(m[5], 10));
  for (const off of [4, 5]) { // EDT then EST: keep the offset whose New York wall time matches
    const t = wall + off * 3_600_000;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).formatToParts(new Date(t));
    if (parseInt(parts.find((p) => p.type === "hour")!.value, 10) % 24 === hour) return new Date(t).toISOString();
  }
  return null;
}

/** "Ending October 16th at 2:21 PM EDT" / "Ended February 11th at 2:14 PM EST" plus "2/11/26" on ended pages. */
export function parseEnd(phrase: string, shortDate: string | null, fetchedAt: Date): string | null {
  const m = phrase.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(E[DS]T)/i);
  if (!m) return null;
  const month = new Date(`${m[1]} 1, 2000 UTC`).getUTCMonth();
  if (Number.isNaN(month)) return null;
  let hour = parseInt(m[3], 10) % 12; if (m[5].toUpperCase() === "PM") hour += 12;
  const off = m[6].toUpperCase() === "EDT" ? 4 : 5;
  const sd = shortDate?.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  let year = sd ? 2000 + parseInt(sd[3], 10) : fetchedAt.getUTCFullYear();
  let t = Date.UTC(year, month, parseInt(m[2], 10), hour + off, parseInt(m[4], 10));
  if (!sd) {
    const ending = /ending/i.test(phrase);
    if (ending && t < fetchedAt.getTime() - 86_400_000) t = Date.UTC(year + 1, month, parseInt(m[2], 10), hour + off, parseInt(m[4], 10));
    if (!ending && t > fetchedAt.getTime() + 86_400_000) t = Date.UTC(year - 1, month, parseInt(m[2], 10), hour + off, parseInt(m[4], 10));
  }
  return new Date(t).toISOString();
}

const SECTION_HEADINGS: Record<string, string> = {
  "dougs-take": "Doug's Take", highlights: "Highlights", equipment: "Equipment", modifications: "Modifications",
  known_flaws: "Known Flaws", recent_service_history: "Recent Service History", other_items: "Other Items Included in Sale",
  ownership_history: "Ownership History", seller_notes: "Seller Notes",
};

export function parseCabDepth(html: string, fetchedAt: Date, lotId: string | null = null): CabDepth {
  // Sections
  const sections: CabSection[] = [];
  for (const m of html.matchAll(/<div class="detail-section\s+([^"]*)"/g)) {
    const key = m[1].trim().replace(/^detail-/, "").split(/\s+/)[0];
    const inner = balanced(html, m.index!);
    if (!inner) continue;
    const bodyAt = inner.search(/<div class="detail-body[^"]*"/);
    const body = bodyAt >= 0 ? balanced(inner, bodyAt) : inner;
    const text = body ? textOf(body) : "";
    const heading = textOf(inner.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1] ?? "") || SECTION_HEADINGS[key] || key;
    if (text) sections.push({ key, heading, text });
  }
  const fullDescription = sections.length ? sections.map((s) => `${s.heading}\n${s.text}`).join("\n\n") : null;

  // Comment and bid stream
  const comments: CabComment[] = [];
  const cAt = html.indexOf("cnb-details-comments");
  const stream = cAt >= 0 ? html.slice(cAt) : html;
  const starts = [...stream.matchAll(/<li data-id="([^"]+)" id="comment-[^"]+" class="(?:comment|bid)\b[^"]*">/g)];
  starts.forEach((m, i) => {
    const chunk = stream.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : m.index! + 20000);
    const author = chunk.match(/class="user" href="([^"]*)">([^<]*)</);
    const timeLabel = chunk.match(/class="time"[^>]*title="([^"]+)"/)?.[1] ?? "";
    const tag = chunk.match(/<span class="cnb-[a-z]+-tag\s*">([^<]*)</)?.[1] ?? null;
    const msgAt = chunk.indexOf('<div class="message">');
    const msg = msgAt >= 0 ? balanced(chunk, msgAt) : null;
    const bid = chunk.match(/class="placed-bid[^"]*"[\s\S]*?class="bid-value">\$?([\d,]+)/);
    const reply = chunk.match(/data-username="([^"]*)"/);
    const likes = num(chunk.match(/btn-upvote[^>]*>[\s\S]*?<\/svg>\s*(\d+)\s*<\/button>/)?.[1]);
    const text = msg ? textOf(msg.replace(/<button[\s\S]*?<\/button>/gi, "")) : bid ? `Bid $${bid[1]}` : "";
    if (!author || !text) return;
    comments.push({
      id: m[1], author: decode(author[2]).trim(),
      profileUrl: author[1] || null, role: tag ? decode(tag).trim() : null, postedAt: easternToIso(decode(timeLabel)),
      text, likes: likes ?? 0, replyTo: reply ? decode(reply[1]) : null, bidAmount: bid ? num(bid[1]) : null,
      isSeller: /^seller$/i.test(tag ?? ""), edited: /\bedited\b/i.test(chunk.slice(0, 2500)),
    });
  });

  // Seller, buyer, bidder
  const sd = html.match(/<dd class="seller">[\s\S]*?class="user" href="([^"]+)"[^>]*>([^<]*)</);
  const soldTo = html.match(/<h4>Sold to<\/h4><div class="username">[\s\S]*?title="([^"]+)" class="usericon" href="([^"]*)"/) ||
    html.match(/<h4>Sold to<\/h4><div class="username">[\s\S]*?class="usericon" href="([^"]*)"/);
  const cur = html.match(/<h4>Current Bid<\/h4><div class="username">[\s\S]*?title="([^"]+)" class="usericon"/);
  const buyerName = html.match(/<h4>Sold to<\/h4><div class="username">[\s\S]*?<a title="([^"]+)" class="usericon" href="([^"]*)"/);

  // Outcome and price from the stats band
  const band = html.match(/<ul class="bid-stats">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const bandText = textOf(band).replace(/\n/g, " ");
  const ended = /class="bid-bar\s+ended/.test(html) || /<li class="ended"/.test(band);
  const amount = num(band.match(/class="bid-value">\$?([\d,]+)/)?.[1]);
  const outcome: CabDepth["outcome"] = !ended ? "active" : /Sold for/i.test(bandText) ? "sold" : /reserve not met/i.test(bandText) ? "reserve_not_met" : "ended";
  const phrase = html.match(/class="end-time">([^<]*)</)?.[1] ?? null;
  const shortDate = band.match(/class="time-ended">([^<]*)</)?.[1] ?? null;

  // Gallery photos: only the gallery block (avatars and the cards for other lots are elsewhere on the page)
  const photos: string[] = [];
  const seen = new Set<string>();
  for (const u of galleryUrls(html, cabOtherLotPhotoKeys(html, lotId))) {
    const url = u.replace(/\?.*$/, "").replace(/\/cdn-cgi\/image\/[^/]*\//, "/cdn-cgi/image/width=2080,quality=70/");
    const id = cabPhotoKey(url);
    if (!seen.has(id)) { seen.add(id); photos.push(url); }
  }

  const statLabel = (label: string) => num(html.match(new RegExp(`<div class="th">${label}</div><div class="td [a-z-]+">([\\d,]+)<`))?.[1]);

  return {
    sections, fullDescription, comments,
    seller: sd ? { name: decode(sd[2]).trim(), profileUrl: sd[1] } : null,
    buyer: outcome === "sold" && buyerName ? { name: decode(buyerName[1]).trim(), profileUrl: buyerName[2] || null } : null,
    currentBidder: cur ? decode(cur[1]).trim() : null,
    endedAt: phrase ? parseEnd(decode(phrase), shortDate, fetchedAt) : null,
    endedPhrase: phrase ? decode(phrase).trim() : null,
    outcome, amount,
    bidCount: num(band.match(/num-bids[\s\S]*?class="value">([\d,]+)/)?.[1]),
    commentCount: num(band.match(/num-comments[\s\S]*?class="value">([\d,]+)/)?.[1]),
    viewCount: statLabel("Views"), watchingCount: statLabel("Watching"),
    photos, photoCountClaimed: num(html.match(/All Photos \((\d+)\)/)?.[1]),
  };
}
