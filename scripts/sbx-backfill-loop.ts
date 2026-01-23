import { chromium, type Page, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  BATCH_SIZE: 10,
  DELAY_BETWEEN: 3000,      // 3 sec between listings
  DELAY_BETWEEN_BATCHES: 8000, // 8 sec between batches
  MAX_LISTINGS: 0,          // 0 = no limit
  HEADLESS: true,
  SKIP_IMAGE_DELETE: true,  // Skip slow delete for speed
};

interface SBXListing {
  url: string;
  lotNumber: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  transmission: string | null;
  currentBid: number | null;
  reserveMet: boolean | null;
  auctionEndDate: string | null;
  auctionStatus: string;
  images: string[];
  description: string | null;
  highlights: string[];
  location: string | null;
  sellerName: string | null;
  specialistName: string | null;
  overview: any;
  specs: any;
  exterior: any;
  interior: any;
  mechanical: any;
  condition: any;
  carfaxUrl: string | null;
}

// ============================================================================
// DISCOVERY: Find all listing URLs from browse pages
// ============================================================================
async function discoverListings(page: Page): Promise<string[]> {
  const listings: Set<string> = new Set();

  const sections = [
    'https://sbxcars.com/auctions',
    'https://sbxcars.com/preview',
    'https://sbxcars.com/results',
  ];

  for (const sectionUrl of sections) {
    console.log(`📋 Discovering from: ${sectionUrl}`);

    try {
      await page.goto(sectionUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Scroll to load all listings
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      // Extract listing URLs
      const urls = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/listing/"]');
        return Array.from(links).map(a => (a as HTMLAnchorElement).href);
      });

      urls.forEach(url => {
        if (url.includes('/listing/')) {
          // Normalize URL
          const clean = url.split('?')[0];
          listings.add(clean);
        }
      });

      console.log(`   Found ${urls.length} listings on this page`);
    } catch (error: any) {
      console.error(`   Error on ${sectionUrl}:`, error.message);
    }
  }

  console.log(`\n✅ Total unique listings discovered: ${listings.size}\n`);
  return Array.from(listings);
}

