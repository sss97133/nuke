/**
 * URL Normalization — Extract canonical listing IDs from known platforms
 *
 * Used in entity resolution to prevent duplicate vehicle records from
 * URL variants (e.g., JamesEdition clean URL vs title-appended URL).
 *
 * The normalized form is: "platform:listing_id" — a canonical identifier
 * that uniquely identifies a listing regardless of URL format.
 *
 * Usage:
 *   import { normalizeListingUrl, normalizeVin, urlsMatchSameListing } from "../_shared/urlNormalization.ts";
 *
 *   const result = normalizeListingUrl('https://www.jamesedition.com/cars/.../for-sale-14855981 "Title"');
 *   // result.canonicalListingId === "jamesedition:14855981"
 *   // result.normalized === "https://jamesedition.com/cars/.../for-sale-14855981"
 */

export interface NormalizedUrl {
  /** Original URL as received */
  original: string;
  /** Normalized URL (cleaned: no www, no trailing slash, no query params, no appended title) */
  normalized: string;
  /** Platform-specific canonical listing ID (e.g., "jamesedition:14855981") */
  canonicalListingId: string | null;
  /** Detected platform slug */
  platform: string | null;
}

/**
 * Strip common URL noise: appended titles in quotes, query params, fragments,
 * trailing slashes, www prefix, and normalize to https.
 */
function stripUrlNoise(raw: string): string {
  // 1. Strip appended title text: `url "Title"` or `url 'Title'`
  let cleaned = raw.replace(/\s+["'][^"']*["']?\s*$/, "");
  // 2. Strip anything after a space (handles `url Title Text` without quotes)
  cleaned = cleaned.split(/\s+/)[0];

  try {
    const u = new URL(cleaned);
    u.hash = "";
    u.search = "";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname || "").replace(/\/+$/, "");
    return `https://${host}${path}`;
  } catch {
    // Fallback for non-parseable URLs
    return cleaned
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/^https?:\/\//i, "https://")
      .replace(/^(https:\/\/)www\./i, "$1");
  }
}

/**
 * Normalize a listing URL and extract platform-specific listing ID.
 *
 * Platform-specific extractors pull out the stable identifier (numeric ID, slug, lot number)
 * so that URL variants (www vs non-www, title-appended, trailing slash) all resolve
 * to the same canonicalListingId.
 */
