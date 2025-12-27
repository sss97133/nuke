#!/usr/bin/env tsx
/**
 * Extract All Organizations Inventory
 * 
 * Systematically extracts vehicles from all organizations with websites.
 * 
 * Usage:
 *   npm run extract-all-orgs
 *   npm run extract-all-orgs -- --limit 20 --threshold 5
 *   npm run extract-all-orgs -- --business-type dealer
 *   npm run extract-all-orgs -- --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Options {
  limit?: number;
  offset?: number;
  minVehicleThreshold?: number;
  businessType?: string;
  dryRun?: boolean;
}

async function extractAllOrgs(options: Options = {}) {
  const {
    limit = 10,
    offset = 0,
    minVehicleThreshold = 10,
    businessType,
    dryRun = false,
  } = options;

  console.log('🚀 Extract All Organizations Inventory\n');
  console.log('Options:');
  console.log(`  - Limit: ${limit}`);
  console.log(`  - Offset: ${offset}`);
  console.log(`  - Min vehicle threshold: ${minVehicleThreshold}`);
  console.log(`  - Business type: ${businessType || 'all'}`);
  console.log(`  - Dry run: ${dryRun ? 'YES' : 'NO'}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/extract-all-orgs-inventory`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        limit,
        offset,
        min_vehicle_threshold: minVehicleThreshold,
        business_type: businessType,
        dry_run: dryRun,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }

    console.log('✅ Extraction Complete!\n');
    console.log('Summary:');
    console.log(`  - Processed: ${result.processed}`);
    console.log(`  - Successful: ${result.successful}`);
    console.log(`  - Failed: ${result.failed}`);
    console.log(`  - Total vehicles created: ${result.total_vehicles_created}`);
    console.log(`  - Next offset: ${result.next_offset}`);
    console.log(`  - Has more: ${result.has_more ? 'YES' : 'NO'}\n`);

    if (result.results && result.results.length > 0) {
      console.log('Results:');
      result.results.forEach((r: any, idx: number) => {
        const status = r.status === 'success' ? '✅' : r.status === 'dry_run' ? '🔍' : '❌';
        console.log(`  ${status} ${r.business_name}`);
        if (r.status === 'success') {
          console.log(`     Vehicles: ${r.vehicles_before} → ${(r.vehicles_before || 0) + (r.vehicles_created || 0)} (+${r.vehicles_created || 0})`);
        }
      });
      console.log('');
    }

    if (result.has_more && !dryRun) {
      console.log('Next batch:');
      console.log(`  npm run extract-all-orgs -- --limit ${limit} --offset ${result.next_offset}`);
    }

    return result;
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Options = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[++i], 10);
  } else if (arg === '--offset' && args[i + 1]) {
    options.offset = parseInt(args[++i], 10);
  } else if (arg === '--threshold' && args[i + 1]) {
    options.minVehicleThreshold = parseInt(args[++i], 10);
  } else if (arg === '--business-type' && args[i + 1]) {
    options.businessType = args[++i];
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
}

extractAllOrgs(options).catch(console.error);

