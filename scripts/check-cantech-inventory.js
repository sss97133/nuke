/**
 * Check Cantech Automotive Inventory Status
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const CANTECH_ORG_ID = 'db6585be-dfab-4f07-ac73-11d18586d4f6';

async function checkInventory() {
  console.log('🔍 Checking Cantech Automotive inventory...\n');

  // Get all linked vehicles
  const { data: links, error } = await supabase
    .from('organization_vehicles')
    .select(`
      id,
      vehicle_id,
      relationship_type,
      status,
      vehicles!inner(
        id,
        year,
        make,
        model,
        discovery_url
      )
    `)
    .eq('organization_id', CANTECH_ORG_ID);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log(`📊 Total linked vehicles: ${links?.length || 0}\n`);

  if (links && links.length > 0) {
    console.log('Vehicle Links:');
    links.forEach((link, i) => {
      const v = link.vehicles;
      console.log(`\n${i + 1}. ${v.year} ${v.make} ${v.model}`);
      console.log(`   Relationship: ${link.relationship_type}`);
      console.log(`   Status: ${link.status}`);
      console.log(`   Discovery URL: ${v.discovery_url || 'N/A'}`);
    });

    // Check which ones would show in inventory tab
    const inventoryTypes = ['in_stock', 'consignment', 'seller', 'consigner'];
    const activeInventory = links.filter(l => 
      inventoryTypes.includes(l.relationship_type) && l.status === 'active'
    );

    console.log(`\n📦 Would show in inventory tab: ${activeInventory.length}`);
    console.log(`   (relationship_type in [${inventoryTypes.join(', ')}] AND status = 'active')`);

    if (activeInventory.length === 0) {
      console.log('\n⚠️  No vehicles showing in inventory!');
      console.log('   Possible fixes:');
      console.log('   1. Update relationship_type to "in_stock" or "seller"');
      console.log('   2. Ensure status is "active"');
    }
  } else {
    console.log('⚠️  No vehicles linked to Cantech Automotive');
    console.log('   Need to discover and link vehicles from their website');
  }

  // Check for vehicles with Cantech URLs that aren't linked
  const { data: unlinkedVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .ilike('discovery_url', '%cantechautomotive.com%')
    .is('origin_organization_id', null)
    .limit(20);

  if (unlinkedVehicles && unlinkedVehicles.length > 0) {
    console.log(`\n🔗 Found ${unlinkedVehicles.length} vehicles with Cantech URLs that aren't linked:`);
    unlinkedVehicles.forEach((v, i) => {
      console.log(`   ${i + 1}. ${v.year} ${v.make} ${v.model} - ${v.discovery_url}`);
    });
  }
}

checkInventory().catch(console.error);

