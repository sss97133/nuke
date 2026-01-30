#!/usr/bin/env node
/**
 * Create External Identities from ALL BaT Users
 * Includes sellers, bidders, and commenters
 *
 * Usage: dotenvx run -- node scripts/contacts/create-all-bat-identities.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAllUsers() {
  const users = new Map(); // username -> { comment_count, bid_count, is_seller, first_seen, last_seen }
  let offset = 0;
  const limit = 1000;

  console.log('Fetching ALL user data from auction_comments...');

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auction_comments?select=author_username,posted_at,is_seller,comment_type&author_username=not.is.null&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;

    data.forEach(row => {
      const username = row.author_username;
      if (!username) return;

      const postedAt = new Date(row.posted_at);
      const isBid = row.comment_type === 'bid';

      if (users.has(username)) {
        const u = users.get(username);
        u.total_count++;
        if (isBid) u.bid_count++;
        else u.comment_count++;
        if (row.is_seller) u.is_seller = true;
        if (postedAt < u.first_seen) u.first_seen = postedAt;
        if (postedAt > u.last_seen) u.last_seen = postedAt;
      } else {
        users.set(username, {
          total_count: 1,
          comment_count: isBid ? 0 : 1,
          bid_count: isBid ? 1 : 0,
          is_seller: row.is_seller || false,
          first_seen: postedAt,
          last_seen: postedAt
        });
      }
    });

    if (offset % 100000 === 0) {
      console.log(`  Processed ${offset + data.length} rows, ${users.size} unique users`);
    }

    if (data.length < limit) break;
    offset += limit;
  }

  console.log(`  Total: ${users.size} unique users\n`);
  return users;
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
      total_activity: data.total_count,
      comment_count: data.comment_count,
      bid_count: data.bid_count,
      is_seller: data.is_seller,
      source: 'bulk_import_all_users',
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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BAT USER IDENTITY CREATION (ALL USERS)                      ║');
  console.log('║  Sellers, Bidders, and Commenters                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Get existing
  console.log('Checking existing external identities...');
  const existing = await getExistingIdentities();
  console.log(`  Found ${existing.size} existing BaT identities\n`);

  // Get all users
  const users = await getAllUsers();

  // Stats
  let sellers = 0, bidders = 0, commenters = 0;
  for (const [_, data] of users) {
    if (data.is_seller) sellers++;
    if (data.bid_count > 0) bidders++;
    if (data.comment_count > 0) commenters++;
  }
  console.log(`User breakdown:`);
  console.log(`  Sellers: ${sellers}`);
  console.log(`  Bidders: ${bidders}`);
  console.log(`  Commenters: ${commenters}\n`);

  // Filter new users
  const newUsers = [];
  for (const [username, data] of users) {
    if (!existing.has(username)) {
      newUsers.push({ username, ...data });
    }
  }

  console.log(`New identities to create: ${newUsers.length}\n`);

  // Sort by activity (most active first)
  newUsers.sort((a, b) => b.total_count - a.total_count);

  let created = 0, errors = 0;

  for (const user of newUsers) {
    const ok = await createExternalIdentity(user.username, user);

    if (ok) {
      created++;
      if (created <= 20 || created % 1000 === 0) {
        const type = user.is_seller ? 'seller' : (user.bid_count > 0 ? 'bidder' : 'commenter');
        console.log(`  ✓ ${user.username} (${type}, ${user.total_count} activity)`);
      }
    } else {
      errors++;
    }

    // Rate limit
    if (created % 100 === 0) {
      await new Promise(r => setTimeout(r, 100));
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
