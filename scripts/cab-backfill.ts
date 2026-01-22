/**
 * Cars & Bids Backfill Script
 * Uses Playwright to extract complete data and update existing vehicles
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface CABData {
  vin: string | null;
  mileage: number | null;
  currentBid: number | null;
  soldPrice: number | null;
  bidCount: number | null;
  commentCount: number | null;
  watchCount: number | null;
  location: string | null;
  seller: string | null;
  endDate: string | null;
  status: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  images: string[];
  highlights: string | null;
  equipment: string | null;
  modifications: string | null;
  knownFlaws: string | null;
  sellerNotes: string | null;
}

async function extractCABData(page: Page, url: string): Promise<CABData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for Cloudflare challenge to complete - poll until title changes
    let attempts = 0;
    while (attempts < 20) {
      const title = await page.title();
      if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
        break;
      }
      await page.waitForTimeout(1000);
      attempts++;
    }

    await page.waitForTimeout(2000); // Extra wait for content

    const content = await page.content();
    const title = await page.title();

    // Check for 404 or error (but not Cloudflare challenges)
    if (title.includes('404') || (content.includes('Page not found') && !title.includes('Just a moment'))) {
      console.log('  ❌ 404 - auction not found');
      return null;
    }

    // If still on Cloudflare, skip
    if (title.includes('Just a moment')) {
      console.log('  ⚠️ Cloudflare challenge not passed');
      return null;
    }

    // Extract VIN from title (most reliable)
    const vinFromTitle = title.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
    const vinFromContent = content.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinFromTitle?.[1] || vinFromContent?.[1] || null;

    // Extract mileage
    const mileageMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

    // Extract bid/price info
    const soldMatch = content.match(/Sold\s*(?:for)?\s*\$?([\d,]+)/i);
    const bidMatch = content.match(/(?:Current\s*)?Bid[:\s]*\$?([\d,]+)/i);
    const soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
    const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;

    // Extract counts
    const bidCountMatch = content.match(/(\d+)\s*(?:bids?)/i);
    const commentCountMatch = content.match(/(\d+)\s*(?:comments?)/i);
    const watchCountMatch = content.match(/(\d+)\s*(?:watchers?|watching)/i);
    const bidCount = bidCountMatch ? parseInt(bidCountMatch[1], 10) : null;
    const commentCount = commentCountMatch ? parseInt(commentCountMatch[1], 10) : null;
    const watchCount = watchCountMatch ? parseInt(watchCountMatch[1], 10) : null;

    // Extract location
    const locationMatch = content.match(/(?:Location|Located(?:\s+in)?)[:\s]*([^<\n]+(?:,\s*[A-Z]{2})?)/i);
    const location = locationMatch?.[1]?.trim().substring(0, 100) || null;

    // Extract seller
    const sellerMatch = content.match(/(?:Seller|Listed by|Sold by)[:\s]*@?(\w+)/i);
    const seller = sellerMatch?.[1] || null;

    // Extract end date
    const endMatch = content.match(/(?:Ends?|Ending|Ended|Auction\s+ends?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    const endDate = endMatch?.[1] || null;

    // Extract status
    let status = 'unknown';
    if (content.includes('Sold for') || content.includes('sold for')) status = 'sold';
    else if (content.includes('Reserve Not Met')) status = 'reserve_not_met';
    else if (content.includes('No Reserve')) status = 'no_reserve';
    else if (content.includes('Live')) status = 'live';
    else if (content.includes('Ended')) status = 'ended';

    // Extract specs from detail sections
    const engineMatch = content.match(/Engine[:\s]*([^<\n]+)/i);
    const transMatch = content.match(/Transmission[:\s]*([^<\n]+)/i);
    const driveMatch = content.match(/Drivetrain[:\s]*([^<\n]+)/i);
    const extColorMatch = content.match(/Exterior\s*(?:Color)?[:\s]*([^<\n]+)/i);
    const intColorMatch = content.match(/Interior\s*(?:Color)?[:\s]*([^<\n]+)/i);
    const titleStatusMatch = content.match(/Title\s*(?:Status)?[:\s]*([^<\n]+)/i);
    const bodyMatch = content.match(/Body\s*(?:Style)?[:\s]*([^<\n]+)/i);

    // Extract all images
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

    // Extract description sections
    const highlightsMatch = content.match(/Highlights[:\s]*<[^>]*>([^<]+)/i);
    const equipmentMatch = content.match(/Equipment[:\s]*<[^>]*>([^<]+)/i);
    const modsMatch = content.match(/Modifications[:\s]*<[^>]*>([^<]+)/i);
    const flawsMatch = content.match(/(?:Known\s*)?Flaws[:\s]*<[^>]*>([^<]+)/i);

    return {
      vin,
      mileage,
      currentBid,
      soldPrice,
      bidCount,
      commentCount,
      watchCount,
      location,
      seller,
      endDate,
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
      equipment: equipmentMatch?.[1]?.trim().substring(0, 1000) || null,
      modifications: modsMatch?.[1]?.trim().substring(0, 1000) || null,
      knownFlaws: flawsMatch?.[1]?.trim().substring(0, 1000) || null,
      sellerNotes: null,
    };
  } catch (error: any) {
    console.log('  ❌ Error:', error.message);
    return null;
  }
}

async function updateVehicle(vehicleId: string, data: CABData): Promise<boolean> {
  try {
    // Update vehicle record
    const updateData: any = {};
    if (data.vin) updateData.vin = data.vin;
    if (data.mileage) updateData.mileage = data.mileage;
    if (data.location) updateData.location = data.location;
    if (data.exteriorColor) updateData.exterior_color = data.exteriorColor;
    if (data.interiorColor) updateData.interior_color = data.interiorColor;
    if (data.engine) updateData.engine = data.engine;
    if (data.transmission) updateData.transmission = data.transmission;
    if (data.drivetrain) updateData.drivetrain = data.drivetrain;
    if (data.bodyStyle) updateData.body_style = data.bodyStyle;
    if (data.titleStatus) updateData.title_status = data.titleStatus;

    // Add extraction metadata
    updateData.extraction_completeness = calculateCompleteness(data);
    updateData.updated_at = new Date().toISOString();

    if (Object.keys(updateData).length > 2) {
      const { error: vError } = await supabase
        .from('vehicles')
        .update(updateData)
        .eq('id', vehicleId);

      if (vError) {
        console.log('  ⚠️ Vehicle update error:', vError.message);
      }
    }

    // Insert images
    if (data.images.length > 0) {
      const imageRows = data.images.map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source_url: url,
        source: 'cab_import',
        position: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
      }));

      const { error: imgError } = await supabase
        .from('vehicle_images')
        .upsert(imageRows, { onConflict: 'vehicle_id,image_url', ignoreDuplicates: true });

      if (imgError && !imgError.message.includes('duplicate')) {
        console.log('  ⚠️ Image insert error:', imgError.message);
      }
    }

    // Update or create auction event
    if (data.soldPrice || data.currentBid || data.bidCount) {
      const auctionData: any = {
        vehicle_id: vehicleId,
        source: 'cars_and_bids',
        sale_price: data.soldPrice || data.currentBid,
        bid_count: data.bidCount,
        watch_count: data.watchCount,
        comment_count: data.commentCount,
        status: data.status,
        updated_at: new Date().toISOString(),
      };

      if (data.endDate) {
        try {
          auctionData.end_date = new Date(data.endDate).toISOString();
        } catch {}
      }

      const { error: aeError } = await supabase
        .from('auction_events')
        .upsert(auctionData, { onConflict: 'vehicle_id,source' });

      if (aeError) {
        console.log('  ⚠️ Auction event error:', aeError.message);
      }
    }

    return true;
  } catch (error: any) {
    console.log('  ❌ Update error:', error.message);
    return false;
  }
}

function calculateCompleteness(data: CABData): number {
  const fields = [
    data.vin,
    data.mileage,
    data.soldPrice || data.currentBid,
    data.location,
    data.exteriorColor,
    data.engine,
    data.transmission,
    data.images.length > 0,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       CARS & BIDS BACKFILL - PLAYWRIGHT EXTRACTION       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Get all C&B vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, vin, mileage')
    .ilike('discovery_url', '%carsandbids%')
    .order('created_at', { ascending: false });

  if (error || !vehicles) {
    console.error('Failed to fetch vehicles:', error?.message);
    return;
  }

  console.log(`Found ${vehicles.length} C&B vehicles to process\n`);

  // Filter to those needing data
  const needsData = vehicles.filter(v => !v.vin || !v.mileage);
  console.log(`${needsData.length} vehicles need VIN or mileage\n`);

  // Launch browser with more realistic settings
  console.log('Launching browser...\n');
  const browser = await chromium.launch({ headless: false }); // Use headed mode for Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });

  // First visit homepage to get cookies
  console.log('Warming up session...');
  const page = await context.newPage();
  await page.goto('https://carsandbids.com', { waitUntil: 'load', timeout: 60000 });
  // Wait for Cloudflare challenge
  for (let i = 0; i < 30; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) {
      console.log(`  Cloudflare passed after ${i}s`);
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
  console.log('Session ready!\n');

  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Process vehicles
  for (let i = 0; i < needsData.length; i++) {
    const v = needsData[i];
    console.log(`[${i + 1}/${needsData.length}] ${v.year} ${v.make} ${v.model}`);
    console.log(`  URL: ${v.discovery_url}`);

    if (!v.discovery_url) {
      console.log('  ⏭️ No URL, skipping');
      skipped++;
      continue;
    }

    const data = await extractCABData(page, v.discovery_url);

    if (data) {
      console.log(`  ✅ VIN: ${data.vin || 'N/A'} | Miles: ${data.mileage || 'N/A'} | Images: ${data.images.length}`);
      console.log(`  💰 Price: $${data.soldPrice || data.currentBid || 'N/A'} | Bids: ${data.bidCount || 'N/A'}`);

      const updated = await updateVehicle(v.id, data);
      if (updated) {
        success++;
      } else {
        failed++;
      }
    } else {
      failed++;
    }

    // Longer delay between requests to avoid rate limiting
    await page.waitForTimeout(3000);

    // Progress update every 10 vehicles
    if ((i + 1) % 10 === 0) {
      console.log(`\n--- Progress: ${success} success, ${failed} failed, ${skipped} skipped ---\n`);
    }
  }

  await browser.close();

  // Final summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('                      BACKFILL COMPLETE');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Total processed: ${needsData.length}`);
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️ Skipped: ${skipped}`);
}

main().catch(console.error);
