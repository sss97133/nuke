/**
 * Cars & Bids Scraper v2
 * Clean extraction using page text structure
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface CABData {
  url: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  mileage: number | null;
  soldPrice: number | null;
  bidCount: number | null;
  commentCount: number | null;
  location: string | null;
  seller: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  sellerType: string | null;
  status: string;
  images: string[];
}

function extractField(lines: string[], label: string): string | null {
  const idx = lines.findIndex(l => l.trim().toLowerCase() === label.toLowerCase());
  if (idx >= 0 && idx + 1 < lines.length) {
    const value = lines[idx + 1].trim();
    // Skip if value looks like another label or is empty
    if (value && !value.match(/^(Make|Model|Mileage|VIN|Title|Location|Seller|Engine|Drivetrain|Transmission|Body|Exterior|Interior|Seller Type)$/i)) {
      return value;
    }
  }
  return null;
}

async function extractAuctionData(page: Page, url: string): Promise<CABData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for Cloudflare
    for (let i = 0; i < 15; i++) {
      const title = await page.title();
      if (!title.includes('Just a moment')) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (title.includes('404') || title.includes('does not exist')) {
      return null;
    }

    // Get page text
    const bodyText = await page.evaluate(() => document.body.innerText);
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

    // Parse year/make/model from URL
    const urlMatch = url.match(/\/auctions\/[^/]+\/(\d{4})-([^-]+)-(.+)/);
    if (!urlMatch) return null;
    const [, yearStr, makeRaw, modelRaw] = urlMatch;

    // Extract VIN from title (most reliable)
    const vinMatch = title.match(/VIN:\s*([A-HJ-NPR-Z0-9]+)/i);
    const vin = vinMatch?.[1] || extractField(lines, 'VIN');

    // Extract mileage
    const mileageField = extractField(lines, 'Mileage');
    const mileageMatch = mileageField?.match(/([\d,]+)/);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

    // Extract price - look for "Sold for $X" or "Bid to $X"
    const soldMatch = bodyText.match(/Sold\s+for\s+\$([\d,]+)/i);
    const bidMatch = bodyText.match(/Bid\s+to\s+\$([\d,]+)/i);
    const soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) :
                      bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;

    // Extract counts
    const bidsMatch = bodyText.match(/Bids\s*\n?\s*(\d+)/i);
    const commentsMatch = bodyText.match(/Comments\s*\n?\s*(\d+)/i);
    const bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;
    const commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;

    // Determine status
    let status = 'unknown';
    if (bodyText.includes('Sold for')) status = 'sold';
    else if (bodyText.includes('Reserve Not Met')) status = 'reserve_not_met';
    else if (bodyText.includes('This auction has ended')) status = 'ended';
    else if (bodyText.includes('Live')) status = 'live';

    // Extract structured fields
    const location = extractField(lines, 'Location');
    const seller = extractField(lines, 'Seller');
    const engine = extractField(lines, 'Engine');
    const transmission = extractField(lines, 'Transmission');
    const drivetrain = extractField(lines, 'Drivetrain');
    const exteriorColor = extractField(lines, 'Exterior Color');
    const interiorColor = extractField(lines, 'Interior Color');
    const titleStatus = extractField(lines, 'Title Status');
    const bodyStyle = extractField(lines, 'Body Style');
    const sellerType = extractField(lines, 'Seller Type');

    // Extract images - only actual vehicle images
    const images = await page.$$eval('img[src*="media.carsandbids.com"]', imgs =>
      imgs
        .map((img: any) => img.src)
        .filter((src: string) =>
          src &&
          src.includes('/photos/') &&
          !src.includes('avatar') &&
          !src.includes('logo')
        )
    );

    return {
      url,
      year: parseInt(yearStr, 10),
      make: makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1).toLowerCase(),
      model: modelRaw.replace(/-/g, ' '),
      vin: vin && vin.length >= 11 ? vin : null, // VINs should be at least 11 chars
      mileage,
      soldPrice,
      bidCount,
      commentCount,
      location: location?.substring(0, 100) || null,
      seller,
      engine: engine?.substring(0, 100) || null,
      transmission: transmission?.substring(0, 50) || null,
      drivetrain: drivetrain?.substring(0, 50) || null,
      exteriorColor: exteriorColor?.substring(0, 50) || null,
      interiorColor: interiorColor?.substring(0, 50) || null,
      titleStatus: titleStatus?.substring(0, 50) || null,
      bodyStyle: bodyStyle?.substring(0, 50) || null,
      sellerType,
      status,
      images: [...new Set(images)].slice(0, 100),
    };
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function saveVehicle(data: CABData): Promise<string | null> {
  try {
    let vehicleId: string | null = null;

    // Check if exists by VIN first (most reliable)
    if (data.vin) {
      const { data: byVin } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', data.vin)
        .single();
      if (byVin) vehicleId = byVin.id;
    }

    // Then check by URL
    if (!vehicleId) {
      const { data: byUrl } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', data.url)
        .single();
      if (byUrl) vehicleId = byUrl.id;
    }

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
      // Update existing - don't change VIN or discovery_url to avoid unique conflicts
      const updateData = { ...vehicleData };
      delete updateData.vin;
      delete updateData.discovery_url;
      await supabase.from('vehicles').update(updateData).eq('id', vehicleId);
    } else {
      // Insert new
      vehicleData.created_at = new Date().toISOString();
      const { data: newV, error } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();
      if (error) throw error;
      vehicleId = newV.id;
    }

    // Save images (batch insert)
    if (data.images.length > 0) {
      const imageRows = data.images.map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source_url: url,
        source: 'bat_import',
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
        exif_data: {
          source_url: data.url,
          imported_from: 'Cars & Bids',
        },
      }));

      // Insert in batches
      for (let i = 0; i < imageRows.length; i += 20) {
        const batch = imageRows.slice(i, i + 20);
        await supabase.from('vehicle_images').upsert(batch, {
          onConflict: 'vehicle_id,image_url',
          ignoreDuplicates: true
        }).then(() => {}).catch(() => {});
      }
    }

    // Save auction event
    if (data.soldPrice || data.bidCount) {
      const auctionData: any = {
        vehicle_id: vehicleId,
        source: 'cars_and_bids',
        source_url: data.url,
        winning_bid: data.soldPrice,
        total_bids: data.bidCount,
        comments_count: data.commentCount,
        outcome: data.status,
        updated_at: new Date().toISOString(),
      };

      // Check if auction event exists
      const { data: existing } = await supabase
        .from('auction_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('source', 'cars_and_bids')
        .single();

      if (existing) {
        await supabase.from('auction_events').update(auctionData).eq('id', existing.id);
      } else {
        auctionData.created_at = new Date().toISOString();
        await supabase.from('auction_events').insert(auctionData);
      }
    }

    return vehicleId;
  } catch (error: any) {
    console.log(`  ⚠️ DB: ${error.message}`);
    return null;
  }
}

async function getPageListings(page: Page, pageNum: number): Promise<string[]> {
  const url = `https://carsandbids.com/past-auctions?page=${pageNum}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  for (let i = 0; i < 10; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  const links = await page.$$eval('a[href*="/auctions/"]', els => {
    const seen = new Set<string>();
    return els
      .map(e => e.getAttribute('href'))
      .filter((h): h is string => {
        if (!h || seen.has(h) || !h.match(/\/auctions\/[^/]+\/\d{4}-/)) return false;
        seen.add(h);
        return true;
      })
      .map(h => `https://carsandbids.com${h}`);
  });

  return links;
}

async function main() {
  const args = process.argv.slice(2);
  const startPage = parseInt(args[0] || '1', 10);
  const endPage = parseInt(args[1] || '10', 10);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         CARS & BIDS SCRAPER v2 - Clean Extraction        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Processing pages ${startPage} to ${endPage}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  console.log('Ready!\n');

  let total = 0, success = 0, withVin = 0, withPrice = 0;

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    console.log(`\n═══ PAGE ${pageNum} ═══`);

    const urls = await getPageListings(page, pageNum);
    console.log(`Found ${urls.length} auctions\n`);

    for (let i = 0; i < urls.length; i++) {
      total++;
      const auctionUrl = urls[i];
      const nameMatch = auctionUrl.match(/\/(\d{4}-[^/]+)$/);
      const name = nameMatch ? nameMatch[1].replace(/-/g, ' ') : 'Unknown';

      process.stdout.write(`[${i + 1}/${urls.length}] ${name}... `);

      const data = await extractAuctionData(page, auctionUrl);

      if (data) {
        const id = await saveVehicle(data);
        if (id) {
          success++;
          if (data.vin) withVin++;
          if (data.soldPrice) withPrice++;
          console.log(`✅ VIN:${data.vin ? '✓' : '✗'} $${data.soldPrice || 'N/A'} ${data.images.length}img`);
        } else {
          console.log('⚠️ DB error');
        }
      } else {
        console.log('❌ 404');
      }

      await page.waitForTimeout(1500);
    }

    console.log(`\n--- Page ${pageNum}: ${success}/${total} saved, ${withVin} VINs, ${withPrice} prices ---`);
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('                       COMPLETE');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Total: ${total} | Saved: ${success} | VINs: ${withVin} | Prices: ${withPrice}`);
}

main().catch(console.error);
