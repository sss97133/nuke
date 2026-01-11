/**
 * SCRAPE ALL VIVA BaT LISTINGS WITH PLAYWRIGHT
 * Loads all 55 listings by clicking "Show more" until disabled
 * Then extracts all listing URLs and imports them
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const BAT_MEMBER_URL = 'https://bringatrailer.com/member/vivalasvegasautos/';

console.log('🔍 SCRAPING ALL VIVA BaT LISTINGS WITH PLAYWRIGHT...\n');

async function getAllListings() {
  console.log(`📡 Loading BaT member page: ${BAT_MEMBER_URL}`);
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto(BAT_MEMBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Scroll to listings section
  await page.evaluate(() => {
    const listingsSection = document.querySelector('h2');
    if (listingsSection && listingsSection.textContent.includes('Past Listings')) {
      listingsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  
  await page.waitForTimeout(1000);
  
  // Click "Show more" until it's disabled or doesn't exist
  let clickCount = 0;
  while (true) {
    try {
      const showMoreButton = page.locator('button:has-text("Show more")').first();
      const isDisabled = await showMoreButton.evaluate(btn => btn.disabled);
      
      if (isDisabled) {
        console.log('✅ All listings loaded (button disabled)');
        break;
      }
      
      await showMoreButton.click();
      clickCount++;
      console.log(`  Clicked "Show more" ${clickCount} times...`);
      await page.waitForTimeout(2000); // Wait for content to load
      
    } catch (error) {
      console.log('✅ All listings loaded (button not found)');
      break;
    }
  }
  
  // Extract all listing URLs from the Past Listings section
  const listingURLs = await page.evaluate(() => {
    const urls = [];
    
    // Find the "Past Listings" section
    const headings = Array.from(document.querySelectorAll('h2'));
    const pastListingsHeading = headings.find(h => h.textContent.includes('Past Listings'));
    
    if (!pastListingsHeading) {
      return [];
    }
    
    // Get the container after the heading
    let container = pastListingsHeading.parentElement;
    while (container && !container.querySelector('a[href*="/listing/"]')) {
      container = container.nextElementSibling;
    }
    
    if (!container) {
      return [];
    }
    
    // Extract all listing links
    const links = container.querySelectorAll('a[href*="/listing/"]');
    const seen = new Set();
    
    links.forEach(link => {
      const url = link.href;
      if (url && url.includes('/listing/') && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
    
    return Array.from(urls);
  });
  
  await browser.close();
  
  console.log(`✅ Found ${listingURLs.length} unique listings\n`);
  return listingURLs;
}

async function importBATListing(url) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/import-bat-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ 
        batUrl: url,
        organizationId: VIVA_ORG_ID
      })
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  } catch (error) {
    return { error: error.message };
  }
}

// Main execution
const listingURLs = await getAllListings();

let created = 0;
let updated = 0;
let errors = 0;

console.log(`🔄 Processing ${listingURLs.length} listings...\n`);

for (let i = 0; i < listingURLs.length; i++) {
  const url = listingURLs[i];
  const progress = `[${i + 1}/${listingURLs.length}]`;
  const shortName = url.split('/listing/')[1]?.replace('/', '') || url;

  process.stdout.write(`${progress} ${shortName}... `);

  try {
    const result = await importBATListing(url);

    if (result.error) {
      console.log(`❌ ${result.error}`);
      errors++;
      continue;
    }

    if (result.action === 'created') {
      created++;
      console.log(`✅ CREATED (${result.vehicleId})`);
    } else if (result.action === 'updated') {
      updated++;
      console.log(`✅ UPDATED (${result.vehicleId})`);
    } else {
      console.log(`⚠️  SKIPPED (action: ${result.action})`);
    }

    // Rate limit: 3 seconds between listings
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Total listings processed: ${listingURLs.length}`);
console.log(`Vehicles created: ${created}`);
console.log(`Vehicles updated: ${updated}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ All Viva BaT listings imported!`);

