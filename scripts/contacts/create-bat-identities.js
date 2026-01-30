#!/usr/bin/env node
/**
 * Create External Identities from BaT Sellers
 * Creates claimable user identities from BaT seller usernames
 *
 * These identities can be "claimed" when users sign up and verify
 * they own the BaT account.
 *
 * Usage: dotenvx run -- node scripts/contacts/create-bat-identities.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getSellersDirect() {
  const sellers = new Map(); // username -> { count, first_seen, last_seen }
  let offset = 0;
  const limit = 1000;

  console.log('Fetching seller data from auction_comments...');

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auction_comments?select=author_username,posted_at&is_seller=eq.true&limit=${limit}&offset=${offset}`,
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
      if (!row.author_username) return;

      const username = row.author_username;
      const postedAt = new Date(row.posted_at);

      if (sellers.has(username)) {
        const existing = sellers.get(username);
        existing.count++;
        if (postedAt < existing.first_seen) existing.first_seen = postedAt;
        if (postedAt > existing.last_seen) existing.last_seen = postedAt;
      } else {
        sellers.set(username, {
          count: 1,
          first_seen: postedAt,
          last_seen: postedAt
        });
      }
    });

    if (offset % 50000 === 0) {
      console.log(`  Processed ${offset + data.length} rows, ${sellers.size} unique sellers`);
    }

    if (data.length < limit) break;
    offset += limit;
  }

  console.log(`  Total: ${sellers.size} unique sellers\n`);
  return sellers;
}

async function createExternalIdentity(username, data) {
  const payload = {
    platform: 'bat',
    handle: username,
    profile_url: `https://bringatrailer.com/member/${username}/`,
    display_name: null,
    claimed_by_user_id: null,
    claimed_at: null,
    claim_confidence: 0,
    first_seen_at: data.first_seen.toISOString(),
    last_seen_at: data.last_seen.toISOString(),
    metadata: {
      seller_comment_count: data.count,
      source: 'bulk_import',
      imported_at: new Date().toISOString()
    }
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/external_identities`, {
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

async function getExistingIdentities() {
  const existing = new Set();
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/external_identities?select=handle&platform=eq.bat&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;

    data.forEach(row => existing.add(row.handle));

    if (data.length < limit) break;
    offset += limit;
  }

  return existing;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BAT EXTERNAL IDENTITY CREATION                              ║');
  console.log('║  Creating claimable user profiles from BaT sellers           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Get existing to avoid duplicates
  console.log('Checking existing external identities...');
  const existing = await getExistingIdentities();
  console.log(`  Found ${existing.size} existing BaT identities\n`);

  // Get sellers from our data
  const sellers = await getSellersDirect();

  // Filter out already existing
  const newSellers = [];
  for (const [username, data] of sellers) {
    if (!existing.has(username)) {
      newSellers.push({ username, ...data });
    }
  }

  console.log(`New identities to create: ${newSellers.length}\n`);

  // Sort by comment count (most active first)
  newSellers.sort((a, b) => b.count - a.count);

  let created = 0, errors = 0;

  for (const seller of newSellers) {
    const ok = await createExternalIdentity(seller.username, seller);

    if (ok) {
      created++;
      if (created <= 20 || created % 500 === 0) {
        console.log(`  ✓ ${seller.username} (${seller.count} seller comments)`);
      }
    } else {
      errors++;
    }

    // Rate limit
    if (created % 100 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`COMPLETE`);
  console.log(`  New identities created: ${created}`);
  console.log(`  Already existed: ${existing.size}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total BaT identities: ${existing.size + created}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(console.error);
