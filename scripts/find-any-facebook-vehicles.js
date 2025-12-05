#!/usr/bin/env node
/**
 * Find ANY vehicles that might be from Facebook (comprehensive search)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findFacebookVehicles() {
  console.log('🔍 Comprehensive search for Facebook Marketplace vehicles...\n');

  // Search 1: profile_origin
  console.log('Searching by profile_origin...');
  const { data: byOrigin } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, profile_origin')
    .eq('profile_origin', 'facebook_marketplace_import')
    .limit(50);

  // Search 2: discovery_source
  console.log('Searching by discovery_source...');
  const { data: bySource } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source')
    .eq('discovery_source', 'facebook_marketplace')
    .limit(50);

  // Search 3: discovery_url contains facebook
  console.log('Searching by discovery_url (facebook.com)...');
  const { data: byUrl } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .ilike('discovery_url', '%facebook.com%')
    .limit(50);

  // Search 4: origin_metadata contains facebook
  console.log('Searching by origin_metadata...');
  const { data: allVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata, profile_origin, discovery_source')
    .limit(1000);

  const facebookInMetadata = (allVehicles || []).filter(v => {
    if (!v.origin_metadata) return false;
    const meta = typeof v.origin_metadata === 'string' ? JSON.parse(v.origin_metadata) : v.origin_metadata;
    return meta && (
      meta.facebook_marketplace_url ||
      meta.facebook_marketplace_listing_id ||
      (meta.source && meta.source.includes('facebook')) ||
      JSON.stringify(meta).toLowerCase().includes('facebook')
    );
  });

  // Combine all results
  const allResults = new Map();
  
  [...(byOrigin || []), ...(bySource || []), ...(byUrl || []), ...facebookInMetadata].forEach(v => {
    if (!allResults.has(v.id)) {
      allResults.set(v.id, v);
    }
  });

  const vehicles = Array.from(allResults.values());

  if (vehicles.length === 0) {
    console.log('\n❌ No Facebook Marketplace vehicles found in database.\n');
    console.log('📊 Search Results:');
    console.log(`   By profile_origin: ${byOrigin?.length || 0}`);
    console.log(`   By discovery_source: ${bySource?.length || 0}`);
    console.log(`   By discovery_url: ${byUrl?.length || 0}`);
    console.log(`   By origin_metadata: ${facebookInMetadata.length}\n`);
    console.log('⚠️  The edge function has an error preventing imports.');
    console.log('   Check logs: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions\n');
    return;
  }

  console.log(`\n✅ Found ${vehicles.length} Facebook Marketplace vehicle(s):\n`);

  vehicles.forEach((vehicle, index) => {
    console.log(`${index + 1}. ${vehicle.year || 'N/A'} ${vehicle.make || 'N/A'} ${vehicle.model || 'N/A'}`);
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
    console.log(`   Profile Origin: ${vehicle.profile_origin || 'N/A'}`);
    console.log(`   Discovery Source: ${vehicle.discovery_source || 'N/A'}`);
    
    if (vehicle.origin_metadata) {
      const meta = typeof vehicle.origin_metadata === 'string' 
        ? JSON.parse(vehicle.origin_metadata) 
        : vehicle.origin_metadata;
      
      if (meta.facebook_marketplace_url) {
        console.log(`   Facebook URL: ${meta.facebook_marketplace_url}`);
      }
      if (meta.facebook_marketplace_listing_id) {
        console.log(`   Listing ID: ${meta.facebook_marketplace_listing_id}`);
      }
    }
    console.log('');
  });

  console.log(`\n📊 Summary: ${vehicles.length} total Facebook Marketplace vehicle(s) found\n`);
}

findFacebookVehicles().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

