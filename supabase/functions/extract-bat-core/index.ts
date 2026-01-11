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
    const m = u.pathname.match(/\/listing\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return { year: null, make: null, model: null, title: null };
    const year = Number(m[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) {
      return { year: null, make: null, model: null, title: null };
    }
    const parts = String(m[2]).split("-").filter(Boolean);
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

  // Seller (from essentials)
  const essentialsIdx = h.indexOf('<div class="essentials"');
  const win = essentialsIdx >= 0 ? h.slice(essentialsIdx, essentialsIdx + 300000) : h;

  const sellerMatch =
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*href=["'][^"']*\/member\/([^"\/]+)\/?["'][^>]*>([^<]+)<\/a>/i) ||
    win.match(/<strong>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i);
  const seller_username = sellerMatch ? stripTags(String(sellerMatch[2] || sellerMatch[1] || "")) || null : null;

  // Buyer (sold to)
  const buyerMatch =
    h.match(/Sold\s+to\s*<strong>([^<]+)<\/strong>/i) ||
    h.match(/to\s*<strong>([^<]+)<\/strong>\s*for\s*(?:USD\s*)?\$?/i);
  const buyer_username = buyerMatch?.[1] ? stripTags(buyerMatch[1]) : null;

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
  if (h.includes("no-reserve") || /\bNo Reserve\b/i.test(h)) reserve_status = "no_reserve";
  if (/\bReserve Not Met\b/i.test(h) || /reserve-not-met/i.test(h)) reserve_status = "reserve_not_met";
  if (/\bReserve Met\b/i.test(h)) reserve_status = "reserve_met";

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
  const hasGotAway = /got\s+away|did\s+not\s+sell|no\s+sale|not\s+sold|reserve\s+not\s+met/i.test(h);
  let sale_price: number | null = null;
  let high_bid: number | null = null;

  const bidToMatch = h.match(/Bid\s+to\s+(?:USD\s*)?\$?([0-9,]+)/i);
  if (bidToMatch?.[1]) {
    const n = parseInt(bidToMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n > 0) high_bid = n;
  }

  const soldPatterns = [
    /Sold\s+(?:for|to)\s+(?:USD\s*)?\$?([0-9,]+)/i,
    /Sold\s+(?:USD\s*)?\$?([0-9,]+)\s+(?:on|for)/i,
  ];
  for (const p of soldPatterns) {
    const m = h.match(p);
    if (m?.[1] && !/Bid\s+to/i.test(h)) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n > 0) {
        sale_price = n;
        high_bid = high_bid || n;
        break;
      }
    }
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
        const milesMatch = t.match(/\b([0-9,]+)\s*Miles?\b/i) || t.match(/\b~\s*([0-9,]+)\s*Miles?\b/i);
        if (milesMatch?.[1]) {
          const n = parseInt(milesMatch[1].replace(/,/g, ""), 10);
          if (Number.isFinite(n) && n > 0 && n < 10000000) mileage = n;
        }
      }
      if (!transmission && /transmission/i.test(t) && t.length <= 80) transmission = t;
      if (!engine) {
        if (/\b\d+(?:\.\d+)?-?\s*Liter\b/i.test(t) || /\b\d+(?:\.\d+)?\s*L\b/i.test(t) || /\bV\d\b/i.test(t)) {
          if (!/exhaust|wheels|brakes/i.test(t)) engine = t;
        }
      }
      if (!exterior_color) {
        const paintMatch = t.match(/^(.+?)\s+Paint\b/i);
        if (paintMatch?.[1]) exterior_color = paintMatch[1].trim();
      }
      if (!interior_color) {
        const upMatch = t.match(/^(.+?)\s+Upholstery\b/i);
        if (upMatch?.[1]) interior_color = upMatch[1].trim();
      }
    }
  }

  // Rough drivetrain detection (fallback)
  const driveMatch = h.match(/\b(AWD|4WD|RWD|FWD|4x4)\b/i);
  if (driveMatch?.[1]) drivetrain = driveMatch[1].toUpperCase();

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

    console.log(`extract-bat-core: fetching ${listingUrlNorm}`);

    let html = "";
    let httpStatus: number | null = null;
    let userAgent = "";
    try {
      const fetched = await fetchHtmlDirect(listingUrlNorm);
      html = fetched.html;
      httpStatus = fetched.status;
      userAgent = fetched.userAgent;
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

    const identity = extractTitleIdentity(html, listingUrlCanonical);
    const essentials = extractEssentials(html);
    const descriptionRaw = extractDescription(html);
    const description = normalizeDescriptionSummary(descriptionRaw);
    const images = extractImages(html);

    // Resolve existing vehicle
    let vehicleId: string | null = providedVehicleId;
    let existing: any | null = null;
    if (!vehicleId) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, listing_title, bat_listing_title, vin, description")
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
        .select("id, year, make, model, listing_title, bat_listing_title, vin, description")
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
        color: essentials.exterior_color || null,
        interior_color: essentials.interior_color || null,
        transmission: essentials.transmission || null,
        drivetrain: essentials.drivetrain || null,
        engine_size: essentials.engine || null,
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
          .select("id, year, make, model, listing_title, bat_listing_title, vin, description")
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
      if (!existing?.bat_lot_number && essentials.lot_number) updatePayload.bat_lot_number = essentials.lot_number;

      if (!existing?.mileage && essentials.mileage) updatePayload.mileage = essentials.mileage;
      if (!existing?.color && essentials.exterior_color) updatePayload.color = essentials.exterior_color;
      if (!existing?.interior_color && essentials.interior_color) updatePayload.interior_color = essentials.interior_color;
      if (!existing?.transmission && essentials.transmission) updatePayload.transmission = essentials.transmission;
      if (!existing?.drivetrain && essentials.drivetrain) updatePayload.drivetrain = essentials.drivetrain;
      if (!existing?.engine_size && essentials.engine) updatePayload.engine_size = essentials.engine;

      // Auction outcomes / counters (set if missing)
      if (!existing?.sale_price && essentials.sale_price) updatePayload.sale_price = essentials.sale_price;
      if (!existing?.high_bid && essentials.high_bid) updatePayload.high_bid = essentials.high_bid;
      if (!existing?.auction_end_date && essentials.auction_end_date) updatePayload.auction_end_date = essentials.auction_end_date;
      if (!existing?.reserve_status && essentials.reserve_status) updatePayload.reserve_status = essentials.reserve_status;

      if (!existing?.bat_views && essentials.view_count) updatePayload.bat_views = essentials.view_count;
      if (!existing?.bat_watchers && essentials.watcher_count) updatePayload.bat_watchers = essentials.watcher_count;
      if (!existing?.bat_bids && essentials.bid_count) updatePayload.bat_bids = essentials.bid_count;
      if (!existing?.bat_comments && essentials.comment_count) updatePayload.bat_comments = essentials.comment_count;

      const { error } = await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);
      if (error) throw new Error(`vehicles update failed: ${error.message}`);
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

      const { error } = await supabase
        .from("external_listings")
        .upsert({
          vehicle_id: vehicleId,
          platform: "bat",
          listing_url: listingUrlCanonical,
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
        }, { onConflict: "vehicle_id,platform,listing_id" });

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

