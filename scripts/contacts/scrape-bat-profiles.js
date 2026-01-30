#!/usr/bin/env node
/**
 * Scrape BaT User Profiles for Location
 *
 * BaT member profiles at bringatrailer.com/member/{username}/
 * have location info that we can extract.
 *
 * Usage: dotenvx run -- node scripts/contacts/scrape-bat-profiles.js [limit]
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

const STATE_NAMES = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC'
};

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

async function getSellersWithoutLocation() {
  // Get sellers with location
  const withLoc = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_name=not.is.null&seller_location=not.is.null&select=seller_name`
  );
  const sellersWithLoc = new Set(withLoc.map(e => e.seller_name));

  // Get unique sellers without location
  const withoutLoc = await fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_name=not.is.null&seller_location=is.null&select=seller_name`
  );

  const uniqueSellers = [...new Set(withoutLoc.map(e => e.seller_name))]
    .filter(name => !sellersWithLoc.has(name) && name !== 'Unknown');

  return uniqueSellers.slice(0, LIMIT);
}

function parseLocation(locationText) {
  if (!locationText) return null;

  // Clean up the text
  let text = locationText.trim();

  // Remove ", United States" or similar country suffix
  text = text.replace(/,?\s*(United States|USA|US)$/i, '').trim();

  // Just state code (e.g., "GA" or "CA")
  if (/^[A-Z]{2}$/.test(text)) {
    if (VALID_STATES.has(text)) {
      return { city: null, state: text };
    }
  }

  // "City, ST" format
  const cityStateMatch = text.match(/^([A-Za-z\s]+),\s*([A-Z]{2})$/);
  if (cityStateMatch) {
    let city = cityStateMatch[1].trim();
    const state = cityStateMatch[2];
    if (VALID_STATES.has(state)) {
      city = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      return { city, state };
    }
  }

  // "City, State Name" format
  const cityStateNameMatch = text.match(/^([A-Za-z\s]+),\s*([A-Za-z\s]+)$/);
  if (cityStateNameMatch) {
    let city = cityStateNameMatch[1].trim();
    const stateName = cityStateNameMatch[2].trim().toLowerCase();
    const state = STATE_NAMES[stateName];
    if (state) {
      city = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      return { city, state };
    }
  }

  return null;
}

async function extractProfileLocation(page, username) {
  try {
    const url = `https://bringatrailer.com/member/${encodeURIComponent(username)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    // Extract location from profile
    const location = await page.evaluate(() => {
      // Look for "Location:" label followed by <br> then <p>
      const html = document.body.innerHTML;
      const match = html.match(/<strong>Location:<\/strong><br\s*\/?>\s*<p>([^<]+)<\/p>/i);
      if (match) {
        return match[1].trim();
      }

      // Fallback: look in page text
      const text = document.body.innerText;
      const textMatch = text.match(/Location:\s*\n?\s*([A-Z]{2}),?\s*(United States)?/);
      if (textMatch) {
        return textMatch[1];
      }

      return null;
    });

    if (location) {
      return parseLocation(location);
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function updateSellerLocation(sellerName, location) {
  const locString = location.city
    ? `${location.city}, ${location.state}`
    : location.state;

  // Update all auction_events for this seller
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

  // Update external_identity if exists
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
      location_source: 'bat_profile',
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
  console.log('║  SCRAPE BAT PROFILES FOR LOCATION                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  let sellersFound = 0, totalEventsUpdated = 0, noLocation = 0;

  try {
    const sellers = await getSellersWithoutLocation();
    console.log(`Checking ${sellers.length} seller profiles for location\n`);

    for (const seller of sellers) {
      const location = await extractProfileLocation(page, seller);

      if (location) {
        const updated = await updateSellerLocation(seller, location);
        sellersFound++;
        totalEventsUpdated += updated;
        const locStr = location.city ? `${location.city}, ${location.state}` : location.state;
        console.log(`  ✓ ${seller} → ${locStr} (${updated} events)`);
      } else {
        noLocation++;
      }

      await page.waitForTimeout(1000);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`COMPLETE`);
    console.log(`  Sellers with location found: ${sellersFound}`);
    console.log(`  Total events updated: ${totalEventsUpdated}`);
    console.log(`  No location on profile: ${noLocation}`);
    console.log(`════════════════════════════════════════`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
