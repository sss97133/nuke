/** Read-only listing page fetch + parse for evaluate_listing (no testimony writes). */
import { identityFromListingUrl } from "./variants.ts";

export interface FetchedListing {
  url: string;
  fetched_at: string;
  http_status: number;
  title: string | null;
  asking_price: number | null;
  currency: string | null;
  description: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  transmission: string | null;
  title_status: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  photo_urls: string[];
  raw_attrs: Record<string, string>;
  source: string;
  /** Set when the fetch landed on a login / checkpoint wall instead of the listing. */
  blocked_reason?: string | null;
  /** auction_live: the page price is a current bid, never an asking price. */
  listing_kind?: "auction_live" | "auction_ended" | "fixed_price" | null;
  /** Live auction high bid (not an ask, not a sale). */
  current_bid?: number | null;
  /** Auction end time (ISO) when the page states it. */
  auction_end_at?: string | null;
}

/**
 * Live auction state from the page. BaT renders a countdown with data-until (epoch seconds) while
 * bidding is open; ended pages show "Sold for" / "Bid to" instead. Exported for tests.
 */
export function detectAuctionState(html: string, nowMs = Date.now()): {
  live: boolean;
  ended: boolean;
  end_at: string | null;
} {
  const until = html.match(/listing-available-countdown[^>]*data-until="(\d{9,11})"/i)?.[1] ||
    html.match(/data-until="(\d{9,11})"[^>]*listing-available-countdown/i)?.[1] ||
    html.match(/data-ends="(\d{9,11})"/i)?.[1] ||
    html.match(/"end_timestamp"\s*:\s*(\d{9,11})/)?.[1] ||
    null;
  const endMs = until ? Number(until) * 1000 : null;
  const end_at = endMs != null && Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;
  const endedText = /\b(?:Sold\s+for|Bid\s+to)\s+(?:USD\s*)?\$[\d,]+/i.test(html) &&
    !/listing-available-countdown/i.test(html);
  if (endMs != null && endMs > nowMs && /listing-available-countdown|Place Bid|CURRENTLY LIVE/i.test(html)) {
    return { live: true, ended: false, end_at };
  }
  if (endMs != null && endMs <= nowMs) return { live: false, ended: true, end_at };
  return { live: false, ended: endedText, end_at };
}

/**
 * A login, checkpoint, or consent wall instead of the listing (e.g. facebook.com/login after a
 * redirect). Never cite such a page as the listing source. Exported for tests.
 */