export function normalizeListingUrl(url: string | null | undefined): NormalizedUrl | null {
  if (!url || typeof url !== "string" || url.trim().length === 0) return null;

  const trimmed = url.trim();

  // JamesEdition: extract numeric listing ID (7+ digits)
  // Clean: /for-sale-14855981
  // Dirty: /for-sale-14855981 "2019 Koenigsegg Regera"
  // The numeric ID is the only stable part — title slug can vary
  const je = trimmed.match(/jamesedition\.com.*?[/-](\d{7,})/);
  if (je) {
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `jamesedition:${je[1]}`,
      platform: "jamesedition",
    };
  }

  // RM Sotheby's: extract lot ID (e.g., r0001-1967-chevrolet-corvette...)
  const rm = trimmed.match(/rmsothebys\.com\/.*?\/lots\/(r\d+-[^/\s?#]+)/);
  if (rm) {
    const lotSlug = rm[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `rmsothebys:${lotSlug}`,
      platform: "rm-sothebys",
    };
  }

  // BaT: extract listing slug
  const bat = trimmed.match(/bringatrailer\.com\/listing\/([\w-]+)/);
  if (bat) {
    const slug = bat[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: `https://bringatrailer.com/listing/${slug}`,
      canonicalListingId: `bat:${slug}`,
      platform: "bat",
    };
  }

  // Cars & Bids
  const cab = trimmed.match(/carsandbids\.com\/auctions\/([\w-]+)/);
  if (cab) {
    const slug = cab[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: `https://carsandbids.com/auctions/${slug}`,
      canonicalListingId: `carsandbids:${slug}`,
      platform: "cars-and-bids",
    };
  }

  // Barrett-Jackson: normalize vehicle URL
  const bj = trimmed.match(/barrett-jackson\.com\/([^?\s#]+)/);
  if (bj) {
    const path = bj[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: `https://barrett-jackson.com/${path}`,
      canonicalListingId: `barrett-jackson:${path}`,
      platform: "barrett-jackson",
    };
  }

  // Mecum
  const mec = trimmed.match(/mecum\.com\/([^?\s#]+)/);
  if (mec) {
    const path = mec[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `mecum:${path}`,
      platform: "mecum",
    };
  }

  // Gooding
  const goo = trimmed.match(/goodingco\.com\/([^?\s#]+)/);
  if (goo) {
    const path = goo[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `gooding:${path}`,
      platform: "gooding",
    };
  }

  // Bonhams
  const bon = trimmed.match(/bonhams\.com\/([^?\s#]+)/);
  if (bon) {
    const path = bon[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `bonhams:${path}`,
      platform: "bonhams",
    };
  }

  // Broad Arrow
  const ba = trimmed.match(/broadarrowauctions\.com\/([^?\s#]+)/);
  if (ba) {
    const path = ba[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `broadarrow:${path}`,
      platform: "broad-arrow",
    };
  }

  // Collecting Cars
  const cc = trimmed.match(/collectingcars\.com\/([^?\s#]+)/);
  if (cc) {
    const path = cc[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `collectingcars:${path}`,
      platform: "collecting-cars",
    };
  }

  // Hagerty Marketplace
  const hag = trimmed.match(/hagerty\.com\/marketplace\/([^?\s#]+)/);
  if (hag) {
    const path = hag[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `hagerty:${path}`,
      platform: "hagerty",
    };
  }

  // Hemmings
  const hem = trimmed.match(/hemmings\.com\/classifieds\/([^?\s#]+)/);
  if (hem) {
    const path = hem[1].replace(/\/+$/, "");
    return {
      original: trimmed,
      normalized: stripUrlNoise(trimmed),
      canonicalListingId: `hemmings:${path}`,
      platform: "hemmings",
    };
  }

  // eBay Motors
  const ebay = trimmed.match(/ebay\.com\/itm\/(\d+)/);
  if (ebay) {
    return {
      original: trimmed,
      normalized: `https://ebay.com/itm/${ebay[1]}`,
      canonicalListingId: `ebay:${ebay[1]}`,
      platform: "ebay",
    };
  }

  // Generic fallback: use stripUrlNoise for consistent normalization
  return {
    original: trimmed,
    normalized: stripUrlNoise(trimmed),
    canonicalListingId: null,
    platform: null,
  };
}

/**
 * Validate and normalize a VIN.
 * Returns null if the VIN is invalid/fake.
 */
export function normalizeVin(vin: string | null | undefined): string | null {
  if (!vin || typeof vin !== "string") return null;

  const cleaned = vin.trim().toUpperCase().replace(/\s+/g, "");

  // Reject empty
  if (cleaned.length === 0) return null;

  // Reject known placeholder values
  const fakes = new Set([
    "UNKNOWN", "STRING", "NUMBER", "NULL", "N/A", "NONE", "TBD",
    "NA", "PENDING", "NOTAVAILABLE", "UNAVAILABLE", "SEE DESCRIPTION",
    "NUMBER", "SOLDNOBS", "S0LD0NB0S",
  ]);
  if (fakes.has(cleaned)) return null;

  // Reject single character repeated
  if (/^(.)\1+$/.test(cleaned)) return null;

  // Reject Bonhams engine/lot numbers
  // Pattern: N followed by digits + ENGNEN/SEETEXTE/ENG suffix
  if (/^N\d+.*ENG/i.test(cleaned)) return null;
  if (/^N\d+.*SEE/i.test(cleaned)) return null;
  if (/^NRC\d+.*ENG/i.test(cleaned)) return null;
  if (/^NGB\d+.*ENG/i.test(cleaned)) return null;

  // Reject too short to be meaningful (< 6 chars)
  if (cleaned.length < 6) return null;

  return cleaned;
}

/**
 * Check if two URLs point to the same listing.
 * Uses canonical listing IDs when available, falls back to normalized URL comparison.
 */
export function urlsMatchSameListing(urlA: string, urlB: string): boolean {
  const normA = normalizeListingUrl(urlA);
  const normB = normalizeListingUrl(urlB);

  if (!normA || !normB) return false;

  // If both have canonical listing IDs, compare those
  if (normA.canonicalListingId && normB.canonicalListingId) {
    return normA.canonicalListingId === normB.canonicalListingId;
  }

  // Fall back to normalized URL comparison
  return normA.normalized === normB.normalized;
}
