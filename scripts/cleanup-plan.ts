#!/usr/bin/env npx tsx
/**
 * CLEANUP PLAN - Based on Code-Simplifier Methodology
 *
 * Approach:
 * 1. Identify high-impact cleanup targets
 * 2. Batch related fixes together
 * 3. Run cleanup in priority order
 * 4. Verify each phase before moving on
 *
 * Run: dotenvx run -- npx tsx scripts/cleanup-plan.ts [phase]
 * Phases: audit | data | orgs | images | queues | all
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const phase = process.argv[2] || 'audit';

async function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ============================================================================
// PHASE 1: AUDIT - Identify what needs cleanup
// ============================================================================

async function auditPhase() {
  log('=== PHASE 1: AUDIT ===');

  const issues: { category: string; issue: string; count: number; sql?: string }[] = [];

  // 1. Vehicles missing make
  const { count: noMake } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.is.null,make.eq.');
  issues.push({ category: 'data', issue: 'Vehicles missing make', count: noMake || 0 });

  // 2. Orphaned images
  const { count: orphanedImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .is('vehicle_id', null);
  issues.push({ category: 'images', issue: 'Orphaned images (null vehicle_id)', count: orphanedImages || 0 });

  // 3. Test/dummy vehicles
  const { count: testVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.ilike.%test%,model.ilike.%test%,make.ilike.%dummy%,model.ilike.%asdf%');
  issues.push({ category: 'data', issue: 'Test/dummy vehicles', count: testVehicles || 0 });

  // 4. Invalid years
  const { count: badYears } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('year.lt.1885,year.gt.2030');
  issues.push({ category: 'data', issue: 'Invalid year values', count: badYears || 0 });

  // 5. Suspicious prices
  const { count: badPrices } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .not('sale_price', 'is', null)
    .or('sale_price.lt.100,sale_price.gt.50000000');
  issues.push({ category: 'data', issue: 'Suspicious prices (<$100 or >$50M)', count: badPrices || 0 });

  // 6. Duplicate org names
  const { data: orgNames } = await supabase
    .from('businesses')
    .select('business_name')
    .not('business_name', 'is', null)
    .limit(10000);

  const nameCounts = new Map<string, number>();
  for (const o of orgNames || []) {
    if (o.business_name) {
      const name = o.business_name.toLowerCase().trim();
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }
  const duplicateOrgs = [...nameCounts.entries()].filter(([_, c]) => c > 1);
  issues.push({ category: 'orgs', issue: 'Duplicate org names', count: duplicateOrgs.length });

  // 7. Failed imports
  const { count: failedImports } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed');
  issues.push({ category: 'queues', issue: 'Failed imports', count: failedImports || 0 });

  // 8. Pending imports
  const { count: pendingImports } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  issues.push({ category: 'queues', issue: 'Pending imports (backlog)', count: pendingImports || 0 });

  // Print summary
  log('\nCLEANUP TARGETS:');
  log('─'.repeat(60));

  const byCategory = new Map<string, typeof issues>();
  for (const i of issues) {
    const list = byCategory.get(i.category) || [];
    list.push(i);
    byCategory.set(i.category, list);
  }

  for (const [cat, items] of byCategory) {
    log(`\n${cat.toUpperCase()}:`);
    for (const item of items) {
      const status = item.count === 0 ? '✅' : item.count < 100 ? '🟡' : '🔴';
      log(`  ${status} ${item.issue}: ${item.count.toLocaleString()}`);
    }
  }

  return issues;
}

// ============================================================================
// PHASE 2: DATA CLEANUP - Fix vehicle data issues
// ============================================================================

async function dataCleanupPhase() {
  log('=== PHASE 2: DATA CLEANUP ===');

  // 2a. Delete test/dummy vehicles
  log('\n[2a] Finding test/dummy vehicles...');
  const { data: testVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('make.ilike.%test%,model.ilike.%test%,make.ilike.%dummy%,model.ilike.%asdf%')
    .limit(50);

  if (testVehicles && testVehicles.length > 0) {
    log(`Found ${testVehicles.length} test vehicles (showing first 10):`);
    for (const v of testVehicles.slice(0, 10)) {
      log(`  - ${v.year} ${v.make} ${v.model} (${v.id})`);
    }
    log('\nTo delete: Run with --execute flag');
    // Actual deletion would go here with --execute flag
  } else {
    log('No test vehicles found ✅');
  }

  // 2b. Fix invalid years
  log('\n[2b] Finding invalid years...');
  const { data: badYearVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('year.lt.1885,year.gt.2030')
    .limit(50);

  if (badYearVehicles && badYearVehicles.length > 0) {
    log(`Found ${badYearVehicles.length} vehicles with invalid years:`);
    for (const v of badYearVehicles.slice(0, 10)) {
      log(`  - ${v.year} ${v.make} ${v.model} (${v.id})`);
    }
  } else {
    log('No invalid years found ✅');
  }

  // 2c. Find vehicles missing make (try to infer from model/description)
  log('\n[2c] Finding vehicles missing make...');
  const { data: noMakeVehicles, count: noMakeCount } = await supabase
    .from('vehicles')
    .select('id, year, model, description', { count: 'exact' })
    .or('make.is.null,make.eq.')
    .limit(20);

  if (noMakeVehicles && noMakeVehicles.length > 0) {
    log(`Found ${noMakeCount} vehicles missing make (showing first 10):`);
    for (const v of noMakeVehicles.slice(0, 10)) {
      const desc = (v.description || '').slice(0, 50);
      log(`  - ${v.year} [no make] ${v.model} - "${desc}..." (${v.id})`);
    }
  } else {
    log('All vehicles have make ✅');
  }
}

// ============================================================================
// PHASE 3: ORG CLEANUP - Merge duplicate organizations
// ============================================================================

async function orgCleanupPhase() {
  log('=== PHASE 3: ORG CLEANUP ===');

  // Find duplicate org names
  const { data: orgs } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, created_at')
    .not('business_name', 'is', null)
    .order('business_name');

  const byName = new Map<string, any[]>();
  for (const o of orgs || []) {
    const name = (o.business_name || '').toLowerCase().trim();
    const list = byName.get(name) || [];
    list.push(o);
    byName.set(name, list);
  }

  const duplicates = [...byName.entries()].filter(([_, list]) => list.length > 1);

  log(`\nFound ${duplicates.length} duplicate org names:\n`);

  for (const [name, list] of duplicates.slice(0, 10)) {
    log(`"${name}" (${list.length} copies):`);
    for (const o of list) {
      const website = o.website ? ` - ${o.website}` : '';
      log(`  - ${o.id}${website} (created ${o.created_at?.slice(0, 10)})`);
    }
    log('');
  }

  log('Merge strategy: Keep oldest, update references, delete duplicates');
  log('To execute: Run auto-merge-duplicate-orgs edge function');
}

// ============================================================================
// PHASE 4: IMAGE CLEANUP - Handle orphaned images
// ============================================================================

async function imageCleanupPhase() {
  log('=== PHASE 4: IMAGE CLEANUP ===');

  // Find orphaned images
  const { data: orphanedImages, count } = await supabase
    .from('vehicle_images')
    .select('id, url, created_at', { count: 'exact' })
    .is('vehicle_id', null)
    .limit(20);

  log(`\nFound ${count} orphaned images (null vehicle_id)`);

  if (orphanedImages && orphanedImages.length > 0) {
    log('\nSample orphaned images:');
    for (const img of orphanedImages.slice(0, 10)) {
      const urlShort = img.url?.slice(0, 60) || 'no url';
      log(`  - ${img.id}: ${urlShort}...`);
    }
  }

  log('\nCleanup options:');
  log('1. Delete orphaned images older than 30 days');
  log('2. Try to match orphaned images to vehicles by URL/filename');
  log('3. Move to archive table');
}

// ============================================================================
// PHASE 5: QUEUE CLEANUP - Process stuck imports
// ============================================================================

async function queueCleanupPhase() {
  log('=== PHASE 5: QUEUE CLEANUP ===');

  // Analyze failed imports
  const { data: failedImports } = await supabase
    .from('import_queue')
    .select('id, url, error_message, created_at, source')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(50);

  // Group by error type
  const errorCounts = new Map<string, number>();
  for (const imp of failedImports || []) {
    const error = (imp.error_message || 'unknown').slice(0, 50);
    errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
  }

  log('\nFailed import error breakdown:');
  const sortedErrors = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [error, count] of sortedErrors.slice(0, 10)) {
    log(`  ${count}x: ${error}`);
  }

  // Analyze pending imports age
  const { data: oldestPending } = await supabase
    .from('import_queue')
    .select('id, url, created_at, source')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  log('\nOldest pending imports:');
  for (const imp of oldestPending || []) {
    const age = Math.floor((Date.now() - new Date(imp.created_at).getTime()) / (1000 * 60 * 60 * 24));
    log(`  - ${age} days old: ${imp.source || 'unknown'} - ${imp.url?.slice(0, 50)}`);
  }

  log('\nCleanup options:');
  log('1. Retry failed imports with transient errors');
  log('2. Delete permanently failed imports (invalid URLs, 404s)');
  log('3. Process pending queue with batch worker');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log(`Starting cleanup plan - Phase: ${phase}`);
  log('─'.repeat(60));

  switch (phase) {
    case 'audit':
      await auditPhase();
      break;
    case 'data':
      await dataCleanupPhase();
      break;
    case 'orgs':
      await orgCleanupPhase();
      break;
    case 'images':
      await imageCleanupPhase();
      break;
    case 'queues':
      await queueCleanupPhase();
      break;
    case 'all':
      await auditPhase();
      await dataCleanupPhase();
      await orgCleanupPhase();
      await imageCleanupPhase();
      await queueCleanupPhase();
      break;
    default:
      log(`Unknown phase: ${phase}`);
      log('Available phases: audit | data | orgs | images | queues | all');
  }

  log('\n' + '─'.repeat(60));
  log('Cleanup plan complete. Review findings and run with --execute to apply fixes.');
}

main().catch(console.error);
