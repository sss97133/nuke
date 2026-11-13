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
  /**
   * What the page price is (T1). sold = winning bid of a closed sale; high_bid_reserve_not_met = the
   * top bid of an auction that did not sell (never a sale); current_bid = live bid; ask = seller ask.
   */
  price_kind?: "sold" | "high_bid_reserve_not_met" | "current_bid" | "ask" | null;
  /** The page price of `price_kind`, in `currency` (native, never converted). */
  price?: number | null;
  /** hammer = before buyer fee (BaT publishes the winning bid); gross_incl_premium; unknown. */
  price_basis?: "hammer" | "gross_incl_premium" | "unknown" | null;
  /** Where price_basis came from (page label or fee schedule), and any conflict between them. */
  price_basis_note?: string | null;
  sold_price?: number | null;
  high_bid?: number | null;
  /** Sale / auction close time read from the page (ISO). */
  end_at?: string | null;
  /** Odometer as shown on the page; mileage_tmu = "TMU" (true mileage unknown) printed by the seller. */
  mileage_tmu?: boolean;
  mileage_km?: number | null;
  mileage_text?: string | null;
  mileage_source?: "page_listing_details" | "page_text" | "page_attr" | null;
  /** Full model from the page title (e.g. "911 GT3 RS"), before any database fill-in. */
  model_from_title?: string | null;
}

const TWO_WORD_MAKES = [
  "Land Rover",
  "Alfa Romeo",
  "Aston Martin",
  "Rolls-Royce",
  "Mercedes-Benz",
  "De Tomaso",
  "AM General",
  "Austin-Healey",
  "Morgan Plus",
];

/** Year / make / model from a listing title such as "15k-Mile 2011 Porsche 911 GT3 RS 6-Speed". */
export function identityFromTitle(title: string | null | undefined): {
  year: number | null;
  make: string | null;
  model: string | null;
} {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = t.match(/\b((?:18|19|20)\d{2})\s+(.+)$/);
  if (!m) return { year: null, make: null, model: null };
  const year = Number(m[1]);
  const rest = m[2]!;
  const two = TWO_WORD_MAKES.find((mk) => rest.toLowerCase().startsWith(mk.toLowerCase() + " "));
  const make = two ? rest.slice(0, two.length) : rest.split(" ")[0]!;
  let model: string | null = rest.slice(make.length).trim();
  // A trailing gearbox count describes the car, it is not part of the model name.
  model = model.replace(/\s+\d-Speed(?:\s+(?:Manual|Automatic))?$/i, "").trim() || null;
  return { year, make: make || null, model };
}

/** Odometer from a BaT "Listing Details" line: "111k Miles Shown, TMU", "37k Kilometers (~23k Miles) Shown". */
export function parseMileageLine(line: string): { miles: number | null; km: number | null; tmu: boolean } | null {
  const l = line.replace(/\s+/g, " ").trim();
  if (!/\b(?:miles?|kilometers?|kilometres?|km)\b/i.test(l)) return null;
  const num = (raw: string, k: string | undefined) => {
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.round(k ? n * 1000 : n);
  };
  const tmu = /\bTMU\b|true mileage unknown/i.test(l);
  const lead = l.match(/^(?:~|approximately\s+)?([\d,]+(?:\.\d+)?)\s*(k)?\s*(miles?|kilometers?|kilometres?|km)\b/i);
  if (!lead) return null;
  const leadVal = num(lead[1]!, lead[2]);
  if (/^mile/i.test(lead[3]!)) return { miles: leadVal, km: null, tmu };
  const approx = l.match(/~\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*miles?/i);
  return { miles: approx ? num(approx[1]!, approx[2]) : null, km: leadVal, tmu };
}

/**
 * BaT listing page facts read from the page itself (T1/T2): title, the auction result or live bid,
 * the close time, and the odometer line from "Listing Details". Exported for tests.
 */
