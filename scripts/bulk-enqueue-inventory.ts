#!/usr/bin/env tsx
/**
 * Bulk Enqueue Inventory Extraction
 * 
 * Easy script to queue all organizations with missing inventory for extraction.
 * 
 * Usage:
 *   npm run bulk-enqueue-inventory
 *   npm run bulk-enqueue-inventory -- --limit 500 --threshold 10
 *   npm run bulk-enqueue-inventory -- --dry-run
 *   npm run bulk-enqueue-inventory -- --business-type dealer
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
  runMode?: 'current' | 'sold' | 'both';
  limit?: number;
  minInventoryThreshold?: number;
  onlyWithWebsite?: boolean;
  businessType?: string;
  requeueFailed?: boolean;
  dryRun?: boolean;
}

async function bulkEnqueueInventory(options: Options = {}) {
  const {
    runMode = 'both',
    limit = 1000,
    minInventoryThreshold = 5,
    onlyWithWebsite = true,
    businessType,
    requeueFailed = true,
    dryRun = false,
  } = options;

  console.log('🚀 Bulk Enqueue Inventory Extraction\n');
  console.log('Options:');
  console.log(`  - Run mode: ${runMode}`);
  console.log(`  - Limit: ${limit}`);
  console.log(`  - Min inventory threshold: ${minInventoryThreshold}`);
  console.log(`  - Only with website: ${onlyWithWebsite}`);
  console.log(`  - Business type: ${businessType || 'all'}`);
  console.log(`  - Requeue failed: ${requeueFailed}`);
  console.log(`  - Dry run: ${dryRun ? 'YES' : 'NO'}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/bulk-enqueue-inventory-extraction`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        run_mode: runMode,
        limit,
        min_inventory_threshold: minInventoryThreshold,
        only_with_website: onlyWithWebsite,
        business_type: businessType,
        requeue_failed: requeueFailed,
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

    console.log('✅ Success!\n');
    console.log('Stats:');
    console.log(`  - Total orgs checked: ${result.stats.total_orgs_checked}`);
    console.log(`  - Candidates with low inventory: ${result.stats.candidates_with_low_inventory}`);
    console.log(`  - Already queued: ${result.stats.already_queued}`);
    console.log(`  - Newly queued: ${result.stats.newly_queued}`);
    console.log(`  - Requeued failed: ${result.stats.requeued_failed}\n`);

    if (result.sample_queued && result.sample_queued.length > 0) {
      console.log('Sample organizations queued:');
      result.sample_queued.forEach((org: any) => {
        console.log(`  - ${org.name} (${org.current_inventory} vehicles) - ${org.website || 'no website'}`);
      });
      console.log('');
    }

    if (!dryRun) {
      console.log('Next steps:');
      result.next_steps?.forEach((step: string) => {
        console.log(`  - ${step}`);
      });
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
  
  if (arg === '--run-mode' && args[i + 1]) {
    options.runMode = args[++i] as any;
  } else if (arg === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[++i], 10);
  } else if (arg === '--threshold' && args[i + 1]) {
    options.minInventoryThreshold = parseInt(args[++i], 10);
  } else if (arg === '--no-website-filter') {
    options.onlyWithWebsite = false;
  } else if (arg === '--business-type' && args[i + 1]) {
    options.businessType = args[++i];
  } else if (arg === '--no-requeue-failed') {
    options.requeueFailed = false;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
}

bulkEnqueueInventory(options).catch(console.error);