// ============================================================================
// SCRAPE: Extract all data from a single listing
// ============================================================================
async function scrapeListing(page: Page, url: string): Promise<SBXListing | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Wait for content to load
    await page.waitForSelector('h1, .auction-title, [class*="title"]', { timeout: 10000 }).catch(() => {});

    // Use page.$eval and page.$$eval instead of page.evaluate with functions
    const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null) ||
                  await page.title();

    // Get all images
    const images = await page.$$eval('img', imgs => {
      const results: string[] = [];
      imgs.forEach(img => {
        const src = img.src;
        if (src && (src.includes('sbxcars.com') || src.includes('i.sbxcars')) &&
            !src.includes('/Assets/') && !src.includes('.svg')) {
          results.push(src);
        }
      });
      return [...new Set(results)];
    });

    // Get page text for parsing
    const pageText = await page.evaluate('document.body.innerText');

    // Parse year/make/model from URL slug (more reliable than title)
    // URL format: /listing/609/2011-rolls-royce-phantom-drophead
    let year: number | null = null;
    let make: string | null = null;
    let model: string | null = null;

    const urlSlugMatch = url.match(/\/listing\/\d+\/(\d{4})-([^/]+)$/);
    if (urlSlugMatch) {
      year = parseInt(urlSlugMatch[1]);
      const slugParts = urlSlugMatch[2].split('-');
      // First part is make, rest is model
      if (slugParts.length >= 2) {
        make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
        // Handle multi-word makes (e.g., "land-rover" -> "Land Rover", "mercedes-benz" -> "Mercedes-Benz")
        if (slugParts[1] === 'rover' && make.toLowerCase() === 'land') {
          make = 'Land Rover';
          model = slugParts.slice(2).join(' ');
        } else if (slugParts[1] === 'benz' && make.toLowerCase() === 'mercedes') {
          make = 'Mercedes-Benz';
          model = slugParts.slice(2).join(' ');
        } else {
          model = slugParts.slice(1).join(' ');
        }
      }
    }

    // Fallback to title parsing if URL didn't work
    if (!year || !make) {
      const titleMatch = title?.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
      if (titleMatch) {
        year = parseInt(titleMatch[1]);
        make = titleMatch[2];
        model = titleMatch[3];
      }
    }

    // Get current bid from page text
    let currentBid: number | null = null;
    const bidMatch = pageText.match(/Current\s+Bid[:\s]*\$?([\d,]+)/i) ||
                     pageText.match(/High\s+Bid[:\s]*\$?([\d,]+)/i) ||
                     pageText.match(/Bid[:\s]*\$?([\d,]+)/i);
    if (bidMatch) {
      currentBid = parseInt(bidMatch[1].replace(/,/g, ''));
    }

    // Get VIN
    let vin: string | null = null;
    const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    if (vinMatch) {
      vin = vinMatch[1];
    }

    // Get mileage
    let mileage: number | null = null;
    const mileageMatch = pageText.match(/(?:Mileage|Odometer|Miles)[:\s]*([\d,]+)/i);
    if (mileageMatch) {
      mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Get location
    let location: string | null = null;
    const locationMatch = pageText.match(/(?:Location|Located)[:\s]*([A-Za-z\s,]+)/i);
    if (locationMatch) {
      location = locationMatch[1].trim().substring(0, 100);
    }

    // Get description
    const description = await page.$eval('[class*="overview"], [class*="Overview"], [class*="description"]',
      el => el.textContent?.trim().substring(0, 5000)
    ).catch(() => null);

    // Get highlights
    const highlights = await page.$$eval('[class*="highlight"] li, [class*="Highlight"] li',
      els => els.map(el => el.textContent?.trim() || '').filter(t => t.length > 0)
    ).catch(() => [] as string[]);

    // Check auction status
    let auctionStatus = 'live';
    const lowerText = pageText.toLowerCase();
    if (lowerText.includes('sold')) {
      auctionStatus = 'sold';
    } else if (lowerText.includes('ended') || lowerText.includes('closed')) {
      auctionStatus = 'ended';
    } else if (lowerText.includes('upcoming') || lowerText.includes('preview')) {
      auctionStatus = 'upcoming';
    }

    // Check reserve
    const reserveMet = lowerText.includes('reserve met') ? true :
                       lowerText.includes('reserve not met') ? false : null;

    // Get Carfax URL
    const carfaxUrl = await page.$eval('a[href*="carfax.com"]', el => (el as HTMLAnchorElement).href).catch(() => null);

    const data = {
      title,
      year,
      make,
      model,
      vin,
      mileage,
      currentBid,
      reserveMet,
      auctionStatus,
      location,
      description,
      highlights,
      carfaxUrl,
      images,
    };

    // Extract lot number from URL
    const lotMatch = url.match(/\/listing\/(\d+)\//);
    const lotNumber = lotMatch ? lotMatch[1] : '';

    return {
      url,
      lotNumber,
      title: data.title || '',
      year: data.year,
      make: data.make,
      model: data.model,
      vin: data.vin,
      mileage: data.mileage,
      transmission: null,
      currentBid: data.currentBid,
      reserveMet: data.reserveMet,
      auctionEndDate: null,
      auctionStatus: data.auctionStatus,
      images: data.images,
      description: data.description,
      highlights: data.highlights,
      location: data.location,
      sellerName: null,
      specialistName: null,
      overview: null,
      specs: null,
      exterior: null,
      interior: null,
      mechanical: null,
      condition: null,
      carfaxUrl: data.carfaxUrl,
    };
  } catch (error: any) {
    console.error(`   Error scraping ${url}:`, error.message);
    return null;
  }
}

