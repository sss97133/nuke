/**
 * Bonhams Playwright Extractor
 * Handles anti-bot protection with real browser automation
 * Extracts motor car auction lots from current and past sales
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
const BONHAMS_ORG_ID = '00000000-0000-0000-0000-000000000002';

interface BonhamsFullData {
  url: string;
  listingId: string;
  lotNumber: string | null;
  saleId: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  estimate: {
    low: number | null;
    high: number | null;
    currency: string;
  };
  soldPrice: number | null;
  auctionStatus: string;
  location: string | null;
  saleDate: string | null;
  // Specs
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  bodyStyle: string | null;
  chassis: string | null;
  // Content
  description: string | null;
  provenance: string | null;
  literature: string | null;
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
      !title.includes('security') &&
      !bodyText.includes('Checking your browser') &&
      !bodyText.includes('security check') &&
      !bodyText.includes('Please wait')
    ) {
      console.log('    Challenge cleared!');
      return true;
    }
    await page.waitForTimeout(1000);
  }
  console.log('    Challenge timeout');
  return false;
}

async function extractMotorCarDepartmentUrls(page: Page): Promise<string[]> {
  const url = 'https://www.bonhams.com/department/MOT/';
  console.log(`  Fetching motor car sales from ${url}...`);

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(2000);

  const saleUrls = await page.$$eval('a[href*="/auction/"]', links => {
    const seen = new Set<string>();
    const results: string[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;

      // Match sale URLs: /auction/{sale-id}/
      if (href.match(/\/auction\/\d+\/?$/)) {
        seen.add(href);
        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.bonhams.com${href.split('?')[0]}`;
        results.push(fullUrl);
      }
    }

    return results;
  });

  console.log(`  Found ${saleUrls.length} sale URLs`);
  return saleUrls;
}

async function extractLotUrlsFromSale(page: Page, saleUrl: string): Promise<string[]> {
  console.log(`  Fetching lots from sale: ${saleUrl}`);

  await page.goto(saleUrl, { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(2000);

  const lotUrls = await page.$$eval('a[href*="/lot/"]', links => {
    const seen = new Set<string>();
    const results: string[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;

      // Match lot URLs: /auction/{sale-id}/lot/{lot-number}/
      if (href.match(/\/auction\/\d+\/lot\/\d+/)) {
        seen.add(href);
        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.bonhams.com${href.split('?')[0]}`;
        results.push(fullUrl);
      }
    }

    return results;
  });

  console.log(`  Found ${lotUrls.length} lot URLs`);
  return lotUrls;
}

async function extractFullLotData(page: Page, url: string): Promise<BonhamsFullData | null> {
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

    // Extract sale ID and lot number from URL
    // Pattern: /auction/{sale-id}/lot/{lot-number}/
    const urlMatch = url.match(/\/auction\/(\d+)\/lot\/(\d+)/);
    const saleId = urlMatch ? urlMatch[1] : null;
    const lotNumber = urlMatch ? urlMatch[2] : null;

    // Use page.evaluate to extract all data at once
    const data = await page.evaluate(() => {
      const result: any = {};
      const bodyText = document.body.innerText;

      // Extract lot number (backup if not in URL)
      if (!result.lotNumber) {
        const lotMatch = bodyText.match(/Lot\s+(\d+)/i);
        result.lotNumber = lotMatch?.[1] || null;
      }

      // Extract VIN/Chassis
      const vinMatch = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      const chassisMatch = bodyText.match(/Chassis\s+(?:No\.?|Number)[:\s#]*([A-Za-z0-9\-]+)/i);
      result.vin = vinMatch?.[1] || null;
      result.chassis = chassisMatch?.[1]?.trim() || null;

      // Extract year/make/model from title
      const titleEl = document.querySelector('h1, .lot-title, [class*="lot-title"]');
      const titleText = titleEl?.textContent || '';

      // Bonhams format is often: "Year Make Model" or "C.Year Make Model"
      const ymMatch = titleText.match(/(?:c\.|circa\s+)?(\d{4})\s+([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s+(.+)/i);
      if (ymMatch) {
        result.year = parseInt(ymMatch[1], 10);
        result.make = ymMatch[2].trim();
        result.model = ymMatch[3]
          .split('|')[0]
          .split('\n')[0]
          .replace(/Chassis.*$/i, '')
          .trim();
      }

      // Extract estimate
      const estimateMatch = bodyText.match(/Estimate[:\s]*([£$€])([\d,]+)\s*[-–]\s*([£$€])?([\d,]+)/i);
      if (estimateMatch) {
        const currency = estimateMatch[1] === '£' ? 'GBP' : estimateMatch[1] === '€' ? 'EUR' : 'USD';
        result.estimateLow = parseInt(estimateMatch[2].replace(/,/g, ''), 10);
        result.estimateHigh = parseInt(estimateMatch[4].replace(/,/g, ''), 10);
        result.currency = currency;
      } else {
        result.currency = 'GBP'; // Default for Bonhams
      }

      // Extract sold price
      const soldMatch = bodyText.match(/(?:Sold|Hammer)[:\s]*([£$€])([\d,]+)/i);
      result.soldPrice = soldMatch ? parseInt(soldMatch[2].replace(/,/g, ''), 10) : null;

      // Determine status
      if (bodyText.includes('Sold for') || bodyText.includes('SOLD')) {
        result.status = 'sold';
      } else if (bodyText.includes('Not Sold') || bodyText.includes('Unsold')) {
        result.status = 'unsold';
      } else if (bodyText.includes('Withdrawn')) {
        result.status = 'withdrawn';
      } else if (bodyText.includes('Forthcoming') || bodyText.includes('Upcoming')) {
        result.status = 'upcoming';
      } else {
        result.status = 'unknown';
      }

      // Extract mileage - Bonhams often uses km or miles
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|km|kilometers)/i);
      result.mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

      // Extract location and sale date
      const locationMatch = bodyText.match(/(?:Location|Sale)[:\s]*([^,\n]+(?:,\s*[^,\n]+)?)/i);
      result.location = locationMatch?.[1]?.trim().substring(0, 100) || null;

      const dateMatch = bodyText.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
      result.saleDate = dateMatch?.[1] || null;

      // Extract specs from lot details
      const specs: Record<string, string> = {};

      // Method 1: Look for specification sections with dt/dd or key-value pairs
      document.querySelectorAll('dt, dd, [class*="spec"], [class*="detail"]').forEach((el, idx, arr) => {
        if (el.tagName === 'DT' && arr[idx + 1]?.tagName === 'DD') {
          const key = el.textContent?.trim().toLowerCase().replace(':', '') || '';
          const value = arr[idx + 1].textContent?.trim() || '';
          if (key && value) specs[key] = value;
        }
      });

      // Method 2: Parse key information from description sections
      const engineMatch = bodyText.match(/Engine[:\s]*([^\n,;]+)/i);
      if (engineMatch) specs['engine'] = engineMatch[1].trim();

      const transMatch = bodyText.match(/Transmission[:\s]*([^\n,;]+)/i);
      if (transMatch) specs['transmission'] = transMatch[1].trim();

      const driveMatch = bodyText.match(/(?:Drivetrain|Drive)[:\s]*([^\n,;]+)/i);
      if (driveMatch) specs['drivetrain'] = driveMatch[1].trim();

      const colorMatch = bodyText.match(/(?:Colour|Color)[:\s]*([^\n,;]+)/i);
      if (colorMatch) specs['exterior color'] = colorMatch[1].trim();

      const coachworkMatch = bodyText.match(/Coachwork[:\s]*([^\n]+)/i);
      if (coachworkMatch) specs['coachwork'] = coachworkMatch[1].trim();

      result.engine = specs['engine'] || null;
      result.transmission = specs['transmission'] || specs['gearbox'] || null;
      result.drivetrain = specs['drivetrain'] || null;
      result.exteriorColor = specs['exterior color'] || specs['colour'] || specs['color'] || null;
      result.interiorColor = specs['interior color'] || specs['interior'] || specs['upholstery'] || null;
      result.bodyStyle = specs['body style'] || specs['coachwork'] || specs['body'] || null;

      // Extract description
      const descEl = document.querySelector('.description, .lot-description, [class*="description"]');
      result.description = descEl?.textContent?.trim().substring(0, 5000) || null;

      // Extract provenance/history
      const provEl = document.querySelector('.provenance, [class*="provenance"], [class*="history"]');
      result.provenance = provEl?.textContent?.trim().substring(0, 5000) || null;

      // Extract literature references
      const litEl = document.querySelector('.literature, [class*="literature"]');
      result.literature = litEl?.textContent?.trim().substring(0, 2000) || null;

      // Extract all images - Bonhams uses bonhams.com/media or similar
      result.imageUrls = Array.from(document.querySelectorAll('img'))
        .map(img => {
          const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
          // Also check srcset for higher quality
          const srcset = img.getAttribute('srcset');
          if (srcset) {
            const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
            return urls[urls.length - 1] || src; // Get highest quality
          }
          return src;
        })
        .filter(src =>
          src &&
          (src.includes('bonhams.com') || src.includes('bonhams1793.com')) &&
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
    });

    // Try to extract gallery images
    const galleryImages = await extractGalleryImages(page);
    const allImageUrls = [...new Set([...(data.imageUrls || []), ...galleryImages])];

    const images = allImageUrls.map((url, idx) => ({
      url,
      category: 'other' // Bonhams doesn't categorize images in URLs
    }));

    const listingId = `${saleId}-${lotNumber}`;

    return {
      url,
      listingId,
      lotNumber: lotNumber || data.lotNumber,
      saleId,
      year: data.year || null,
      make: data.make || null,
      model: data.model || null,
      vin: data.vin,
      mileage: data.mileage,
      estimate: {
        low: data.estimateLow || null,
        high: data.estimateHigh || null,
        currency: data.currency || 'GBP',
      },
      soldPrice: data.soldPrice,
      auctionStatus: data.status,
      location: data.location,
      saleDate: data.saleDate,
      engine: data.engine?.substring(0, 200) || null,
      transmission: data.transmission?.substring(0, 100) || null,
      drivetrain: data.drivetrain?.substring(0, 50) || null,
      exteriorColor: data.exteriorColor?.substring(0, 50) || null,
      interiorColor: data.interiorColor?.substring(0, 50) || null,
      bodyStyle: data.bodyStyle?.substring(0, 100) || null,
      chassis: data.chassis?.substring(0, 50) || null,
      description: data.description,
      provenance: data.provenance,
      literature: data.literature,
      images,
    };
  } catch (error: any) {
    console.log(`  Error extracting: ${error.message}`);
    return null;
  }
}

async function extractGalleryImages(page: Page): Promise<string[]> {
  try {
    // Try to click on main image to open gallery
    const galleryTriggers = [
      '.lot-image img',
      '.image-gallery img',
      '.main-image',
      '[class*="gallery"] img',
      '[class*="image-viewer"] img'
    ];

    for (const selector of galleryTriggers) {
      const trigger = await page.$(selector);
      if (trigger) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(2000);
        break;
      }
    }

    // Check if gallery/lightbox/viewer opened
    const viewerSelectors = [
      '.image-viewer',
      '.gallery',
      '.lightbox',
      '[class*="image-viewer"]',
      '[class*="gallery"]'
    ];

    let viewerOpen = false;
    for (const selector of viewerSelectors) {
      if (await page.$(selector)) {
        viewerOpen = true;
        break;
      }
    }

    if (viewerOpen) {
      const images: string[] = [];

      // Navigate through gallery
      for (let i = 0; i < 100; i++) {
        try {
          const imgSrc = await page.$eval(
            '.image-viewer img, .gallery img, .lightbox img',
            img => img.src
          ).catch(() => null);

          if (imgSrc && !images.includes(imgSrc) &&
              (imgSrc.includes('bonhams.com') || imgSrc.includes('bonhams1793.com'))) {
            images.push(imgSrc);
          }

          // Try to click next button
          const nextSelectors = [
            '.next',
            '.arrow-right',
            '[class*="next"]',
            '[aria-label*="next"]',
            'button[title*="Next"]'
          ];

          let clicked = false;
          for (const selector of nextSelectors) {
            const nextBtn = await page.$(selector);
            if (nextBtn) {
              await nextBtn.click();
              await page.waitForTimeout(500);
              clicked = true;
              break;
            }
          }

          if (!clicked) break;

          // Check if we cycled back
          if (images.length > 0 && imgSrc && images[0] === imgSrc) break;
        } catch {
          break;
        }
      }

      // Close viewer
      const closeBtn = await page.$('.close, [aria-label*="close"], [class*="close"]');
      if (closeBtn) await closeBtn.click();

      return images;
    }

    return [];
  } catch (error) {
    return [];
  }
}

async function saveToDatabase(data: BonhamsFullData): Promise<string | null> {
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
      discovery_source: 'bonhams',
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
    const externalListingData: any = {
      vehicle_id: vehicleId,
      organization_id: BONHAMS_ORG_ID,
      platform: 'bonhams',
      listing_url: data.url,
      listing_id: data.listingId,
      listing_status: data.auctionStatus === 'sold' ? 'sold' :
                     data.auctionStatus === 'unsold' ? 'ended' : 'active',
      current_bid: data.soldPrice,
      final_price: data.auctionStatus === 'sold' ? data.soldPrice : null,
      metadata: {
        source: 'bonhams_playwright_extractor',
        lot_number: data.lotNumber,
        sale_id: data.saleId,
        sale_date: data.saleDate,
        location: data.location,
        estimate_low: data.estimate.low,
        estimate_high: data.estimate.high,
        estimate_currency: data.estimate.currency,
        auction_status: data.auctionStatus,
        chassis: data.chassis,
        engine: data.engine,
        transmission: data.transmission,
        drivetrain: data.drivetrain,
        exterior_color: data.exteriorColor,
        interior_color: data.interiorColor,
        body_style: data.bodyStyle,
        description: data.description,
        provenance: data.provenance,
        literature: data.literature,
        image_count: data.images.length,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: existingListing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'bonhams')
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
        source: 'bonhams',
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
        exif_data: {
          source_url: data.url,
          imported_from: 'Bonhams',
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

    // Save to auction_events for historical tracking
    if (data.soldPrice || data.estimate.low) {
      const auctionData: any = {
        vehicle_id: vehicleId,
        source: 'bonhams',
        source_url: data.url,
        winning_bid: data.soldPrice,
        outcome: data.auctionStatus,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('auction_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('source', 'bonhams')
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
    console.log(`  DB error: ${error.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const singleUrl = args.find(a => a.startsWith('http'));

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       BONHAMS PLAYWRIGHT EXTRACTOR                                ║');
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
  await page.goto('https://www.bonhams.com', { waitUntil: 'load', timeout: 60000 });
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
    const data = await extractFullLotData(page, singleUrl);
    if (data) {
      console.log('\nExtracted data:');
      console.log(`  Year/Make/Model: ${data.year || '?'} ${data.make || '?'} ${data.model || '?'}`);
      console.log(`  Lot: ${data.lotNumber || 'N/A'}`);
      console.log(`  Chassis: ${data.chassis || 'N/A'}`);
      console.log(`  VIN: ${data.vin || 'N/A'}`);
      console.log(`  Estimate: ${data.estimate.currency} ${data.estimate.low?.toLocaleString() || '?'} - ${data.estimate.high?.toLocaleString() || '?'}`);
      console.log(`  Sold Price: ${data.estimate.currency} ${data.soldPrice?.toLocaleString() || 'N/A'}`);
      console.log(`  Status: ${data.auctionStatus}`);
      console.log(`  Images: ${data.images.length}`);
      console.log(`  Engine: ${data.engine || 'N/A'}`);

      const vehicleId = await saveToDatabase(data);
      if (vehicleId) {
        console.log(`\nSaved to vehicle: ${vehicleId}`);
      }
    }
  } else {
    // Batch mode - discover sales and extract lots
    console.log('Discovering motor car sales...\n');

    const saleUrls = await extractMotorCarDepartmentUrls(page);
    console.log(`\nFound ${saleUrls.length} sales to process\n`);

    for (let saleIdx = 0; saleIdx < Math.min(saleUrls.length, 5); saleIdx++) {
      const saleUrl = saleUrls[saleIdx];
      console.log(`\n═══════════════════════════════════════════════════════════════`);
      console.log(`  SALE ${saleIdx + 1}/${Math.min(saleUrls.length, 5)}: ${saleUrl}`);
      console.log(`═══════════════════════════════════════════════════════════════\n`);

      const lotUrls = await extractLotUrlsFromSale(page, saleUrl);
      if (lotUrls.length === 0) {
        console.log('  No lots found, skipping.');
        continue;
      }

      for (let i = 0; i < Math.min(lotUrls.length, 20); i++) {
        totalProcessed++;
        const lotUrl = lotUrls[i];
        const lotMatch = lotUrl.match(/\/lot\/(\d+)/);
        const lotNum = lotMatch ? lotMatch[1] : 'Unknown';

        process.stdout.write(`[${i + 1}/${Math.min(lotUrls.length, 20)}] Lot ${lotNum}... `);

        const data = await extractFullLotData(page, lotUrl);
        if (data) {
          const vehicleId = await saveToDatabase(data);
          if (vehicleId) {
            totalSuccess++;
            if (data.vin) totalWithVin++;
            if (data.soldPrice) totalWithPrice++;
            totalImages += data.images.length;

            const priceStr = data.soldPrice?.toLocaleString() || data.estimate.low?.toLocaleString() || 'N/A';
            console.log(`✓ VIN:${data.vin ? '✓' : '✗'} ${data.estimate.currency}${priceStr} ${data.images.length}img`);
          } else {
            console.log('✗ DB error');
          }
        } else {
          console.log('✗ Extract failed');
        }

        await page.waitForTimeout(3000);
      }

      console.log(`\n--- Sale ${saleIdx + 1} complete ---`);
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
