#!/usr/bin/env npx tsx
/**
 * FB MARKETPLACE ENRICHMENT
 * 
 * Visits every Facebook Marketplace vehicle listing page via Playwright,
 * extracts ALL available data, backfills the vehicle record, inserts images,
 * and creates a timeline event.
 * 
 * Extracts: model, description, location, mileage, transmission, colors,
 *           fuel type, title status, owners, images (all), video URL,
 *           listing age, seller name
 * 
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-enrich-all.ts
 *   dotenvx run -- npx tsx scripts/fb-enrich-all.ts --limit 50
 *   dotenvx run -- npx tsx scripts/fb-enrich-all.ts --id df81633f-...
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ─── Parse CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
let LIMIT = 9999;
let SINGLE_ID: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) LIMIT = parseInt(args[i + 1]);
  if (args[i] === '--id' && args[i + 1]) SINGLE_ID = args[i + 1];
}

// ─── Types ──────────────────────────────────────────────────────────────
interface FBListingData {
  title: string | null;
  model: string | null;
  description: string | null;
  location: string | null;
  mileage: number | null;
  transmission: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  fuelType: string | null;
  titleStatus: string | null;
  owners: number | null;
  paidOff: boolean | null;
  listedDaysAgo: number | null;
  sellerName: string | null;
  images: string[];
  videoUrl: string | null;
  price: number | null;
}

// ─── Extraction logic ───────────────────────────────────────────────────
async function extractFromPage(page: Page, url: string): Promise<FBListingData | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if listing was removed
    const pageText = await page.evaluate(() => document.body?.innerText || '');
    if (pageText.includes('This listing may have been removed') || 
        pageText.includes('This content isn\'t available') ||
        pageText.includes('Log in or sign up') && !pageText.includes('About this vehicle')) {
      return null;
    }

    // Click "See more" to expand description
    try {
      const seeMore = page.locator('button:has-text("See more")').first();
      if (await seeMore.isVisible({ timeout: 2000 })) {
        await seeMore.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
    } catch {}

    // Get page title for model parsing
    const pageTitle = await page.title();
    // Title format: "1976 GMC Jimmy · Sport Utility 2D - Cars & Trucks - Stockton, California | Facebook Marketplace"
    const titleMatch = pageTitle.match(/^\d{4}\s+(\S+)\s+(.+?)(?:\s*·|\s*-)/);
    const model = titleMatch ? titleMatch[2].trim() : null;

    // Parse full body text for structured fields
    const bodyText = await page.evaluate(() => document.body?.innerText || '');

    // Description - try multiple selectors
    let description: string | null = null;
    try {
      // Look for the seller's description section
      const descEl = await page.$('[data-testid="marketplace_listing_description"]');
      if (descEl) {
        description = await descEl.innerText();
      }
    } catch {}
    if (!description) {
      // Fallback: extract from body text between "Seller's description" and next section
      const descMatch = bodyText.match(/Seller's description\n([\s\S]*?)(?:\nView Map|Related listings|Today's picks|Message\n)/);
      description = descMatch ? descMatch[1].trim() : null;
    }
    if (!description) {
      // Try og:description meta
      description = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content')).catch(() => null);
    }

    // Location: "Listed X ago in City, ST"
    const locationMatch = bodyText.match(/(?:Listed.*?in\s+)([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/);
    const location = locationMatch ? locationMatch[1].trim() : null;

    // Listed time
    const listedMatch = bodyText.match(/Listed\s+(\d+)\s+(hour|day|week|month)s?\s+ago/);
    let listedDaysAgo: number | null = null;
    if (listedMatch) {
      const num = parseInt(listedMatch[1]);
      const unit = listedMatch[2];
      if (unit === 'hour') listedDaysAgo = 0;
      else if (unit === 'day') listedDaysAgo = num;
      else if (unit === 'week') listedDaysAgo = num * 7;
      else if (unit === 'month') listedDaysAgo = num * 30;
    }

    // Mileage: "Driven 123,216 miles"
    const mileageMatch = bodyText.match(/Driven\s+([\d,]+)\s+miles/);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    // Transmission
    const transMatch = bodyText.match(/(Manual|Automatic)\s+transmission/i);
    const transmission = transMatch ? transMatch[1] : null;

    // Colors: "Exterior color: Blue · Interior color: Blue"
    const extColorMatch = bodyText.match(/Exterior color:\s*(\w+)/i);
    const intColorMatch = bodyText.match(/Interior color:\s*(\w+)/i);
    const exteriorColor = extColorMatch ? extColorMatch[1] : null;
    const interiorColor = intColorMatch ? intColorMatch[1] : null;

    // Fuel type
    const fuelMatch = bodyText.match(/Fuel type:\s*(\w+)/i);
    const fuelType = fuelMatch ? fuelMatch[1] : null;

    // Title status
    const titleStatusMatch = bodyText.match(/(Clean|Rebuilt|Salvage)\s+title/i);
    const titleStatus = titleStatusMatch ? titleStatusMatch[1] : null;

    // Owners
    const ownersMatch = bodyText.match(/(\d+)\s+owner/i);
    const owners = ownersMatch ? parseInt(ownersMatch[1]) : null;

    // Paid off
    const paidOff = bodyText.includes('paid off') ? true : null;

    // Price
    const priceMatch = bodyText.match(/\$(\d{1,3}(?:,\d{3})*)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Seller name
    let sellerName: string | null = null;
    try {
      sellerName = await page.$eval('[data-testid="marketplace_pdp_seller_name"]', el => el.textContent).catch(() => null);
    } catch {}

    // Images - get all vehicle photos
    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="scontent"]');
      const urls: string[] = [];
      const seen = new Set<string>();
      imgs.forEach(img => {
        const src = (img as HTMLImageElement).src;
        // Filter: only real photos, not thumbnails/profile/emoji
        if (src.includes('scontent') && 
            !src.includes('emoji') && 
            !src.includes('profile') &&
            src.includes('dst-jpg') &&
            (src.includes('s960x960') || src.includes('s565x565') || src.includes('p526x395') || src.includes('p180x540'))) {
          // Normalize URL to dedupe (remove size params for comparison)
          const key = src.split('?')[0].split('/').pop() || src;
          if (!seen.has(key)) {
            seen.add(key);
            urls.push(src);
          }
        }
      });
      return urls;
    });

    // Video URL
    const videoUrl = await page.$eval('meta[property="og:video"]', el => el.getAttribute('content')).catch(() => null);

    return {
      title: pageTitle.split(' - ')[0].split(' | ')[0].trim(),
      model,
      description,
      location,
      mileage,
      transmission,
      exteriorColor,
      interiorColor,
      fuelType,
      titleStatus,
      owners,
      paidOff,
      listedDaysAgo,
      sellerName,
      images,
      videoUrl,
      price,
    };
  } catch (e: any) {
    console.error(`    Error extracting: ${e.message}`);
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           FB MARKETPLACE ENRICHMENT                        ║');
  console.log('║    Visit every listing. Extract everything. Fix the data.  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Get vehicles that need enrichment
  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, asking_price, description, listing_location, mileage')
    .eq('discovery_source', 'facebook_marketplace')
    .eq('status', 'active')
    .not('discovery_url', 'is', null)
    .order('created_at', { ascending: false });

  if (SINGLE_ID) {
    query = supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, asking_price, description, listing_location, mileage')
      .eq('id', SINGLE_ID);
  } else {
    // Prioritize vehicles missing the most data
    query = query.or('description.is.null,listing_location.is.null,mileage.is.null');
  }

  const { data: vehicles, error } = await query.limit(LIMIT);
  if (error) { console.error('Query error:', error.message); return; }
  if (!vehicles?.length) { console.log('No vehicles need enrichment.'); return; }

  console.log(`  Found ${vehicles.length} vehicles to enrich`);
  console.log('  Launching browser...');

  // Launch Playwright
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let removed = 0;

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const label = `${v.year} ${v.make} ${v.model || ''}`.trim();
    const progress = `[${i + 1}/${vehicles.length}]`;

    // Normalize URL
    let url = v.discovery_url;
    if (!url.startsWith('http')) url = 'https://' + url;
    if (!url.includes('www.facebook.com')) url = url.replace('facebook.com', 'www.facebook.com');

    console.log(`${progress} ${label} ...`);

    const data = await extractFromPage(page, url);

    if (!data) {
      console.log(`  ⊘ Listing removed or inaccessible`);
      removed++;
      continue;
    }

    // Build update payload (only fill missing fields, never overwrite existing good data)
    const updates: Record<string, any> = {};
    
    if (!v.model && data.model) updates.model = data.model;
    if (!v.description && data.description) updates.description = data.description;
    if (!v.listing_location && data.location) updates.listing_location = data.location;
    if (!v.mileage && data.mileage) updates.mileage = data.mileage;
    if (data.transmission) updates.transmission = data.transmission;
    if (data.exteriorColor) updates.color = data.exteriorColor;
    if (data.interiorColor) updates.interior_color = data.interiorColor;
    if (data.fuelType) updates.fuel_type = data.fuelType;
    if (data.videoUrl) updates.walk_around_video_url = data.videoUrl;
    if (!v.asking_price && data.price) updates.asking_price = data.price;
    updates.listing_url = url;
    updates.updated_at = new Date().toISOString();

    const fieldCount = Object.keys(updates).length - 2; // minus listing_url and updated_at

    if (fieldCount === 0 && data.images.length === 0) {
      console.log(`  — Already complete, skipping`);
      skipped++;
      continue;
    }

    // Update vehicle
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', v.id);

    if (updateError) {
      console.error(`  ✗ Update failed: ${updateError.message}`);
      failed++;
      continue;
    }

    // Insert images (if vehicle has no images yet)
    if (data.images.length > 0) {
      // Check existing image count
      const { count } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', v.id);

      if (!count || count < 2) {
        const imageRecords = data.images.slice(0, 20).map((imgUrl, idx) => ({
          vehicle_id: v.id,
          image_url: imgUrl,
          source: 'facebook_marketplace',
          is_primary: idx === 0,
          position: idx,
          display_order: idx,
        }));

        const { error: imgErr } = await supabase.from('vehicle_images').insert(imageRecords);
        if (imgErr && !imgErr.message?.includes('duplicate')) {
          console.error(`  ⚠ Image insert error: ${imgErr.message}`);
        }
      }
    }

    // Create timeline event if none exists
    const { count: eventCount } = await supabase
      .from('auction_events')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    if (!eventCount || eventCount === 0) {
      const listingDate = data.listedDaysAgo != null
        ? new Date(Date.now() - data.listedDaysAgo * 86400000).toISOString().split('T')[0]
        : new Date(v.created_at || Date.now()).toISOString().split('T')[0];

      await supabase.from('auction_events').insert({
        vehicle_id: v.id,
        source: 'facebook_marketplace',
        source_url: url,
        outcome: 'live',
        auction_start_date: listingDate,
        starting_bid: data.price || v.asking_price || null,
        seller_location: data.location,
        seller_name: data.sellerName,
        raw_data: {
          title_status: data.titleStatus,
          owners: data.owners,
          paid_off: data.paidOff,
          fuel_type: data.fuelType,
          exterior_color: data.exteriorColor,
          interior_color: data.interiorColor,
          mileage: data.mileage,
          transmission: data.transmission,
          video_url: data.videoUrl,
          image_count: data.images.length,
        },
      }).then(({ error: evtErr }) => {
        if (evtErr) console.error(`  ⚠ Timeline event failed: ${evtErr.message}`);
      });
    }

    enriched++;
    const fields = [];
    if (data.description) fields.push('desc');
    if (data.location) fields.push('loc');
    if (data.mileage) fields.push(`${data.mileage.toLocaleString()}mi`);
    if (data.transmission) fields.push(data.transmission.toLowerCase());
    if (data.exteriorColor) fields.push(data.exteriorColor);
    if (data.images.length) fields.push(`${data.images.length} imgs`);
    if (data.videoUrl) fields.push('video');
    console.log(`  ✓ +${fieldCount} fields [${fields.join(', ')}]`);

    // Rate limit - don't hammer FB
    await page.waitForTimeout(2000 + Math.random() * 2000);
  }

  await browser.close();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   ENRICHMENT COMPLETE                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Enriched:  ${enriched}`);
  console.log(`  Skipped:   ${skipped} (already complete)`);
  console.log(`  Removed:   ${removed} (listing gone)`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Total:     ${vehicles.length}`);
  console.log('');
}

main().catch(console.error);
