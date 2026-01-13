/**
 * extract-bat-core
 *
 * Free-mode BaT core extractor:
 * - Fetch HTML directly (no Firecrawl)
 * - Save HTML evidence to listing_page_snapshots
 * - Extract clean title/year/make/model (avoid SEO chrome like "for sale on BaT Auctions")
 * - Extract BaT Essentials (seller/location/lot + key specs)
 * - Extract description + images
 * - Upsert vehicles + vehicle_images + external_listings + auction_events
 *
 * Comments/bids are handled separately by extract-auction-comments and stored in auction_comments.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(raw: string): string {
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

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    // Keep canonical URLs without trailing slash (matches much of existing DB)
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }
}

function titleCaseToken(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  if (t.length <= 2) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function decodeBasicEntities(text: string): string {
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

function stripTags(htmlText: string): string {
  return decodeBasicEntities(String(htmlText || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBatTitle(raw: string): string {
  let t = stripTags(raw);
  t = t
    .replace(/\s+for sale on BaT Auctions.*$/i, "")
    .replace(/\s+on BaT Auctions.*$/i, "")
    .replace(/\s*\|.*Bring a Trailer.*$/i, "")
    .replace(/\s*\(Lot #[\d,]+\).*$/i, "")
    .trim();
  return t;
}

function parseBatIdentityFromUrl(listingUrl: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
} {
  try {
    const u = new URL(listingUrl);
    // NOTE: u.pathname is percent-encoded; BaT slugs can include things like %C2%BC (¼) and %C2%BD (½).
    // We capture the full slug (until next '/') then decode it.
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

    const multiWordMakes: Record<string, string> = {
      alfa: "Alfa Romeo",
      mercedes: "Mercedes-Benz",
      land: "Land Rover",
      aston: "Aston Martin",
    };

    let make: string | null = null;
    let model: string | null = null;

    const firstPart = parts[0].toLowerCase();
    if (multiWordMakes[firstPart] && parts.length > 1) {
      const makeParts = multiWordMakes[firstPart].split(" ");
      const secondPart = parts[1].toLowerCase();
      if (secondPart === makeParts[1]?.toLowerCase()) {
        make = multiWordMakes[firstPart];
        model = parts.slice(2).map(titleCaseToken).join(" ").trim() || null;
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

async function trySaveHtmlSnapshot(args: {
  supabase: any;
  listingUrl: string;
  httpStatus: number | null;
  success: boolean;
  errorMessage: string | null;
  html: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, listingUrl, httpStatus, success, errorMessage, html, metadata } = args;
  try {
    const htmlText = html ?? null;
    const htmlSha = htmlText ? await sha256Hex(htmlText) : null;
    const contentLength = htmlText ? htmlText.length : 0;

    const payload: any = {
      platform: "bat",
      listing_url: listingUrl,
      fetch_method: "direct",
      http_status: httpStatus,
      success,
      error_message: errorMessage,
      html: htmlText,
      html_sha256: htmlSha,
      content_length: contentLength,
      metadata: metadata || {},
    };

    const { error } = await supabase.from("listing_page_snapshots").insert(payload);
    if (error) {
      if (String((error as any).code || "") === "23505") return; // duplicate snapshot
      console.warn("listing_page_snapshots insert failed (non-fatal):", error.message);
    }
  } catch (e: any) {
    console.warn("listing_page_snapshots save failed (non-fatal):", e?.message || String(e));
  }
}

async function fetchHtmlDirect(url: string): Promise<{ html: string; status: number; userAgent: string }> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  ];
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  // small jitter to reduce obvious bot patterns
  const delayMs = Math.random() * 500 + 200;
  await new Promise((r) => setTimeout(r, delayMs));

  const resp = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Referer": "https://www.google.com/",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const html = await resp.text();
  if (!html || html.length < 1000) throw new Error(`Insufficient HTML (${html?.length || 0} chars)`);
  return { html, status: resp.status, userAgent };
}

function extractTitleIdentity(html: string, listingUrl: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  const h = String(html || "");
  const urlIdentity = parseBatIdentityFromUrl(listingUrl);

  const h1 = h.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
  const og = h.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const titleTag = h.match(/<title[^>]*>([^<]+)<\/title>/i);
  const raw = (h1?.[1] || og?.[1] || titleTag?.[1] || "").trim();

  if (!raw) return { title: urlIdentity.title, year: urlIdentity.year, make: urlIdentity.make, model: urlIdentity.model };

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

function extractEssentials(html: string): {
  seller_username: string | null;
  buyer_username: string | null;
  location: string | null;
  lot_number: string | null;
  vin: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  reserve_status: string | null;
  auction_end_date: string | null; // YYYY-MM-DD
  bid_count: number;
  comment_count: number;
  view_count: number;
  watcher_count: number;
  sale_price: number | null;
  high_bid: number | null;
} {
  const h = String(html || "");

  // Highest-signal title strings (low noise vs full page text).
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

  // Seller (from essentials)
  const essentialsIdx = h.indexOf('<div class="essentials"');
  const win = essentialsIdx >= 0 ? h.slice(essentialsIdx, essentialsIdx + 300000) : h;
  const winText = stripTags(win).replace(/\s+/g, " ").trim();
  const fullText = stripTags(h).replace(/\s+/g, " ").trim();
  // NOTE: Some outcome/price strings (e.g. "Sold for $X") can live outside the essentials block.
  // Use a combined view to avoid misclassifying sold listings as RNM/ended.
  const text = `${winText} ${fullText} ${titleText || ""}`.replace(/\s+/g, " ").trim();

  const sellerMatch =
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*href=["'][^"']*\/member\/([^"\/]+)\/?["'][^>]*>([^<]+)<\/a>/i) ||
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i);
  const seller_username = sellerMatch ? stripTags(String(sellerMatch[2] || sellerMatch[1] || "")) || null : null;

  // Buyer (sold to)
  const buyerHtmlMatch =
    h.match(/Sold\s+to\s*<strong>([^<]+)<\/strong>/i) ||
    h.match(/to\s*<strong>([^<]+)<\/strong>\s*for\s*(?:USD\s*)?\$?/i);
  let buyer_username = buyerHtmlMatch?.[1] ? stripTags(buyerHtmlMatch[1]) : null;

  if (!buyer_username) {
    const buyerTextMatch =
      // Common on sold listings: "Winning Bid USD $76,500 by Shabam8790"
      text.match(/\bWinning\s+Bid\b[\s\S]{0,80}?\bby\s+([A-Za-z0-9_]{2,})\b/i) ||
      // "Sold on 2/3/22 for $76,500 to Shabam8790"
      text.match(/\bSold\s+on\b[\s\S]{0,120}?\bto\s+([A-Za-z0-9_]{2,})\b/i) ||
      // "This Listing Sold by FantasyJunction to Shabam8790 for USD $76,500.00"
      text.match(/\bSold\b[\s\S]{0,120}?\bto\s+([A-Za-z0-9_]{2,})\b[\s\S]{0,120}?\bfor\b/i) ||
      // "to Shabam8790 for USD $76,500"
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

  // Reserve status
  let reserve_status: string | null = null;
  // IMPORTANT: Do NOT scan the entire page HTML for reserve phrases (sidebar/recommended auctions can contain
  // "reserve not met" and pollute the result). Keep this scoped to essentials + title.
  const reserveScope = `${winText} ${titleText || ""}`;
  if (reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope)) reserve_status = "no_reserve";
  if (/\bReserve Not Met\b/i.test(reserveScope) || /reserve-not-met/i.test(reserveScope)) reserve_status = "reserve_not_met";
  if (/\bReserve Met\b/i.test(reserveScope)) reserve_status = "reserve_met";

  // Auction end date
  let auction_end_date: string | null = null;
  const endsMatch = h.match(/data-ends="(\d+)"/i);
  if (endsMatch?.[1]) {
    const ts = parseInt(endsMatch[1], 10);
    if (Number.isFinite(ts) && ts > 0) {
      auction_end_date = new Date(ts * 1000).toISOString().split("T")[0];
    }
  }

  // Bid/comment/view/watcher counts
  const bidCountMatch = h.match(/"type":"bat-bid"/g);
  const bid_count = bidCountMatch ? bidCountMatch.length : 0;

  const commentHeaderMatch = h.match(/<span class="info-value">(\d+)<\/span>\s*<span class="info-label">Comments<\/span>/i);
  const comment_count = commentHeaderMatch?.[1] ? parseInt(commentHeaderMatch[1], 10) : 0;

  const viewMatch = h.match(/data-stats-item="views">([0-9,]+)/i);
  const view_count = viewMatch?.[1] ? parseInt(viewMatch[1].replace(/,/g, ""), 10) : 0;

  const watcherMatch = h.match(/data-stats-item="watchers">([0-9,]+)/i);
  const watcher_count = watcherMatch?.[1] ? parseInt(watcherMatch[1].replace(/,/g, ""), 10) : 0;

  // Sale/high bid
  const hasGotAway = /got\s+away|did\s+not\s+sell|no\s+sale|not\s+sold|reserve\s+not\s+met/i.test(
    `${winText} ${titleText || ""}`.toLowerCase()
  );
  let sale_price: number | null = null;
  let high_bid: number | null = null;

  const bidToMatch = text.match(/Bid\s+to\s+(?:USD\s*)?\$?([0-9,]+)/i);
  if (bidToMatch?.[1]) {
    const n = parseInt(bidToMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n > 0) high_bid = n;
  }

  // SOLD signals (prefer title for low-noise extraction).
  const titleSoldMatch = titleText ? titleText.match(/\bsold\s+(?:for|to)\s+\$?([0-9,]+)/i) : null;
  if (titleSoldMatch?.[1]) {
    const n = parseInt(titleSoldMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n > 0) {
      sale_price = n;
      high_bid = high_bid || n;
    }
  }

  if (!sale_price) {
    const soldPatterns = [
      /Sold\s+(?:for|to)\s+(?:USD\s*)?\$?([0-9,]+)/i,
      // "Sold on 2/3/22 for $76,500 to ..."
      /Sold\s+on\b[\s\S]{0,120}?\bfor\s+(?:USD\s*)?\$?([0-9,]+)/i,
      /Sold\s+(?:USD\s*)?\$?([0-9,]+)\s+(?:on|for)/i,
    ];
    for (const p of soldPatterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const n = parseInt(m[1].replace(/,/g, ""), 10);
        if (Number.isFinite(n) && n > 0) {
          sale_price = n;
          high_bid = high_bid || n;
          break;
        }
      }
    }
  }

  // If we have a sold price, this listing cannot be RNM.
  // Prefer explicit "No Reserve" when present; otherwise treat as reserve met.
  if (sale_price && reserve_status === "reserve_not_met") {
    const hasNoReserve = reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope);
    reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";
  }
  if (sale_price && !reserve_status) {
    const hasNoReserve = reserveScope.includes("no-reserve") || /\bNo Reserve\b/i.test(reserveScope);
    reserve_status = hasNoReserve ? "no_reserve" : "reserve_met";
  }

  // Listing Details list items (VIN/chassis, mileage, colors, transmission, engine)
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
    let m: RegExpExecArray | null;
    const items: string[] = [];
    while ((m = liRe.exec(ulHtml)) !== null) {
      const t = stripTags(m[1]);
      if (t) items.push(t);
    }

    for (const t of items) {
      if (!vin) {
        const idMatch = t.match(/^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{4,17})\b/i);
        if (idMatch?.[1]) vin = idMatch[1].toUpperCase().trim();
      }
      if (!mileage) {
        const milesMatch =
          t.match(/\b([0-9,]+)\s*Miles?\b/i) ||
          t.match(/\b~\s*([0-9,]+)\s*Miles?\b/i);
        const milesKMatch =
          t.match(/\b(\d+(?:\.\d+)?)\s*k\s*Miles?\b/i) ||
          t.match(/\b(\d+(?:\.\d+)?)k\s*Miles?\b/i);

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
        if (looksLikeTransmission) transmission = t;
      }
      if (!drivetrain) {
        const dm = t.match(/\b(AWD|4WD|RWD|FWD|4x4)\b/i);
        if (dm?.[1]) drivetrain = dm[1].toUpperCase();
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
        if (paintMatch?.[1]) exterior_color = paintMatch[1].trim();
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

  // Outcome-based reserve status (fallback)
  if (!reserve_status && hasGotAway) reserve_status = "reserve_not_met";
  if (!reserve_status && sale_price) reserve_status = "reserve_met";

  return {
    seller_username,
    buyer_username,
    location,
    lot_number,
    vin,
    mileage,
    exterior_color,
    interior_color,
    transmission,
    drivetrain,
    engine,
    body_style,
    reserve_status,
    auction_end_date,
    bid_count,
    comment_count,
    view_count,
    watcher_count,
    sale_price,
    high_bid,
  };
}

function extractDescription(html: string): string | null {
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

function titleCaseWords(raw: string): string {
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

function inferBodyStyleFromTitle(title: string | null): string | null {
  const t = String(title || "").toLowerCase();
  if (!t) return null;
  if (/\bcoupe\b|\bcoupé\b/.test(t)) return "Coupe";
  if (/\bconvertible\b|\bcabriolet\b|\bcab\b/.test(t)) return "Convertible";
  if (/\broadster\b/.test(t)) return "Roadster";
  if (/\bsedan\b/.test(t)) return "Sedan";
  if (/\bwagon\b|\bestate\b/.test(t)) return "Wagon";
  if (/\bhatchback\b/.test(t)) return "Hatchback";
  if (/\bpickup\b|\btruck\b/.test(t)) return "Truck";
  if (/\bsuv\b/.test(t)) return "SUV";
  if (/\bvan\b/.test(t)) return "Van";
  return null;
}

function inferColorsFromDescription(desc: string | null): { exterior_color: string | null; interior_color: string | null } {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  if (!d) return { exterior_color: null, interior_color: null };

  let exterior: string | null = null;
  let interior: string | null = null;

  // Exterior color heuristics
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

  // Interior color heuristics
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

function upgradeBatImageUrl(url: string): string {
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

function extractImages(html: string): string[] {
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
        const items = JSON.parse(jsonText);
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

function normalizeDescriptionSummary(raw: string | null): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 480) return cleaned;
  return `${cleaned.slice(0, 480).trim()}…`;
}

async function trySaveExtractionMetadata(args: {
  supabase: any;
  vehicleId: string;
  fieldName: string;
  fieldValue: string;
  sourceUrl: string;
  extractionMethod: string;
  scraperVersion: string;
  confidenceScore: number; // 0..1
  validationStatus: "unvalidated" | "valid" | "invalid" | "conflicting" | "low_confidence";
  rawExtractionData?: Record<string, any>;
}): Promise<void> {
  try {
    const v = String(args.fieldValue || "").trim();
    if (!v) return;

    // Deduplicate: if the latest row matches exactly, skip.
    const { data: lastRow } = await args.supabase
      .from("extraction_metadata")
      .select("field_value, extracted_at")
      .eq("vehicle_id", args.vehicleId)
      .eq("field_name", args.fieldName)
      .eq("source_url", args.sourceUrl)
      .order("extracted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const lastVal = String((lastRow as any)?.field_value || "").trim();
    if (lastVal && lastVal === v) return;

    await args.supabase.from("extraction_metadata").insert({
      vehicle_id: args.vehicleId,
      field_name: args.fieldName,
      field_value: v,
      extraction_method: args.extractionMethod,
      scraper_version: args.scraperVersion,
      source_url: args.sourceUrl,
      confidence_score: Math.max(0, Math.min(1, Number(args.confidenceScore) || 0)),
      validation_status: args.validationStatus,
      extracted_at: new Date().toISOString(),
      raw_extraction_data: args.rawExtractionData || {},
    });
  } catch (e: any) {
    console.warn(`extraction_metadata insert failed (non-fatal): ${e?.message || String(e)}`);
  }
}

async function tryUpsertAuctionTimelineEvent(args: {
  supabase: any;
  vehicleId: string;
  eventType: "auction_sold" | "auction_reserve_not_met" | "auction_ended";
  eventDateYmd: string; // YYYY-MM-DD
  title: string;
  description?: string | null;
  source: string;
  sourceUrl: string;
  costAmount?: number | null;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const ymd = String(args.eventDateYmd || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;

    // Idempotency: one auction result per (vehicle, source_url, event_type, event_date)
    const { count } = await args.supabase
      .from("timeline_events")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", args.vehicleId)
      .eq("event_type", args.eventType)
      .eq("event_date", ymd)
      .contains("metadata", { source_url: args.sourceUrl });

    if ((count || 0) > 0) return;

    await args.supabase.from("timeline_events").insert({
      vehicle_id: args.vehicleId,
      user_id: null,
      event_type: args.eventType,
      source: args.source,
      title: args.title,
      description: args.description || null,
      event_date: ymd,
      cost_amount: typeof args.costAmount === "number" && Number.isFinite(args.costAmount) ? args.costAmount : null,
      cost_currency: typeof args.costAmount === "number" ? "USD" : null,
      metadata: {
        ...(args.metadata || {}),
        source_url: args.sourceUrl,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      confidence_score: 85,
      data_source: "extract-bat-core",
      // Must satisfy timeline_events_source_type_check
      source_type: "system",
    });
  } catch (e: any) {
    console.warn(`timeline_events insert failed (non-fatal): ${e?.message || String(e)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const inputUrl = String(body?.url || body?.auction_url || "").trim();
    const providedVehicleId = body?.vehicle_id ? String(body.vehicle_id) : null;

    if (!inputUrl || !inputUrl.includes("bringatrailer.com/listing/")) {
      return new Response(JSON.stringify({ error: "Invalid BaT listing URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingUrlNorm = normalizeUrl(inputUrl);
    const listingUrlCanonical = canonicalUrl(inputUrl);
    const urlCandidates = Array.from(
      new Set([
        inputUrl,
        listingUrlNorm,
        listingUrlCanonical,
        listingUrlCanonical.endsWith("/") ? listingUrlCanonical.slice(0, -1) : `${listingUrlCanonical}/`,
      ].filter(Boolean))
    );

    let html = "";
    let httpStatus: number | null = null;
    let userAgent = "";
    let htmlSource: "snapshot" | "direct" = "direct";

    // Prefer existing DB snapshots (reduces BaT load + avoids bans). Can be disabled per-request.
    const preferSnapshot = body?.prefer_snapshot === false ? false : true;
    if (preferSnapshot) {
      try {
        const { data: snap, error: snapErr } = await supabase
          .from("listing_page_snapshots")
          .select("id, html, http_status, fetched_at")
          .eq("platform", "bat")
          .eq("success", true)
          .eq("http_status", 200)
          .in("listing_url", urlCandidates)
          .order("fetched_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!snapErr && snap?.html && String(snap.html).length > 1000) {
          html = String(snap.html);
          httpStatus = typeof (snap as any)?.http_status === "number" ? (snap as any).http_status : 200;
          userAgent = `snapshot:${String((snap as any)?.id || "")}`;
          htmlSource = "snapshot";
          console.log(`extract-bat-core: using snapshot for ${listingUrlCanonical}`);
        }
      } catch (e: any) {
        console.warn(`extract-bat-core: snapshot lookup failed (non-fatal): ${e?.message || String(e)}`);
      }
    }
    if (!html) {
      console.log(`extract-bat-core: fetching ${listingUrlNorm}`);
      try {
        const fetched = await fetchHtmlDirect(listingUrlNorm);
        html = fetched.html;
        httpStatus = fetched.status;
        userAgent = fetched.userAgent;
        htmlSource = "direct";
      } catch (e: any) {
        await trySaveHtmlSnapshot({
          supabase,
          listingUrl: listingUrlNorm,
          httpStatus: null,
          success: false,
          errorMessage: e?.message ? String(e.message) : "Direct fetch failed",
          html: null,
          metadata: { extractor: "extract-bat-core", mode: "free" },
        });
        throw e;
      }

      await trySaveHtmlSnapshot({
        supabase,
        listingUrl: listingUrlNorm,
        httpStatus,
        success: true,
        errorMessage: null,
        html,
        metadata: { extractor: "extract-bat-core", mode: "free", user_agent: userAgent },
      });
    }

    const identity = extractTitleIdentity(html, listingUrlCanonical);
    const essentials = extractEssentials(html);
    const descriptionRaw = extractDescription(html);
    const description = normalizeDescriptionSummary(descriptionRaw);
    const images = extractImages(html);
    const inferredBodyStyle = inferBodyStyleFromTitle(identity.title);
    const inferredColors = inferColorsFromDescription((descriptionRaw || description) ?? null);
    const bestExteriorColor = essentials.exterior_color || inferredColors.exterior_color;
    const bestInteriorColor = essentials.interior_color || inferredColors.interior_color;
    const bestListingLocation = essentials.location || null;

    // Resolve existing vehicle
    let vehicleId: string | null = providedVehicleId;
    let existing: any | null = null;
    if (!vehicleId) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, listing_title, bat_listing_title, vin, description, description_source, discovery_url, listing_url, listing_source, listing_location, bat_seller, bat_buyer, bat_location, bat_lot_number, bat_views, bat_watchers, bat_bids, bat_comments, mileage, mileage_source, color, color_source, interior_color, transmission, transmission_source, drivetrain, engine_size, engine_source, body_style, sale_price, high_bid, auction_end_date, reserve_status, sale_status, sale_date, auction_outcome, winning_bid")
        .in("discovery_url", urlCandidates)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        existing = data;
        vehicleId = String(data.id);
      }
    }
    if (!vehicleId) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, listing_title, bat_listing_title, vin, description, description_source, discovery_url, listing_url, listing_source, listing_location, bat_seller, bat_buyer, bat_location, bat_lot_number, bat_views, bat_watchers, bat_bids, bat_comments, mileage, mileage_source, color, color_source, interior_color, transmission, transmission_source, drivetrain, engine_size, engine_source, body_style, sale_price, high_bid, auction_end_date, reserve_status, sale_status, sale_date, auction_outcome, winning_bid")
        .in("bat_auction_url", urlCandidates)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        existing = data;
        vehicleId = String(data.id);
      }
    }

    const createdIds: string[] = [];
    const updatedIds: string[] = [];

    const isPolluted = (s: any): boolean => {
      const t = String(s || "").toLowerCase();
      if (!t) return false;
      return t.includes("for sale on bat auctions") || t.includes("|  bring a trailer") || t.includes("| bring a trailer");
    };

    if (!vehicleId) {
      // Create new vehicle
      const insertPayload: any = {
        year: identity.year || null,
        make: identity.make || null,
        model: identity.model || null,
        vin: essentials.vin || null,
        description: description || null,
        description_source: description ? "source_imported" : null,
        listing_title: identity.title || null,
        listing_url: listingUrlCanonical,
        listing_source: "bat",
        discovery_url: listingUrlCanonical,
        discovery_source: "bat_core",
        profile_origin: "url_scraper",
        import_method: "scraper",
        is_public: true,
        bat_auction_url: listingUrlCanonical,
        bat_listing_title: identity.title || null,
        bat_seller: essentials.seller_username || null,
        bat_buyer: essentials.buyer_username || null,
        bat_location: essentials.location || null,
        listing_location: bestListingLocation,
        bat_lot_number: essentials.lot_number || null,
        bat_bids: essentials.bid_count || 0,
        bat_comments: essentials.comment_count || 0,
        bat_views: essentials.view_count || 0,
        bat_watchers: essentials.watcher_count || 0,
        reserve_status: essentials.reserve_status || null,
        auction_end_date: essentials.auction_end_date || null,
        sale_price: essentials.sale_price || null,
        high_bid: essentials.high_bid || null,
        mileage: essentials.mileage || null,
        color: bestExteriorColor || null,
        interior_color: bestInteriorColor || null,
        transmission: essentials.transmission || null,
        drivetrain: essentials.drivetrain || null,
        engine_size: essentials.engine || null,
        body_style: inferredBodyStyle || null,
      };

      const { data: inserted, error } = await supabase.from("vehicles").insert(insertPayload).select("id").single();
      if (error) throw new Error(`vehicles insert failed: ${error.message}`);
      vehicleId = String(inserted.id);
      createdIds.push(vehicleId);
    } else {
      // Update existing vehicle (conservative: only fill missing or polluted fields)
      if (!existing) {
        const { data } = await supabase
          .from("vehicles")
          .select("id, year, make, model, listing_title, bat_listing_title, vin, description, description_source, discovery_url, listing_url, listing_source, listing_location, bat_seller, bat_buyer, bat_location, bat_lot_number, bat_views, bat_watchers, bat_bids, bat_comments, mileage, mileage_source, color, color_source, interior_color, transmission, transmission_source, drivetrain, engine_size, engine_source, body_style, sale_price, high_bid, auction_end_date, reserve_status, sale_status, sale_date, auction_outcome, winning_bid")
          .eq("id", vehicleId)
          .maybeSingle();
        existing = data || null;
      }

      const updatePayload: any = {
        bat_auction_url: listingUrlCanonical,
        discovery_url: existing?.discovery_url || listingUrlCanonical,
        listing_url: existing?.listing_url || listingUrlCanonical,
        listing_source: existing?.listing_source || "bat",
        updated_at: new Date().toISOString(),
      };

      const makeLower = String(existing?.make || "").toLowerCase();
      const modelLower = String(existing?.model || "").toLowerCase();
      const modelIsPolluted =
        modelLower.includes("for sale on bat auctions") ||
        modelLower.includes("bring a trailer") ||
        modelLower.includes("|") ||
        modelLower.includes("auction preview");

      const looksLikeBatBoilerplate = (t: string): boolean => {
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
      };

      const wordCount = (t: string): number => {
        return String(t || "").trim().split(/\s+/).filter(Boolean).length;
      };

      const looksLikeEngineSpec = (t: string): boolean => {
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
      };

      const looksLikeTransmissionSpec = (t: string): boolean => {
        const s = String(t || "");
        return (
          /\b(transmission|transaxle|gearbox)\b/i.test(s) ||
          /\b(manual|automatic)\b/i.test(s) ||
          /\b(cvt|dct)\b/i.test(s) ||
          /\bdual[-\s]?clutch\b/i.test(s) ||
          /\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed|nine-speed|ten-speed)\b/i.test(s) ||
          /\b(th400|th350|4l60|4l80|zf|getrag|tiptronic|pdk)\b/i.test(s)
        );
      };

      const isPollutedSpec = (field: string, val: any): boolean => {
        const t = String(val ?? "").trim().toLowerCase();
        if (!t) return false;
        if (t === "var" || t === "cycles") return true;
        if (looksLikeBatBoilerplate(t)) return true;
        if (t.length > 140) return true;
        if (field === "transmission") {
          if (
            t.startsWith(",") ||
            t.includes("driving experien") ||
            t.includes("is said to have") ||
            t.includes("were removed sometime") ||
            (!looksLikeTransmissionSpec(t) && (wordCount(t) > 18 || t.length > 90)) ||
            (/[.!?]/.test(t) && t.length > 60)
          ) {
            return true;
          }
        }
        if (field === "color") {
          if (t === "var") return true;
          if (t.length > 80) return true;
        }
        if (field === "engine_size") {
          if (t === "cycles") return true;
          if (!looksLikeEngineSpec(t) && (wordCount(t) > 14 || t.length > 90)) return true;
          if (!looksLikeEngineSpec(t) && (t.includes("table") || t.includes("coffee"))) return true;
        }
        return false;
      };

      if (
        !existing?.year ||
        !existing?.make ||
        makeLower === "unknown" ||
        !existing?.model ||
        modelLower === "unknown" ||
        modelIsPolluted
      ) {
        if (identity.year) updatePayload.year = identity.year;
        if (identity.make) updatePayload.make = identity.make;
        if (identity.model) updatePayload.model = identity.model;
      }

      if (!existing?.listing_title || isPolluted(existing?.listing_title)) updatePayload.listing_title = identity.title || null;
      if (!existing?.bat_listing_title || isPolluted(existing?.bat_listing_title)) updatePayload.bat_listing_title = identity.title || null;

      if (!existing?.vin && essentials.vin) updatePayload.vin = essentials.vin;
      if (!existing?.description && description) updatePayload.description = description;
      if (!existing?.description_source && description) updatePayload.description_source = "source_imported";

      // BaT fields / essentials (fill if missing)
      if (!existing?.bat_seller && essentials.seller_username) updatePayload.bat_seller = essentials.seller_username;
      if (!existing?.bat_buyer && essentials.buyer_username) updatePayload.bat_buyer = essentials.buyer_username;
      if (!existing?.bat_location && essentials.location) updatePayload.bat_location = essentials.location;
      if (!existing?.listing_location && bestListingLocation) updatePayload.listing_location = bestListingLocation;
      if (!existing?.bat_lot_number && essentials.lot_number) updatePayload.bat_lot_number = essentials.lot_number;
      if (!existing?.body_style && inferredBodyStyle) updatePayload.body_style = inferredBodyStyle;

      if (!existing?.mileage && essentials.mileage) updatePayload.mileage = essentials.mileage;
      const existingColorPolluted = isPollutedSpec("color", existing?.color);
      if ((!existing?.color || existingColorPolluted) && bestExteriorColor) {
        updatePayload.color = bestExteriorColor;
        updatePayload.color_source = "bring a trailer";
      } else if (existingColorPolluted && !bestExteriorColor) {
        updatePayload.color = null;
        updatePayload.color_source = null;
      }
      if (!existing?.interior_color && bestInteriorColor) updatePayload.interior_color = bestInteriorColor;
      const existingTransmissionPolluted = isPollutedSpec("transmission", existing?.transmission);
      if ((!existing?.transmission || existingTransmissionPolluted) && essentials.transmission) {
        updatePayload.transmission = essentials.transmission;
        updatePayload.transmission_source = "bring a trailer";
      } else if (existingTransmissionPolluted && !essentials.transmission) {
        updatePayload.transmission = null;
        updatePayload.transmission_source = null;
      }
      if (!existing?.drivetrain && essentials.drivetrain) updatePayload.drivetrain = essentials.drivetrain;
      const existingEnginePolluted = isPollutedSpec("engine_size", existing?.engine_size);
      if ((!existing?.engine_size || existingEnginePolluted) && essentials.engine) {
        updatePayload.engine_size = essentials.engine;
        updatePayload.engine_source = "bring a trailer";
      } else if (existingEnginePolluted && !essentials.engine) {
        updatePayload.engine_size = null;
        updatePayload.engine_source = null;
      }

      // Auction outcomes / counters (set if missing)
      const existingReserve = String(existing?.reserve_status || "").toLowerCase();
      const existingOutcome = String((existing as any)?.auction_outcome || "").toLowerCase();
      const existingSaleStatus = String((existing as any)?.sale_status || "").toLowerCase();
      const existingSalePrice = typeof (existing as any)?.sale_price === "number" ? (existing as any).sale_price : null;
      const existingHighBid = typeof (existing as any)?.high_bid === "number" ? (existing as any).high_bid : null;

      const extractedReserve = String(essentials.reserve_status || "").toLowerCase() || null;
      const extractedSalePrice = essentials.sale_price;
      const extractedHighBid = essentials.high_bid;
      const extractedEndDate = essentials.auction_end_date || null;

      const hasExtractedSale = typeof extractedSalePrice === "number" && Number.isFinite(extractedSalePrice) && extractedSalePrice > 0;
      const hasExtractedBid = typeof extractedHighBid === "number" && Number.isFinite(extractedHighBid) && extractedHighBid > 0;

      // Always keep auction_end_date in sync when we have it (it's used for auction state and display).
      if (extractedEndDate && (!existing?.auction_end_date || existing?.auction_end_date !== extractedEndDate)) {
        updatePayload.auction_end_date = extractedEndDate;
      }

      // Reserve status: if we have a confident extraction, allow overwriting stale/wrong values.
      if (extractedReserve) {
        if (!existing?.reserve_status || existingReserve !== extractedReserve) {
          updatePayload.reserve_status = extractedReserve;
        }
      }

      // SOLD: explicit "sold for $X" should override legacy RNM/high-bid pollution.
      if (hasExtractedSale) {
        // Sale price must be the sold price (not "Bid to").
        if (!existingSalePrice || existingSalePrice !== extractedSalePrice) {
          updatePayload.sale_price = extractedSalePrice;
        }

        // When sold, high_bid should equal the sold price.
        if (!existingHighBid || existingHighBid !== extractedSalePrice) {
          updatePayload.high_bid = extractedSalePrice;
        }

        // Make the vehicle row consistent (some UIs fall back to vehicles.* if external_listings is blocked by RLS).
        updatePayload.sale_status = "sold";
        updatePayload.auction_outcome = "sold";
        if (extractedEndDate) updatePayload.sale_date = extractedEndDate;

        // Buyer should be present on sold listings; overwrite if missing or clearly stale.
        if (essentials.buyer_username && String((existing as any)?.bat_buyer || "").trim() !== String(essentials.buyer_username).trim()) {
          updatePayload.bat_buyer = essentials.buyer_username;
        }
      } else if (hasExtractedBid && (extractedReserve === "reserve_not_met" || extractedReserve === "no_sale")) {
        // UNSOLD: ensure we don't keep a polluted sale_price that actually represents "bid to".
        const looksLikePollutedSale =
          typeof existingSalePrice === "number" &&
          existingSalePrice > 0 &&
          ((typeof existingHighBid === "number" && existingHighBid > 0 && existingSalePrice === existingHighBid) ||
            existingSalePrice === extractedHighBid);

        const alreadySold =
          existingSaleStatus === "sold" ||
          existingOutcome === "sold";

        if (!alreadySold && looksLikePollutedSale) {
          updatePayload.sale_price = null;
        }

        // Keep high_bid aligned with extracted highest bid.
        if (!existingHighBid || existingHighBid !== extractedHighBid) {
          updatePayload.high_bid = extractedHighBid;
        }

        // Keep auction_outcome consistent (best-effort; depends on schema).
        if (extractedReserve === "reserve_not_met") updatePayload.auction_outcome = "reserve_not_met";
        if (extractedReserve === "no_sale") updatePayload.auction_outcome = "no_sale";
      } else {
        // Fallback: fill missing numeric fields only.
        if (!existingSalePrice && hasExtractedSale) updatePayload.sale_price = extractedSalePrice;
        if (!existingHighBid && hasExtractedBid) updatePayload.high_bid = extractedHighBid;
      }

      if (!existing?.bat_views && essentials.view_count) updatePayload.bat_views = essentials.view_count;
      if (!existing?.bat_watchers && essentials.watcher_count) updatePayload.bat_watchers = essentials.watcher_count;
      if (!existing?.bat_bids && essentials.bid_count) updatePayload.bat_bids = essentials.bid_count;
      if (!existing?.bat_comments && essentials.comment_count) updatePayload.bat_comments = essentials.comment_count;

      const { error } = await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);
      if (error) {
        const e: any = error;
        const msg =
          e?.message ? String(e.message) :
          e?.details ? String(e.details) :
          e?.hint ? String(e.hint) :
          JSON.stringify(e);

        // Common in a long-lived vehicle-first model: we may discover a VIN that already exists on
        // another vehicle row (duplicate profile). VIN is unique, so skip setting it and still
        // allow the rest of the repair (title/essentials/description/images/auction_events) to proceed.
        const code = e?.code ? String(e.code) : "";
        const isVinUniqueConflict =
          Boolean(updatePayload?.vin) &&
          (code === "23505" || msg.includes("vehicles_vin_unique_index"));

        // Another common case: discovery_url is unique; duplicates can exist due to long-lived ingest.
        // Do NOT fail the whole extraction; just avoid setting discovery_url on this row.
        const isDiscoveryUrlUniqueConflict =
          Boolean(updatePayload?.discovery_url) &&
          (code === "23505" || msg.includes("vehicles_discovery_url_unique"));

        if (isVinUniqueConflict || isDiscoveryUrlUniqueConflict) {
          const dropped: string[] = [];
          try {
            if (isVinUniqueConflict) {
              delete updatePayload.vin;
              dropped.push("vin");
            }
            if (isDiscoveryUrlUniqueConflict) {
              delete updatePayload.discovery_url;
              dropped.push("discovery_url");
            }
          } catch {
            // ignore
          }

          console.warn(`Unique conflict for vehicle ${vehicleId}. Retrying update without: ${dropped.join(", ") || "unknown"}`);

          const { error: retryErr } = await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);
          if (retryErr) {
            const re: any = retryErr;
            const rmsg =
              re?.message ? String(re.message) :
              re?.details ? String(re.details) :
              re?.hint ? String(re.hint) :
              JSON.stringify(re);
            throw new Error(`vehicles update failed (after removing ${dropped.join(", ") || "conflicting fields"}): ${rmsg}`);
          }
        } else {
          throw new Error(`vehicles update failed: ${msg}`);
        }
      }
      updatedIds.push(vehicleId);
    }

    // Save images (external URLs only)
    if (vehicleId && images.length > 0) {
      const imageRows = images.map((img, idx) => ({
        vehicle_id: vehicleId,
        image_url: img,
        position: idx,
        source: "bat_core",
        is_external: true,
      }));

      const { error } = await supabase
        .from("vehicle_images")
        .upsert(imageRows, { onConflict: "vehicle_id,image_url", ignoreDuplicates: true });

      if (error) console.warn(`vehicle_images upsert failed (non-fatal): ${error.message}`);
    }

    // external_listings (platform tracking)
    if (vehicleId) {
      const listingStatus = essentials.sale_price ? "sold" : "ended";
      const endAtIso = essentials.auction_end_date ? new Date(`${essentials.auction_end_date}T00:00:00Z`).toISOString() : null;
      const listingUrlKey = normalizeListingUrlKey(listingUrlCanonical);

      const { error } = await supabase
        .from("external_listings")
        .upsert({
          vehicle_id: vehicleId,
          platform: "bat",
          listing_url: listingUrlCanonical,
          listing_url_key: listingUrlKey,
          listing_id: essentials.lot_number || listingUrlCanonical,
          listing_status: listingStatus,
          end_date: endAtIso,
          sold_at: essentials.sale_price ? endAtIso : null,
          final_price: essentials.sale_price,
          bid_count: essentials.bid_count,
          view_count: essentials.view_count,
          watcher_count: essentials.watcher_count,
          metadata: {
            source: "extract-bat-core",
            lot_number: essentials.lot_number,
            seller_username: essentials.seller_username,
            buyer_username: essentials.buyer_username,
            reserve_status: essentials.reserve_status,
            comment_count: essentials.comment_count,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: "platform,listing_url_key" });

      if (error) console.warn(`external_listings upsert failed (non-fatal): ${error.message}`);
    }

    // auction_events (multi-auction history per vehicle)
    if (vehicleId) {
      const hasSale = Number.isFinite(essentials.sale_price) && (essentials.sale_price || 0) > 0;
      const hasBid = Number.isFinite(essentials.high_bid) && (essentials.high_bid || 0) > 0;
      const outcome = hasSale
        ? "sold"
        : (essentials.reserve_status === "reserve_not_met" ? "reserve_not_met" : (hasBid ? "bid_to" : "no_sale"));

      const endAt = essentials.auction_end_date ? new Date(`${essentials.auction_end_date}T00:00:00Z`).toISOString() : null;

      const { error } = await supabase
        .from("auction_events")
        .upsert({
          vehicle_id: vehicleId,
          source: "bat",
          source_url: listingUrlCanonical,
          source_listing_id: essentials.lot_number,
          lot_number: essentials.lot_number,
          auction_end_date: endAt,
          outcome,
          high_bid: hasSale ? essentials.sale_price : (essentials.high_bid || null),
          winning_bid: hasSale ? essentials.sale_price : null,
          winning_bidder: hasSale ? (essentials.buyer_username || null) : null,
          seller_name: essentials.seller_username || null,
          total_bids: essentials.bid_count || null,
          comments_count: essentials.comment_count || null,
          page_views: essentials.view_count || null,
          watchers: essentials.watcher_count || null,
          updated_at: new Date().toISOString(),
          raw_data: {
            extractor: "extract-bat-core",
            listing_url: listingUrlCanonical,
          },
        }, { onConflict: "vehicle_id,source_url" });

      if (error) console.warn(`auction_events upsert failed (non-fatal): ${error.message}`);
    }

    // Save raw listing description history (for Description Entries UI)
    if (vehicleId && descriptionRaw) {
      await trySaveExtractionMetadata({
        supabase,
        vehicleId,
        fieldName: "raw_listing_description",
        fieldValue: String(descriptionRaw),
        sourceUrl: listingUrlCanonical,
        extractionMethod: "extract-bat-core",
        scraperVersion: "v4",
        confidenceScore: 0.9,
        validationStatus: "unvalidated",
        rawExtractionData: {
          extractor: "extract-bat-core",
          mode: "free",
          listing_url: listingUrlCanonical,
        },
      });
    }

    // Persist an auction timeline event so timelines aren't empty for auction-origin vehicles.
    if (vehicleId && essentials.auction_end_date) {
      const hasSale = Number.isFinite(essentials.sale_price) && (essentials.sale_price || 0) > 0;
      const hasBid = Number.isFinite(essentials.high_bid) && (essentials.high_bid || 0) > 0;
      const eventType =
        hasSale ? "auction_sold" :
        (essentials.reserve_status === "reserve_not_met" ? "auction_reserve_not_met" : "auction_ended");

      const amount = hasSale ? (essentials.sale_price || null) : (hasBid ? (essentials.high_bid || null) : null);
      const amountText = typeof amount === "number" && amount > 0 ? `$${Math.round(amount).toLocaleString()}` : "";
      const title =
        eventType === "auction_sold"
          ? `BaT sold${amountText ? ` for ${amountText}` : ""}`
          : eventType === "auction_reserve_not_met"
            ? `BaT ended (RNM)${amountText ? ` • bid to ${amountText}` : ""}`
            : `BaT ended${amountText ? ` • bid to ${amountText}` : ""}`;

      const descParts: string[] = [];
      if (essentials.lot_number) descParts.push(`Lot #${essentials.lot_number}`);
      if (essentials.bid_count) descParts.push(`${essentials.bid_count} bids`);
      if (essentials.comment_count) descParts.push(`${essentials.comment_count} comments`);
      const desc = descParts.length ? descParts.join(" • ") : null;

      await tryUpsertAuctionTimelineEvent({
        supabase,
        vehicleId,
        eventType,
        eventDateYmd: essentials.auction_end_date,
        title,
        description: desc,
        source: "bat",
        sourceUrl: listingUrlCanonical,
        costAmount: typeof amount === "number" ? amount : null,
        metadata: {
          reserve_status: essentials.reserve_status,
          high_bid: essentials.high_bid,
          sale_price: essentials.sale_price,
          buyer_username: essentials.buyer_username,
          seller_username: essentials.seller_username,
          lot_number: essentials.lot_number,
          bid_count: essentials.bid_count,
          comment_count: essentials.comment_count,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: "Bring a Trailer",
        site_type: "bat",
        listing_url: listingUrlCanonical,
        vehicles_extracted: 1,
        vehicles_created: createdIds.length,
        vehicles_updated: updatedIds.length,
        created_vehicle_ids: createdIds,
        updated_vehicle_ids: updatedIds,
        issues: [],
        extraction_method: "direct_html_parsing_free_mode",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    console.error("extract-bat-core error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

