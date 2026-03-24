#!/usr/bin/env node
/**
 * Phase 3: Supplier Inventory Monitoring
 *
 * Three monitoring loops:
 * A. Website re-scrape — set next_run_at for weekly re-sync on all FB-sourced orgs
 * B. FB Marketplace re-sweep — flag known supplier listings in sweeps
 * C. FB Saved re-pull — diff new saves against existing fb_saved_items
 *
 * Usage:
 *   dotenvx run -- node scripts/monitor-supplier-inventory.mjs [--loop A|B|C|all] [--dry-run]
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const loopIdx = args.indexOf('--loop');
const LOOP = loopIdx >= 0 ? args[loopIdx + 1].toUpperCase() : 'ALL';

const BASE = SUPABASE_URL.replace(/\/$/, '');
const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
};

async function pgQuery(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  return res.json();
}

async function pgPatch(table, filter, updates) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

async function pgInsert(table, rows) {
  const res = await fetch(`${BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  return res.ok;
}

// ── Loop A: Website Re-Scrape Scheduling ──

async function loopA() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Loop A: Website Re-Scrape Scheduling    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Get all FB-sourced orgs that have sync queue entries
  const syncJobs = await pgQuery(
    `${BASE}/rest/v1/organization_inventory_sync_queue?select=id,organization_id,status,next_run_at,last_run_at,businesses!inner(business_name,discovered_via)&businesses.discovered_via=eq.facebook_saved_reels`
  );

  console.log(`Found ${syncJobs.length} sync queue entries for FB suppliers\n`);

  const now = new Date();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  let scheduled = 0;

  for (const job of syncJobs) {
    const lastRun = job.last_run_at ? new Date(job.last_run_at) : null;
    const nextRun = job.next_run_at ? new Date(job.next_run_at) : null;
    const orgName = job.businesses?.business_name || job.organization_id;

    // If completed and not scheduled for re-sync, schedule weekly
    if (job.status === 'completed' && (!nextRun || nextRun < now)) {
      const newNext = new Date(now.getTime() + oneWeek);
      console.log(`  ${orgName}: scheduling re-sync for ${newNext.toISOString().split('T')[0]}`);

      if (!DRY_RUN) {
        await pgPatch('organization_inventory_sync_queue', `id=eq.${job.id}`, {
          status: 'pending',
          next_run_at: newNext.toISOString(),
        });
      }
      scheduled++;
    } else if (job.status === 'failed') {
      console.log(`  ${orgName}: FAILED — resetting to pending`);
      if (!DRY_RUN) {
        await pgPatch('organization_inventory_sync_queue', `id=eq.${job.id}`, {
          status: 'pending',
          next_run_at: new Date(now.getTime() + 60000).toISOString(), // retry in 1 min
        });
      }
      scheduled++;
    } else {
      const status = job.status;
      const nextStr = nextRun ? nextRun.toISOString().split('T')[0] : 'N/A';
      console.log(`  ${orgName}: ${status} (next: ${nextStr})`);
    }
  }

  // Also queue orgs that have websites but aren't in sync queue yet
  const orgsWithWebsites = await pgQuery(
    `${BASE}/rest/v1/businesses?discovered_via=eq.facebook_saved_reels&website=not.is.null&select=id,business_name`
  );

  const queuedOrgIds = new Set(syncJobs.map(j => j.organization_id));
  const unqueued = orgsWithWebsites.filter(o => !queuedOrgIds.has(o.id));

  if (unqueued.length > 0) {
    console.log(`\n  ${unqueued.length} enriched orgs not yet in sync queue:`);
    for (const org of unqueued) {
      console.log(`    + ${org.business_name}`);
      if (!DRY_RUN) {
        await pgInsert('organization_inventory_sync_queue', [{
          organization_id: org.id,
          run_mode: 'both',
          status: 'pending',
          next_run_at: now.toISOString(),
        }]);
      }
      scheduled++;
    }
  }

  console.log(`\n  Scheduled: ${scheduled}`);
  return scheduled;
}

// ── Loop B: FB Marketplace Supplier Matching ──

async function loopB() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Loop B: Marketplace Supplier Matching   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Get known supplier FB seller IDs
  const orgLinks = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?matched_organization_id=not.is.null&creator_fb_id=not.is.null&select=creator_fb_id,matched_organization_id&limit=500`
  );

  const supplierFBIds = new Map();
  for (const link of orgLinks) {
    supplierFBIds.set(link.creator_fb_id, link.matched_organization_id);
  }
  console.log(`Known supplier FB IDs: ${supplierFBIds.size}\n`);

  // Check marketplace_listings for matches
  // The fb-marketplace-local-scraper writes to marketplace_listings with fb_seller_id
  let recentListings = [];
  try {
    recentListings = await pgQuery(
      `${BASE}/rest/v1/marketplace_listings?created_at=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&fb_seller_id=not.is.null&select=id,title,fb_seller_id,listing_url,price&order=created_at.desc&limit=500`
    );
  } catch {
    console.log('  (marketplace_listings query failed — table may not exist or be empty)');
  }

  console.log(`Recent marketplace listings with seller IDs: ${recentListings.length}\n`);

  let matched = 0;
  for (const listing of recentListings) {
    const orgId = supplierFBIds.get(listing.fb_seller_id);
    if (orgId) {
      console.log(`  ✓ Supplier match: "${listing.title}" ($${listing.price})`);
      matched++;
    }
  }

  // Check fb_marketplace_sellers for known supplier IDs (batch to avoid URL length limits)
  const supplierIds = [...supplierFBIds.keys()];
  let knownSellers = [];
  if (supplierIds.length > 0) {
    // Use smaller batches to avoid URL too long
    const batch = supplierIds.slice(0, 20);
    try {
      knownSellers = await pgQuery(
        `${BASE}/rest/v1/fb_marketplace_sellers?fb_user_id=in.(${batch.join(',')})&select=id,display_name,fb_user_id,listing_count,dealer_likelihood_score&limit=100`
      );
    } catch {
      console.log('  (fb_marketplace_sellers query failed)');
    }
  }

  if (knownSellers.length > 0) {
    console.log(`\n  Supplier seller profiles found: ${knownSellers.length}`);
    for (const seller of knownSellers) {
      console.log(`    ${seller.display_name}: ${seller.listing_count} listings, dealer score: ${seller.dealer_likelihood_score}`);
    }
  }

  console.log(`\n  Matched to suppliers: ${matched} / ${recentListings.length}`);
  return matched;
}

// ── Loop C: FB Saved Re-Pull Stats ──

async function loopC() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Loop C: FB Saved Items Status           ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Show current saved items breakdown
  const items = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?select=item_type,processing_status&limit=2000`
  );

  // Aggregate
  const counts = {};
  for (const item of items) {
    const key = `${item.item_type}|${item.processing_status}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  console.log('  Current saved items breakdown:');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sorted) {
    const [type, status] = key.split('|');
    console.log(`    ${type.padEnd(20)} ${status.padEnd(12)} ${count}`);
  }

  // Count unmatched items
  const unmatched = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?matched_organization_id=is.null&item_type=in.(Video,FBShorts)&select=id&limit=1000`
  );

  console.log(`\n  Unmatched reels/videos: ${unmatched.length}`);

  // Count supplier listings
  const supplierListings = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?is_supplier_listing=eq.true&select=id&limit=1000`
  );
  console.log(`  Supplier listings flagged: ${supplierListings.length}`);

  // Show recent import_queue activity for FB items
  const recentImports = await pgQuery(
    `${BASE}/rest/v1/import_queue?listing_url=like.*facebook.com*&select=status,listing_title&order=created_at.desc&limit=20`
  );

  if (recentImports.length > 0) {
    console.log(`\n  Recent FB import queue (${recentImports.length}):`);
    const importStats = {};
    for (const imp of recentImports) {
      importStats[imp.status] = (importStats[imp.status] || 0) + 1;
    }
    for (const [status, count] of Object.entries(importStats)) {
      console.log(`    ${status}: ${count}`);
    }
  }

  return items.length;
}

// ── Main ──

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Supplier Inventory Monitoring — Phase 3');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  MODE: DRY RUN\n');

  const results = {};

  if (LOOP === 'ALL' || LOOP === 'A') {
    results.websiteSync = await loopA();
  }
  if (LOOP === 'ALL' || LOOP === 'B') {
    results.marketplaceMatch = await loopB();
  }
  if (LOOP === 'ALL' || LOOP === 'C') {
    results.savedItemsStatus = await loopC();
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
