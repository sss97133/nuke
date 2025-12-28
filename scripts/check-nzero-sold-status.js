#!/usr/bin/env node
/**
 * Check n-zero.dev Vehicle Sold Status
 * 
 * Scrapes n-zero.dev vehicle pages to detect if vehicles are marked as sold
 * (checks for banner-sold div or other sold indicators) and updates the database.
 * 
 * Usage:
 *   node scripts/check-nzero-sold-status.js [vehicle_id]
 *   node scripts/check-nzero-sold-status.js --all
 *   node scripts/check-nzero-sold-status.js --vehicle-url https://n-zero.dev/vehicle/[id]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Check database for sold status indicators
 */
async function checkDatabaseSoldStatus(vehicleId) {
  // Check organization_vehicles for sold status
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('listing_status, sale_date, sale_price')
    .eq('vehicle_id', vehicleId)
    .eq('listing_status', 'sold')
    .limit(1);

  if (orgVehicles && orgVehicles.length > 0) {
    return { isSold: true, method: 'organization_vehicles.listing_status', source: 'database' };
  }

  // Check vehicle_listings for sold status
  const { data: listings } = await supabase
    .from('vehicle_listings')
    .select('status, sold_at, sold_price_cents')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'sold')
    .limit(1);

  if (listings && listings.length > 0) {
    return { isSold: true, method: 'vehicle_listings.status', source: 'database' };
  }

  return { isSold: null, method: 'not found in database', source: 'database' };
}

/**
 * Check if a vehicle is sold on n-zero.dev using Playwright to render React
 */
async function checkNZeroSoldStatus(vehicleId) {
  const url = `https://n-zero.dev/vehicle/${vehicleId}`;
  
  try {
    // Try to use Playwright if available
    let playwright;
    try {
      playwright = await import('playwright');
    } catch (e) {
      // Playwright not available, fall back to direct fetch
      return await checkNZeroSoldStatusFallback(url);
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Navigate to the page and wait for it to load
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait a bit for React to render
    await page.waitForTimeout(2000);
    
    // Check for sold indicators - multiple methods
    const hasBannerSold = await page.$('div.banner-sold').then(el => el !== null).catch(() => false);
    
    // Check for SOLD text anywhere visible
    const hasSoldText = await page.evaluate(() => {
      // Look for SOLD text in visible elements
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        const style = window.getComputedStyle(el);
        // Check if element is visible
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }
        // Check for exact "SOLD" match (case insensitive)
        if (text === 'SOLD' || text === 'Sold') {
          return true;
        }
        // Check for SOLD in text content (avoid false positives)
        if (text.includes('SOLD') && !text.includes('UNSOLD') && !text.includes('RESOLD')) {
          // Check if it's in a badge-like element
          const bgColor = style.backgroundColor;
          const color = style.color;
          if (bgColor.includes('red') || bgColor.includes('220, 38, 38') || color.includes('white')) {
            return true;
          }
        }
      }
      return false;
    });
    
    // Check window data for vehicle sold status
    const windowDataCheck = await page.evaluate(() => {
      try {
        if (window.__vehicleProfileRpcData?.vehicle) {
          const vehicle = window.__vehicleProfileRpcData.vehicle;
          return vehicle.sale_status === 'sold' || 
                 vehicle.auction_outcome === 'sold' ||
                 (vehicle.sale_price && vehicle.sale_price > 0 && vehicle.sale_status !== 'available');
        }
        // Also check for any global vehicle data
        if (window.__vehicleData) {
          const vehicle = window.__vehicleData;
          return vehicle.sale_status === 'sold' || vehicle.auction_outcome === 'sold';
        }
      } catch (e) {
        // Ignore errors
      }
      return false;
    });
    
    // Check for sold badge elements (common patterns)
    const hasSoldBadge = await page.evaluate(() => {
      const badges = document.querySelectorAll('[class*="sold"], [class*="badge"], [style*="background"]');
      for (const badge of badges) {
        const text = (badge.textContent || '').trim().toUpperCase();
        if (text === 'SOLD' || (text.includes('SOLD') && !text.includes('UNSOLD'))) {
          return true;
        }
      }
      return false;
    });
    
    const soldIndicators = [hasBannerSold, hasSoldText, windowDataCheck, hasSoldBadge];

    // Debug: Get page title and vehicle data
    const pageInfo = await page.evaluate(() => {
      const vehicleData = window.__vehicleProfileRpcData?.vehicle || {};
      return {
        title: document.title,
        bodyText: document.body.textContent.substring(0, 500),
        hasVehicleData: !!window.__vehicleProfileRpcData,
        vehicleStatus: {
          sale_status: vehicleData.sale_status,
          auction_outcome: vehicleData.auction_outcome,
          sale_price: vehicleData.sale_price,
          sale_date: vehicleData.sale_date,
        },
      };
    });
    
    // Check vehicle data from window for sold status
    if (pageInfo.vehicleStatus) {
      const vs = pageInfo.vehicleStatus;
      if (vs.sale_status === 'sold' || vs.auction_outcome === 'sold' || (vs.sale_price && vs.sale_price > 0)) {
        await browser.close();
        return { isSold: true, method: 'window.__vehicleProfileRpcData', source: 'scraped', debug: pageInfo };
      }
    }

    await browser.close();

    if (soldIndicators.some(indicator => indicator === true)) {
      return { isSold: true, method: 'Playwright rendered page', source: 'scraped', debug: pageInfo };
    }

    return { isSold: false, method: 'Playwright - no sold indicators', source: 'scraped', debug: pageInfo };
  } catch (error) {
    return { isSold: null, error: error.message, source: 'scraped' };
  }
}

