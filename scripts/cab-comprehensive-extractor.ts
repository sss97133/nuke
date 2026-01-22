/**
 * Cars & Bids Comprehensive Extractor
 * Extracts ALL data including expanded details, gallery images, and auction stats
 * Designed for continuous operation with auto-correction
 */

import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CAB_ORG_ID = '822cae29-f80e-4859-9c48-a1485a543152';

interface CABFullData {
  url: string;
  listingId: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  mileage: number | null;
  soldPrice: number | null;
  bidCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  watcherCount: number | null;
  location: string | null;
  seller: string | null;
  sellerType: string | null;
  status: string;
  reserveStatus: string | null;
  endDate: string | null;
  // Specs
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  // Content
  highlights: string[];
  equipment: string[];
  modifications: string[];
  knownFlaws: string[];
  sellerNotes: string | null;
  // Images
  images: {
    url: string;
    category: string;
  }[];
}

async function waitForCloudflare(page: Page): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function extractAuctionUrls(page: Page, pageNum: number): Promise<string[]> {
  const url = `https://carsandbids.com/past-auctions?page=${pageNum}`;
  console.log(`  Fetching page ${pageNum}...`);

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(2000);

  const urls = await page.$$eval('a[href*="/auctions/"]', links => {
    const seen = new Set<string>();
    const results: string[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;

      // Match auction URLs: /auctions/ID/year-make-model
      if (href.match(/\/auctions\/[^/]+\/\d{4}-/)) {
        seen.add(href);
        results.push(`https://carsandbids.com${href.split('?')[0]}`);
      }
    }

    return results;
  });

  console.log(`  Found ${urls.length} auction URLs`);
  return urls;
}

