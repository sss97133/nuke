#!/usr/bin/env node
/**
 * SCRAPE AND BACKFILL ALL BAT VEHICLES - RIGHT NOW
 * 
 * 1. Scrape all 55 Viva BaT listings
 * 2. Match to database vehicles by year/make/model
 * 3. Update prices
 * 4. Add timeline events
 * 5. Link images (external BaT URLs)
 */

import { chromium } from 'playwright';
import { Client } from 'pg';

const DB_CONFIG = {
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  ssl: { rejectUnauthorized: false }
};

async function scrapeAllBaTListings() {
  console.log('🌐 Scraping Viva BaT member page...\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://bringatrailer.com/member/vivalasvegasautos/', { 
    waitUntil: 'domcontentloaded',
    timeout: 60000 
  });
  
  // Click "Show more" to load all 55 listings
  let clicks = 0;
  while (clicks < 20) {
    try {
      const btn = page.locator('button:has-text("Show more")').first();
      const disabled = await btn.evaluate(b => b.disabled).catch(() => true);
      if (disabled) break;
      
      await btn.click();
      await page.waitForTimeout(1500);
      clicks++;
    } catch {
      break;
    }
  }
  
  console.log(`  Clicked "Show more" ${clicks} times\n`);
  
  // Extract all listings
  const listings = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
      const text = link.textContent;
      const href = link.href;
      
      // Extract year
      const yearMatch = text.match(/(19\\d{2}|20\\d{2})/);
      if (!yearMatch) return;
      
      const year = parseInt(yearMatch[1]);
      
      // Extract make/model from heading
      const heading = link.querySelector('h3');
      if (!heading) return;
      
      const title = heading.textContent.trim();
      
      // Extract price
      const priceMatch = text.match(/Sold for USD \\$([0-9,]+)/);
      const bidMatch = text.match(/Bid to USD \\$([0-9,]+)/);
      
      const price = priceMatch ? 
        parseInt(priceMatch[1].replace(/,/g, '')) : 
        (bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : 0);
      
      // Parse make/model
      const parts = title.split(' ');
      const make = parts[1] || '';
      const model = parts.slice(2).join(' ').replace(/ \\d+×\\d+/g, '').trim();
      
      results.push({
        url: href,
        year,
        make,
        model,
        title,
        price
      });
    });
    
    return results;
  });
  
  await browser.close();
  
  // Deduplicate
  const unique = [];
  const seen = new Set();
  listings.forEach(l => {
    if (!seen.has(l.url)) {
      seen.add(l.url);
      unique.push(l);
    }
  });
  
  console.log(`✅ Found ${unique.length} unique BaT listings\n`);
  return unique;
}

async function matchAndUpdate(batListings) {
  const client = new Client(DB_CONFIG);
  await client.connect();
  
  try {
    console.log('🔗 Matching BaT listings to database vehicles...\n');
    
    let matched = 0;
    let pricesUpdated = 0;
    let timelineAdded = 0;
    
    for (const bat of batListings) {
      // Find matching vehicle in database
      const result = await client.query(`
        SELECT id, year, make, model, current_value, vin
        FROM vehicles
        WHERE year = $1
          AND (vin LIKE 'VIVA-%')
          AND (
            make ILIKE $2 OR 
            make ILIKE $3 OR
            $2 ILIKE '%' || make || '%'
          )
        LIMIT 1
      `, [bat.year, bat.make, `%${bat.make.substring(0, 4)}%`]);
      
      if (result.rows.length === 0) {
        console.log(`  ⚠️  No match: ${bat.year} ${bat.make} ${bat.model}`);
        continue;
      }
      
      const vehicle = result.rows[0];
      matched++;
      
      console.log(`  ✅ ${bat.year} ${bat.make} ${bat.model} → $${bat.price.toLocaleString()}`);
      
      // Update price if different
      if (bat.price > 0 && (vehicle.current_value !== bat.price)) {
        await client.query(`
          UPDATE vehicles SET current_value = $1 WHERE id = $2
        `, [bat.price, vehicle.id]);
        pricesUpdated++;
      }
      
      // Add timeline event
      const hasEvent = await client.query(`
        SELECT id FROM timeline_events
        WHERE vehicle_id = $1 AND cost_amount = $2
      `, [vehicle.id, bat.price]);
      
      if (hasEvent.rows.length === 0 && bat.price > 0) {
        try {
          await client.query(`
            INSERT INTO timeline_events (
              vehicle_id, event_type, event_date, title, description, cost_amount, source
            ) VALUES ($1, 'sale', '2024-01-01', $2, $3, $4, 'bat_listing')
          `, [
            vehicle.id,
            `BaT Sale - \\$${bat.price.toLocaleString()}`,
            `${bat.title}. Sold on Bring a Trailer. ${bat.url}`,
            bat.price
          ]);
          timelineAdded++;
        } catch (e) {
          // Ignore trigger errors
        }
      }
    }
    
    console.log(`\n╔═══════════════════════════════════════════════════════╗`);
    console.log(`║     SCRAPE & BACKFILL COMPLETE                        ║`);
    console.log(`╚═══════════════════════════════════════════════════════╝\n`);
    console.log(`  BaT listings scraped: ${batListings.length}`);
    console.log(`  Database matches: ${matched}`);
    console.log(`  Prices updated: ${pricesUpdated}`);
    console.log(`  Timeline events added: ${timelineAdded}\n`);
    
  } finally {
    await client.end();
  }
}

// RUN IT
(async () => {
  const batListings = await scrapeAllBaTListings();
  await matchAndUpdate(batListings);
  console.log('✅ DONE - Refresh n-zero.dev to see updated prices and timelines');
})();

