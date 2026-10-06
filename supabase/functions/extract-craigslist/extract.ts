// extract-craigslist, the half that needs no network: page HTML in, listing out.
// Craigslist is server-rendered: JSON-LD for title, price, place and photos; the attribute block for the rest.
// index.ts fetches the page through archiveFetch (which archives it to listing_page_snapshots) and calls this.

import { type CraigslistAttributes, parseCapture, stripTags } from '../_shared/craigslistAttributes.ts';

export interface CraigslistExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  exterior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuel_type: string | null;
  cylinders: string | null;
  body_style: string | null;
  condition: string | null;
  title_status: string | null;
  description: string | null;
  image_urls: string[];
  /** The post's own clocks (ISO 8601 UTC) and id, read from the page. */
  posted_at: string | null;
  updated_at: string | null;
  post_id: string | null;
  /** Identity-grade VIN only (see _shared/craigslistAttributes judgeVin); the seller's text is in attributes.vin_raw. */
  vin: string | null;
  /** The whole attribute block, a stable object: see CraigslistAttributes. */
  attributes: CraigslistAttributes;
}

function extractJsonLd(html: string): any | null {
  // Craigslist has JSON-LD with vehicle data in <script type="application/ld+json" id="ld_posting_data">
  const match = html.match(/<script type="application\/ld\+json" id="ld_posting_data"\s*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractSpanValue(html: string, spanClass: string): string | null {
  // Extract value from <span class="valu {spanClass}">...</span>
  // Pattern needs to match either: plain text OR <a>text</a>
  const pattern = new RegExp(`<span class="valu ${spanClass}"[^>]*>(?:[\\s]*<a[^>]*>([^<]+)<\\/a>|([^<]+))`, 'i');
  const match = html.match(pattern);
  // match[1] is if content was in <a> tag, match[2] is if it was plain text
  const result = (match?.[1] || match?.[2])?.replace(/\s+/g, ' ').trim();
  return result || null;
}

function parseYearMakeModel(makeModelStr: string): { make: string | null; model: string | null } {
  // Input format: "gmc yukon slt 4x4" or similar
  if (!makeModelStr || !makeModelStr.trim()) {
    return { make: null, model: null };
  }

  const parts = makeModelStr.trim().split(/\s+/);
  if (parts.length === 0) return { make: null, model: null };

  const make = parts[0];
  const model = parts.slice(1).join(' ');

  return {
    make: make ? (make.charAt(0).toUpperCase() + make.slice(1).toLowerCase()) : null,
    model: model || null
  };
}

export function extractFromHtml(html: string, url: string): CraigslistExtracted {
  // Parse JSON-LD structured data
  const jsonLd = extractJsonLd(html);

  // Extract title and basic info
  const title = jsonLd?.name || null;
  const price = jsonLd?.offers?.price ? Math.round(parseFloat(jsonLd.offers.price)) : null;
  const location = jsonLd?.offers?.availableAtOrFrom?.address?.addressLocality || null;

  // Extract year from HTML attributes (it's a span class, not attr class)
  const yearStr = extractSpanValue(html, 'year');
  const year = yearStr ? parseInt(yearStr, 10) : null;

  // Extract make/model from makemodel attribute (it's a span class, not attr class)
  const makeModelStr = extractSpanValue(html, 'makemodel') || '';
  const { make, model } = parseYearMakeModel(makeModelStr);

  // The attribute block and the post's own id and clocks
  const { post_id, posted_at, updated_at, attributes } = parseCapture(html, url);

  // Extract description from postingbody
  let description: string | null = null;
  const descMatch = html.match(/<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/);
  if (descMatch) {
    // Remove QR code div and clean up HTML
    description = stripTags(
      descMatch[1]
        .replace(/<div class="print-information[^>]*>[\s\S]*?<\/div>/g, '')
        .replace(/<br\s*\/?>/gi, '\n'),
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000) || null;
  }

  // Extract images from JSON-LD
  const image_urls: string[] = [];
  if (jsonLd?.image && Array.isArray(jsonLd.image)) {
    image_urls.push(...jsonLd.image.filter((url: string) => url && url.startsWith('https://')));
  }

  return {
    url,
    title,
    year,
    make,
    model,
    price,
    mileage: attributes.odometer,
    location,
    exterior_color: attributes.paint_color,
    transmission: attributes.transmission,
    drivetrain: attributes.drive,
    fuel_type: attributes.fuel,
    cylinders: attributes.cylinders,
    body_style: attributes.type,
    condition: attributes.condition,
    title_status: attributes.title_status,
    description,
    image_urls,
    posted_at,
    updated_at,
    post_id,
    vin: attributes.vin,
    attributes,
  };
}

/**
 * The import_queue row for one extracted listing. raw_data carries the whole attribute block as `attributes`
 * (always present, all-null when the page had none) beside the post's id and clocks.
 */
export function buildQueueRow(extracted: CraigslistExtracted): Record<string, unknown> {
  return {
    listing_url: extracted.url,
    listing_title: extracted.title,
    listing_price: extracted.price,
    listing_year: extracted.year,
    listing_make: extracted.make,
    listing_model: extracted.model,
    thumbnail_url: extracted.image_urls[0] || null,
    raw_data: {
      mileage: extracted.mileage,
      location: extracted.location,
      exterior_color: extracted.exterior_color,
      transmission: extracted.transmission,
      drivetrain: extracted.drivetrain,
      fuel_type: extracted.fuel_type,
      cylinders: extracted.cylinders,
      body_style: extracted.body_style,
      condition: extracted.condition,
      title_status: extracted.title_status,
      description: extracted.description,
      image_urls: extracted.image_urls,
      posted_at: extracted.posted_at,
      updated_at: extracted.updated_at,
      post_id: extracted.post_id,
      attributes: extracted.attributes,
    },
    status: 'pending',
    extractor_version: 'extract-craigslist-v2',
  };
}
