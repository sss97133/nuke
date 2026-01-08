#!/usr/bin/env node
/**
 * Script to identify and cleanup fake/invalid organizations created by process-import-queue
 * 
 * Usage:
 *   node scripts/identify-and-cleanup-fake-orgs.js [--cleanup] [--dry-run]
 * 
 * Options:
 *   --cleanup    Actually delete fake organizations (default is identify only)
 *   --dry-run    Dry run mode (default, won't delete anything)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function identifyFakeOrgs() {
  console.log('🔍 Identifying fake organizations from import_queue...\n');

  const { data, error } = await supabase
    .from('businesses')
    .select('id, business_name, website, discovered_via, source_url, created_at')
    .eq('discovered_via', 'import_queue')
    .or('business_name.is.null,business_name.lt.3')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('❌ Error identifying fake orgs:', error);
    return [];
  }

  // Filter for invalid patterns
  const fakeOrgs = (data || []).filter(org => {
    if (!org.business_name) return true;
    if (org.business_name.trim().length < 3) return true;
    if (/^https?:\/\//i.test(org.business_name)) return true;
    if (org.website && !/^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(org.website)) return true;
    return false;
  });

  // Group by issue type
  const issues = {
    null_name: fakeOrgs.filter(o => !o.business_name),
    too_short: fakeOrgs.filter(o => o.business_name && o.business_name.trim().length < 3),
    name_contains_url: fakeOrgs.filter(o => o.business_name && /^https?:\/\//i.test(o.business_name)),
    invalid_website: fakeOrgs.filter(o => o.website && !/^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(o.website)),
  };

  console.log('📊 Fake Organizations Found:');
  console.log(`   Total: ${fakeOrgs.length}`);
  console.log(`   - Null name: ${issues.null_name.length}`);
  console.log(`   - Too short (< 3 chars): ${issues.too_short.length}`);
  console.log(`   - Name contains URL: ${issues.name_contains_url.length}`);
  console.log(`   - Invalid website: ${issues.invalid_website.length}\n`);

  if (fakeOrgs.length > 0) {
    console.log('📋 Sample fake organizations (first 10):');
    fakeOrgs.slice(0, 10).forEach((org, i) => {
      console.log(`   ${i + 1}. ID: ${org.id}`);
      console.log(`      Name: ${org.business_name || '(null)'}`);
      console.log(`      Website: ${org.website || '(null)'}`);
      console.log(`      Created: ${org.created_at}`);
      console.log('');
    });
  }

  return fakeOrgs;
}

async function checkDependencies(orgId) {
  const [contributors, vehicles, images, team, ownership, roles] = await Promise.all([
    supabase.from('organization_contributors').select('id').eq('organization_id', orgId).limit(1),
    supabase.from('organization_vehicles').select('id').eq('organization_id', orgId).eq('status', 'active').limit(1),
    supabase.from('organization_images').select('id').eq('organization_id', orgId).limit(1),
    supabase.from('business_team_data').select('id').eq('business_id', orgId).limit(1),
    supabase.from('business_ownership').select('id').eq('business_id', orgId).limit(1),
    supabase.from('business_user_roles').select('id').eq('business_id', orgId).limit(1),
  ]);

  return {
    hasContributors: (contributors.data?.length || 0) > 0,
    hasVehicles: (vehicles.data?.length || 0) > 0,
    hasImages: (images.data?.length || 0) > 0,
    hasTeam: (team.data?.length || 0) > 0,
    hasOwnership: (ownership.data?.length || 0) > 0,
    hasRoles: (roles.data?.length || 0) > 0,
  };
}

async function cleanupFakeOrgs(dryRun = true) {
  console.log(dryRun ? '🧪 DRY RUN: Checking which organizations can be safely deleted...\n' : '🗑️  DELETING fake organizations...\n');

  const fakeOrgs = await identifyFakeOrgs();

  if (fakeOrgs.length === 0) {
    console.log('✅ No fake organizations found!');
    return;
  }

  console.log(`\n🔍 Checking dependencies for ${fakeOrgs.length} organizations...\n`);

  const safeToDelete = [];
  const hasDependencies = [];

  for (const org of fakeOrgs) {
    const deps = await checkDependencies(org.id);
    const hasAnyDeps = Object.values(deps).some(v => v);

    if (hasAnyDeps) {
      hasDependencies.push({ org, deps });
    } else {
      safeToDelete.push(org);
    }
  }

  console.log(`📊 Results:`);
  console.log(`   Safe to delete: ${safeToDelete.length}`);
  console.log(`   Has dependencies: ${hasDependencies.length}\n`);

  if (hasDependencies.length > 0) {
    console.log('⚠️  Organizations with dependencies (will NOT be deleted):');
    hasDependencies.slice(0, 5).forEach(({ org, deps }) => {
      console.log(`   - ${org.id}: ${org.business_name || '(null)'}`);
      const depList = Object.entries(deps)
        .filter(([_, has]) => has)
        .map(([name]) => name.replace('has', ''))
        .join(', ');
      if (depList) console.log(`     Dependencies: ${depList}`);
    });
    console.log('');
  }

  if (safeToDelete.length === 0) {
    console.log('✅ No organizations are safe to delete (all have dependencies)');
    return;
  }

  if (dryRun) {
    console.log(`🧪 DRY RUN: Would delete ${safeToDelete.length} organizations:`);
    safeToDelete.slice(0, 10).forEach(org => {
      console.log(`   - ${org.id}: ${org.business_name || '(null)'} (${org.website || 'no website'})`);
    });
    if (safeToDelete.length > 10) {
      console.log(`   ... and ${safeToDelete.length - 10} more`);
    }
    console.log('\n💡 Run with --cleanup to actually delete these organizations.');
  } else {
    console.log(`🗑️  Deleting ${safeToDelete.length} organizations...`);
    
    const idsToDelete = safeToDelete.map(o => o.id);
    
    // Delete in batches to avoid overwhelming the database
    const batchSize = 50;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      const { error } = await supabase
        .from('businesses')
        .delete()
        .in('id', batch);

      if (error) {
        console.error(`❌ Error deleting batch ${Math.floor(i / batchSize) + 1}:`, error);
      } else {
        console.log(`✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} organizations`);
      }
    }

    console.log(`\n✅ Cleanup complete! Deleted ${idsToDelete.length} fake organizations.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldCleanup = args.includes('--cleanup');
  const dryRun = !args.includes('--no-dry-run');

  if (shouldCleanup) {
    await cleanupFakeOrgs(dryRun);
  } else {
    await identifyFakeOrgs();
    console.log('\n💡 Run with --cleanup to delete fake organizations (use --no-dry-run to actually delete).');
  }
}

main().catch(console.error);

