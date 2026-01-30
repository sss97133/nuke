#!/usr/bin/env node
/**
 * Retry Sellers Without Location
 *
 * For sellers who didn't have location on their first listing,
 * try their OTHER listings - different listings may show location.
 *
 * Usage: dotenvx run -- node scripts/contacts/scrape-sellers-retry.js [limit]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIMIT = parseInt(process.argv[2]) || 100;

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

const ARIZONA_CITIES = new Set(['phoenix','tucson','scottsdale','mesa','tempe','chandler','glendale','gilbert','peoria','surprise','yuma','avondale','flagstaff','goodyear','buckeye','casa grande','sierra vista','prescott','sedona']);
const NEVADA_CITIES = new Set(['las vegas','henderson','reno','boulder city','willow beach','carson city','sparks','mesquite','elko','fernley','laughlin']);
const NEW_JERSEY_CITIES = new Set(['wyckoff','demarest','moonachie','englewood','hackensack','paramus','ridgewood','teaneck','hoboken','jersey city','newark','elizabeth','paterson','trenton','atlantic city','princeton','cherry hill']);

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (options.method === 'PATCH') return res.ok;
  return res.json();
}

async function getSellersToRetry() {
  // Get all sellers WITH location
  const withLoc = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_name=not.is.null&seller_location=not.is.null&select=seller_name`
  );
  const sellersWithLoc = new Set(withLoc.map(e => e.seller_name));

  // Get sellers WITHOUT location who have multiple listings
  const withoutLoc = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_name=not.is.null&seller_location=is.null&source_url=not.is.null&select=id,seller_name,source_url&order=seller_name`
  );

  // Group by seller, get multiple listings per seller
  const sellerListings = {};
  for (const event of withoutLoc) {
    if (sellersWithLoc.has(event.seller_name)) continue;
    if (!sellerListings[event.seller_name]) {
      sellerListings[event.seller_name] = [];
    }
    sellerListings[event.seller_name].push(event);
  }

  // Get sellers with multiple listings (more chances to find location)
  const retryList = [];
  for (const [seller, listings] of Object.entries(sellerListings)) {
    // Try up to 3 different listings per seller
    for (const listing of listings.slice(0, 3)) {
      retryList.push(listing);
      if (retryList.length >= LIMIT) break;
    }
    if (retryList.length >= LIMIT) break;
  }

  return retryList;
}

function normalizeLocation(city, state) {
  if (!city || !state) return null;
  city = city.trim();
  state = state.trim().toUpperCase();
  const cityLower = city.toLowerCase();

  if (ARIZONA_CITIES.has(cityLower)) state = 'AZ';
  else if (NEVADA_CITIES.has(cityLower)) state = 'NV';
  else if (NEW_JERSEY_CITIES.has(cityLower)) state = 'NJ';

  if (!VALID_STATES.has(state)) return null;
  city = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return { city, state };
}

async function extractLocation(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const location = await page.evaluate(() => {
      const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
      const statePattern = states.join('|');
      const text = document.body.innerText;
      const lines = text.split('\n');

      for (const line of lines) {
        const match = line.match(new RegExp(`^\\s*([A-Z][a-zA-Z\\s]+),\\s*(${statePattern})\\s*$`, 'i'));
        if (match) return { city: match[1].trim(), state: match[2].toUpperCase() };

        const locMatch = line.match(new RegExp(`Location[:\\s]+([A-Z][a-zA-Z\\s]+),\\s*(${statePattern})`, 'i'));
        if (locMatch) return { city: locMatch[1].trim(), state: locMatch[2].toUpperCase() };
      }
      return null;
    });

    if (location) return normalizeLocation(location.city, location.state);
    return null;
  } catch (e) {
    return null;
  }
}

async function updateSellerLocation(sellerName, location) {
  const locString = `${location.city}, ${location.state}`;

  const events = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_name=eq.${encodeURIComponent(sellerName)}&seller_location=is.null&select=id`
  );

  let updated = 0;
  for (const event of events) {
    await fetchJSON(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${event.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ seller_location: locString })
    });
    updated++;
  }

  // Update identity
  const identities = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/external_identities?platform=eq.bat&handle=eq.${encodeURIComponent(sellerName)}&select=id,metadata`
  );
  if (identities.length) {
    const identity = identities[0];
    const newMetadata = {
      ...identity.metadata,
      city: location.city,
      state: location.state,
      country: 'USA',
      location_source: 'bat_listing',
      location_updated_at: new Date().toISOString()
    };
    await fetchJSON(`${SUPABASE_URL}/rest/v1/external_identities?id=eq.${identity.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: newMetadata })
    });
  }

  return updated;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  RETRY SELLERS - TRY DIFFERENT LISTINGS                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  let sellersFound = 0, totalEventsUpdated = 0, errors = 0;
  const foundSellers = new Set();

  try {
    const listings = await getSellersToRetry();
    console.log(`Trying ${listings.length} listings from sellers without location\n`);

    for (const listing of listings) {
      // Skip if we already found this seller's location
      if (foundSellers.has(listing.seller_name)) continue;

      const location = await extractLocation(page, listing.source_url);

      if (location) {
        const updated = await updateSellerLocation(listing.seller_name, location);
        sellersFound++;
        totalEventsUpdated += updated;
        foundSellers.add(listing.seller_name);
        console.log(`  ✓ ${listing.seller_name} → ${location.city}, ${location.state} (${updated} events)`);
      } else {
        errors++;
      }

      await page.waitForTimeout(1500);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`COMPLETE`);
    console.log(`  New sellers found: ${sellersFound}`);
    console.log(`  Total events updated: ${totalEventsUpdated}`);
    console.log(`  Still no location: ${errors}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