async function extractFullAuctionData(page: Page, url: string): Promise<CABFullData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    if (!await waitForCloudflare(page)) {
      console.log('  Cloudflare challenge failed');
      return null;
    }
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (title.includes('404') || title.includes('does not exist')) {
      console.log('  404 - page not found');
      return null;
    }

    // Parse year/make/model and listing ID from URL
    const urlMatch = url.match(/\/auctions\/([^/]+)\/((\d{4})-([^-]+)-(.+))$/);
    if (!urlMatch) {
      console.log('  Invalid URL format');
      return null;
    }

    const [, listingId, , yearStr, makeRaw, modelRaw] = urlMatch;

    // Use page.evaluate to extract all data at once
    const data = await page.evaluate(() => {
      const result: any = {};
      const bodyText = document.body.innerText;

      // Extract VIN from title or page content
      const titleEl = document.querySelector('title');
      const vinFromTitle = titleEl?.textContent?.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
      const vinFromPage = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinFromTitle?.[1] || vinFromPage?.[1] || null;

      // Extract price from bid-value element
      const bidValue = document.querySelector('.bid-value, .current-bid .bid-value, .bid-bar .bid-value');
      if (bidValue) {
        const priceText = bidValue.textContent || '';
        const priceMatch = priceText.match(/\$?([\d,]+)/);
        result.soldPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Also check for "Sold for $X" text
      if (!result.soldPrice) {
        const soldMatch = bodyText.match(/Sold\s+for\s+\$?([\d,]+)/i);
        result.soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Extract bid count from bid-stats
      const bidStats = document.querySelector('.bid-stats');
      if (bidStats) {
        const statsText = bidStats.textContent || '';
        const bidsMatch = statsText.match(/Bids?\s*(\d+)/i);
        result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;

        const commentsMatch = statsText.match(/Comments?\s*(\d+)/i);
        result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
      }

      // Fallback: look for bids in page text
      if (!result.bidCount) {
        const bidsMatch = bodyText.match(/(\d+)\s+bids?/i);
        result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;
      }

      if (!result.commentCount) {
        const commentsMatch = bodyText.match(/(\d+)\s+comments?/i);
        result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
      }

      // Extract views and watchers
      const viewsMatch = bodyText.match(/(\d+[\d,]*)\s+views?/i);
      result.viewCount = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ''), 10) : null;

      const watchersMatch = bodyText.match(/(\d+[\d,]*)\s+watchers?/i);
      result.watcherCount = watchersMatch ? parseInt(watchersMatch[1].replace(/,/g, ''), 10) : null;

      // Extract mileage
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|mi\b)/i);
      result.mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

      // Extract quick facts (specs)
      const quickFacts = document.querySelectorAll('.quick-facts dt, .quick-facts dd');
      const facts: Record<string, string> = {};
      let currentKey = '';
      quickFacts.forEach(el => {
        if (el.tagName === 'DT') {
          currentKey = (el.textContent?.trim().toLowerCase() || '');
        } else if (el.tagName === 'DD' && currentKey) {
          facts[currentKey] = el.textContent?.trim() || '';
        }
      });

      // Also try alternative selectors for specs
      document.querySelectorAll('.detail-item, .spec-item, [class*="detail"], [class*="spec"]').forEach(el => {
        const label = el.querySelector('.label, dt, [class*="label"]');
        const value = el.querySelector('.value, dd, [class*="value"]');
        if (label && value) {
          const key = label.textContent?.trim().toLowerCase() || '';
          const val = value.textContent?.trim() || '';
          if (key && val) facts[key] = val;
        }
      });

      result.engine = facts['engine'] || null;
      result.transmission = facts['transmission'] || null;
      result.drivetrain = facts['drivetrain'] || null;
      result.exteriorColor = facts['exterior color'] || facts['exterior'] || null;
      result.interiorColor = facts['interior color'] || facts['interior'] || null;
      result.titleStatus = facts['title status'] || facts['title'] || null;
      result.bodyStyle = facts['body style'] || facts['body'] || null;
      result.location = facts['location'] || null;
      result.seller = facts['seller'] || null;
      result.sellerType = facts['seller type'] || null;

      // Determine auction status
      if (bodyText.includes('Sold for') || bodyText.includes('sold for')) {
        result.status = 'sold';
      } else if (bodyText.includes('Reserve Not Met')) {
        result.status = 'reserve_not_met';
      } else if (bodyText.includes('This auction has ended')) {
        result.status = 'ended';
      } else if (bodyText.includes('Live')) {
        result.status = 'live';
      } else {
        result.status = 'unknown';
      }

      // Reserve status
      if (bodyText.includes('No Reserve')) {
        result.reserveStatus = 'no_reserve';
      } else if (bodyText.includes('Reserve')) {
        result.reserveStatus = 'has_reserve';
      } else {
        result.reserveStatus = null;
      }

      // Extract content sections (highlights, equipment, etc.)
      result.highlights = [];
      result.equipment = [];
      result.modifications = [];
      result.knownFlaws = [];
      result.sellerNotes = null;

      // Try to find expandable sections
      document.querySelectorAll('[class*="section"], [class*="content"]').forEach(section => {
        const header = section.querySelector('h2, h3, h4, .title, .header');
        const content = section.querySelector('.body, .content, ul, p');
        if (!header || !content) return;

        const headerText = header.textContent?.toLowerCase() || '';
        const items = Array.from(content.querySelectorAll('li')).map(li => li.textContent?.trim() || '');
        const text = items.length > 0 ? items : [content.textContent?.trim() || ''];

        if (headerText.includes('highlight')) {
          result.highlights = text.filter(t => t);
        } else if (headerText.includes('equipment')) {
          result.equipment = text.filter(t => t);
        } else if (headerText.includes('modification')) {
          result.modifications = text.filter(t => t);
        } else if (headerText.includes('flaw')) {
          result.knownFlaws = text.filter(t => t);
        } else if (headerText.includes('seller') && headerText.includes('note')) {
          result.sellerNotes = text.join('\n');
        }
      });

      // Extract all images from the page
      result.imageUrls = Array.from(document.querySelectorAll('img'))
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src =>
          src &&
          src.includes('media.carsandbids.com') &&
          src.includes('/photos/') &&
          !src.includes('avatar') &&
          !src.includes('logo')
        );

      return result;
    });

    // Try to expand the image gallery and get more images
    const galleryImages = await extractGalleryImages(page);
    const allImageUrls = [...new Set([...(data.imageUrls || []), ...galleryImages])];

    // Categorize images by their URL path
    const images = allImageUrls.map(url => {
      let category = 'other';
      const urlLower = url.toLowerCase();
      if (urlLower.includes('/exterior/')) category = 'exterior';
      else if (urlLower.includes('/interior/')) category = 'interior';
      else if (urlLower.includes('/mechanical/')) category = 'mechanical';
      else if (urlLower.includes('/docs/')) category = 'docs';
      else if (urlLower.includes('/application/')) category = 'other';
      return { url, category };
    });

    return {
      url,
      listingId,
      year: parseInt(yearStr, 10),
      make: makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1).toLowerCase(),
      model: modelRaw.replace(/-/g, ' '),
      vin: data.vin,
      mileage: data.mileage,
      soldPrice: data.soldPrice,
      bidCount: data.bidCount,
      commentCount: data.commentCount,
      viewCount: data.viewCount,
      watcherCount: data.watcherCount,
      location: data.location?.substring(0, 100) || null,
      seller: data.seller,
      sellerType: data.sellerType,
      status: data.status,
      reserveStatus: data.reserveStatus,
      endDate: null, // Would need to parse from page
      engine: data.engine?.substring(0, 200) || null,
      transmission: data.transmission?.substring(0, 100) || null,
      drivetrain: data.drivetrain?.substring(0, 50) || null,
      exteriorColor: data.exteriorColor?.substring(0, 50) || null,
      interiorColor: data.interiorColor?.substring(0, 50) || null,
      titleStatus: data.titleStatus?.substring(0, 50) || null,
      bodyStyle: data.bodyStyle?.substring(0, 50) || null,
      highlights: data.highlights || [],
      equipment: data.equipment || [],
      modifications: data.modifications || [],
      knownFlaws: data.knownFlaws || [],
      sellerNotes: data.sellerNotes,
      images,
    };
  } catch (error: any) {
    console.log(`  Error extracting: ${error.message}`);
    return null;
  }
}

