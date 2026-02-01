#!/usr/bin/env npx tsx
/**
 * EXECUTE CLEANUP - Actually fix the issues
 *
 * Run: dotenvx run -- npx tsx scripts/execute-cleanup.ts [action]
 * Actions: infer-makes | merge-orgs | fix-years | clear-failed-imports
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const action = process.argv[2] || 'help';
const dryRun = !process.argv.includes('--execute');

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ============================================================================
// ACTION: Infer makes from model names
// ============================================================================

const MODEL_TO_MAKE: Record<string, string> = {
  // Mercedes
  '560sl': 'Mercedes-Benz', '450sl': 'Mercedes-Benz', '380sl': 'Mercedes-Benz',
  '300sl': 'Mercedes-Benz', '190e': 'Mercedes-Benz', 'amg': 'Mercedes-Benz',
  'g-wagon': 'Mercedes-Benz', 'g wagon': 'Mercedes-Benz',

  // Porsche
  '911': 'Porsche', '912': 'Porsche', '914': 'Porsche', '924': 'Porsche',
  '928': 'Porsche', '930': 'Porsche', '944': 'Porsche', '959': 'Porsche',
  '964': 'Porsche', '993': 'Porsche', '996': 'Porsche', '997': 'Porsche',
  'carrera': 'Porsche', 'turbo s': 'Porsche', 'gt3': 'Porsche', 'gt2': 'Porsche',
  'boxster': 'Porsche', 'cayman': 'Porsche', 'cayenne': 'Porsche',
  'panamera': 'Porsche', 'taycan': 'Porsche', 'macan': 'Porsche',

  // Ferrari
  '308': 'Ferrari', '328': 'Ferrari', '348': 'Ferrari', '355': 'Ferrari',
  '360': 'Ferrari', '430': 'Ferrari', '458': 'Ferrari', '488': 'Ferrari',
  'testarossa': 'Ferrari', 'f40': 'Ferrari', 'f50': 'Ferrari',
  '599': 'Ferrari', '612': 'Ferrari', 'enzo': 'Ferrari', 'gto': 'Ferrari',

  // Chevrolet
  'c10': 'Chevrolet', 'c20': 'Chevrolet', 'c30': 'Chevrolet',
  'k5': 'Chevrolet', 'k10': 'Chevrolet', 'blazer': 'Chevrolet',
  'corvette': 'Chevrolet', 'camaro': 'Chevrolet', 'chevelle': 'Chevrolet',
  'impala': 'Chevrolet', 'nova': 'Chevrolet', 'el camino': 'Chevrolet',

  // Ford
  'mustang': 'Ford', 'bronco': 'Ford', 'f100': 'Ford', 'f150': 'Ford',
  'f250': 'Ford', 'thunderbird': 'Ford', 'falcon': 'Ford', 'gt40': 'Ford',

  // BMW
  '2002': 'BMW', 'e30': 'BMW', 'e36': 'BMW', 'e46': 'BMW', 'e90': 'BMW',
  'm3': 'BMW', 'm5': 'BMW', 'm6': 'BMW', 'z3': 'BMW', 'z4': 'BMW',

  // Audi
  'rs 6': 'Audi', 'rs6': 'Audi', 'rs4': 'Audi', 'r8': 'Audi', 'quattro': 'Audi',

  // Lamborghini
  'countach': 'Lamborghini', 'diablo': 'Lamborghini', 'murcielago': 'Lamborghini',
  'gallardo': 'Lamborghini', 'huracan': 'Lamborghini', 'aventador': 'Lamborghini',

  // Land Rover
  'defender': 'Land Rover', 'range rover': 'Land Rover', 'discovery': 'Land Rover',

  // Toyota
  'land cruiser': 'Toyota', 'fj40': 'Toyota', 'fj60': 'Toyota', 'fj80': 'Toyota',
  'supra': 'Toyota', '4runner': 'Toyota',

  // Nissan/Datsun
  '240z': 'Datsun', '260z': 'Datsun', '280z': 'Datsun', '300zx': 'Nissan',
  'skyline': 'Nissan', 'gtr': 'Nissan', 'gt-r': 'Nissan',
};

async function inferMakes() {
  log('=== INFER MAKES FROM MODEL NAMES ===');

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, model, description')
    .or('make.is.null,make.eq.')
    .limit(5000);

  if (!vehicles || vehicles.length === 0) {
    log('No vehicles missing make');
    return;
  }

  log(`Found ${vehicles.length} vehicles missing make`);

  const updates: { id: string; make: string; model: string }[] = [];

  for (const v of vehicles) {
    const modelLower = (v.model || '').toLowerCase();

    for (const [pattern, make] of Object.entries(MODEL_TO_MAKE)) {
      if (modelLower.includes(pattern)) {
        updates.push({ id: v.id, make, model: v.model });
        break;
      }
    }
  }

  log(`Can infer make for ${updates.length} vehicles`);

  // Group by inferred make
  const byMake = new Map<string, number>();
  for (const u of updates) {
    byMake.set(u.make, (byMake.get(u.make) || 0) + 1);
  }

  log('\nInferred makes:');
  for (const [make, count] of [...byMake.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${make}: ${count}`);
  }

  if (dryRun) {
    log('\n[DRY RUN] Would update these vehicles. Run with --execute to apply.');
    log('Sample updates:');
    for (const u of updates.slice(0, 10)) {
      log(`  ${u.model} → ${u.make}`);
    }
  } else {
    log('\nApplying updates...');
    let updated = 0;
    for (const u of updates) {
      const { error } = await supabase
        .from('vehicles')
        .update({ make: u.make })
        .eq('id', u.id);

      if (!error) updated++;
    }
    log(`Updated ${updated} vehicles`);
  }
}

// ============================================================================
// ACTION: Merge duplicate organizations
// ============================================================================

async function mergeOrgs() {
  log('=== MERGE DUPLICATE ORGANIZATIONS ===');

  const { data: orgs } = await supabase
    .from('businesses')
    .select('id, business_name, legal_name, website, created_at, description')
    .not('business_name', 'is', null)
    .order('created_at', { ascending: true });

  const byName = new Map<string, any[]>();
  for (const o of orgs || []) {
    const name = (o.business_name || '').toLowerCase().trim();
    const list = byName.get(name) || [];
    list.push(o);
    byName.set(name, list);
  }

  const duplicates = [...byName.entries()].filter(([_, list]) => list.length > 1);

  log(`Found ${duplicates.length} duplicate org name sets`);

  for (const [name, list] of duplicates) {
    log(`\n"${name}" - ${list.length} copies`);

    // Keep the oldest one (first created)
    const keep = list[0];
    const toDelete = list.slice(1);

    log(`  Keep: ${keep.id} (created ${keep.created_at?.slice(0, 10)})`);

    for (const del of toDelete) {
      log(`  Delete: ${del.id}`);

      if (!dryRun) {
        // Update any vehicle references
        await supabase
          .from('vehicles')
          .update({ seller_org_id: keep.id })
          .eq('seller_org_id', del.id);

        // Delete the duplicate
        await supabase
          .from('businesses')
          .delete()
          .eq('id', del.id);
      }
    }
  }

  if (dryRun) {
    log('\n[DRY RUN] Run with --execute to apply merges.');
  } else {
    log('\nMerges complete.');
  }
}

// ============================================================================
// ACTION: Fix invalid years
// ============================================================================

async function fixYears() {
  log('=== FIX INVALID YEARS ===');

  const { data: badYears } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('year.lt.1885,year.gt.2030')
    .limit(100);

  log(`Found ${badYears?.length || 0} vehicles with invalid years`);

  for (const v of badYears || []) {
    log(`  ${v.year} ${v.make} ${v.model} (${v.id})`);

    // Set year to null for clearly invalid values
    if (!dryRun && (v.year === 0 || v.year < 1885 || v.year > 2030)) {
      await supabase
        .from('vehicles')
        .update({ year: null })
        .eq('id', v.id);
    }
  }

  if (dryRun) {
    log('\n[DRY RUN] Run with --execute to set invalid years to null.');
  }
}

// ============================================================================
// ACTION: Clear old failed imports
// ============================================================================

async function clearFailedImports() {
  log('=== CLEAR FAILED IMPORTS ===');

  // Get error breakdown
  const { data: failed } = await supabase
    .from('import_queue')
    .select('id, error_message, created_at')
    .eq('status', 'failed')
    .limit(1000);

  const errorGroups = new Map<string, string[]>();
  for (const f of failed || []) {
    const error = (f.error_message || 'unknown').slice(0, 60);
    const list = errorGroups.get(error) || [];
    list.push(f.id);
    errorGroups.set(error, list);
  }

  log('Error breakdown:');
  const permanentErrors = ['404', 'not found', 'invalid url', 'page removed'];
  let deleteCount = 0;

  for (const [error, ids] of [...errorGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
    const isPermanent = permanentErrors.some(e => error.toLowerCase().includes(e));
    const action = isPermanent ? '→ DELETE' : '→ RETRY';
    log(`  ${ids.length}x: ${error} ${action}`);

    if (isPermanent) deleteCount += ids.length;
  }

  log(`\nWould delete ${deleteCount} permanently failed imports`);

  if (!dryRun) {
    for (const [error, ids] of errorGroups) {
      const isPermanent = permanentErrors.some(e => error.toLowerCase().includes(e));
      if (isPermanent) {
        await supabase
          .from('import_queue')
          .delete()
          .in('id', ids);
      }
    }
    log('Deleted permanently failed imports');
  } else {
    log('\n[DRY RUN] Run with --execute to delete.');
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log(`Action: ${action}, Dry run: ${dryRun}`);
  log('─'.repeat(60));

  switch (action) {
    case 'infer-makes':
      await inferMakes();
      break;
    case 'merge-orgs':
      await mergeOrgs();
      break;
    case 'fix-years':
      await fixYears();
      break;
    case 'clear-failed-imports':
      await clearFailedImports();
      break;
    case 'all':
      await inferMakes();
      await mergeOrgs();
      await fixYears();
      await clearFailedImports();
      break;
    default:
      log('Available actions:');
      log('  infer-makes          - Infer make from model names (560SL→Mercedes)');
      log('  merge-orgs           - Merge duplicate organizations');
      log('  fix-years            - Set invalid years to null');
      log('  clear-failed-imports - Delete permanently failed imports');
      log('  all                  - Run all cleanup actions');
      log('\nAdd --execute to actually apply changes (default is dry run)');
  }
}

main().catch(console.error);
