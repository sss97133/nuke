#!/usr/bin/env node
/**
 * Query Facebook Marketplace vehicles from database
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

async function queryFacebookVehicles() {
  console.log('🔍 Querying Facebook Marketplace vehicles...\n');

  // Query vehicles by profile_origin
  const { data: vehicles1, error: error1 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source, profile_origin, origin_metadata, created_at')
    .eq('profile_origin', 'facebook_marketplace_import')
    .order('created_at', { ascending: false })
    .limit(20);

  // Query vehicles by discovery_source
  const { data: vehicles2, error: error2 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source, profile_origin, origin_metadata, created_at')
    .eq('discovery_source', 'facebook_marketplace')
    .order('created_at', { ascending: false })
    .limit(20);

  // Query vehicles by discovery_url containing facebook
  const { data: vehicles3, error: error3 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source, profile_origin, origin_metadata, created_at')
    .ilike('discovery_url', '%facebook.com%')
    .order('created_at', { ascending: false })
    .limit(20);

  // Combine and deduplicate
  const allVehicles = new Map();
  
  [...(vehicles1 || []), ...(vehicles2 || []), ...(vehicles3 || [])].forEach(v => {
    if (!allVehicles.has(v.id)) {
      allVehicles.set(v.id, v);
    }
  });

  const vehicles = Array.from(allVehicles.values());

  if (vehicles.length === 0) {
    console.log('ℹ️  No Facebook Marketplace vehicles found in database.\n');
    console.log('   Run the import script to add Facebook vehicles:\n');
    console.log('   node scripts/import-facebook-marketplace.js <url>\n');
    return;
  }

  console.log(`✅ Found ${vehicles.length} Facebook Marketplace vehicle(s):\n`);

  vehicles.forEach((vehicle, index) => {
    console.log(`${index + 1}. ${vehicle.year || 'N/A'} ${vehicle.make || 'N/A'} ${vehicle.model || 'N/A'}`);
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
    console.log(`   Origin: ${vehicle.profile_origin || 'N/A'}`);
    console.log(`   Source: ${vehicle.discovery_source || 'N/A'}`);
    
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
    
    console.log(`   Created: ${new Date(vehicle.created_at).toLocaleDateString()}`);
    console.log('');
  });

  console.log(`\n📊 Summary: ${vehicles.length} total Facebook Marketplace vehicle(s)\n`);
}

queryFacebookVehicles().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

