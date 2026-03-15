/**
 * _shared/batParser.ts — Shared BaT HTML parsing functions
 *
 * Extracted from extract-bat-core/index.ts and bat-snapshot-parser/index.ts.
 * Both original functions import from here — single source of truth for all BaT parsing.
 *
 * Version: 1.0.0
 */

export const BAT_PARSER_VERSION = "batParser:1.0.0";

// ─── Utility helpers ─────────────────────────────────────────────────

export function decodeBasicEntities(text: string): string {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#038;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => {
      try {
        return String.fromCharCode(parseInt(String(code), 10));
      } catch {
        return _m;
      }
    })
    .replace(/&#x([a-fA-F0-9]+);/g, (_m, code) => {
      try {
        return String.fromCharCode(parseInt(String(code), 16));
      } catch {
        return _m;
      }
    });
}

export function stripTags(htmlText: string): string {
  return decodeBasicEntities(String(htmlText || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCaseToken(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  if (t.length <= 2) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function titleCaseWords(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base : `${base}/`;
  }
}

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }
}

export function normalizeBatImageUrl(raw: string): string {
  const s = decodeBasicEntities(String(raw || "").trim());
  if (!s) return "";
  return s
    .split("#")[0]
    .split("?")[0]
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/-scaled\./g, ".")
    .trim();
}

export function upgradeBatImageUrl(url: string): string {
  if (!url || typeof url !== "string" || !url.includes("bringatrailer.com")) return url;
  return url
    .replace(/&#038;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[?&]w=\d+/g, "")
    .replace(/[?&]h=\d+/g, "")
    .replace(/[?&]resize=[^&]*/g, "")
    .replace(/[?&]fit=[^&]*/g, "")
    .replace(/[?&]quality=[^&]*/g, "")
    .replace(/[?&]strip=[^&]*/g, "")
    .replace(/[?&]+$/, "")
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, ".$1")
    .trim();
}

// ─── Multi-word make map ────────────────────────────────────────────
// Used by URL slug parser. Extended from original 4 entries.
export const multiWordMakes: Record<string, string> = {
  alfa: "Alfa Romeo",
  mercedes: "Mercedes-Benz",
  land: "Land Rover",
  aston: "Aston Martin",
  rolls: "Rolls-Royce",
  austin: "Austin-Healey",
  de: "De Tomaso",
  am: "AM General",
  range: "Range Rover",
};

// ─── Title cleaning ─────────────────────────────────────────────────

