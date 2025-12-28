#!/usr/bin/env node
/**
 * Discover The Shop Auto Group inventory
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const ORGANIZATION_ID = '0b8219ae-9d9b-447c-978c-3a30ab37fd49'; // The Shop
const INVENTORY_URL = 'https://autogroup.theshopclubs.com';

async function discoverInventory() {
  console.log('🚗 Discovering The Shop Auto Group Inventory');
  console.log(`   Organization ID: ${ORGANIZATION_ID}`);
  console.log(`   Website: ${INVENTORY_URL}\n`);

  try {
    const functionUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/discover-organization-full`;
    
    console.log(`📡 Calling discover-organization-full...\n`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        organization_id: ORGANIZATION_ID,
        website: INVENTORY_URL,
        force_rediscover: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ HTTP ${response.status}: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    if (!result.success) {
      console.error('❌ Discovery failed:', result.error);
      process.exit(1);
    }

    const data = result.result || result;

    console.log('✅ Discovery Complete!\n');
    console.log('Results:');
    console.log(`  - Site Type: ${data.site_structure?.site_type || 'unknown'}`);
    if (data.site_structure?.platform) {
      console.log(`  - Platform: ${data.site_structure.platform}`);
    }
    console.log(`  - Vehicles Found: ${data.vehicles_found || 0}`);
    console.log(`  - Vehicles Queued: ${data.vehicles_extracted || data.vehicles_queued || 0}`);
    console.log(`  - Vehicle Profiles Created: ${data.vehicles_created || 0}`);
    console.log(`  - Images Found: ${data.images_found || 0}\n`);

    if (data.vehicles_found > 0 || data.vehicles_queued > 0) {
      console.log('🎉 Successfully queued vehicles for processing!');
      console.log('   They will be processed automatically by the import queue.\n');
    }

    return result;
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

discoverInventory().catch(console.error);