// ============================================================================
// SAVE: Upsert listing data to Supabase
// ============================================================================
async function saveListing(listing: SBXListing): Promise<{ vehicleId: string | null; isNew: boolean }> {
  // Check if we already have this listing
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', listing.url)
    .maybeSingle();

  const isNew = !existing;
  let vehicleId = existing?.id;

  if (isNew) {
    // Create new vehicle
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: listing.year,
        make: listing.make,
        model: listing.model,
        vin: listing.vin,
        mileage: listing.mileage,
        listing_url: listing.url,
        description: listing.description?.substring(0, 5000),
        location: listing.location,
        high_bid: listing.currentBid,
        auction_outcome: listing.auctionStatus,
        status: 'active',
        discovery_url: listing.url,
      })
      .select('id')
      .single();

    if (error) {
      console.error('   Error creating vehicle:', error.message);
      return { vehicleId: null, isNew: false };
    }

    vehicleId = newVehicle.id;
  } else {
    // Update existing vehicle
    await supabase
      .from('vehicles')
      .update({
        vin: listing.vin || undefined,
        mileage: listing.mileage || undefined,
        description: listing.description?.substring(0, 5000) || undefined,
        location: listing.location || undefined,
        high_bid: listing.currentBid || undefined,
        auction_outcome: listing.auctionStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);
  }

  // Save to external_listings for metadata
  await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      source: 'sbx_cars',
      listing_url: listing.url,
      external_id: listing.lotNumber,
      metadata: {
        title: listing.title,
        lotNumber: listing.lotNumber,
        highlights: listing.highlights,
        carfaxUrl: listing.carfaxUrl,
        reserveMet: listing.reserveMet,
        overview: listing.overview,
        specs: listing.specs,
        exterior: listing.exterior,
        interior: listing.interior,
        mechanical: listing.mechanical,
        condition: listing.condition,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vehicle_id,source' });

  // Save images
  if (listing.images.length > 0 && vehicleId) {
    // Delete existing images if not skipping
    if (!CONFIG.SKIP_IMAGE_DELETE) {
      for (let delAttempt = 0; delAttempt < 20; delAttempt++) {
        const { data: existingImages } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('source', 'external_import')
          .limit(20);

        if (!existingImages || existingImages.length === 0) break;

        const ids = existingImages.map(img => img.id);
        await supabase.from('vehicle_images').delete().in('id', ids);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Insert new images
    const imageRecords = listing.images.map((imageUrl, idx) => ({
      vehicle_id: vehicleId,
      image_url: imageUrl,
      source: 'external_import',
      display_order: idx,
    }));

    // Insert in batches
    for (let i = 0; i < imageRecords.length; i += 50) {
      const batch = imageRecords.slice(i, i + 50);
      await supabase.from('vehicle_images').insert(batch);
    }
  }

  return { vehicleId, isNew };
}

// ============================================================================
// MAIN LOOP
// ============================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SBX CARS BACKFILL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Config: batch=${CONFIG.BATCH_SIZE}, delay=${CONFIG.DELAY_BETWEEN}ms`);
  console.log('');

  const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // Step 1: Discover all listings
    console.log('PHASE 1: DISCOVERY');
    console.log('─────────────────────────────────────────────────────────────');
    const listingUrls = await discoverListings(page);

    if (listingUrls.length === 0) {
      console.log('No listings found. Exiting.');
      return;
    }

    // Filter out already processed listings
    const { data: existingUrls } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', listingUrls.slice(0, 1000)); // Check first 1000

    const existingSet = new Set(existingUrls?.map(v => v.listing_url) || []);
    const newUrls = listingUrls.filter(url => !existingSet.has(url));

    console.log(`New listings to process: ${newUrls.length} (${existingSet.size} already in DB)`);

    // Limit if configured
    const toProcess = CONFIG.MAX_LISTINGS > 0
      ? newUrls.slice(0, CONFIG.MAX_LISTINGS)
      : newUrls;

    // Step 2: Scrape and save each listing
    console.log('\nPHASE 2: EXTRACTION');
    console.log('─────────────────────────────────────────────────────────────');

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const url = toProcess[i];
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const inBatch = (i % CONFIG.BATCH_SIZE) + 1;

      console.log(`[${i + 1}/${toProcess.length}] Batch ${batchNum}, Item ${inBatch}`);
      console.log(`   URL: ${url}`);

      const listing = await scrapeListing(page, url);

      if (listing) {
        const { vehicleId, isNew } = await saveListing(listing);

        if (vehicleId) {
          processed++;
          if (isNew) {
            created++;
            console.log(`   ✅ Created: ${listing.year} ${listing.make} ${listing.model}`);
          } else {
            updated++;
            console.log(`   📝 Updated: ${listing.year} ${listing.make} ${listing.model}`);
          }
          console.log(`   Images: ${listing.images.length}, Bid: $${listing.currentBid?.toLocaleString() || 'N/A'}`);
        } else {
          errors++;
          console.log('   ❌ Failed to save');
        }
      } else {
        errors++;
        console.log('   ❌ Failed to scrape');
      }

      // Delay
      if (i < toProcess.length - 1) {
        const isEndOfBatch = (i + 1) % CONFIG.BATCH_SIZE === 0;
        const delay = isEndOfBatch ? CONFIG.DELAY_BETWEEN_BATCHES : CONFIG.DELAY_BETWEEN;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Total processed: ${processed}`);
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════════════');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
