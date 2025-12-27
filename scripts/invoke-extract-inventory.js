#!/usr/bin/env node
/**
 * Invoke extract-all-orgs-inventory Edge Function
 * 
 * The function has access to all API keys via Supabase Edge Function secrets.
 * We just need the Supabase URL and service role key to invoke it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('Set them in your environment or .env file:');
  console.error('  export SUPABASE_URL="https://your-project.supabase.co"');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  process.exit(1);
}

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10', 10);
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0', 10);
const threshold = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '1', 10);
const dryRun = args.includes('--dry-run');

async function invokeExtraction() {
  console.log('🚀 Invoking extract-all-orgs-inventory Edge Function');
  console.log('');
  console.log('Parameters:');
  console.log(`  - Limit: ${limit}`);
  console.log(`  - Offset: ${offset}`);
  console.log(`  - Min vehicle threshold: ${threshold}`);
  console.log(`  - Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log('');

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/extract-all-orgs-inventory`;
    
    console.log(`📡 Calling: ${functionUrl}`);
    console.log('');

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        limit,
        offset,
        min_vehicle_threshold: threshold,
        dry_run: dryRun,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ HTTP ${response.status}: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    if (!result.success) {
      console.error('❌ Extraction failed:', result.error);
      process.exit(1);
    }

    console.log('✅ Extraction Complete!');
    console.log('');
    console.log('Summary:');
    console.log(`  - Processed: ${result.processed}`);
    console.log(`  - Successful: ${result.successful}`);
    console.log(`  - Failed: ${result.failed}`);
    console.log(`  - Total vehicles created: ${result.total_vehicles_created}`);
    console.log(`  - Next offset: ${result.next_offset}`);
    console.log(`  - Has more: ${result.has_more ? 'YES' : 'NO'}`);
    console.log('');

    if (result.results && result.results.length > 0) {
      console.log('Results:');
      result.results.forEach((r, idx) => {
        const status = r.status === 'success' ? '✅' : r.status === 'dry_run' ? '🔍' : '❌';
        console.log(`  ${status} ${r.business_name || r.organization_id}`);
        if (r.status === 'success') {
          console.log(`     Vehicles: ${r.vehicles_before || 0} → ${(r.vehicles_before || 0) + (r.vehicles_created || 0)} (+${r.vehicles_created || 0})`);
        }
      });
      console.log('');
    }

    if (result.has_more && !dryRun) {
      console.log('Next batch:');
      console.log(`  node scripts/invoke-extract-inventory.js --limit=${limit} --offset=${result.next_offset} --threshold=${threshold}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

invokeExtraction().catch(console.error);