async function extractGalleryImages(page: Page): Promise<string[]> {
  try {
    // Try to click on the hero image or gallery button to open full gallery
    const heroClick = await page.$('.hero-gallery, .gallery-hero, .hero img, .main-image');
    if (heroClick) {
      await heroClick.click();
      await page.waitForTimeout(2000);
    }

    // Check if PhotoSwipe gallery opened (pswp class)
    const pswpOpen = await page.$('.pswp--open');
    if (pswpOpen) {
      // Gallery is open, collect all images
      const images: string[] = [];

      // Get current visible image
      const currentImg = await page.$eval('.pswp__img', img => img.src).catch(() => null);
      if (currentImg) images.push(currentImg);

      // Try to navigate through gallery and collect images
      for (let i = 0; i < 150; i++) { // Max 150 images
        try {
          const nextBtn = await page.$('.pswp__button--arrow--right, .slide_button.right, button[title*="Next"]');
          if (!nextBtn) break;

          await nextBtn.click();
          await page.waitForTimeout(300);

          const imgSrc = await page.$eval('.pswp__img', img => img.src).catch(() => null);
          if (imgSrc && !images.includes(imgSrc)) {
            images.push(imgSrc);
          } else if (images.length > 0) {
            // If we get a duplicate, we've cycled through
            break;
          }
        } catch {
          break;
        }
      }

      // Close gallery
      const closeBtn = await page.$('.pswp__button--close');
      if (closeBtn) await closeBtn.click();

      return images;
    }

    // Fallback: just get all images on page
    return await page.$$eval('img[src*="media.carsandbids.com"]', imgs =>
      imgs.map(img => img.src).filter(src => src.includes('/photos/'))
    );
  } catch (error) {
    return [];
  }
}

