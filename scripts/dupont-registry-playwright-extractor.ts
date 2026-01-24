/**
 * DuPont Registry Playwright Extractor
 * Handles anti-bot protection with real browser automation
 * Supports both marketplace listings and live auctions
 */

import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Placeholder org ID - TODO: Create in database
const DUPONT_ORG_ID = '00000000-0000-0000-0000-000000000001';

interface DupontFullData {
  url: string;
  listingId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  price: number | null;
  location: string | null;
  seller: string | null;
  listingType: 'marketplace' | 'auction' | 'unknown';
  auctionStatus: string | null;
  // Specs
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  bodyStyle: string | null;
  // Auction data (for live auctions)
  currentBid: number | null;
  bidCount: number | null;
  reserveStatus: string | null;
  endDate: string | null;
  // Content
  description: string | null;
  features: string[];
  // Images
  images: {
    url: string;
    category: string;
  }[];
}

async function waitForCloudflare(page: Page): Promise<boolean> {
  console.log('    Waiting for anti-bot challenges...');
  for (let i = 0; i < 30; i++) {
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');

    if (
      !title.includes('Just a moment') &&
      !title.includes('Cloudflare') &&
      !bodyText.includes('Checking your browser') &&
      !bodyText.includes('security check')
    ) {
      console.log('    Challenge cleared!');
      return true;
    }
    await page.waitForTimeout(1000);
  }
  console.log('    Challenge timeout');
  return false;
}

