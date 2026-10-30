/**
 * Normalize an extractor's answer to the one shape the callers read (vehicleWrite, ingest's tryAutoEnrich).
 * Moved out of index.ts unchanged so it can be tested without starting the function; the only addition is the
 * Craigslist capture pass-through at the end.
 */

import { captureFields } from '../_shared/craigslistAttributes.ts'

/** A source's explicit spending hold must survive the dedicated-extractor proxy.
 * Turning it into a generic AI attempt loses the deferral and needlessly tries
 * paid providers against the same unavailable page.
 */
export function dedicatedExtractorDeferral(data: unknown): { success: false; deferred: true; error: string } | null {
  const message = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof message === 'string' && /allowance[_ ]deferred|firecrawl_allowance_exhausted/i.test(message)
    ? { success: false, deferred: true, error: 'allowance_deferred: source Firecrawl allowance unavailable' }
    : null;
}

export function normalizeExtractedData(data: any, url: string): any {
  return {
    vin: data.vin || null,
    year: data.year ? (parseInt(String(data.year), 10) || null) : null,
    make: data.make || data.manufacturer || null,
    model: data.model || null,
    series: data.series || null,
    trim: data.trim || null,
    mileage: data.mileage ? (parseInt(String(data.mileage).replace(/[^0-9]/g, ''), 10) || null) : null,
    price: (data.price || data.asking_price) ? (parseInt(String(data.price || data.asking_price).replace(/[^0-9]/g, ''), 10) || null) : null,
    asking_price: data.asking_price ? (parseInt(String(data.asking_price).replace(/[^0-9]/g, ''), 10) || null) : null,
    sold_price: data.sold_price ? (parseInt(String(data.sold_price).replace(/[^0-9]/g, ''), 10) || null) : null,
    sold_date: data.sold_date || null,
    color: data.color || data.exterior_color || null,
    exterior_color: data.exterior_color || data.color || null,
    interior_color: data.interior_color || null,
    transmission: data.transmission || null,
    drivetrain: data.drivetrain || null,
    engine: data.engine || data.engine_type || null,
    engine_size: data.engine_size || data.displacement || null,
    body_style: data.body_style || data.body_type || null,
    body_type: data.body_type || data.body_style || null,
    title_status: data.title_status || null,
    description: data.description || null,
    images: data.images || data.image_urls || [],
    image_urls: data.image_urls || data.images || [],
    location: data.location || null,
    seller: data.seller || null,
    seller_phone: data.seller_phone || null,
    seller_email: data.seller_email || null,
    listing_title: data.listing_title || data.title || null,
    listing_url: url,
    confidence: data.confidence || 0.8,
    // A Craigslist capture (the post's attribute block, id and clocks) rides through untouched; `{}` for every other source.
    ...captureFields(data),
  }
}


