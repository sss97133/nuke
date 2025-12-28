/**
 * Playwright-based scraper for The Shop Auto Group (DealerCenter) inventory
 * 
 * DealerCenter uses heavy JavaScript rendering, so we need full browser automation
 * to properly extract vehicle listings. This script uses Playwright to:
 * 1. Navigate to The Shop Auto Group inventory page
 * 2. Wait for JavaScript to fully render vehicle listings
 * 3. Extract all vehicle data
 * 4. Queue listings in import_queue for processing
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple env file locations
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Auto-scroll to load lazy-loaded content
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

/**
 * Scrape DealerCenter inventory page using Playwright
 */
async function scrapeDealerCenterInventory(inventoryUrl, organizationId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    console.log(`🌐 Navigating to: ${inventoryUrl}`);
    
    // Navigate and wait for page to load
    await page.goto(inventoryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    // Wait for vehicle listings to appear - DealerCenter uses various selectors
    console.log('⏳ Waiting for vehicle listings to render...');
    
    // Wait a bit for JavaScript to initialize
    await page.waitForTimeout(3000);
    
    // Try multiple selectors that DealerCenter might use
    try {
      await page.waitForSelector(
        '[class*="vehicle"], [class*="inventory"], [class*="listing"], [class*="car-card"], [data-vehicle], article, .vehicle-item, .inventory-item',
        { timeout: 30000 }
      );
    } catch (e) {
      console.warn('⚠️  Vehicle selector not found, continuing anyway...');
    }

    // Wait for DealerCenter JavaScript to load and render vehicles
    console.log('⏳ Waiting for DealerCenter to render vehicles via JavaScript...');
    
    // Wait for the AJAX call to complete and vehicles to render
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      console.log('⚠️  Network idle timeout, continuing anyway...');
    });
    
    // Wait for vehicle listing container to appear
    try {
      await page.waitForSelector('.dws-vehicle-listing-item, .list-group-item.dws-no-h-padding, [id*="vehicle-listing"], .dws-vehicle-listing-widget', {
        timeout: 20000
      });
      console.log('✅ Vehicle container found!');
    } catch (e) {
      console.warn('⚠️  Vehicle container not found, waiting longer...');
      await page.waitForTimeout(5000);
    }
    
    // Additional wait for JavaScript to fully render
    await page.waitForTimeout(5000);
    
    // Scroll to trigger lazy loading
    console.log('📜 Scrolling to load all vehicles...');
    await autoScroll(page);
    await page.waitForTimeout(3000);
    
    // Extract vehicles from rendered DOM
    let allVehicles = [];
    let pageNum = 1;
    let hasMorePages = true;

    while (hasMorePages && pageNum <= 20) {
      console.log(`📄 Extracting vehicles from page ${pageNum}...`);
      
      // Extract vehicle listings from the current page
      const vehicles = await page.evaluate(() => {
        const listings = [];
        
            // DealerCenter specific selectors
            const selectors = [
              '.dws-vehicle-listing-item',
              '.list-group-item.dws-no-h-padding',
              '[class*="vehicle-listing-item"]',
              '[data-stock-number]',
              '[data-vehicle-vin]'
            ];

            let vehicleElements = [];
            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                vehicleElements = Array.from(elements);
                console.log(`Found ${elements.length} elements with selector: ${selector}`);
                break;
              }
            }

            // Fallback: find all links that might be vehicle listings
            if (vehicleElements.length === 0) {
              const allLinks = document.querySelectorAll('a[href*="/inventory/"], a.dws-vehicle-view-detail-link');
              vehicleElements = Array.from(allLinks);
              console.log(`Found ${vehicleElements.length} potential vehicle links`);
            }

        vehicleElements.forEach((el, index) => {
          try {
            // Extract vehicle data
            const link = el.closest('a') || el.querySelector('a');
            let url = link?.href || null;
            
            // If element itself is a link
            if (!url && el.tagName === 'A') {
              url = el.href;
            }
            
            // Skip if no valid URL
            if (!url || url.includes('#')) return;
            
            // Extract from DealerCenter data attributes
            const stockNum = el.getAttribute('data-vehicle-stock-no') || el.getAttribute('data-stock-number') || '';
            const vin = el.getAttribute('data-vehicle-vin') || el.getAttribute('data-vin') || null;
            
            // Extract title/name - try multiple approaches
            let title = '';
            const titleEl = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"], .dws-vehicle-title, .vehicle-title');
            if (titleEl) {
              title = titleEl.textContent?.trim() || '';
            }
            
            // If title is empty or looks corrupted, try getting from link text or aria-label
            if (!title || title.length > 100 || /(\d{4})\s+\w+\s+\w+.*\1/.test(title)) {
              if (link) {
                const linkText = link.textContent?.trim() || link.getAttribute('aria-label') || '';
                if (linkText && linkText.length < 100) {
                  title = linkText;
                }
              }
            }
            
            // Clean up duplicated patterns (e.g., "2014 LOOK TL2014 LOOK TL" -> "2014 LOOK TL")
            title = title.replace(/(\d{4}\s+[\w\s-]+?)(\1)+/gi, '$1').trim();
            
            // Extract year, make, model from title
            const yearMatch = title.match(/\b(19|20)\d{2}\b/);
            const year = yearMatch ? parseInt(yearMatch[0]) : null;
            
            // Remove year and split into make/model
            const titleWithoutYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
            const titleParts = titleWithoutYear.split(/\s+/).filter(p => p && p.length > 0);
            
            // Make is typically first word, model is rest (limit to reasonable length)
            const make = titleParts[0] || null;
            const model = titleParts.slice(1).join(' ').substring(0, 50) || null;

            // Extract price
            const priceEl = el.querySelector('[class*="price"], [class*="cost"], .dws-vehicle-price, .vehicle-price');
            const priceText = priceEl?.textContent?.trim() || '';
            const priceMatch = priceText.match(/[\$]?([\d,]+)/);
            const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

            // Extract mileage
            const milesEl = el.querySelector('[class*="mile"], [class*="odometer"], .dws-vehicle-mileage, .vehicle-miles');
            const milesText = milesEl?.textContent?.trim() || '';
            const milesMatch = milesText.match(/([\d,]+)/);
            const miles = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : null;

            // Extract image from data-background-image or img
            const bgImage = el.getAttribute('data-background-image') || 
                          el.querySelector('[data-background-image]')?.getAttribute('data-background-image');
            const imgEl = el.querySelector('img');
            const imageUrl = bgImage || imgEl?.src || imgEl?.getAttribute('data-src') || imgEl?.getAttribute('data-lazy-src') || null;

            // Only include URLs that look like detail pages (have /inventory/make/model/stock format)
            // Reject listing pages, home pages, or generic inventory pages
            if (url && 
                url.includes('autogroup.theshopclubs.com') && 
                url.match(/\/inventory\/[\w-]+\/[\w-]+\/\d+\/?$/) &&  // Must have /inventory/make/model/stock pattern
                !url.includes('/inventory/?') &&  // Not the main inventory page
                !url.match(/\/inventory\/\?/)) {  // Not inventory with just query params
              listings.push({
                url: url.split('?')[0].split('#')[0],  // Clean URL, remove query params and fragments
                title: title || `${year || ''} ${make || ''} ${model || ''}`.trim(),
                year: year,
                make: make,
                model: model,
                price: price,
                mileage: miles,
                vin: vin,
                stock_number: stockNum,
                thumbnail_url: imageUrl,
                index: index
              });
            }
          } catch (err) {
            console.warn(`Error extracting vehicle ${index}:`, err.message);
          }
        });

        return listings;
      });

      // Deduplicate by URL
      const newVehicles = vehicles.filter(v => !allVehicles.find(existing => existing.url === v.url));
      allVehicles.push(...newVehicles);
      
      console.log(`   Found ${newVehicles.length} new vehicles on page ${pageNum} (${allVehicles.length} total)`);
      
      // If no vehicles found on first page, we're done
      if (newVehicles.length === 0 && pageNum === 1) {
        console.log('⚠️  No vehicles found on first page. The page may not have loaded correctly.');
        hasMorePages = false;
        break;
      }
      
      // If we found fewer vehicles than expected, might be last page, but continue checking
      if (newVehicles.length === 0 && pageNum > 1) {
        console.log(`   ℹ️  No new vehicles on page ${pageNum}, reached end`);
        hasMorePages = false;
        break;
      }

      // Check for next page button or pagination
      const nextPageButton = await page.$('a[aria-label*="next"], a[aria-label*="Next"], button[aria-label*="next"], .pagination-next, [class*="next-page"], .pagination .next, a.next');
      
      if (nextPageButton) {
        const isDisabled = await nextPageButton.evaluate(el => {
          return el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
        });
        
        if (!isDisabled) {
          console.log(`   📄 Moving to next page...`);
          await nextPageButton.click();
          await page.waitForTimeout(3000);
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await autoScroll(page);
          await page.waitForTimeout(2000);
          pageNum++;
        } else {
          hasMorePages = false;
        }
      } else {
        // Check if there are more pages via pagination numbers
        const hasMore = await page.evaluate(() => {
          const currentPage = document.querySelector('.pagination .active, .pagination .current');
          const nextPageNum = currentPage?.nextElementSibling;
          return nextPageNum && nextPageNum.tagName === 'A' && !nextPageNum.classList.contains('disabled');
        });
        
        if (hasMore) {
          // Click next page number
          await page.evaluate(() => {
            const currentPage = document.querySelector('.pagination .active, .pagination .current');
            const nextPageNum = currentPage?.nextElementSibling;
            if (nextPageNum && nextPageNum.tagName === 'A') {
              nextPageNum.click();
            }
          });
          await page.waitForTimeout(3000);
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await autoScroll(page);
          await page.waitForTimeout(2000);
          pageNum++;
        } else {
          hasMorePages = false;
        }
      }
    }

    console.log(`✅ Extracted ${allVehicles.length} total vehicles`);

    // Get page HTML for debugging
    const html = await page.content();
    
    // Also try extracting from page metadata/JSON-LD
    const jsonLdScripts = await page.$$eval('script[type="application/ld+json"]', (scripts) => {
      return scripts.map(script => {
        try {
          return JSON.parse(script.textContent);
        } catch {
          return null;
        }
      }).filter(Boolean);
    });

    await browser.close();

    return {
      vehicles: allVehicles,
      html,
      jsonLd: jsonLdScripts,
      url: inventoryUrl
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Queue vehicles in import_queue for processing
 */
async function queueVehicles(vehicles, organizationId, dealerUrl) {
  if (!vehicles || vehicles.length === 0) {
    console.log('⚠️  No vehicles to queue');
    return { queued: 0, duplicates: 0 };
  }

  console.log(`📦 Queuing ${vehicles.length} vehicles...`);

  // Ensure scrape_source exists
  const { data: source } = await supabase
    .from('scrape_sources')
    .select('id')
    .eq('url', dealerUrl)
    .maybeSingle();

  let sourceId = source?.id;

  if (!sourceId) {
    const { data: newSource, error: sourceError } = await supabase
      .from('scrape_sources')
      .insert({
        url: dealerUrl,
        source_type: 'dealer_website',
        name: 'The Shop Auto Group',
        is_active: true
      })
      .select('id')
      .single();

    if (sourceError) {
      console.error('❌ Error creating scrape_source:', sourceError);
      return { queued: 0, duplicates: 0, error: sourceError };
    }

    sourceId = newSource.id;
  }

  // Batch check for duplicates first (check in chunks to avoid URL length limits)
  const existingUrls = new Set();
  if (vehicles.length > 0) {
    const urls = vehicles.map(v => v.url);
    const chunkSize = 100;
    
    for (let i = 0; i < urls.length; i += chunkSize) {
      const urlChunk = urls.slice(i, i + chunkSize);
      const { data: existing } = await supabase
        .from('import_queue')
        .select('listing_url')
        .in('listing_url', urlChunk);
      
      if (existing) {
        existing.forEach(e => existingUrls.add(e.listing_url));
      }
    }
  }

  // Prepare batch insert
  const vehiclesToInsert = vehicles
    .filter(v => !existingUrls.has(v.url))
    .map(vehicle => ({
      listing_url: vehicle.url,
      source_id: sourceId,
      listing_title: vehicle.title,
      listing_year: vehicle.year,
      listing_make: vehicle.make,
      listing_model: vehicle.model,
      listing_price: vehicle.price ? Math.round(vehicle.price) : null,
      thumbnail_url: vehicle.thumbnail_url,
      raw_data: {
        organization_id: organizationId,
        title: vehicle.title,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        price: vehicle.price,
        mileage: vehicle.mileage || null,
        vin: vehicle.vin || null,
        stock_number: vehicle.stock_number || null,
        thumbnail_url: vehicle.thumbnail_url,
        extracted_via: 'playwright_dealercenter_scraper',
        source_url: dealerUrl
      },
      status: 'pending',
      priority: 5
    }));

  const duplicates = vehicles.length - vehiclesToInsert.length;
  
  if (duplicates > 0) {
    console.log(`   ℹ️  Skipping ${duplicates} vehicles already in queue`);
  }

  if (vehiclesToInsert.length === 0) {
    console.log(`   ℹ️  All ${duplicates} vehicles already in queue`);
    return { queued: 0, duplicates };
  }

  // Batch insert in chunks of 50
  let queued = 0;
  const batchSize = 50;
  
  for (let i = 0; i < vehiclesToInsert.length; i += batchSize) {
    const batch = vehiclesToInsert.slice(i, i + batchSize);
    const { data, error: insertError } = await supabase
      .from('import_queue')
      .insert(batch);

    if (insertError) {
      // If it's a duplicate key error, some items might have been inserted before the error
      if (insertError.message?.includes('duplicate key') || insertError.code === '23505') {
        console.log(`   ⚠️  Some vehicles in batch ${Math.floor(i/batchSize) + 1} may already exist, trying individually...`);
        // Try individual inserts to handle duplicates gracefully
        for (const item of batch) {
          const { error: singleError } = await supabase
            .from('import_queue')
            .insert(item);
          if (!singleError) {
            queued++;
          } else if (!singleError.message?.includes('duplicate key') && singleError.code !== '23505') {
            // Only log non-duplicate errors
            console.warn(`   ⚠️  Failed to queue ${item.listing_url}: ${singleError.message}`);
          }
        }
      } else {
        console.error(`❌ Error queuing batch ${Math.floor(i/batchSize) + 1}:`, insertError.message || insertError);
        // Try individual inserts for this batch as fallback
        for (const item of batch) {
          const { error: singleError } = await supabase
            .from('import_queue')
            .insert(item);
          if (!singleError) {
            queued++;
          }
        }
      }
    } else {
      queued += batch.length;
      console.log(`   ✅ Queued batch ${Math.floor(i/batchSize) + 1}: ${batch.length} vehicles (${queued}/${vehiclesToInsert.length} total)`);
    }
  }

  return { queued, duplicates };
}

/**
 * Main execution
 */
async function main() {
  const INVENTORY_URL = 'https://autogroup.theshopclubs.com/inventory/';
  const ORGANIZATION_ID = '0b8219ae-9d9b-447c-978c-3a30ab37fd49'; // The Shop

  console.log('🚗 The Shop Auto Group Playwright Scraper');
  console.log('='.repeat(60));
  console.log(`Inventory URL: ${INVENTORY_URL}`);
  console.log(`Organization ID: ${ORGANIZATION_ID}`);
  console.log('');

  try {
    // Scrape the inventory page
    const result = await scrapeDealerCenterInventory(INVENTORY_URL, ORGANIZATION_ID);

    console.log('');
    console.log('📊 Scraping Results:');
    console.log(`   Vehicles found: ${result.vehicles.length}`);
    console.log(`   JSON-LD objects: ${result.jsonLd.length}`);

    if (result.vehicles.length > 0) {
      console.log('');
      console.log('📋 Sample vehicles:');
      result.vehicles.slice(0, 10).forEach((v, i) => {
        console.log(`   ${i + 1}. ${v.year || '?'} ${v.make || ''} ${v.model || ''}`);
        if (v.price) console.log(`      Price: $${v.price.toLocaleString()}`);
        if (v.mileage) console.log(`      Miles: ${v.mileage.toLocaleString()}`);
        console.log(`      URL: ${v.url}`);
      });
    }

    // Queue vehicles
    if (result.vehicles.length > 0) {
      console.log('');
      const queueResult = await queueVehicles(result.vehicles, ORGANIZATION_ID, INVENTORY_URL);
      console.log('📦 Queue Results:');
      console.log(`   Queued: ${queueResult.queued}`);
      console.log(`   Duplicates skipped: ${queueResult.duplicates}`);
      
      if (queueResult.queued > 0) {
        console.log('');
        console.log('🔄 Processing import queue...');
        // Process a batch to create vehicle profiles
        const processResponse = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            batch_size: Math.min(50, queueResult.queued),
            priority_only: false
          })
        });
        
        if (processResponse.ok) {
          const processResult = await processResponse.json();
          console.log(`   ✅ Created ${processResult.vehicles_created?.length || 0} vehicle profiles`);
        }
      }
    }

    // Save HTML for analysis
    if (result.html) {
      await writeFile('temp-shop-autogroup-page.html', result.html);
      console.log('');
      console.log('💾 Saved page HTML to: temp-shop-autogroup-page.html (for pattern analysis)');
    }

    console.log('');
    console.log('✅ Scraping complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

