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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars with fallback to .env.local
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

// Check nuke_frontend/.env.local if key not found
const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
    if (line.startsWith('VITE_SUPABASE_URL=') && !SUPABASE_URL.includes('qkgaybvrernstplzjaam')) {
      SUPABASE_URL = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('Set them in your environment or nuke_frontend/.env.local:');
  console.error('  SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"');
  console.error('  SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  console.error('');
  console.error('Or get the key from: Supabase Dashboard → Project Settings → API → service_role key');
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
      console.error(`❌ HTTP ${response.status} Error: ${errorText}`);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      console.error(`❌ Extraction failed:`, JSON.stringify(result, null, 2));
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
        console.log(`  ${status} ${r.business_name || r.organization_id}`);
        if (r.status === 'success') {
          console.log(`     Vehicles: ${r.vehicles_before || 0} → ${(r.vehicles_before || 0) + (r.vehicles_created || 0)} (+${r.vehicles_created || 0})`);
        } else if (r.status === 'failed' && r.error) {
          console.log(`     Error: ${r.error.substring(0, 200)}${r.error.length > 200 ? '...' : ''}`);
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