/**
 * Fallback: direct fetch (may not work for React apps)
 */
async function checkNZeroSoldStatusFallback(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { isSold: null, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    
    // Check for sale_status in JSON data (React apps often embed data)
    const saleStatusPatterns = [
      /"sale_status"\s*:\s*"sold"/i,
      /'sale_status'\s*:\s*'sold'/i,
      /sale_status["']?\s*:\s*["']?sold/i,
    ];
    
    for (const pattern of saleStatusPatterns) {
      if (pattern.test(html)) {
        return { isSold: true, method: 'sale_status JSON field', source: 'scraped' };
      }
    }

    return { isSold: false, method: 'no sold indicators found (React not rendered)', source: 'scraped' };
  } catch (error) {
    return { isSold: null, error: error.message, source: 'scraped' };
  }
}

/**
 * Use Firecrawl API to properly render the React page and check for sold status
 */
async function checkNZeroSoldStatusWithFirecrawl(vehicleId) {
  const url = `https://n-zero.dev/vehicle/${vehicleId}`;
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

  if (!firecrawlApiKey) {
    console.warn('  ⚠️  FIRECRAWL_API_KEY not set, falling back to direct fetch');
    return checkNZeroSoldStatus(vehicleId);
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url: url,
        pageOptions: {
          waitFor: 2000, // Wait 2 seconds for React to render
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { isSold: null, error: `Firecrawl API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    const html = data.data?.markdown || data.data?.html || '';

    // Check for sold indicators in the rendered HTML
    const hasSoldBanner = /banner-sold/i.test(html) || /class="[^"]*banner-sold[^"]*"/i.test(html);
    const hasSoldStatus = /"sale_status"\s*:\s*"sold"/i.test(html) || /sale_status.*sold/i.test(html);
    
    if (hasSoldBanner || hasSoldStatus) {
      return { isSold: true, method: 'Firecrawl rendered page' };
    }

    return { isSold: false, method: 'Firecrawl - no sold indicators' };
  } catch (error) {
    return { isSold: null, error: error.message };
  }
}

/**
 * Update vehicle sale status in database
 */
async function updateVehicleSoldStatus(vehicleId, isSold, currentStatus) {
  if (isSold === null) {
    return { success: false, error: 'Cannot determine sold status' };
  }

  // If already marked as sold, no update needed
  if (currentStatus === 'sold' && isSold) {
    return { success: true, updated: false, reason: 'Already marked as sold' };
  }

  // If not sold and we detect it's not sold, no update needed
  if (currentStatus !== 'sold' && !isSold) {
    return { success: true, updated: false, reason: 'Status matches (not sold)' };
  }

  // Update to sold
  if (isSold && currentStatus !== 'sold') {
    const { data, error } = await supabase
      .from('vehicles')
      .update({
        sale_status: 'sold',
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId)
      .select('id, sale_status, sale_price, sale_date')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, updated: true, data };
  }

  return { success: true, updated: false, reason: 'No change needed' };
}

/**
 * Process a single vehicle
 */
async function processVehicle(vehicleId) {
  console.log(`\nProcessing vehicle: ${vehicleId}`);

  // Get current vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date')
    .eq('id', vehicleId)
    .single();

  if (error || !vehicle) {
    console.error(`  ❌ Vehicle not found: ${error ? error.message : 'Unknown error'}`);
    return;
  }

  console.log(`  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  Current status: ${vehicle.sale_status || 'null'}`);
  console.log(`  URL: https://n-zero.dev/vehicle/${vehicleId}`);

  // First check database
  console.log(`  🔍 Checking database for sold status...`);
  const dbCheck = await checkDatabaseSoldStatus(vehicleId);
  
  if (dbCheck.isSold === true) {
    console.log(`  📊 Database shows: SOLD (${dbCheck.method})`);
    // Still update vehicle if needed
    const updateResult = await updateVehicleSoldStatus(
      vehicleId,
      true,
      vehicle.sale_status
    );
    if (updateResult.success && updateResult.updated) {
      console.log(`  ✅ Updated vehicle sale_status to sold`);
    }
    return;
  }

  // If not found in database, check n-zero.dev frontend
  console.log(`  🔍 Checking n-zero.dev frontend for sold status...`);
  const statusCheck = await checkNZeroSoldStatus(vehicleId);

  if (statusCheck.error) {
    console.error(`  ❌ Error checking status: ${statusCheck.error}`);
    return;
  }

  console.log(`  📊 Status check: ${statusCheck.isSold ? 'SOLD' : 'NOT SOLD'} (${statusCheck.method})`);
  if (statusCheck.debug && process.env.DEBUG) {
    console.log(`  🔍 Debug info:`, JSON.stringify(statusCheck.debug, null, 2));
  }

  // Update if needed
  const updateResult = await updateVehicleSoldStatus(
    vehicleId,
    statusCheck.isSold,
    vehicle.sale_status
  );

  if (updateResult.success) {
    if (updateResult.updated) {
      console.log(`  ✅ Updated vehicle to sold status`);
      if (updateResult.data) {
        console.log(`     New status: ${updateResult.data.sale_status}`);
      }
    } else {
      console.log(`  ⏭️  No update needed: ${updateResult.reason}`);
    }
  } else {
    console.error(`  ❌ Failed to update: ${updateResult.error}`);
  }
}

/**
 * Process all vehicles (or a subset)
 */
async function processAll() {
  console.log('Finding vehicles to check...\n');

  // Get vehicles that are not marked as sold
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status')
    .or('sale_status.is.null,sale_status.neq.sold')
    .limit(1000); // Limit to avoid overwhelming the system

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles found to check');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles to check\n`);

  // Process in batches
  const batchSize = 5; // Small batches to avoid rate limiting
  for (let i = 0; i < vehicles.length; i += batchSize) {
    const batch = vehicles.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, vehicles.length)} of ${vehicles.length})`);

    await Promise.all(
      batch.map(vehicle => processVehicle(vehicle.id))
    );

    // Delay between batches to avoid rate limiting
    if (i + batchSize < vehicles.length) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log(`\n✅ Completed processing ${vehicles.length} vehicles`);
}

async function main() {
  const args = process.argv.slice(2);
  const vehicleId = args.find(arg => !arg.startsWith('--'));
  const allFlag = args.includes('--all');
  const urlArg = args.find(arg => arg.startsWith('--vehicle-url='));
  
  let targetVehicleId = vehicleId;
  
  // Extract vehicle ID from URL if provided
  if (urlArg) {
    const url = urlArg.split('=')[1];
    const match = url.match(/\/vehicle\/([a-f0-9-]+)/i);
    if (match) {
      targetVehicleId = match[1];
    }
  }

  if (targetVehicleId && !allFlag) {
    await processVehicle(targetVehicleId);
  } else {
    await processAll();
  }
}

main().catch(console.error);

