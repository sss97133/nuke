#!/usr/bin/env node
/**
 * Import the Jaguar XKE BAT listing
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
const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const JAGUAR_BAT_URL = 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function importJaguar() {
  console.log('🚗 Importing Jaguar XKE from BAT...\n');
  console.log(`URL: ${JAGUAR_BAT_URL}\n`);

  try {
    // Use the complete-bat-import function
    const { data, error } = await supabase.functions.invoke('complete-bat-import', {
      body: {
        bat_url: JAGUAR_BAT_URL,
        organization_id: VIVA_ORG_ID
      }
    });

    if (error) {
      console.error('❌ Error:', error);
      throw error;
    }

    if (data?.success) {
      console.log('✅ Successfully imported Jaguar!');
      console.log(`   Vehicle ID: ${data.vehicleId}`);
      console.log(`   Listing: ${data.listing?.year} ${data.listing?.make} ${data.listing?.model}`);
      return data.vehicleId;
    } else {
      throw new Error('Import failed: ' + (data?.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    
    // Fallback: Try import-bat-listing
    console.log('\n🔄 Trying alternative import method...');
    const { data: altData, error: altError } = await supabase.functions.invoke('import-bat-listing', {
      body: {
        bat_url: JAGUAR_BAT_URL,
        organization_id: VIVA_ORG_ID
      }
    });

    if (altError || !altData) {
      console.error('❌ Alternative import also failed:', altError || altData);
      throw altError || new Error('Import failed');
    }

    console.log('✅ Imported via alternative method');
    return altData.vehicleId;
  }
}

// Run import
importJaguar()
  .then((vehicleId) => {
    console.log(`\n✅ Jaguar imported! Vehicle ID: ${vehicleId}`);
    console.log('\n📊 Checking external listing and sync status...');
    
    // Check if external listing was created
    return supabase
      .from('external_listings')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'bat')
      .single();
  })
  .then(({ data: listing, error }) => {
    if (listing) {
      console.log(`\n✅ External listing created:`);
      console.log(`   Listing ID: ${listing.id}`);
      console.log(`   Status: ${listing.listing_status}`);
      console.log(`   Current Bid: $${listing.current_bid || 'N/A'}`);
      console.log(`   Bid Count: ${listing.bid_count || 0}`);
      console.log(`   Sync Enabled: ${listing.sync_enabled ? 'Yes' : 'No'}`);
      console.log(`   Last Synced: ${listing.last_synced_at || 'Never'}`);
      
      if (!listing.sync_enabled) {
        console.log('\n⚠️  Sync is disabled. Enabling...');
        return supabase
          .from('external_listings')
          .update({ sync_enabled: true })
          .eq('id', listing.id);
      }
    } else {
      console.log('\n⚠️  No external listing found. This is normal if the import function creates it differently.');
    }
  })
  .then(() => {
    console.log('\n✅ Jaguar is now in the system and ready for updates!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

