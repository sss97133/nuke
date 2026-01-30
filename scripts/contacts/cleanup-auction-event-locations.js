#!/usr/bin/env node
/**
 * Cleanup Bad Auction Event Location Data
 *
 * Clears invalid seller_location from auction_events
 * where the "state" part is not a valid US state abbreviation
 *
 * Usage: dotenvx run -- node scripts/contacts/cleanup-auction-event-locations.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

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
  return res.json();
}

async function getEventsWithLocation(offset = 0, limit = 200) {
  return fetchJSON(
    `${SUPABASE_URL}/rest/v1/auction_events?seller_location=not.is.null&select=id,seller_name,seller_location&offset=${offset}&limit=${limit}`
  );
}

async function clearLocation(eventId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${eventId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ seller_location: null })
  });
  return res.ok;
}

function isValidLocation(location) {
  if (!location || typeof location !== 'string') return false;

  // Should be "City, ST" format
  const parts = location.split(',').map(s => s.trim());
  if (parts.length !== 2) return false;

  const [city, state] = parts;

  // Check if state is a valid 2-letter abbreviation
  if (!VALID_STATES.has(state.toUpperCase())) return false;

  // City should be reasonable
  if (city.length > 30) return false;
  if (city.length < 2) return false;

  // Reject obvious bad patterns
  const badPatterns = ['leather', 'cloth', 'interior', 'gray', 'black', 'tan',
                       'lounge', 'bidding', 'trim', 'paint', 'engine', 'wheel'];
  const cityLower = city.toLowerCase();
  for (const pattern of badPatterns) {
    if (cityLower.includes(pattern)) return false;
  }

  return true;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANUP AUCTION EVENT LOCATIONS                             ║');
  console.log('║  Removing invalid seller_location values                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let totalChecked = 0;
  let totalCleaned = 0;
  let totalValid = 0;
  let offset = 0;

  while (true) {
    const events = await getEventsWithLocation(offset, 200);

    if (!events.length) {
      console.log('\nNo more events to check');
      break;
    }

    console.log(`\nChecking batch at offset ${offset} (${events.length} events)...`);

    for (const event of events) {
      totalChecked++;

      if (isValidLocation(event.seller_location)) {
        totalValid++;
        if (totalValid <= 5) {
          console.log(`  ✓ Valid: ${event.seller_name || 'unknown'} → ${event.seller_location}`);
        }
      } else {
        // Bad location - clear it
        const ok = await clearLocation(event.id);
        if (ok) {
          totalCleaned++;
          console.log(`  ✗ Cleared: "${event.seller_location}" (${event.seller_name || 'unknown'})`);
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 30));
    }

    offset += 200;

    // Safety limit
    if (offset > 5000) {
      console.log('\nReached safety limit');
      break;
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Checked: ${totalChecked}`);
  console.log(`  Valid locations: ${totalValid}`);
  console.log(`  Cleaned bad data: ${totalCleaned}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
