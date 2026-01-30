#!/usr/bin/env node
/**
 * Extract BaT Sellers from Our Data
 * Creates contact leads from seller usernames in auction_comments
 *
 * Usage: dotenvx run -- node scripts/contacts/extract-bat-sellers.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getUniqueSellers() {
  // Get unique seller usernames from comments where is_seller=true
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_unique_sellers`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    }
  );

  if (!res.ok) {
    // Fallback to direct query if RPC doesn't exist
    console.log('RPC not available, using direct query...');
    return await getSellersDirect();
  }

  return await res.json();
}

async function getSellersDirect() {
  // Get sellers with pagination
  const sellers = new Set();
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auction_comments?select=author_username&is_seller=eq.true&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await res.json();
    if (!data.length) break;

    data.forEach(row => {
      if (row.author_username) sellers.add(row.author_username);
    });

    console.log(`  Fetched ${offset + data.length} rows, ${sellers.size} unique sellers`);

    if (data.length < limit) break;
    offset += limit;
  }

  return [...sellers].map(username => ({ author_username: username }));
}

async function saveSellerLead(username) {
  // Check if looks like a dealer (company-like name)
  const isDealer = /motors?|cars?|auto|classics?|euro|import|vintage/i.test(username);

  const payload = {
    lead_type: 'person',
    lead_name: `BaT Seller: ${username}`,
    lead_url: `https://bringatrailer.com/member/${username}/`,
    lead_description: `Bring a Trailer ${isDealer ? 'dealer' : 'seller'}. Username: ${username}`,
    discovered_from_type: 'manual',
    discovered_from_url: 'https://bringatrailer.com',
    discovery_method: 'internal_data',
    confidence_score: 0.8,
    status: 'pending',
    raw_data: {
      username,
      platform: 'bringatrailer',
      is_likely_dealer: isDealer,
      source: 'auction_comments'
    }
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/discovery_leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BAT SELLER EXTRACTION                                       ║');
  console.log('║  Source: auction_comments (is_seller=true)                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Fetching unique sellers...');
  const sellers = await getSellersDirect();

  console.log(`\nFound ${sellers.length} unique sellers\n`);

  let saved = 0, errors = 0, dealers = 0;

  for (const row of sellers) {
    const username = row.author_username;
    if (!username) continue;

    const isDealer = /motors?|cars?|auto|classics?|euro|import|vintage|garage|collection/i.test(username);
    if (isDealer) dealers++;

    const ok = await saveSellerLead(username);

    if (ok) {
      saved++;
      if (saved <= 10 || saved % 50 === 0) {
        console.log(`  ✓ ${username}${isDealer ? ' (dealer)' : ''}`);
      }
    } else {
      errors++;
    }

    // Small delay
    if (saved % 100 === 0) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  Total sellers: ${sellers.length}`);
  console.log(`  Saved: ${saved}`);
  console.log(`  Likely dealers: ${dealers}`);
  console.log(`  Errors: ${errors}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