export function parseBatListing(html: string): {
  title: string | null;
  price_kind: FetchedListing["price_kind"];
  price: number | null;
  currency: string | null;
  end_at: string | null;
  mileage: number | null;
  mileage_km: number | null;
  mileage_tmu: boolean;
  mileage_text: string | null;
} {
  const h1 = html.match(/data-testid="listing-post-title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    html.match(/<h1[^>]*class="[^"]*listing-post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? null;
  const title = h1 ? stripTags(h1) || null : null;
  const infoRaw = html.match(/class="listing-available-info"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const info = stripTags(infoRaw);
  let price_kind: FetchedListing["price_kind"] = null;
  let price: number | null = null;
  let currency: string | null = null;
  const pick = (re: RegExp) => {
    const m = info.match(re);
    if (!m) return false;
    currency = m[1] ? m[1].toUpperCase() : "USD";
    price = parseMoney(m[2]);
    return true;
  };
  const CUR = "(USD|EUR|GBP|CAD|AUD|CHF|JPY)?\\s*[$€£]?\\s*([\\d,]+)";
  if (pick(new RegExp(`Current Bid:?\\s*${CUR}`, "i"))) price_kind = "current_bid";
  else if (pick(new RegExp(`Sold for\\s*${CUR}`, "i"))) price_kind = "sold";
  else if (pick(new RegExp(`Bid to\\s*${CUR}`, "i"))) price_kind = "high_bid_reserve_not_met";
  let end_at: string | null = null;
  const until = html.match(/listing-available-countdown[^>]*data-until="(\d{9,11})"/i)?.[1];
  const ts = infoRaw.match(/data-timestamp="(\d{9,11})"/i)?.[1];
  const endTs = price_kind === "current_bid" ? until : ts ?? until;
  if (endTs) end_at = new Date(Number(endTs) * 1000).toISOString();
  let mileage: number | null = null;
  let mileage_km: number | null = null;
  let mileage_tmu = false;
  let mileage_text: string | null = null;
  const detailsIdx = html.search(/Listing Details<\/strong>/i);
  if (detailsIdx >= 0) {
    const ul = html.slice(detailsIdx, detailsIdx + 8000).match(/<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
    for (const li of ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const line = stripTags(li[1] || "");
      const m = parseMileageLine(line);
      if (m) {
        mileage = m.miles;
        mileage_km = m.km;
        mileage_tmu = m.tmu;
        mileage_text = line;
        break;
      }
    }
  }
  return { title, price_kind, price, currency, end_at, mileage, mileage_km, mileage_tmu, mileage_text };
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

/** Photo URLs from BaT's data-gallery-items attribute (large, else full/small). */
export function batGalleryPhotoUrls(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-gallery-items=(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = decodeEntities(m[1] ?? m[2] ?? "");
    let arr: unknown;
    try {
      arr = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const it of arr as Array<Record<string, unknown>>) {
      const pick = (k: string) => {
        const v = it?.[k] as { url?: unknown } | string | undefined;
        return typeof v === "string" ? v : typeof v?.url === "string" ? v.url : null;
      };
      const u = pick("large") || pick("full") || pick("url") || pick("small");
      if (u && /^https?:|^\//i.test(u)) out.push(absUrl(u, base));
    }
  }
  return out;
}

function detectSource(url: string): string {
  // Decide by the parsed host, never by a substring of the whole URL: a path or a look-alike
  // host ("mecum.com.example.org", "example.org/?u=mecum.com") must not match.
  let h = "";
  try { h = new URL(url).hostname.toLowerCase(); } catch { return "listing"; }
  const on = (domain: string) => h === domain || h.endsWith("." + domain);
  if (on("craigslist.org")) return "craigslist";
  if (on("bringatrailer.com")) return "bat";
  if (on("carsandbids.com")) return "cars_and_bids";
  if (/(^|\.)ebay\.[a-z.]{2,6}$/.test(h)) return "ebay";
  if (on("mecum.com")) return "mecum";
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

  // BaT: gallery JSON lives HTML-entity-encoded in data-gallery-items.
  photo_urls.push(...batGalleryPhotoUrls(html, url));
  // Generic fallback: og:image / twitter:image.
  if (!photo_urls.length) {
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi)) {
      const c = m[0].match(/content=["']([^"']+)["']/i)?.[1];
      if (c && /^https?:|^\//i.test(decodeEntities(c))) photo_urls.push(absUrl(decodeEntities(c), url));
    }
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

  // BaT: read the result / bid, close time and odometer from the page itself (T1/T2).
  let price_kind: FetchedListing["price_kind"] = null;
  let price: number | null = null;
  let price_basis: FetchedListing["price_basis"] = null;
  let price_basis_note: string | null = null;
  let sold_price: number | null = null;
  let high_bid: number | null = null;
  let end_at: string | null = null;
  let mileage_tmu = false;
  let mileage_km: number | null = null;
  let mileage_text: string | null = null;
  let mileage_source: FetchedListing["mileage_source"] = mileage != null ? "page_attr" : null;
  let model_from_title: string | null = null;
  if (source === "bat") {
    const bat = parseBatListing(html);
    if (bat.title) title = bat.title;
    if (bat.price_kind) {
      price_kind = bat.price_kind;
      price = bat.price;
      if (bat.currency) currency = bat.currency;
      price_basis = "hammer";
      price_basis_note = "BaT publishes the winning / high bid; the buyer fee is charged on top (hammer basis)";
      if (bat.price_kind === "current_bid") {
        listing_kind = "auction_live";
        current_bid = bat.price;
        asking_price = null;
      } else {
        listing_kind = "auction_ended";
        asking_price = null; // a result is never an ask
        if (bat.price_kind === "sold") sold_price = bat.price;
        else high_bid = bat.price;
      }
    }
    if (bat.end_at) {
      end_at = bat.end_at;
      auction_end_at = bat.end_at;
    }
    if (bat.mileage != null || bat.mileage_km != null) {
      mileage = bat.mileage;
      mileage_km = bat.mileage_km;
      mileage_tmu = bat.mileage_tmu;
      mileage_text = bat.mileage_text;
      mileage_source = "page_listing_details";
    }
  } else if (source === "mecum") {
    // Mecum lot pages carry the result in embedded JSON ("hammerPrice") plus a sold badge.
    const t = title?.replace(/\s+For Sale At Auction.*$/i, "").replace(/\s+-\s+Mecum Auctions$/i, "").trim();
    if (t) title = t;
    const hp = html.match(/\\?"hammerPrice\\?"\s*:\s*\\?"?(\d+)/)?.[1];
    const soldBadge = /saleResultBadge[^"]*\bsold\b|alt="sold"/i.test(html);
    if (hp && Number(hp) > 0 && soldBadge) {
      price_kind = "sold";
      price = Number(hp);
      sold_price = price;
      listing_kind = "auction_ended";
      asking_price = null;
      // Conflict, flagged not resolved: the page field is named hammerPrice, while Nuke's cited fee
      // schedule (platform_fee_schedule, mecum) says Mecum's published results include the premium.
      price_basis = "unknown";
      price_basis_note =
        "conflict: Mecum page field is 'hammerPrice' but platform_fee_schedule (mecum, published_price_basis=gross_incl_premium) says published results include the buyer premium";
    }
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
  // BaT / Mecum titles carry the full model ("911 GT3 RS", "Cayenne Turbo S"): the title beats the
  // keyword guesses above, which collapse every 911 to "911".
  if ((source === "bat" || source === "mecum") && title) {
    const ti = identityFromTitle(title);
    if (ti.year) year = ti.year;
    if (ti.make) make = /^chevy$/i.test(ti.make) ? "Chevrolet" : /^vw$/i.test(ti.make) ? "Volkswagen" : ti.make;
    if (ti.model) {
      model = ti.model;
      model_from_title = ti.model;
    }
  }
  if (/g50/i.test(identity) && !transmission) transmission = "G50 5-speed manual";
  if (!transmission && /5[\s-]?speed|manual/i.test(identity)) transmission = "manual";

  // "sold for $X" in page text is an observed sale, never an ask (T1).
  const soldFor = identity.match(/sold\s+for\s+(?:USD\s*)?\$?([\d,]+)/i);
  if (soldFor && price_kind == null && listing_kind !== "auction_live") {
    sold_price = parseMoney(soldFor[1]);
    price = sold_price;
    price_kind = "sold";
    price_basis = source === "bat" ? "hammer" : "unknown";
    if (asking_price === sold_price) asking_price = null;
    raw_attrs.sold_price_from_page = String(sold_price);
  }
  if (price_kind == null) {
    if (listing_kind === "auction_live" && current_bid != null) {
      price_kind = "current_bid";
      price = current_bid;
    } else if (asking_price != null) {
      price_kind = "ask";
      price = asking_price;
    }
  }

  const milesClaim = identity.match(/\b(\d{1,3}(?:,\d{3})+)\s*(?:miles|mi)\b/i) ||
    identity.match(/\b(\d{2,3})k\s*(?:miles|mi)?\b/i);
  if (!mileage && mileage_source == null && milesClaim) {
    const raw = milesClaim[1]!.toLowerCase();
    mileage = raw.endsWith("k") || /k\s*(?:miles)?$/i.test(milesClaim[0]!)
      ? Number(raw.replace(/k$/i, "")) * 1000
      : parseMoney(raw);
    if (mileage != null) mileage_source = "page_text";
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
    price_kind,
    price,
    price_basis,
    price_basis_note,
    sold_price,
    high_bid,
    end_at: end_at ?? (listing_kind === "auction_ended" ? auction_end_at : null),
    mileage_tmu,
    mileage_km,
    mileage_text,
    mileage_source,
    model_from_title,
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