export function cleanBatTitle(raw: string): string {
  let t = stripTags(raw);
  t = t
    .replace(/\s+for sale on BaT Auctions.*$/i, "")
    .replace(/\s+on BaT Auctions.*$/i, "")
    .replace(/\s*\|.*Bring a Trailer.*$/i, "")
    .replace(/\s*\(Lot #[\d,]+\).*$/i, "")
    .trim();
  return t;
}

// ─── Identity parsing ───────────────────────────────────────────────

export interface BatIdentity {
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
}

export function parseBatIdentityFromUrl(listingUrl: string): BatIdentity {
  try {
    const u = new URL(listingUrl);
    const m = u.pathname.match(/\/listing\/(\d{4})-([^/]+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return { year: null, make: null, model: null, title: null };
    const year = Number(m[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) {
      return { year: null, make: null, model: null, title: null };
    }
    let slug = String(m[2]);
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // keep raw slug if decoding fails
    }

    const parts = slug.split("-").filter(Boolean);
    if (parts.length < 2) return { year, make: null, model: null, title: null };

    let make: string | null = null;
    let model: string | null = null;

    const firstPart = parts[0].toLowerCase();
    if (multiWordMakes[firstPart] && parts.length > 1) {
      const makeParts = multiWordMakes[firstPart].split(" ");
      const secondPart = parts[1].toLowerCase();
      // For hyphenated makes like "De Tomaso", also check single-word match
      if (makeParts.length > 1 && secondPart === makeParts[1]?.toLowerCase()) {
        make = multiWordMakes[firstPart];
        model = parts.slice(2).map(titleCaseToken).join(" ").trim() || null;
      } else if (makeParts.length === 1) {
        // Single-word expansion (shouldn't happen in current map, but defensive)
        make = multiWordMakes[firstPart];
        model = parts.slice(1).map(titleCaseToken).join(" ").trim() || null;
      } else {
        make = titleCaseToken(parts[0]);
        model = parts.slice(1).map(titleCaseToken).join(" ").trim() || null;
      }
    } else {
      make = titleCaseToken(parts[0]);
      model = parts.slice(1).map(titleCaseToken).join(" ").trim() || null;
    }

    if (model) model = model.replace(/\s+\d+$/, "").trim();

    const title = [year, make, model].filter(Boolean).join(" ");
    return { year, make, model, title: title || null };
  } catch {
    return { year: null, make: null, model: null, title: null };
  }
}

export function extractTitleIdentity(
  html: string,
  listingUrl: string,
): BatIdentity {
  const h = String(html || "");
  const urlIdentity = parseBatIdentityFromUrl(listingUrl);

  const h1 = h.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
  const og = h.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const titleTag = h.match(/<title[^>]*>([^<]+)<\/title>/i);
  const raw = (h1?.[1] || og?.[1] || titleTag?.[1] || "").trim();

  if (!raw) return urlIdentity;

  const cleanedTitle = cleanBatTitle(raw);
  const yearMatch = cleanedTitle.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch?.[0] ? parseInt(yearMatch[0], 10) : null;

  let make = urlIdentity.make;
  let model = urlIdentity.model;

  if (yearMatch?.[0] && make) {
    const afterYear = cleanedTitle.slice(cleanedTitle.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
    if (afterYear && afterYear.toLowerCase().startsWith(make.toLowerCase())) {
      const afterMake = afterYear.slice(make.length).trim();
      if (afterMake) model = afterMake;
    }
  }

  // Guard against SEO chrome pollution
  const modelLower = String(model || "").toLowerCase();
  if (modelLower.includes("for sale on bat auctions") || modelLower.includes("bring a trailer") || modelLower.includes("|")) {
    model = urlIdentity.model;
  }

  return {
    title: cleanedTitle || urlIdentity.title,
    year: year || urlIdentity.year,
    make,
    model,
  };
}

// ─── Money parsing ──────────────────────────────────────────────────

/**
 * Parse a money string like "$48,000", "48k", "1.2m" into cents-free integer.
 * Returns null for invalid/absurd values.
 * Lower bound: $10 for auction context (rejects $0-$9 noise).
 * Upper bound: $100M (no vehicle auction has exceeded this).
 */
export function parseMoney(raw: string | null): number | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const normalized = s.replace(/,/g, "").replace(/\s+/g, "");
  const m = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([km])?$/i);
  if (!m?.[1]) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix = m[2]?.toLowerCase();
  const multiplier = suffix === "k" && n < 1000 ? 1000 : suffix === "m" && n < 100 ? 1_000_000 : 1;
  const result = Math.round(n * multiplier);
  if (result < 10) return null; // auction floor
  if (result > 100_000_000) return null;
  return result;
}

export function parseMoneyFromRow(rowHtml: string | null): number | null {
  if (!rowHtml) return null;
  const strong = rowHtml.match(/<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)\s*<\/strong>/i);
  if (strong?.[1]) return parseMoney(strong[1]);
  const anyDollar = rowHtml.match(/\$\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)/i);
  if (anyDollar?.[1]) return parseMoney(anyDollar[1]);
  return null;
}

export function parseBuyerFromRow(rowHtml: string | null): string | null {
  if (!rowHtml) return null;
  const soldTo = rowHtml.match(/Sold\s+to\s*<a[^>]*\/member\/[^"'>]+\/?["'][^>]*>([^<]+)<\/a>/i);
  if (soldTo?.[1]) return stripTags(soldTo[1]) || null;
  const byUser = rowHtml.match(/\bby\s*<a[^>]*\/member\/[^"'>]+\/?["'][^>]*>([^<]+)<\/a>/i);
  if (byUser?.[1]) return stripTags(byUser[1]) || null;
  return null;
}

// ─── Essentials extraction (main extract-bat-core parser) ───────────

export interface BatEssentials {
  seller_username: string | null;
  buyer_username: string | null;
  location: string | null;
  lot_number: string | null;
  listing_category: string | null;
  vin: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  reserve_status: string | null;
  auction_end_date: string | null;
  auction_end_at: string | null;
  bid_count: number;
  comment_count: number;
  view_count: number;
  watcher_count: number;
  sale_price: number | null;
  high_bid: number | null;
}

export function extractEssentials(html: string): BatEssentials {
  const h = String(html || "");

  const titleText =
    (() => {
      const m = h.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m?.[1] ? stripTags(m[1]) : null;
    })() ||
    (() => {
      const m = h.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
      return m?.[1] ? stripTags(m[1]) : null;
    })() ||
    null;

  // Essentials block (capped at 50KB to prevent comment pollution)
  const essentialsIdx = h.indexOf('<div class="essentials"');
  const win = essentialsIdx >= 0 ? h.slice(essentialsIdx, essentialsIdx + 50000) : h;
  const winText = stripTags(win).replace(/\s+/g, " ").trim();
  const fullText = stripTags(h).replace(/\s+/g, " ").trim();
  const text = `${winText} ${fullText} ${titleText || ""}`.replace(/\s+/g, " ").trim();

  // Auction Result table (highest-signal source)
  const listingStatsHtml = (() => {
    const m =
      h.match(/<table[^>]*id=["']listing-bid["'][^>]*>[\s\S]*?<\/table>/i) ||
      h.match(/<table[^>]*class=["'][^"']*listing-stats[^"']*["'][^>]*>[\s\S]*?<\/table>/i);
    return m?.[0] ? String(m[0]) : "";
  })();

  const pickRowHtml = (labelRe: string): string | null => {
    if (!listingStatsHtml) return null;
    const re = new RegExp(
      `<tr[^>]*>[\\s\\S]*?<td[^>]*listing-stats-label[^>]*>\\s*${labelRe}\\s*<\\/td>[\\s\\S]*?<\\/tr>`,
      "i",
    );
    const m = listingStatsHtml.match(re);
    return m?.[0] ? String(m[0]) : null;
  };

  const soldRow = pickRowHtml("Sold");
  const winningBidRow = pickRowHtml("Winning\\s+Bid");
  const highBidRow = pickRowHtml("High\\s+Bid");
  const currentBidRow =
    (listingStatsHtml.match(/<tr[^>]*id=["']current-bid-row["'][^>]*>[\s\S]*?<\/tr>/i)?.[0] ?? null) ||
    pickRowHtml("Current\\s+Bid");

  const soldPriceFromStats = parseMoneyFromRow(soldRow) || parseMoneyFromRow(winningBidRow);
  const buyerFromStats = parseBuyerFromRow(soldRow) || parseBuyerFromRow(winningBidRow);
  const bidFromStats = parseMoneyFromRow(highBidRow) || parseMoneyFromRow(currentBidRow);
  const statsHasReserveNotMet =
    /\bReserve\s+Not\s+Met\b/i.test(String(highBidRow || "")) ||
    /\(\s*Reserve\s+Not\s+Met\s*\)/i.test(String(highBidRow || ""));

  // Seller
  const sellerMatch =
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*href=["'][^"']*\/member\/([^"\/]+)\/?["'][^>]*>([^<]+)<\/a>/i) ||
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i);
  const seller_username = sellerMatch ? stripTags(String(sellerMatch[2] || sellerMatch[1] || "")) || null : null;

  // Buyer
  const buyerHtmlMatch =
    h.match(/Sold\s+to\s*<strong>([^<]+)<\/strong>/i) ||
    h.match(/to\s*<strong>([^<]+)<\/strong>\s*for\s*(?:USD\s*)?\$?/i);
  let buyer_username = buyerFromStats || (buyerHtmlMatch?.[1] ? stripTags(buyerHtmlMatch[1]) : null);

  if (!buyer_username) {
    const buyerTextMatch =
      text.match(/\bWinning\s+Bid\b[\s\S]{0,80}?\bby\s+([A-Za-z0-9_]{2,})\b/i) ||
      text.match(/\bSold\s+on\b[\s\S]{0,120}?\bto\s+([A-Za-z0-9_]{2,})\b/i) ||
      text.match(/\bSold\b[\s\S]{0,120}?\bto\s+([A-Za-z0-9_]{2,})\b[\s\S]{0,120}?\bfor\b/i) ||
      text.match(/\bto\s+([A-Za-z0-9_]{2,})\b[\s\S]{0,80}?\bfor\s+(?:USD\s*)?\$?[\d,]+/i);
    buyer_username = buyerTextMatch?.[1] ? String(buyerTextMatch[1]).trim() : null;
  }

  // Location
  const locationMatch =
    win.match(/<strong>Location<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i) ||
    h.match(/"location"[:\s]*"([^"]+)"/i);
  const location = locationMatch?.[1] ? stripTags(locationMatch[1]) : null;

  // Lot number
  const lotMatch = win.match(/<strong>Lot<\/strong>\s*#([0-9,]+)/i);
  const lot_number = lotMatch?.[1] ? lotMatch[1].replace(/,/g, "").trim() : null;

  // Category
  const categoryMatch =
    win.match(/<strong[^>]*class=["'][^"']*group-title-label[^"']*["'][^>]*>\s*Category\s*<\/strong>\s*([^<]+)/i) ||
    h.match(/<strong[^>]*class=["'][^"']*group-title-label[^"']*["'][^>]*>\s*Category\s*<\/strong>\s*([^<]+)/i);
  const listing_category = categoryMatch?.[1] ? stripTags(categoryMatch[1]).trim() : null;

  // Reserve status
  let reserve_status: string | null = null;
  const reserveScope = `${winText} ${titleText || ""}`;
  if (reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope)) reserve_status = "no_reserve";
  if (/\bReserve Not Met\b/i.test(reserveScope) || /reserve-not-met/i.test(reserveScope)) reserve_status = "reserve_not_met";
  if (/\bReserve Met\b/i.test(reserveScope)) reserve_status = "reserve_met";
  if (statsHasReserveNotMet) reserve_status = "reserve_not_met";

  // Auction end date
  let auction_end_date: string | null = null;
  let auction_end_at: string | null = null;
  const endsMatch = h.match(/data-ends="(\d+)"/i);
  if (endsMatch?.[1]) {
    const ts = parseInt(endsMatch[1], 10);
    if (Number.isFinite(ts) && ts > 0) {
      const dt = new Date(ts * 1000);
      auction_end_at = dt.toISOString();
      auction_end_date = auction_end_at.split("T")[0];
    }
  }
  if (!auction_end_date) {
    const m = h.match(/data-auction-ends="(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}-\d{2}"/i);
    if (m?.[1]) auction_end_date = String(m[1]);
  }

  // Counts
  const bidCountMatch = h.match(/"type":"bat-bid"/g);
  const bid_count = bidCountMatch ? bidCountMatch.length : 0;

  const commentHeaderMatch = h.match(/<span class="info-value">(\d+)<\/span>\s*<span class="info-label">Comments<\/span>/i);
  const comment_count = commentHeaderMatch?.[1] ? parseInt(commentHeaderMatch[1], 10) : 0;

  const viewMatch = h.match(/data-stats-item="views">([0-9,]+)/i);
  const view_count = viewMatch?.[1] ? parseInt(viewMatch[1].replace(/,/g, ""), 10) : 0;

  const watcherMatch = h.match(/data-stats-item="watchers">([0-9,]+)/i);
  const watcher_count = watcherMatch?.[1] ? parseInt(watcherMatch[1].replace(/,/g, ""), 10) : 0;

  // Sale/high bid pricing
  const hasGotAway = /got\s+away|did\s+not\s+sell|no\s+sale|not\s+sold|reserve\s+not\s+met/i.test(
    `${winText} ${titleText || ""}`.toLowerCase()
  );
  let sale_price: number | null = null;
  let high_bid: number | null = null;

  if (soldPriceFromStats && !statsHasReserveNotMet) {
    sale_price = soldPriceFromStats;
    high_bid = soldPriceFromStats;
  } else if (soldPriceFromStats && statsHasReserveNotMet) {
    high_bid = soldPriceFromStats;
  } else if (bidFromStats) {
    high_bid = bidFromStats;
  }

  const bidToMatch = text.match(/Bid\s+to\s+(?:USD\s*)?\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)/i);
  if (!sale_price && bidToMatch?.[1]) {
    const n = parseMoney(bidToMatch[1]);
    if (Number.isFinite(n) && n! > 0) high_bid = n;
  }

  // SOLD signals (title only for low-noise extraction)
  const titleSoldMatch = titleText
    ? titleText.match(/\bsold\s+(?:for|to)\s+\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)/i)
    : null;
  if (!sale_price && !statsHasReserveNotMet && titleSoldMatch?.[1]) {
    const n = parseMoney(titleSoldMatch[1]);
    if (Number.isFinite(n) && n! > 0) {
      sale_price = n;
      high_bid = high_bid || n;
    }
  }

  // Sold patterns (essentials + title only, not full page)
  if (!sale_price && !statsHasReserveNotMet) {
    const soldPatterns = [
      /Sold\s+(?:for|to)\s+(?:USD\s*)?\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)/i,
      /Sold\s+on\b[\s\S]{0,120}?\bfor\s+(?:USD\s*)?\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)/i,
      /Sold\s+(?:USD\s*)?\$?\s*([0-9,.]+(?:\.[0-9]+)?\s*[kKmM]?)\s+(?:on|for)/i,
    ];
    const soldSearchScope = `${winText} ${titleText || ""}`;
    for (const p of soldPatterns) {
      const m = soldSearchScope.match(p);
      if (m?.[1]) {
        const n = parseMoney(m[1]);
        if (Number.isFinite(n) && n! > 0) {
          sale_price = n;
          high_bid = high_bid || n;
          break;
        }
      }
    }
  }

  // SAFETY: Stats RNM overrides any text-derived sale price
  if (statsHasReserveNotMet) {
    sale_price = null;
    reserve_status = "reserve_not_met";
  }

  // Confident sale overrides stale RNM
  const hasHighConfidenceSale = Boolean(soldPriceFromStats);
  if (sale_price && hasHighConfidenceSale && reserve_status === "reserve_not_met") {
    const hasNoReserve = reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope);
    reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";
  }
  if (sale_price && hasHighConfidenceSale && !reserve_status) {
    const hasNoReserve = reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope);
    reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";
  }

  // Listing Details (VIN, mileage, colors, transmission, etc.)
  let vin: string | null = null;
  let mileage: number | null = null;
  let exterior_color: string | null = null;
  let interior_color: string | null = null;
  let transmission: string | null = null;
  let drivetrain: string | null = null;
  let engine: string | null = null;
  let body_style: string | null = null;

  const detailsUlMatch = win.match(/<strong>Listing Details<\/strong>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (detailsUlMatch?.[1]) {
    const ulHtml = detailsUlMatch[1];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    const items: string[] = [];
    while ((liMatch = liRe.exec(ulHtml)) !== null) {
      const t = stripTags(liMatch[1]);
      if (t) items.push(t);
    }

    for (const t of items) {
      if (!vin) {
        const idMatch = t.match(/^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
        if (idMatch?.[1]) vin = idMatch[1].toUpperCase().trim();
      }
      if (!mileage) {
        const milesMatch = t.match(/\b([0-9,]+)\s*Miles?\b/i) || t.match(/\b~\s*([0-9,]+)\s*Miles?\b/i);
        const milesKMatch = t.match(/\b(\d+(?:\.\d+)?)\s*k\s*Miles?\b/i) || t.match(/\b(\d+(?:\.\d+)?)k\s*Miles?\b/i);
        if (milesMatch?.[1]) {
          const n = parseInt(milesMatch[1].replace(/,/g, ""), 10);
          if (Number.isFinite(n) && n > 0 && n < 10000000) mileage = n;
        } else if (milesKMatch?.[1]) {
          const n = Math.round(parseFloat(milesKMatch[1]) * 1000);
          if (Number.isFinite(n) && n > 0 && n < 10000000) mileage = n;
        }
      }
      if (!transmission) {
        const looksLikeTransmission =
          t.length <= 80 &&
          !/(miles|paint|upholstery|chassis|vin|engine)\b/i.test(t) &&
          (
            /\btransmission\b/i.test(t) ||
            /\btransaxle\b/i.test(t) ||
            /\bgearbox\b/i.test(t) ||
            /\bcvt\b/i.test(t) ||
            /\bdct\b/i.test(t) ||
            /\bdual[-\s]?clutch\b/i.test(t) ||
            (
              /\b(manual|automatic)\b/i.test(t) &&
              (/\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed|nine-speed|ten-speed)\b/i.test(t) || /\btransaxle\b/i.test(t))
            )
          );
        if (looksLikeTransmission) {
          transmission = t.replace(/\s+Transmission\s*$/i, "").trim();
        }
      }
      if (!drivetrain) {
        const dm = t.match(/\b(AWD|4WD|RWD|FWD|4x4)\b/i);
        if (dm?.[1]) {
          const raw = dm[1].toUpperCase();
          drivetrain = raw === "4X4" ? "4WD" : raw;
        } else {
          const s = t.toLowerCase();
          if (s.includes("rear-wheel drive") || s.includes("rear wheel drive")) drivetrain = "RWD";
          else if (s.includes("front-wheel drive") || s.includes("front wheel drive")) drivetrain = "FWD";
          else if (s.includes("all-wheel drive") || s.includes("all wheel drive")) drivetrain = "AWD";
          else if (
            s.includes("four-wheel drive") || s.includes("four wheel drive") ||
            s.includes("4-wheel drive") || s.includes("4 wheel drive") || s.includes("4x4")
          ) {
            drivetrain = "4WD";
          }
        }
      }
      if (!engine) {
        const looksLikeEngine =
          (
            /\b\d+(?:\.\d+)?-?\s*Liter\b/i.test(t) ||
            /\b\d+(?:\.\d+)?\s*L\b/i.test(t) ||
            /\bV\d\b/i.test(t) ||
            /\b[0-9,]{3,5}\s*cc\b/i.test(t) ||
            /\b\d{2,3}\s*ci\b/i.test(t) ||
            /\bcubic\s+inch\b/i.test(t) ||
            /\bflat[-\s]?four\b/i.test(t) ||
            /\bflat[-\s]?six\b/i.test(t) ||
            /\binline[-\s]?(?:three|four|five|six)\b/i.test(t) ||
            /\binline[-\s]?\d\b/i.test(t) ||
            /\bv-?twin\b/i.test(t)
          ) && !/exhaust|wheels|brakes/i.test(t);
        if (looksLikeEngine) engine = t;
      }
      if (!exterior_color) {
        const paintMatch = t.match(/^(.+?)\s+Paint\b/i);
        if (paintMatch?.[1] && paintMatch[1].trim().length <= 60 && paintMatch[1].trim().split(/\s+/).length <= 6) {
          exterior_color = paintMatch[1].trim();
        }
        if (!exterior_color) {
          const repMatch = t.match(/\bRepainted\s+in\s+(.+)\b/i);
          if (repMatch?.[1] && repMatch[1].trim().length <= 60) exterior_color = repMatch[1].trim();
        }
        if (!exterior_color) {
          const finMatch = t.match(/\bFinished\s+in\s+(.+)\b/i);
          if (finMatch?.[1] && finMatch[1].trim().length <= 60) exterior_color = finMatch[1].trim();
        }
      }
      if (!interior_color) {
        const upMatch = t.match(/^(.+?)\s+Upholstery\b/i);
        if (upMatch?.[1]) interior_color = upMatch[1].trim();
      }
    }
  }

  // Fallback reserve status
  if (!reserve_status && hasGotAway) reserve_status = "reserve_not_met";
  if (!reserve_status && sale_price) reserve_status = "reserve_met";

  return {
    seller_username, buyer_username, location, lot_number, listing_category,
    vin, mileage, exterior_color, interior_color, transmission, drivetrain,
    engine, body_style, reserve_status, auction_end_date, auction_end_at,
    bid_count, comment_count, view_count, watcher_count, sale_price, high_bid,
  };
}

// ─── Description extraction ─────────────────────────────────────────

export function extractDescription(html: string): string | null {
  const h = String(html || "");
  const excerptMatch =
    h.match(/<div[^>]*class=["'][^"']*post-excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    h.match(/<div[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (excerptMatch?.[1]) {
    const t = stripTags(excerptMatch[1]);
    if (t && t.length > 40) return t;
  }
  const metaMatch =
    h.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
    h.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaMatch?.[1]) {
    const t = stripTags(metaMatch[1]);
    if (t && t.length > 40) return t;
  }
  return null;
}

export function normalizeDescriptionSummary(raw: string | null): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 480) return cleaned;
  return `${cleaned.slice(0, 480).trim()}…`;
}

// ─── Image extraction ───────────────────────────────────────────────

export function extractImages(html: string): string[] {
  const h = String(html || "");
  const urls: string[] = [];
  try {
    const idx = h.indexOf('id="bat_listing_page_photo_gallery"');
    if (idx >= 0) {
      const win = h.slice(idx, idx + 5000000);
      const m = win.match(/data-gallery-items=(?:"([^"]+)"|'([^']+)')/i);
      const encoded = (m?.[1] || m?.[2] || "").trim();
      if (encoded) {
        const jsonText = encoded.replace(/&quot;/g, '"').replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        let items: any[];
        try { items = JSON.parse(jsonText); } catch { items = []; }
        if (Array.isArray(items)) {
          for (const it of items) {
            let u = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url;
            if (typeof u === "string" && u.trim()) {
              u = upgradeBatImageUrl(u);
              const normalized = u.split("#")[0].split("?")[0].replace(/-scaled\./g, ".").trim();
              if (
                normalized.includes("bringatrailer.com/wp-content/uploads/") &&
                !normalized.endsWith(".svg") &&
                !normalized.endsWith(".pdf")
              ) {
                urls.push(normalized);
              }
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return Array.from(new Set(urls));
}

// ─── Body style / color inference ───────────────────────────────────

export function inferBodyStyleFromTitle(title: string | null): string | null {
  const t = String(title || "").toLowerCase();
  if (!t) return null;
  if (/\bcoupe\b|\bcoupé\b/.test(t)) return "Coupe";
  if (/\bconvertible\b|\bcabriolet\b/.test(t)) return "Convertible";
  if (/\broadster\b/.test(t)) return "Roadster";
  if (/\bsedan\b/.test(t)) return "Sedan";
  if (/\bwagon\b|\bestate\b/.test(t)) return "Wagon";
  if (/\bhatchback\b/.test(t)) return "Hatchback";
  if (/\bpickup\b|\btruck\b|\bcrew cab\b|\bregular cab\b|\bextended cab\b/.test(t)) return "Truck";
  if (/\bsuv\b|\bsuburban\b|\btahoe\b|\byukon\b|\bwagoneer\b|\bblazer\b|\bbronco\b/.test(t)) return "SUV";
  if (/\bvan\b/.test(t)) return "Van";
  if (/\brv\b|\bmotor\s*home\b|\bmotor\s*coach\b/.test(t)) return "RV";
  return null;
}

export function inferColorsFromDescription(desc: string | null): { exterior_color: string | null; interior_color: string | null } {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  if (!d) return { exterior_color: null, interior_color: null };

  let exterior: string | null = null;
  let interior: string | null = null;

  const exteriorPatterns: RegExp[] = [
    /\brefinished\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)/i,
    /\bfinished\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)/i,
    /\brepainted\s+in\s+([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)/i,
    /\bpainted\s+(?:in\s+)?([A-Za-z][A-Za-z\s/-]{2,50}?)(?=\s+(?:over|with|and)\b|[.,;]|$)/i,
  ];
  for (const re of exteriorPatterns) {
    const m = d.match(re);
    if (m?.[1]) {
      const v = m[1].trim();
      if (v.length >= 2 && v.length <= 60) {
        exterior = titleCaseWords(v);
        break;
      }
    }
  }

  const interiorPatterns: RegExp[] = [
    /\bover\s+(?:a\s+)?(?:refreshed|retrimmed|refurbished|reupholstered|redone|replacement)?\s*([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth|interior|upholstery)\b/i,
    /\b([A-Za-z][A-Za-z\s/-]{2,40}?)\s+(?:leather|vinyl|cloth)\s+interior\b/i,
    /\binterior\s+is\s+(?:trimmed|finished|upholstered)\s+in\s+([A-Za-z][A-Za-z\s/-]{2,40}?)(?=\s+(?:leather|vinyl|cloth|upholstery)\b|[.,;]|$)/i,
  ];
  for (const re of interiorPatterns) {
    const m = d.match(re);
    if (m?.[1]) {
      const v = m[1].trim();
      if (v.length >= 2 && v.length <= 60) {
        interior = titleCaseWords(v);
        break;
      }
    }
  }

  return { exterior_color: exterior, interior_color: interior };
}

// ─── bat-snapshot-parser's parseBaTHTML ──────────────────────────────

export interface ParsedListing {
  chassis: string | null;
  vin_valid: boolean;
  mileage: number | null;
  mileage_unit: string | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior: string | null;
  location_raw: string | null;
  location_city: string | null;
  location_state: string | null;
  location_zip: string | null;
  party_type: string | null;
  lot_number: string | null;
  views: number | null;
  watchers: number | null;
  comment_count: number | null;
  sale_price: number | null;
  sale_currency: string | null;
  sale_date: string | null;
  sale_status: string | null;
  no_reserve: boolean;
  features: string[];
  item_title: string | null;
}

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

export function parseBaTHTML(html: string): ParsedListing {
  const result: ParsedListing = {
    chassis: null, vin_valid: false,
    mileage: null, mileage_unit: null,
    engine: null, transmission: null,
    exterior_color: null, interior: null,
    location_raw: null, location_city: null, location_state: null, location_zip: null,
    party_type: null, lot_number: null,
    views: null, watchers: null, comment_count: null,
    sale_price: null, sale_currency: null, sale_date: null, sale_status: null,
    no_reserve: false, features: [], item_title: null,
  };

  // Chassis/VIN
  const chassisMatch = html.match(/Chassis:?\s*(?:<[^>]*>)*\s*([A-Za-z0-9*-]+(?:\s[A-Za-z0-9*-]+)*)/i);
  if (chassisMatch) {
    result.chassis = chassisMatch[1].trim().replace(/\s+/g, "");
    result.vin_valid = VIN_REGEX.test(result.chassis);
  }

  // Listing Details
  const detailsMatch = html.match(/Listing Details<\/strong>\s*<ul>(.*?)<\/ul>/s);
  if (detailsMatch) {
    const items = detailsMatch[1].match(/<li>(.*?)<\/li>/gs) || [];
    for (const item of items) {
      const text = item.replace(/<[^>]+>/g, "").trim();

      if (text.startsWith("Chassis:") && !result.chassis) {
        result.chassis = text.replace("Chassis:", "").trim();
        result.vin_valid = VIN_REGEX.test(result.chassis);
        continue;
      }

      const mileMatch = text.match(/([\d,]+)k?\s*(Miles?\s*(?:Shown|Indicated)?|Kilometers?|TMU)/i);
      if (mileMatch) {
        let miles = parseInt(mileMatch[1].replace(/,/g, ""));
        if (text.includes("k ") || text.includes("k\u00a0")) miles *= 1000;
        result.mileage = miles;
        result.mileage_unit = mileMatch[2].toLowerCase().includes("kilometer") ? "kilometers" :
          mileMatch[2].toLowerCase().includes("tmu") ? "TMU" : "miles";
        continue;
      }

      if (/exterior/i.test(text)) {
        result.exterior_color = text.replace(/exterior/i, "").trim();
        continue;
      }

      if (/(?:interior|upholster)/i.test(text) && !result.interior) {
        result.interior = text;
        continue;
      }

      if (/(?:leather|cloth|alcantara|vinyl|suede)\s/i.test(text) && !result.interior && !/(?:liter|ci|cc|V\d)/i.test(text)) {
        result.interior = text;
        continue;
      }

      if (/(?:\d+[\.\d]*[-\s]*(?:liter|L\b)|(?:\d+)ci\b|\d+cc\b|(?:inline|flat|V)[-\s]*\d|turbo|supercharg)/i.test(text) && !result.engine) {
        result.engine = text;
        continue;
      }

      if (/(?:manual|automatic|speed|CVT|DCT|PDK|tiptronic|sequential|gearbox|transmission)/i.test(text) && !result.transmission) {
        result.transmission = text;
        continue;
      }

      if (/no reserve/i.test(text)) {
        result.no_reserve = true;
        continue;
      }

      result.features.push(text);
    }
  }

  // Location
  const locMatch = html.match(/Location:\s*<a[^>]*>([^<]+)<\/a>/i);
  if (locMatch) {
    result.location_raw = locMatch[1].trim();
    const locParts = result.location_raw.match(/^(.+?),\s*(\w[\w\s]*?)\s*(\d{5})?$/);
    if (locParts) {
      result.location_city = locParts[1].trim();
      result.location_state = locParts[2].trim();
      result.location_zip = locParts[3] || null;
    }
  }

  // Party type
  const partyMatch = html.match(/Private Party or Dealer:\s*(.*?)(?:<|$)/i);
  if (partyMatch) result.party_type = partyMatch[1].replace(/<[^>]+>/g, "").trim();

  // Lot number
  const lotMatch = html.match(/Lot<\/strong>\s*#?(\d+)/i);
  if (lotMatch) result.lot_number = lotMatch[1];

  // Views and watchers
  const viewsMatch = html.match(/data-stats-item="views"[^>]*>([\d,]+)\s*views/i);
  if (viewsMatch) result.views = parseInt(viewsMatch[1].replace(/,/g, ""));

  const watchMatch = html.match(/data-stats-item="watchers"[^>]*>([\d,]+)\s*watchers/i);
  if (watchMatch) result.watchers = parseInt(watchMatch[1].replace(/,/g, ""));

  // Comment count
  const commentMatch = html.match(/comments_header_html[^>]*>.*?class="info-value"[^>]*>(\d+)/s);
  if (commentMatch) result.comment_count = parseInt(commentMatch[1]);

  // Sale info
  const soldMatch = html.match(/Sold\s+for\s+<strong>(\w+)\s*\$?([\d,]+)<\/strong>\s*<span[^>]*>on\s+(\d+\/\d+\/\d+)/i);
  if (soldMatch) {
    result.sale_currency = soldMatch[1];
    result.sale_price = parseInt(soldMatch[2].replace(/,/g, ""));
    result.sale_date = soldMatch[3];
    result.sale_status = "sold";
  } else {
    const bidMatch = html.match(/Bid\s+to\s+<strong>(\w+)\s*\$?([\d,]+)<\/strong>\s*<span[^>]*>on\s+(\d+\/\d+\/\d+)/i);
    if (bidMatch) {
      result.sale_currency = bidMatch[1];
      result.sale_price = parseInt(bidMatch[2].replace(/,/g, ""));
      result.sale_date = bidMatch[3];
      result.sale_status = "bid_to";
    }
  }

  if (html.includes("status-unsold") || html.includes("Reserve Not Met")) {
    result.sale_status = result.sale_status || "unsold";
  }

  // Item title
  const titleMatch = html.match(/data-item-title="([^"]+)"/);
  if (titleMatch) result.item_title = titleMatch[1];

  return result;
}

// ─── Pollution detectors (used by extract-bat-core update logic) ─────

export function isPollutedBatField(s: any): boolean {
  const t = String(s || "").toLowerCase();
  if (!t) return false;
  return t.includes("for sale on bat auctions") || t.includes("|  bring a trailer") || t.includes("| bring a trailer");
}

export function looksLikeBatBoilerplate(t: string): boolean {
  const s = String(t || "").toLowerCase();
  return (
    s.includes("for sale on bat auctions") ||
    s.includes("bring a trailer") ||
    s.includes("bringatrailer.com") ||
    s.includes("sold for $") ||
    s.includes("(lot #") ||
    s.includes("lot #") ||
    s.includes("auction preview") ||
    s.includes("| bring a trailer") ||
    s.includes("|")
  );
}

export function isPollutedSpec(field: string, val: any): boolean {
  const t = String(val ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t === "var" || t === "cycles") return true;
  if (looksLikeBatBoilerplate(t)) return true;
  if (t.length > 140) return true;

  const wordCount = (s: string): number => String(s || "").trim().split(/\s+/).filter(Boolean).length;

  if (field === "transmission") {
    if (
      t.startsWith(",") ||
      t.includes("driving experien") ||
      t.includes("is said to have") ||
      t.includes("were removed sometime") ||
      (!looksLikeTransmissionSpec(t) && (wordCount(t) > 18 || t.length > 90)) ||
      (/[.!?]/.test(t) && t.length > 60)
    ) return true;
  }
  if (field === "color") {
    if (t === "var") return true;
    if (t.length > 80) return true;
    if (/\b(during|aforementioned|refurbishment|powered by|details include|automatic|headlights)\b/i.test(t)) return true;
    if (wordCount(t) > 8) return true;
  }
  if (field === "engine_size") {
    if (t === "cycles") return true;
    if (!looksLikeEngineSpec(t) && (wordCount(t) > 14 || t.length > 90)) return true;
    if (!looksLikeEngineSpec(t) && (t.includes("table") || t.includes("coffee"))) return true;
  }
  return false;
}

export function looksLikeEngineSpec(t: string): boolean {
  const s = String(t || "");
  return (
    /\b\d+(?:\.\d+)?-?\s*Liter\b/i.test(s) ||
    /\b\d+(?:\.\d+)?\s*L\b/i.test(s) ||
    /\bV\d\b/i.test(s) ||
    /\b[0-9,]{3,5}\s*cc\b/i.test(s) ||
    /\b\d{2,3}\s*ci\b/i.test(s) ||
    /\bcubic\s+inch\b/i.test(s) ||
    /\bflat[-\s]?four\b/i.test(s) ||
    /\bflat[-\s]?six\b/i.test(s) ||
    /\binline[-\s]?(?:three|four|five|six)\b/i.test(s) ||
    /\binline[-\s]?\d\b/i.test(s) ||
    /\bv-?twin\b/i.test(s)
  );
}

export function looksLikeTransmissionSpec(t: string): boolean {
  const s = String(t || "");
  return (
    /\b(transmission|transaxle|gearbox)\b/i.test(s) ||
    /\b(manual|automatic)\b/i.test(s) ||
    /\b(cvt|dct)\b/i.test(s) ||
    /\bdual[-\s]?clutch\b/i.test(s) ||
    /\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed|nine-speed|ten-speed)\b/i.test(s) ||
    /\b(th400|th350|4l60|4l80|zf|getrag|tiptronic|pdk)\b/i.test(s)
  );
}

// ─── SHA-256 helper ─────────────────────────────────────────────────

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
