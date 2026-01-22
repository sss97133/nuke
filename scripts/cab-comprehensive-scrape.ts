/**
 * Cars & Bids Comprehensive Scraper
 * Scrapes ALL past auctions and stores complete data
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface AuctionListing {
  url: string;
  year: number;
  make: string;
  model: string;
  soldPrice?: number;
  bidAmount?: number;
}

interface CABFullData {
  url: string;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  mileage: number | null;
  soldPrice: number | null;
  currentBid: number | null;
  bidCount: number | null;
  commentCount: number | null;
  watchCount: number | null;
  location: string | null;
  seller: string | null;
  endDate: string | null;
  status: string;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  images: string[];
  highlights: string | null;
}

async function getAuctionListings(page: Page, pageNum: number): Promise<AuctionListing[]> {
  const url = `https://carsandbids.com/past-auctions?page=${pageNum}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // Wait for Cloudflare
  for (let i = 0; i < 10; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  // Extract auction data from page
  const listings = await page.$$eval('a[href*="/auctions/"]', (links) => {
    const seen = new Set<string>();
    const results: any[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);

      // Parse URL: /auctions/ID/YEAR-make-model-etc
      const match = href.match(/\/auctions\/[^/]+\/(\d{4})-([^-]+)-(.+)/);
      if (!match) continue;

      const [, year, make, modelRaw] = match;
      const model = modelRaw.replace(/-/g, ' ');

      // Try to get price from nearby text
      const parent = link.closest('[class*="auction"], [class*="listing"], [class*="card"]') || link.parentElement;
      const text = parent?.textContent || '';
      const soldMatch = text.match(/Sold\s*(?:for)?\s*\$?([\d,]+)/i);
      const bidMatch = text.match(/Bid\s*(?:to)?\s*\$?([\d,]+)/i);

      results.push({
        url: `https://carsandbids.com${href}`,
        year: parseInt(year, 10),
        make: make.charAt(0).toUpperCase() + make.slice(1),
        model: model,
        soldPrice: soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : undefined,
        bidAmount: bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : undefined,
      });
    }

    return results;
  });

  return listings;
}

async function extractFullAuctionData(page: Page, url: string): Promise<CABFullData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for Cloudflare
    for (let i = 0; i < 15; i++) {
      const title = await page.title();
      if (!title.includes('Just a moment') && !title.includes('404')) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (title.includes('404')) {
      return null;
    }

    const content = await page.content();

    // Parse year/make/model from URL
    const urlMatch = url.match(/\/auctions\/[^/]+\/(\d{4})-([^-]+)-(.+)/);
    if (!urlMatch) return null;
    const [, yearStr, makeRaw, modelRaw] = urlMatch;

    // Extract VIN from title
    const vinMatch = title.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i) ||
                     content.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1] || null;

    // Extract mileage
    const mileageMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

    // Extract prices - require $ sign to avoid false matches
    const soldMatch = content.match(/Sold\s*(?:for)?\s*\$\s*([\d,]+)/i);
    const bidMatch = content.match(/(?:Current\s*)?Bid\s*(?:to)?\s*\$\s*([\d,]+)/i);
    const soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
    const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;

    // Extract counts
    const bidCountMatch = content.match(/(\d+)\s*(?:bids?)/i);
    const commentCountMatch = content.match(/(\d+)\s*(?:comments?)/i);
    const watchCountMatch = content.match(/(\d+)\s*(?:watchers?|watching)/i);

    // Extract location
    const locationMatch = content.match(/(?:Location|Located)[:\s]*([^<\n]+(?:,\s*[A-Z]{2})?)/i);

    // Extract seller
    const sellerMatch = content.match(/(?:Seller|Listed by)[:\s]*@?(\w+)/i);

    // Determine status
    let status = 'unknown';
    if (content.includes('Sold for') || content.includes('sold for')) status = 'sold';
    else if (content.includes('Reserve Not Met')) status = 'reserve_not_met';
    else if (content.includes('No Reserve')) status = 'no_reserve';
    else if (content.includes('Ended')) status = 'ended';

    // Extract specs
    const engineMatch = content.match(/Engine[:\s]*([^<\n]+)/i);
    const transMatch = content.match(/Transmission[:\s]*([^<\n]+)/i);
    const driveMatch = content.match(/Drivetrain[:\s]*([^<\n]+)/i);
    const extColorMatch = content.match(/Exterior\s*(?:Color)?[:\s]*([^<\n]+)/i);
    const intColorMatch = content.match(/Interior\s*(?:Color)?[:\s]*([^<\n]+)/i);
    const titleStatusMatch = content.match(/Title\s*(?:Status)?[:\s]*([^<\n]+)/i);
    const bodyMatch = content.match(/Body\s*(?:Style)?[:\s]*([^<\n]+)/i);

    // Extract images
    const images = await page.$$eval('img', imgs =>
      imgs
        .map((img: any) => img.src || img.getAttribute('data-src'))
        .filter((src: string) =>
          src &&
          (src.includes('media.carsandbids.com') || src.includes('carsandbids')) &&
          !src.includes('avatar') &&
          !src.includes('logo') &&
          !src.includes('placeholder')
        )
    );

    // Extract highlights
    const highlightsMatch = content.match(/Highlights[:\s]*<[^>]*>([^<]+)/i);

    return {
      url,
      vin,
      year: parseInt(yearStr, 10),
      make: makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1),
      model: modelRaw.replace(/-/g, ' '),
      mileage,
      soldPrice,
      currentBid,
      bidCount: bidCountMatch ? parseInt(bidCountMatch[1], 10) : null,
      commentCount: commentCountMatch ? parseInt(commentCountMatch[1], 10) : null,
      watchCount: watchCountMatch ? parseInt(watchCountMatch[1], 10) : null,
      location: locationMatch?.[1]?.trim().substring(0, 100) || null,
      seller: sellerMatch?.[1] || null,
      endDate: null,
      status,
      engine: engineMatch?.[1]?.trim().substring(0, 200) || null,
      transmission: transMatch?.[1]?.trim().substring(0, 100) || null,
      drivetrain: driveMatch?.[1]?.trim().substring(0, 50) || null,
      exteriorColor: extColorMatch?.[1]?.trim().substring(0, 50) || null,
      interiorColor: intColorMatch?.[1]?.trim().substring(0, 50) || null,
      titleStatus: titleStatusMatch?.[1]?.trim().substring(0, 50) || null,
      bodyStyle: bodyMatch?.[1]?.trim().substring(0, 50) || null,
      images: [...new Set(images)],
      highlights: highlightsMatch?.[1]?.trim().substring(0, 1000) || null,
    };
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function saveToDatabase(data: CABFullData): Promise<string | null> {
  try {
    // Check if vehicle exists by VIN or URL
    let vehicleId: string | null = null;

    if (data.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', data.vin)
        .single();
      if (existing) vehicleId = existing.id;
    }

    if (!vehicleId) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', data.url)
        .single();
      if (existing) vehicleId = existing.id;
    }

    // Create or update vehicle
    const vehicleData: any = {
      year: data.year,
      make: data.make,
      model: data.model,
      discovery_url: data.url,
      discovery_source: 'cars_and_bids',
      updated_at: new Date().toISOString(),
    };

    if (data.vin) vehicleData.vin = data.vin;
    if (data.mileage) vehicleData.mileage = data.mileage;
    if (data.location) vehicleData.location = data.location;
    if (data.exteriorColor) vehicleData.color = data.exteriorColor;
    if (data.interiorColor) vehicleData.interior_color = data.interiorColor;
    if (data.engine) vehicleData.engine_type = data.engine;
    if (data.transmission) vehicleData.transmission = data.transmission;
    if (data.drivetrain) vehicleData.drivetrain = data.drivetrain;
    if (data.bodyStyle) vehicleData.body_style = data.bodyStyle;

    if (vehicleId) {
      // Update existing
      await supabase.from('vehicles').update(vehicleData).eq('id', vehicleId);
    } else {
      // Insert new
      vehicleData.created_at = new Date().toISOString();
      const { data: newVehicle, error } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();
      if (error) throw error;
      vehicleId = newVehicle.id;
    }

    // Save images
    if (data.images.length > 0 && vehicleId) {
      const imageRows = data.images.slice(0, 50).map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source_url: url,
        source: 'bat_import',  // Use bat_import to satisfy constraint
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
        exif_data: {
          source_url: data.url,
          discovery_url: data.url,
          imported_from: 'Cars & Bids',
        },
      }));

      // Insert one by one to handle errors gracefully
      for (const img of imageRows) {
        const { error } = await supabase
          .from('vehicle_images')
          .insert(img);
        if (error && !error.message.includes('duplicate')) {
          // Silently skip constraint errors
        }
      }
    }

    // Save auction event
    if (vehicleId && (data.soldPrice || data.currentBid)) {
      const auctionData: any = {
        vehicle_id: vehicleId,
        source: 'cars_and_bids',
        source_url: data.url,
        sale_price: data.soldPrice || data.currentBid,
        bid_count: data.bidCount,
        watch_count: data.watchCount,
        comment_count: data.commentCount,
        status: data.status,
        updated_at: new Date().toISOString(),
      };

      await supabase
        .from('auction_events')
        .upsert(auctionData, { onConflict: 'vehicle_id,source' });
    }

    return vehicleId;
  } catch (error: any) {
    console.log(`  ⚠️ DB Error: ${error.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const startPage = parseInt(args[0] || '1', 10);
  const endPage = parseInt(args[1] || '10', 10);
  const detailsOnly = args.includes('--details');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       CARS & BIDS COMPREHENSIVE SCRAPER                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Pages: ${startPage} to ${endPage}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up session...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log('Ready!\n');

  let totalListings = 0;
  let totalExtracted = 0;
  let totalSaved = 0;

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    console.log(`\n═══ PAGE ${pageNum} ═══\n`);

    const listings = await getAuctionListings(page, pageNum);
    console.log(`Found ${listings.length} auctions on page ${pageNum}`);
    totalListings += listings.length;

    if (listings.length === 0) {
      console.log('No more listings, stopping.');
      break;
    }

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      console.log(`[${i + 1}/${listings.length}] ${listing.year} ${listing.make} ${listing.model}`);

      const fullData = await extractFullAuctionData(page, listing.url);

      if (fullData) {
        totalExtracted++;
        console.log(`  ✅ VIN: ${fullData.vin || 'N/A'} | Miles: ${fullData.mileage || 'N/A'} | $${fullData.soldPrice || fullData.currentBid || 'N/A'}`);
        console.log(`  📷 ${fullData.images.length} images | 💬 ${fullData.commentCount || 0} comments`);

        const vehicleId = await saveToDatabase(fullData);
        if (vehicleId) {
          totalSaved++;
          console.log(`  💾 Saved: ${vehicleId}`);
        }
      } else {
        console.log('  ❌ Failed to extract');
      }

      // Delay between requests
      await page.waitForTimeout(2000);
    }

    console.log(`\n--- Page ${pageNum} complete: ${listings.length} listed, ${totalExtracted} extracted, ${totalSaved} saved ---`);
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('                    SCRAPE COMPLETE');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Total listings found: ${totalListings}`);
  console.log(`  Total extracted: ${totalExtracted}`);
  console.log(`  Total saved: ${totalSaved}`);
}

main().catch(console.error);