export function detectLoginWall(requestedUrl: string, finalUrl: string, html: string): string | null {
  let path = "";
  let host = "";
  try {
    const u = new URL(finalUrl || requestedUrl);
    path = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const loginPath = /^\/(?:login|log-in|signin|sign-in|sign_in|checkpoint|auth|account\/login|accounts\/login|users\/sign_in|uas\/login)(?:[\/.?#]|$)/
    .test(path) || /^accounts\.google\./.test(host) || /^login\./.test(host);
  if (loginPath) return `redirected to a login page (${host}${path})`;
  const t = html.slice(0, 200_000);
  const title = (t.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().toLowerCase();
  if (
    /^(?:log in|log into|sign in|login)\b/.test(title) ||
    /facebook\.com/.test(host) && (/id="login_form"/i.test(t) || /you must log in to continue/i.test(t)) ||
    /^(?:facebook|instagram)$/.test(title) && /id="login_form"|name="login"/i.test(t)
  ) {
    return `page is a login wall (${host})`;
  }
  return null;
}

function absUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function uniq(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = u.replace(/\/$/, "").replace(/_\d+x\d+\./, "_600x450.");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function detectSource(url: string): string {
  const h = url.toLowerCase();
  if (h.includes("craigslist")) return "craigslist";
  if (h.includes("bringatrailer")) return "bat";
  if (h.includes("carsandbids")) return "cars_and_bids";
  if (h.includes("ebay")) return "ebay";
  return "listing";
}

/** Best-effort HTML parse for CL / common listing pages (schema.org + CL attrs). */
export function parseListingHtml(url: string, html: string, httpStatus: number): FetchedListing {
  const fetched_at = new Date().toISOString();
  const source = detectSource(url);

  let title: string | null = null;
  let asking_price: number | null = null;
  let currency: string | null = "USD";
  let description: string | null = null;
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let mileage: number | null = null;
  let transmission: string | null = null;
  let title_status: string | null = null;
  let location: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  const photo_urls: string[] = [];
  const raw_attrs: Record<string, string> = {};

  const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1];
  if (ogTitle) title = decodeEntities(ogTitle);

  const titleOnly = html.match(/id="titletextonly"[^>]*>([^<]+)/i)?.[1];
  if (titleOnly) title = decodeEntities(titleOnly);

  const priceSpan = html.match(/class="price"[^>]*>\s*\$?([\d,]+)/i)?.[1];
  if (priceSpan) asking_price = parseMoney(priceSpan);

  // schema.org Product JSON blocks
  const jsonBlocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonBlocks) {
    try {
      const j = JSON.parse(block[1]!);
      const nodes = Array.isArray(j) ? j : [j];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        if (n["@type"] === "Product" || n.name) {
          if (typeof n.name === "string" && !title) title = n.name;
          if (typeof n.description === "string") description = n.description;
          if (Array.isArray(n.image)) {
            for (const im of n.image) {
              if (typeof im === "string") photo_urls.push(absUrl(im, url));
            }
          }
          const offers = n.offers as Record<string, unknown> | undefined;
          if (offers) {
            if (asking_price == null) asking_price = parseMoney(String(offers.price ?? ""));
            if (typeof offers.priceCurrency === "string") currency = offers.priceCurrency;
            const place = offers.availableAtOrFrom as Record<string, unknown> | undefined;
            const addr = place?.address as Record<string, unknown> | undefined;
            if (addr) {
              city = typeof addr.addressLocality === "string" ? addr.addressLocality : city;
              state = typeof addr.addressRegion === "string" ? addr.addressRegion : state;
              location = [city, state].filter(Boolean).join(", ") || location;
            }
            const geo = place?.geo as Record<string, unknown> | undefined;
            if (geo) {
              latitude = geo.latitude != null ? Number(geo.latitude) : latitude;
              longitude = geo.longitude != null ? Number(geo.longitude) : longitude;
            }
          }
        }
      }
    } catch {
      /* ignore bad json-ld */
    }
  }

  const ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/name="description"\s+content="([^"]+)"/i)?.[1];
  if (ogDesc) {
    const og = decodeEntities(ogDesc);
    description = description ? `${og}\n\n${description}` : og;
  }

  // Craigslist posting body — append so schema.org / og:description claims are retained
  const bodyMatch = html.match(/id="postingbody"[^>]*>([\s\S]*?)<\/section>/i) ||
    html.match(/id="postingbody"[^>]*>([\s\S]*?)<\/div>/i);
  if (bodyMatch?.[1]) {
    const bodyText = stripTags(bodyMatch[1].replace(/<[^>]*qrcode[^>]*>[\s\S]*?<\/[^>]+>/gi, " "));
    if (bodyText) {
      description = description ? `${description}\n\n${bodyText}` : bodyText;
    }
  }

  // CL attr rows
  for (const m of html.matchAll(/class="attr[^"]*"[^>]*>[\s\S]*?class="labl"[^>]*>([^<:]+):?[\s\S]*?class="valu"[^>]*>([\s\S]*?)<\/(?:span|div)/gi)) {
    const lab = stripTags(m[1] || "").toLowerCase().replace(/\s+/g, "_");
    const val = stripTags(m[2] || "");
    if (lab && val) raw_attrs[lab] = val;
  }
  // simpler attr pattern used by CL
  for (const m of html.matchAll(/<span class="labl">([^<:]+):?<\/span>\s*<span class="valu">([\s\S]*?)<\/span>/gi)) {
    const lab = stripTags(m[1] || "").toLowerCase().replace(/\s+/g, "_");
    const val = stripTags(m[2] || "");
    if (lab && val) raw_attrs[lab] = val;
  }

  if (raw_attrs.odometer) mileage = parseMoney(raw_attrs.odometer);
  if (raw_attrs.transmission) transmission = raw_attrs.transmission;
  if (raw_attrs.title_status || raw_attrs["title status"]) {
    title_status = raw_attrs.title_status || raw_attrs["title status"] || null;
  }
  if (raw_attrs.year) year = Number(raw_attrs.year) || year;

  const yearSpan = html.match(/class="valu year"[^>]*>(\d{4})/i)?.[1];
  if (yearSpan) year = Number(yearSpan);

  // imgList JS on CL
  const imgList = html.match(/var imgList\s*=\s*(\[[\s\S]*?\]);/);
  if (imgList?.[1]) {
    try {
      const arr = JSON.parse(imgList[1]) as Array<{ url?: string }>;
      for (const im of arr) {
        if (im.url) photo_urls.push(absUrl(im.url, url));
      }
    } catch {
      /* ignore */
    }
  }
  for (const m of html.matchAll(/https:\/\/images\.craigslist\.org\/[^"' ]+_600x450\.(?:jpg|jpeg|png|webp)/gi)) {
    photo_urls.push(m[0]!);
  }

  // Live auction: the schema.org offer / price span is the current high bid, not a seller's ask.
  let listing_kind: FetchedListing["listing_kind"] = null;
  let current_bid: number | null = null;
  let auction_end_at: string | null = null;
  if (source === "bat" || source === "cars_and_bids" || source === "ebay") {
    const st = detectAuctionState(html);
    auction_end_at = st.end_at;
    if (st.live) {
      listing_kind = "auction_live";
      current_bid = asking_price;
      asking_price = null;
      if (current_bid != null) raw_attrs.current_bid = String(current_bid);
    } else if (st.ended) {
      listing_kind = "auction_ended";
    }
  } else if (asking_price != null) {
    listing_kind = "fixed_price";
  }

  // Identity from title / description; when HTML is a JS shell, fall back to URL slug.
  const fromUrl = identityFromListingUrl(url);
  if (fromUrl.auction_id) raw_attrs.auction_id = fromUrl.auction_id;
  const identity = `${title || ""} ${description || ""} ${fromUrl.title || ""}`;
  const ym = identity.match(/\b(19|20)\d{2}\b/);
  if (!year && ym) year = Number(ym[0]);
  if (!year && fromUrl.year) year = fromUrl.year;
  const makeMatch = identity.match(
    /\b(Porsche|Volkswagen|VW|BMW|Mercedes(?:-Benz)?|Ford|Chevrolet|Chevy|Ferrari|Jaguar|Lotus|Morris|Dodge|GMC|Toyota|Honda|Nissan|Audi|Mazda)\b/i,
  );
  if (makeMatch) {
    const raw = makeMatch[1]!;
    make = make || (/^vw$/i.test(raw) ? "Volkswagen" : /^chevy$/i.test(raw) ? "Chevrolet" : raw);
  }
  if (/porsche/i.test(identity)) make = make || "Porsche";
  if (/volkswagen|\bvw\b/i.test(identity)) make = make || "Volkswagen";
  make = make || fromUrl.make;
  if (/\b911\b/i.test(identity)) model = model || "911";
  if (/karmann\s*ghia/i.test(identity)) model = model || "Karmann Ghia";
  if (/cabriolet|cabrio|convertible/i.test(identity) && model && !/cab|convertible/i.test(model)) {
    model = `${model} Cabriolet`;
  }
  if (/coupe/i.test(identity) && model && !/coupe/i.test(model) && /karmann/i.test(model)) {
    model = `${model} Coupe`;
  }
  // Prefer URL slug model when it carries specialty trim the HTML missed (Turbo, etc.).
  if (fromUrl.model) {
    if (!model) model = fromUrl.model;
    else if (/turbo/i.test(fromUrl.model) && !/turbo/i.test(model)) {
      model = /911/.test(model) ? fromUrl.model : `${model} ${fromUrl.model}`;
    }
  }
  if (!title && fromUrl.title) title = fromUrl.title;
  if (/g50/i.test(identity) && !transmission) transmission = "G50 5-speed manual";
  if (!transmission && /5[\s-]?speed|manual/i.test(identity)) transmission = "manual";

  // BaT sold price often in "sold for $X" — still an observed sale, not an ask.
  const soldFor = identity.match(/sold\s+for\s+\$?([\d,]+)/i);
  if (soldFor && asking_price == null && listing_kind !== "auction_live") {
    asking_price = parseMoney(soldFor[1]);
    raw_attrs.sold_price_from_page = String(asking_price);
  }

  const milesClaim = identity.match(/\b(\d{1,3}(?:,\d{3})+)\s*(?:miles|mi)\b/i) ||
    identity.match(/\b(\d{2,3})k\s*(?:miles|mi)?\b/i);
  if (!mileage && milesClaim) {
    const raw = milesClaim[1]!.toLowerCase();
    mileage = raw.endsWith("k") || /k\s*(?:miles)?$/i.test(milesClaim[0]!)
      ? Number(raw.replace(/k$/i, "")) * 1000
      : parseMoney(raw);
  }

  if (!location) {
    const loc = html.match(/\(([^)]+)\)\s*<\/span>\s*<\/span>\s*<\/h1>/i)?.[1] ||
      html.match(/og:title"[^>]*content="[^"]+-\s*([^-]+)\s*-\s*craigslist/i)?.[1];
    if (loc) location = decodeEntities(loc.trim());
  }

  return {
    url,
    fetched_at,
    http_status: httpStatus,
    title,
    asking_price,
    currency,
    description,
    year,
    make,
    model,
    mileage,
    transmission,
    title_status,
    location,
    city,
    state,
    latitude,
    longitude,
    photo_urls: uniq(photo_urls).slice(0, 24),
    raw_attrs,
    source,
    listing_kind,
    current_bid,
    auction_end_at,
  };
}

export async function fetchListingPage(url: string): Promise<FetchedListing> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NukeAssetAdvisor/1.0; +https://nuke.ag/mcp/advisor)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    const html = await res.text();
    const wall = detectLoginWall(url, res.url || url, html);
    if (wall) {
      // Keep the requested URL as the listing URL; never cite the wall page.
      const blank = parseListingHtml(url, "", res.status);
      return { ...blank, title: null, year: null, make: null, model: null, blocked_reason: wall };
    }
    return parseListingHtml(res.url || url, html, res.status);
  } finally {
    clearTimeout(t);
  }
}