async function extractListingUrls(page: Page, pageNum: number): Promise<string[]> {
  const url = `https://www.dupontregistry.com/autos/results/all?page=${pageNum}`;
  console.log(`  Fetching page ${pageNum}...`);

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(2000);

  const urls = await page.$$eval('a[href*="/autos/listing/"]', links => {
    const seen = new Set<string>();
    const results: string[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;

      // Match listing URLs: /autos/listing/{year}/{make}/{model}/{id}
      if (href.match(/\/autos\/listing\/\d{4}\//)) {
        seen.add(href);
        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.dupontregistry.com${href.split('?')[0]}`;
        results.push(fullUrl);
      }
    }

    return results;
  });

  console.log(`  Found ${urls.length} listing URLs`);
  return urls;
}

async function extractFullListingData(page: Page, url: string): Promise<DupontFullData | null> {
  try {
    console.log(`    Navigating to ${url.substring(0, 80)}...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    if (!await waitForCloudflare(page)) {
      console.log('  Cloudflare challenge failed');
      return null;
    }
    await page.waitForTimeout(3000);

    const title = await page.title();
    if (title.includes('404') || title.includes('Not Found')) {
      console.log('  404 - page not found');
      return null;
    }

    // Determine listing type
    const isLiveAuction = url.includes('live.dupontregistry.com');

    // Extract listing ID from URL
    const idMatch = url.match(/\/([^/]+)\/?$/);
    const listingId = idMatch ? idMatch[1] : url.split('/').pop() || 'unknown';

    // Extract year/make/model from URL (reliable fallback)
    // Pattern: /autos/listing/{year}/{make}/{model}/{id}
    const urlMatch = url.match(/\/autos\/listing\/(\d{4})\/([^/]+)\/([^/]+)\/(\d+)/);
    const urlYear = urlMatch ? parseInt(urlMatch[1], 10) : null;
    const urlMake = urlMatch ? urlMatch[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
    const urlModel = urlMatch ? urlMatch[3].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;

    // Use page.evaluate to extract all data at once
    const data = await page.evaluate((isAuction) => {
      const result: any = {
        listingType: isAuction ? 'auction' : 'marketplace'
      };
      const bodyText = document.body.innerText;

      // Extract VIN
      const vinMatch = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch?.[1] || null;

      // Extract year/make/model from title or heading
      const titleEl = document.querySelector('h1, .listing-title, .vehicle-title');
      const titleText = titleEl?.textContent || '';
      const ymMatch = titleText.match(/(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
      if (ymMatch) {
        result.year = parseInt(ymMatch[1], 10);
        result.make = ymMatch[2];
        result.model = ymMatch[3].split('|')[0].trim();
      }

      // Extract price - try multiple selectors
      const priceSelectors = [
        '.price-value',
        '.listing-price',
        '[class*="price"]',
        '.current-bid',
        '.sale-price'
      ];

      for (const selector of priceSelectors) {
        const priceEl = document.querySelector(selector);
        if (priceEl) {
          const priceText = priceEl.textContent || '';
          const priceMatch = priceText.match(/\$?([\d,]+)/);
          if (priceMatch) {
            result.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            break;
          }
        }
      }

      // Also check page text for price
      if (!result.price) {
        const askingMatch = bodyText.match(/(?:Asking|Price|List)[:\s]*\$?([\d,]+)/i);
        result.price = askingMatch ? parseInt(askingMatch[1].replace(/,/g, ''), 10) : null;
      }

      // For auctions: current bid
      if (isAuction) {
        const bidMatch = bodyText.match(/Current Bid[:\s]*\$?([\d,]+)/i);
        result.currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;

        const bidCountMatch = bodyText.match(/(\d+)\s+bids?/i);
        result.bidCount = bidCountMatch ? parseInt(bidCountMatch[1], 10) : null;

        if (bodyText.includes('No Reserve')) {
          result.reserveStatus = 'no_reserve';
        } else if (bodyText.includes('Reserve Not Met')) {
          result.reserveStatus = 'reserve_not_met';
        } else if (bodyText.includes('Reserve Met')) {
          result.reserveStatus = 'reserve_met';
        }
      }

      // Extract mileage
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|mi\b)/i);
      result.mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

      // Extract location
      const locationMatch = bodyText.match(/Location[:\s]*([^\n]+)/i);
      result.location = locationMatch?.[1]?.trim().substring(0, 100) || null;

      // Extract specs - try common patterns
      const specs: Record<string, string> = {};

      // Method 1: Look for dl/dt/dd pairs
      document.querySelectorAll('dl dt, dl dd').forEach((el, idx, arr) => {
        if (el.tagName === 'DT' && arr[idx + 1]?.tagName === 'DD') {
          const key = el.textContent?.trim().toLowerCase() || '';
          const value = arr[idx + 1].textContent?.trim() || '';
          if (key && value) specs[key] = value;
        }
      });

      // Method 2: Look for labeled spans/divs
      document.querySelectorAll('[class*="spec"], [class*="detail"]').forEach(el => {
        const label = el.querySelector('.label, [class*="label"]');
        const value = el.querySelector('.value, [class*="value"]');
        if (label && value) {
          const key = label.textContent?.trim().toLowerCase() || '';
          const val = value.textContent?.trim() || '';
          if (key && val) specs[key] = val;
        }
      });

      result.engine = specs['engine'] || null;
      result.transmission = specs['transmission'] || null;
      result.drivetrain = specs['drivetrain'] || specs['drive type'] || null;
      result.exteriorColor = specs['exterior color'] || specs['exterior'] || null;
      result.interiorColor = specs['interior color'] || specs['interior'] || null;
      result.bodyStyle = specs['body style'] || specs['body type'] || null;

      // Extract description
      const descEl = document.querySelector('.description, .listing-description, [class*="description"]');
      result.description = descEl?.textContent?.trim().substring(0, 5000) || null;

      // Extract features
      result.features = [];
      document.querySelectorAll('.features li, .equipment li, [class*="feature"] li').forEach(li => {
        const text = li.textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          result.features.push(text);
        }
      });

      // Extract all images
      result.imageUrls = Array.from(document.querySelectorAll('img'))
        .map(img => img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy'))
        .filter(src =>
          src &&
          (src.includes('dupontregistry.com') || src.includes('cloudfront.net')) &&
          !src.includes('logo') &&
          !src.includes('avatar') &&
          !src.includes('icon') &&
          src.match(/\.(jpg|jpeg|png|webp)/i)
        )
        .map(src => {
          // Remove size parameters to get full resolution
          return src.split('?')[0];
        });

      return result;
    }, isLiveAuction);

    // Try to extract gallery images
    const galleryImages = await extractGalleryImages(page);
    const allImageUrls = [...new Set([...(data.imageUrls || []), ...galleryImages])];

    const images = allImageUrls.map((url, idx) => ({
      url,
      category: 'other' // DuPont doesn't categorize images in URLs
    }));

    return {
      url,
      listingId,
      year: data.year || urlYear || null,
      make: data.make || urlMake || null,
      model: data.model || urlModel || null,
      vin: data.vin,
      mileage: data.mileage,
      price: data.price,
      location: data.location,
      seller: null, // TODO: Extract if available
      listingType: data.listingType,
      auctionStatus: data.reserveStatus ?
        (data.reserveStatus === 'reserve_not_met' ? 'ended' : 'active') : null,
      engine: data.engine?.substring(0, 200) || null,
      transmission: data.transmission?.substring(0, 100) || null,
      drivetrain: data.drivetrain?.substring(0, 50) || null,
      exteriorColor: data.exteriorColor?.substring(0, 50) || null,
      interiorColor: data.interiorColor?.substring(0, 50) || null,
      bodyStyle: data.bodyStyle?.substring(0, 50) || null,
      currentBid: data.currentBid,
      bidCount: data.bidCount,
      reserveStatus: data.reserveStatus,
      endDate: null, // TODO: Parse from page
      description: data.description,
      features: data.features || [],
      images,
    };
  } catch (error: any) {
    console.log(`  Error extracting: ${error.message}`);
    return null;
  }
}

async function extractGalleryImages(page: Page): Promise<string[]> {
  try {
    // Try to click gallery/carousel to trigger lightbox
    const galleryTriggers = [
      '.gallery-image',
      '.photo-gallery img',
      '.carousel-item img',
      '.vehicle-images img',
      '[class*="gallery"] img'
    ];

    for (const selector of galleryTriggers) {
      const trigger = await page.$(selector);
      if (trigger) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(2000);
        break;
      }
    }

    // Check if lightbox/modal opened
    const lightboxSelectors = [
      '.lightbox',
      '.modal',
      '.photo-viewer',
      '[class*="lightbox"]',
      '[class*="modal"]'
    ];

    let lightboxOpen = false;
    for (const selector of lightboxSelectors) {
      if (await page.$(selector)) {
        lightboxOpen = true;
        break;
      }
    }

    if (lightboxOpen) {
      const images: string[] = [];

      // Navigate through gallery
      for (let i = 0; i < 100; i++) {
        try {
          const imgSrc = await page.$eval(
            '.lightbox img, .modal img, [class*="lightbox"] img, [class*="modal"] img',
            img => img.src
          ).catch(() => null);

          if (imgSrc && !images.includes(imgSrc)) {
            images.push(imgSrc);
          }

          // Try to click next button
          const nextBtn = await page.$(
            '.next, .arrow-right, [class*="next"], [class*="arrow-right"]'
          );
          if (!nextBtn) break;

          await nextBtn.click();
          await page.waitForTimeout(500);

          // Check if we cycled back
          if (images.length > 0 && imgSrc && images[0] === imgSrc) break;
        } catch {
          break;
        }
      }

      // Close lightbox
      const closeBtn = await page.$('.close, [class*="close"], .modal-close');
      if (closeBtn) await closeBtn.click();

      return images;
    }

    return [];
  } catch (error) {
    return [];
  }
}

async function saveToDatabase(data: DupontFullData): Promise<string | null> {
  try {
    let vehicleId: string | null = null;

    // Check if vehicle exists by VIN or URL
    if (data.vin) {
      const { data: byVin } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', data.vin)
        .single();
      if (byVin) vehicleId = byVin.id;
    }

    if (!vehicleId) {
      const { data: byUrl } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', data.url)
        .single();
      if (byUrl) vehicleId = byUrl.id;
    }

    // Create or update vehicle
    const vehicleData: any = {
      year: data.year,
      make: data.make,
      model: data.model,
      discovery_url: data.url,
      discovery_source: 'dupont_registry',
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
      await supabase.from('vehicles').update(vehicleData).eq('id', vehicleId);
    } else {
      vehicleData.created_at = new Date().toISOString();
      const { data: newV, error } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();
      if (error) throw error;
      vehicleId = newV.id;
    }

    // Save to external_listings
    const listingStatus = data.listingType === 'auction' ?
      (data.auctionStatus || 'active') : 'active';

    const externalListingData: any = {
      vehicle_id: vehicleId,
      organization_id: DUPONT_ORG_ID,
      platform: 'dupont_registry',
      listing_url: data.url,
      listing_id: data.listingId,
      listing_status: listingStatus,
      current_bid: data.currentBid || data.price,
      bid_count: data.bidCount,
      final_price: null, // Only set when sold
      metadata: {
        source: 'dupont_playwright_extractor',
        listing_type: data.listingType,
        seller: data.seller,
        location: data.location,
        reserve_status: data.reserveStatus,
        engine: data.engine,
        transmission: data.transmission,
        drivetrain: data.drivetrain,
        exterior_color: data.exteriorColor,
        interior_color: data.interiorColor,
        body_style: data.bodyStyle,
        description: data.description,
        features: data.features,
        image_count: data.images.length,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: existingListing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'dupont_registry')
      .single();

    if (existingListing) {
      await supabase.from('external_listings').update(externalListingData).eq('id', existingListing.id);
    } else {
      externalListingData.created_at = new Date().toISOString();
      await supabase.from('external_listings').insert(externalListingData);
    }

    // Save images
    if (data.images.length > 0) {
      const imageRows = data.images.slice(0, 150).map((img, idx) => ({
        vehicle_id: vehicleId,
        image_url: img.url,
        source_url: img.url,
        source: 'dupont_registry',
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
        exif_data: {
          source_url: data.url,
          imported_from: 'DuPont Registry',
          category: img.category,
        },
      }));

      for (let i = 0; i < imageRows.length; i += 20) {
        const batch = imageRows.slice(i, i + 20);
        try {
          await supabase.from('vehicle_images').upsert(batch, {
            onConflict: 'vehicle_id,image_url',
            ignoreDuplicates: true
          });
        } catch {
          // Ignore image upsert errors
        }
      }
    }

    return vehicleId;
  } catch (error: any) {
    console.log(`  DB error: ${error.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const startPage = parseInt(args[0] || '1', 10);
  const endPage = parseInt(args[1] || '5', 10);
  const singleUrl = args.find(a => a.startsWith('http'));

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       DUPONT REGISTRY PLAYWRIGHT EXTRACTOR                        ║');
  console.log('║       Handles anti-bot protection with real browser              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Warm up session
  console.log('Warming up browser session...');
  await page.goto('https://www.dupontregistry.com', { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(5000);
  console.log('Session ready!\n');

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalWithVin = 0;
  let totalWithPrice = 0;
  let totalImages = 0;

  if (singleUrl) {
    // Single URL mode
    console.log(`Processing single URL: ${singleUrl}\n`);
    const data = await extractFullListingData(page, singleUrl);
    if (data) {
      console.log('\nExtracted data:');
      console.log(`  Year/Make/Model: ${data.year || '?'} ${data.make || '?'} ${data.model || '?'}`);
      console.log(`  VIN: ${data.vin || 'N/A'}`);
      console.log(`  Price: $${data.price?.toLocaleString() || 'N/A'}`);
      console.log(`  Mileage: ${data.mileage?.toLocaleString() || 'N/A'}`);
      console.log(`  Type: ${data.listingType}`);
      console.log(`  Images: ${data.images.length}`);
      console.log(`  Engine: ${data.engine || 'N/A'}`);
      console.log(`  Color: ${data.exteriorColor || 'N/A'}`);

      const vehicleId = await saveToDatabase(data);
      if (vehicleId) {
        console.log(`\nSaved to vehicle: ${vehicleId}`);
      }
    }
  } else {
    // Batch mode - process listings
    console.log(`Processing pages ${startPage} to ${endPage}\n`);

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      console.log(`\n═══════════════════════════════════════════════════════════════`);
      console.log(`  PAGE ${pageNum}`);
      console.log(`═══════════════════════════════════════════════════════════════\n`);

      const urls = await extractListingUrls(page, pageNum);
      if (urls.length === 0) {
        console.log('  No more listings found, stopping.');
        break;
      }

      for (let i = 0; i < urls.length; i++) {
        totalProcessed++;
        const listingUrl = urls[i];
        const nameMatch = listingUrl.match(/\/(\d{4}[^/]+)$/);
        const name = nameMatch ? nameMatch[1].replace(/-/g, ' ').substring(0, 40) : 'Unknown';

        process.stdout.write(`[${i + 1}/${urls.length}] ${name}... `);

        const data = await extractFullListingData(page, listingUrl);
        if (data) {
          const vehicleId = await saveToDatabase(data);
          if (vehicleId) {
            totalSuccess++;
            if (data.vin) totalWithVin++;
            if (data.price) totalWithPrice++;
            totalImages += data.images.length;

            console.log(`✓ VIN:${data.vin ? '✓' : '✗'} $${data.price?.toLocaleString() || 'N/A'} ${data.images.length}img`);
          } else {
            console.log('✗ DB error');
          }
        } else {
          console.log('✗ Extract failed');
        }

        await page.waitForTimeout(3000);
      }

      console.log(`\n--- Page ${pageNum} complete ---`);
      console.log(`  Running totals: ${totalSuccess}/${totalProcessed} saved, ${totalWithVin} VINs, ${totalWithPrice} prices, ${totalImages} images`);
    }
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    EXTRACTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Saved: ${totalSuccess}`);
  console.log(`  With VIN: ${totalWithVin}`);
  console.log(`  With Price: ${totalWithPrice}`);
  console.log(`  Total Images: ${totalImages}`);
}

main().catch(console.error);
