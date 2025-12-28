/**
 * Playwright-based scraper for Motorious inventory pages
 * 
 * Motorious uses heavy JavaScript rendering, so we need full browser automation
 * to properly extract vehicle listings. This script uses Playwright to:
 * 1. Navigate to Motorious dealer inventory pages
 * 2. Wait for JavaScript to fully render vehicle listings
 * 3. Extract all vehicle data
 * 4. Queue listings in import_queue for processing
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
 * Scrape Motorious dealer inventory page using Playwright
 */
async function scrapeMotoriousInventory(dealerInventoryUrl, organizationId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    console.log(`🌐 Navigating to: ${dealerInventoryUrl}`);
    
    // Navigate and wait for page to load
    await page.goto(dealerInventoryUrl, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Wait for vehicle listings to appear - Motorious uses various selectors
    console.log('⏳ Waiting for vehicle listings to render...');
    
    try {
      // Wait for vehicle listing containers (adjust selectors based on actual Motorious structure)
      await page.waitForSelector('[class*="vehicle"], [class*="listing"], [class*="inventory-item"], [data-testid*="vehicle"]', {
        timeout: 30000
      });
    } catch (e) {
      console.warn('⚠️  Vehicle selector not found, continuing anyway...');
    }

    // Additional wait for JavaScript to fully render
    await page.waitForTimeout(5000);

    // Scroll to load lazy-loaded content
    console.log('📜 Scrolling to load all vehicles...');
    await autoScroll(page);

    // Extract vehicle listings from the page
    console.log('🔍 Extracting vehicle data...');
    const vehicles = await page.evaluate(() => {
      const listings = [];
      
      // Try multiple selector patterns (we'll need to update these based on actual Motorious DOM)
      const selectors = [
        '[class*="vehicle"]',
        '[class*="listing"]',
        '[class*="inventory-item"]',
        '[data-testid*="vehicle"]',
        'article',
        '.card',
        '[class*="car-card"]'
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

      // If no specific selectors work, try to find all links that might be vehicle listings
      if (vehicleElements.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="/vehicle"], a[href*="/listing"], a[href*="/inventory"]');
        vehicleElements = Array.from(allLinks);
        console.log(`Found ${allLinks.length} potential vehicle links`);
      }

      vehicleElements.forEach((el, index) => {
        try {
          // Extract vehicle data - this will need to be customized based on actual Motorious structure
          const link = el.closest('a') || el.querySelector('a');
          const url = link?.href || null;
          
          if (!url || !url.includes('motorious')) return;

          // Extract title/name
          const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]') || el;
          const title = titleEl?.textContent?.trim() || '';

          // Extract price
          const priceEl = el.querySelector('[class*="price"], [class*="cost"]');
          const priceText = priceEl?.textContent?.trim() || '';
          const priceMatch = priceText.match(/[\$]?([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

          // Extract year, make, model from title
          const yearMatch = title.match(/\b(19|20)\d{2}\b/);
          const year = yearMatch ? parseInt(yearMatch[0]) : null;
          
          const titleParts = title.replace(/\b(19|20)\d{2}\b/, '').trim().split(/\s+/);
          const make = titleParts[0] || null;
          const model = titleParts.slice(1, 3).join(' ') || null;

          // Extract image
          const imgEl = el.querySelector('img');
          const imageUrl = imgEl?.src || imgEl?.getAttribute('data-src') || null;

          if (url) {
            listings.push({
              url: url,
              title: title,
              year: year,
              make: make,
              model: model,
              price: price,
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

    console.log(`✅ Extracted ${vehicles.length} vehicles`);

    // Get page HTML for debugging/pattern recognition
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
      vehicles,
      html,
      jsonLd: jsonLdScripts,
      url: dealerInventoryUrl
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
}

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
        source_type: 'marketplace',
        name: 'Motorious Marketplace',
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

  // Queue each vehicle
  let queued = 0;
  let duplicates = 0;

  for (const vehicle of vehicles) {
    const { data: existing, error: checkError } = await supabase
      .from('import_queue')
      .select('id')
      .eq('listing_url', vehicle.url)
      .maybeSingle();

    if (existing) {
      duplicates++;
      continue;
    }

    const { error: insertError } = await supabase
      .from('import_queue')
      .insert({
        listing_url: vehicle.url,
        source_id: sourceId,
        listing_title: vehicle.title,
        listing_year: vehicle.year,
        listing_make: vehicle.make,
        listing_model: vehicle.model,
        listing_price: vehicle.price,
        thumbnail_url: vehicle.thumbnail_url,
        raw_data: {
          organization_id: organizationId,
          title: vehicle.title,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          price: vehicle.price,
          thumbnail_url: vehicle.thumbnail_url,
          extracted_via: 'playwright_motorious_scraper',
          source_url: dealerUrl,
          organization_id: organizationId
        },
        status: 'pending',
        priority: 5
      });

    if (insertError) {
      console.error(`❌ Error queuing ${vehicle.url}:`, insertError);
    } else {
      queued++;
    }
  }

  return { queued, duplicates };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dealerUrl = args[0];
  const orgId = args[1];

  if (!dealerUrl) {
    console.error('Usage: node scripts/scrape-motorious-inventory.js <dealer_inventory_url> [organization_id]');
    console.error('\nExample:');
    console.error('  node scripts/scrape-motorious-inventory.js "https://buy.motorious.com/inventory/dealer/Avant+Garde+Collection"');
    process.exit(1);
  }

  console.log('🚀 Motorious Playwright Scraper');
  console.log('='.repeat(60));
  console.log(`Dealer URL: ${dealerUrl}`);
  if (orgId) {
    console.log(`Organization ID: ${orgId}`);
  }
  console.log('');

  try {
    // If orgId not provided, try to find it by URL
    let organizationId = orgId;
    if (!organizationId) {
      console.log('🔍 Looking up organization...');
      const { data: orgs } = await supabase
        .from('businesses')
        .select('id, business_name, website')
        .or(`website.ilike.%motorious%,website.ilike.%${dealerUrl.split('/').pop()}%`)
        .limit(5);

      if (orgs && orgs.length > 0) {
        console.log(`📋 Found ${orgs.length} potential organizations:`);
        orgs.forEach((org, i) => {
          console.log(`   ${i + 1}. ${org.business_name} (${org.id})`);
        });
        organizationId = orgs[0].id;
        console.log(`✅ Using: ${orgs[0].business_name}`);
      } else {
        console.log('⚠️  No organization found. Vehicles will be queued without organization_id');
      }
    }

    // Scrape the inventory page
    const result = await scrapeMotoriousInventory(dealerUrl, organizationId);

    console.log('');
    console.log('📊 Scraping Results:');
    console.log(`   Vehicles found: ${result.vehicles.length}`);
    console.log(`   JSON-LD objects: ${result.jsonLd.length}`);

    if (result.vehicles.length > 0) {
      console.log('');
      console.log('📋 Sample vehicles:');
      result.vehicles.slice(0, 5).forEach((v, i) => {
        console.log(`   ${i + 1}. ${v.year || '?'} ${v.make || ''} ${v.model || ''} - ${v.title}`);
        if (v.price) console.log(`      Price: $${v.price.toLocaleString()}`);
        console.log(`      URL: ${v.url}`);
      });
    }

    // Queue vehicles if organization ID is available
    if (organizationId && result.vehicles.length > 0) {
      console.log('');
      const queueResult = await queueVehicles(result.vehicles, organizationId, dealerUrl);
      console.log('📦 Queue Results:');
      console.log(`   Queued: ${queueResult.queued}`);
      console.log(`   Duplicates skipped: ${queueResult.duplicates}`);
    }

    // Save HTML for analysis
    if (result.html) {
      const fs = await import('fs/promises');
      await fs.writeFile('temp-motorious-page.html', result.html);
      console.log('');
      console.log('💾 Saved page HTML to: temp-motorious-page.html (for pattern analysis)');
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

