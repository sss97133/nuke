/**
 * Cars & Bids DOM-Based Scraper
 * Uses proper DOM selectors instead of regex for reliable extraction
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
  vin: string | null;
  year: number;
  make: string;
  model: string;
  mileage: number | null;
  soldPrice: number | null;
  bidCount: number | null;
  commentCount: number | null;
  location: string | null;
  seller: string | null;
  status: string;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  images: string[];
}

async function extractWithDOM(page: Page, url: string): Promise<CABData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for Cloudflare
    for (let i = 0; i < 15; i++) {
      const title = await page.title();
      if (!title.includes('Just a moment')) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);

    // Check for 404
    const title = await page.title();
    if (title.includes('404') || title.includes('does not exist')) {
      console.log('  404 - page not found');
      return null;
    }

    // Extract year/make/model from URL
    const urlMatch = url.match(/\/auctions\/[^/]+\/(\d{4})-([^-]+)-(.+)/);
    if (!urlMatch) return null;
    const [, yearStr, makeRaw, modelRaw] = urlMatch;

    // DOM-based extraction
    const data = await page.evaluate(() => {
      const result: any = {};

      // Find VIN from title or page
      const titleEl = document.querySelector('title');
      const vinMatch = titleEl?.textContent?.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch?.[1] || null;

      // Also check page content for VIN
      if (!result.vin) {
        const bodyText = document.body.innerText;
        const vinContentMatch = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
        result.vin = vinContentMatch?.[1] || null;
      }

      // Extract price from bid-value element (most reliable)
      const bidValue = document.querySelector('.current-bid .bid-value, .bid-bar .bid-value');
      if (bidValue) {
        const priceMatch = bidValue.textContent?.match(/\$?([\d,]+)/);
        result.soldPrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Extract bids and comments from bid-stats
      const bidStats = document.querySelector('.bid-stats');
      if (bidStats) {
        const statsText = bidStats.textContent || '';
        // Parse "Bids31" - number immediately follows "Bids"
        const bidsMatch = statsText.match(/Bids\s*(\d+)/i);
        result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;

        // Parse "Comments62"
        const commentsMatch = statsText.match(/Comments\s*(\d+)/i);
        result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
      }

      // Fallback: use .num-bids element for bid count
      if (!result.bidCount) {
        const numBidsEl = document.querySelector('.num-bids');
        if (numBidsEl) {
          const bidsText = numBidsEl.textContent || '';
          const match = bidsText.match(/(\d+)/);
          result.bidCount = match ? parseInt(match[1], 10) : null;
        }
      }

      // Fallback: search page text for price
      if (!result.soldPrice) {
        const bodyText = document.body.innerText;
        const soldMatch = bodyText.match(/Sold\s+for\s+\$?([\d,]+)/i);
        result.soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Find quick facts section - this has the key data
      const quickFacts = document.querySelectorAll('.quick-facts dt, .quick-facts dd, [class*="quick-fact"] dt, [class*="quick-fact"] dd');
      const facts: Record<string, string> = {};
      let currentKey = '';
      quickFacts.forEach(el => {
        if (el.tagName === 'DT') {
          currentKey = el.textContent?.trim().toLowerCase() || '';
        } else if (el.tagName === 'DD' && currentKey) {
          facts[currentKey] = el.textContent?.trim() || '';
        }
      });

      // Alternative: find labeled spans/divs
      document.querySelectorAll('[class*="stat"], [class*="detail"], [class*="spec"]').forEach(el => {
        const label = el.querySelector('dt, [class*="label"], [class*="title"], span:first-child');
        const value = el.querySelector('dd, [class*="value"], span:last-child');
        if (label && value) {
          const key = label.textContent?.trim().toLowerCase() || '';
          const val = value.textContent?.trim() || '';
          if (key && val && key !== val) {
            facts[key] = val;
          }
        }
      });

      // Extract mileage
      const mileageVal = facts['mileage'] || facts['miles'] || '';
      const mileageMatch = mileageVal.match(/([\d,]+)/);
      result.mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

      // Extract other fields from facts
      result.engine = facts['engine'] || null;
      result.transmission = facts['transmission'] || null;
      result.drivetrain = facts['drivetrain'] || null;
      result.exteriorColor = facts['exterior color'] || facts['exterior'] || null;
      result.interiorColor = facts['interior color'] || facts['interior'] || null;
      result.titleStatus = facts['title status'] || facts['title'] || null;
      result.bodyStyle = facts['body style'] || facts['body'] || null;
      result.location = facts['location'] || null;
      result.seller = facts['seller'] || null;

      // Determine status
      const bodyText = document.body.innerText;
      if (bodyText.includes('Sold for')) result.status = 'sold';
      else if (bodyText.includes('Reserve Not Met')) result.status = 'reserve_not_met';
      else if (bodyText.includes('No Reserve')) result.status = 'no_reserve';
      else if (bodyText.includes('Live')) result.status = 'live';
      else result.status = 'ended';

      // Get images
      const images = Array.from(document.querySelectorAll('img'))
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src =>
          src &&
          src.includes('media.carsandbids.com') &&
          src.includes('/photos/') &&
          !src.includes('avatar') &&
          !src.includes('logo')
        ) as string[];
      result.images = [...new Set(images)].slice(0, 100);

      return result;
    });

    return {
      url,
      year: parseInt(yearStr, 10),
      make: makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1),
      model: modelRaw.replace(/-/g, ' '),
      vin: data.vin,
      mileage: data.mileage,
      soldPrice: data.soldPrice,
      bidCount: data.bidCount,
      commentCount: data.commentCount,
      location: data.location?.substring(0, 100) || null,
      seller: data.seller,
      status: data.status,
      engine: data.engine?.substring(0, 200) || null,
      transmission: data.transmission?.substring(0, 100) || null,
      drivetrain: data.drivetrain?.substring(0, 50) || null,
      exteriorColor: data.exteriorColor?.substring(0, 50) || null,
      interiorColor: data.interiorColor?.substring(0, 50) || null,
      titleStatus: data.titleStatus?.substring(0, 50) || null,
      bodyStyle: data.bodyStyle?.substring(0, 50) || null,
      images: data.images,
    };
  } catch (error: any) {
    console.log(`  Error: ${error.message}`);
    return null;
  }
}

async function saveVehicle(data: CABData): Promise<string | null> {
  try {
    let vehicleId: string | null = null;

    // Check if exists by VIN or URL
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

    // Also check by lowercase URL (for vehicles not yet fixed)
    if (!vehicleId) {
      const { data: byLowerUrl } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', data.url)
        .single();
      if (byLowerUrl) vehicleId = byLowerUrl.id;
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

    // Save images
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

      for (let i = 0; i < imageRows.length; i += 20) {
        const batch = imageRows.slice(i, i + 20);
        await supabase.from('vehicle_images').upsert(batch, {
          onConflict: 'vehicle_id,image_url',
          ignoreDuplicates: true
        }).then(() => {}).catch(() => {});
      }
    }

    return vehicleId;
  } catch (error: any) {
    console.log(`  DB error: ${error.message}`);
    return null;
  }
}

async function main() {
  const targetUrl = process.argv[2];

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         C&B DOM-BASED SCRAPER                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  console.log('Ready!\n');

  if (targetUrl) {
    // Single URL mode
    console.log(`Scraping: ${targetUrl}\n`);
    const data = await extractWithDOM(page, targetUrl);
    if (data) {
      console.log('Extracted:');
      console.log(`  VIN: ${data.vin || 'N/A'}`);
      console.log(`  Price: $${data.soldPrice || 'N/A'}`);
      console.log(`  Bids: ${data.bidCount || 'N/A'}`);
      console.log(`  Comments: ${data.commentCount || 'N/A'}`);
      console.log(`  Color: ${data.exteriorColor || 'N/A'}`);
      console.log(`  Engine: ${data.engine || 'N/A'}`);
      console.log(`  Images: ${data.images.length}`);

      const id = await saveVehicle(data);
      if (id) {
        console.log(`\nSaved to vehicle: ${id}`);
      }
    } else {
      console.log('Failed to extract data');
    }
  } else {
    // Batch mode - process all C&B vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url')
      .like('discovery_url', '%carsandbids%')
      .or('color.is.null,engine_type.is.null,vin.is.null')
      .order('created_at', { ascending: false })
      .limit(100);

    console.log(`Found ${vehicles?.length || 0} vehicles to scrape\n`);

    let success = 0, failed = 0;

    for (let i = 0; i < (vehicles?.length || 0); i++) {
      const v = vehicles![i];
      console.log(`[${i + 1}/${vehicles?.length}] ${v.year} ${v.make} ${v.model}`);

      // Try the URL as-is first
      let data = await extractWithDOM(page, v.discovery_url);

      // If 404, try searching for correct URL
      if (!data) {
        const query = `${v.year} ${v.make} ${v.model}`;
        console.log(`  Searching for correct URL...`);
        await page.goto(`https://carsandbids.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'load' });
        await page.waitForTimeout(3000);

        const links = await page.$$eval('a[href*="/auctions/"]', els =>
          els.map(e => e.getAttribute('href')).filter(h => h && h.match(/\/auctions\/[^/]+\/\d{4}-/))
        );

        if (links.length > 0) {
          const newUrl = `https://carsandbids.com${links[0].split('?')[0]}`;
          console.log(`  Found: ${newUrl}`);
          data = await extractWithDOM(page, newUrl);
        }
      }

      if (data) {
        console.log(`  VIN: ${data.vin || '✗'} | $${data.soldPrice || 'N/A'} | ${data.bidCount || '?'} bids | ${data.images.length} imgs`);
        const id = await saveVehicle(data);
        if (id) success++;
        else failed++;
      } else {
        console.log(`  ❌ Failed`);
        failed++;
      }

      await page.waitForTimeout(2000);
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`  Success: ${success} | Failed: ${failed}`);
  }

  await browser.close();
}

main().catch(console.error);