async function saveToDatabase(data: CABFullData): Promise<string | null> {
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
      // Try exact match first
      const { data: byUrl } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', data.url)
        .single();
      if (byUrl) vehicleId = byUrl.id;
    }

    if (!vehicleId) {
      // Try case-insensitive match (URLs may have different casing)
      const { data: byUrlLower } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', data.url)
        .single();
      if (byUrlLower) vehicleId = byUrlLower.id;
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

    // Save to external_listings (this is what the frontend reads!)
    const listingStatus = data.status === 'sold' ? 'sold' :
                         data.status === 'live' ? 'active' : 'ended';

    const externalListingData: any = {
      vehicle_id: vehicleId,
      organization_id: CAB_ORG_ID,
      platform: 'cars_and_bids',
      listing_url: data.url,
      listing_id: data.listingId,
      listing_status: listingStatus,
      current_bid: data.soldPrice,
      bid_count: data.bidCount,
      view_count: data.viewCount || 0,
      watcher_count: data.watcherCount || 0,
      final_price: data.status === 'sold' ? data.soldPrice : null,
      metadata: {
        source: 'cab_comprehensive_extractor',
        seller: data.seller,
        seller_type: data.sellerType,
        location: data.location,
        reserve_status: data.reserveStatus,
        comment_count: data.commentCount,
        engine: data.engine,
        transmission: data.transmission,
        drivetrain: data.drivetrain,
        exterior_color: data.exteriorColor,
        interior_color: data.interiorColor,
        title_status: data.titleStatus,
        body_style: data.bodyStyle,
        highlights: data.highlights,
        equipment: data.equipment,
        modifications: data.modifications,
        known_flaws: data.knownFlaws,
        seller_notes: data.sellerNotes,
        image_count: data.images.length,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: existingListing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'cars_and_bids')
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

    // Also save to auction_events for historical tracking
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
  console.log('║       CARS & BIDS COMPREHENSIVE EXTRACTOR                         ║');
  console.log('║       Full data extraction with gallery images                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up session
  console.log('Warming up session...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(3000);
  console.log('Session ready!\n');

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalWithVin = 0;
  let totalWithPrice = 0;
  let totalImages = 0;

  if (singleUrl) {
    // Single URL mode
    console.log(`Processing single URL: ${singleUrl}\n`);
    const data = await extractFullAuctionData(page, singleUrl);
    if (data) {
      console.log('\nExtracted data:');
      console.log(`  VIN: ${data.vin || 'N/A'}`);
      console.log(`  Price: $${data.soldPrice?.toLocaleString() || 'N/A'}`);
      console.log(`  Bids: ${data.bidCount || 'N/A'}`);
      console.log(`  Comments: ${data.commentCount || 'N/A'}`);
      console.log(`  Views: ${data.viewCount || 'N/A'}`);
      console.log(`  Watchers: ${data.watcherCount || 'N/A'}`);
      console.log(`  Images: ${data.images.length}`);
      console.log(`  Engine: ${data.engine || 'N/A'}`);
      console.log(`  Color: ${data.exteriorColor || 'N/A'}`);
      console.log(`  Status: ${data.status}`);

      const vehicleId = await saveToDatabase(data);
      if (vehicleId) {
        console.log(`\nSaved to vehicle: ${vehicleId}`);
      }
    }
  } else {
    // Batch mode - process past auctions
    console.log(`Processing pages ${startPage} to ${endPage}\n`);

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      console.log(`\n═══════════════════════════════════════════════════════════════`);
      console.log(`  PAGE ${pageNum}`);
      console.log(`═══════════════════════════════════════════════════════════════\n`);

      const urls = await extractAuctionUrls(page, pageNum);
      if (urls.length === 0) {
        console.log('  No more auctions found, stopping.');
        break;
      }

      for (let i = 0; i < urls.length; i++) {
        totalProcessed++;
        const auctionUrl = urls[i];
        const nameMatch = auctionUrl.match(/\/(\d{4}-[^/]+)$/);
        const name = nameMatch ? nameMatch[1].replace(/-/g, ' ').substring(0, 40) : 'Unknown';

        process.stdout.write(`[${i + 1}/${urls.length}] ${name}... `);

        const data = await extractFullAuctionData(page, auctionUrl);
        if (data) {
          const vehicleId = await saveToDatabase(data);
          if (vehicleId) {
            totalSuccess++;
            if (data.vin) totalWithVin++;
            if (data.soldPrice) totalWithPrice++;
            totalImages += data.images.length;

            console.log(`✓ VIN:${data.vin ? '✓' : '✗'} $${data.soldPrice?.toLocaleString() || 'N/A'} ${data.bidCount || '?'}bids ${data.images.length}img`);
          } else {
            console.log('✗ DB error');
          }
        } else {
          console.log('✗ Extract failed');
        }

        await page.waitForTimeout(2000);
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
