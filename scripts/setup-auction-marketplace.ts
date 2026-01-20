/**
 * Setup Auction Marketplace
 * 
 * 1. Creates missing auction platform organizations
 * 2. Adds missing platforms to external_listings constraint
 * 3. Creates external_listings for our extracted auction data
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Platform to org mapping
const PLATFORM_ORGS: Record<string, { name: string; website: string; orgId?: string }> = {
  'bat': { name: 'Bring a Trailer', website: 'https://bringatrailer.com', orgId: 'bd035ea4-75f0-4b17-ad02-aee06283343f' },
  'cars_and_bids': { name: 'Cars & Bids', website: 'https://carsandbids.com', orgId: '822cae29-f80e-4859-9c48-a1485a543152' },
  'pcarmarket': { name: 'PCarMarket', website: 'https://www.pcarmarket.com', orgId: 'f7c80592-6725-448d-9b32-2abf3e011cf8' },
  'collecting_cars': { name: 'Collecting Cars', website: 'https://collectingcars.com', orgId: '0d435048-f2c5-47ba-bba0-4c18c6d58686' },
  'broad_arrow': { name: 'Broad Arrow Auctions', website: 'https://www.broadarrowauctions.com', orgId: 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a' },
  'rmsothebys': { name: 'RM Sothebys', website: 'https://rmsothebys.com', orgId: '5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1' },
  'gooding': { name: 'Gooding and Company', website: 'https://www.goodingco.com', orgId: '98a2e93e-b814-4fda-b48a-0bb5440b7d00' },
  'sbx': { name: 'SBX Cars', website: 'https://www.sbxcars.com' }, // Need to create
};

// Map auction_source to platform key
const SOURCE_TO_PLATFORM: Record<string, string> = {
  'Bring a Trailer': 'bat',
  'Cars & Bids': 'cars_and_bids',
  'PCarMarket': 'pcarmarket',
  'Collecting Cars': 'collecting_cars',
  'Broad Arrow Auctions': 'broad_arrow',
  'RM Sothebys': 'rmsothebys',
  'Gooding & Company': 'gooding',
  'SBX Cars': 'sbx',
};

async function ensureOrganizations() {
  console.log('=== Ensuring auction platform organizations ===\n');
  
  for (const [platform, config] of Object.entries(PLATFORM_ORGS)) {
    if (config.orgId) {
      console.log(`✓ ${config.name} - exists (${config.orgId})`);
      continue;
    }
    
    // Check if it exists by name/website
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .or(`business_name.eq.${config.name},website.eq.${config.website}`)
      .limit(1);
    
    if (existing && existing.length > 0) {
      config.orgId = existing[0].id;
      console.log(`✓ ${config.name} - found (${config.orgId})`);
      continue;
    }
    
    // Create the organization
    const { data: created, error } = await supabase
      .from('businesses')
      .insert({
        business_name: config.name,
        website: config.website,
        business_type: 'auction_house',
        is_verified: true,
      })
      .select('id')
      .single();
    
    if (error) {
      console.log(`✗ ${config.name} - failed: ${error.message}`);
    } else {
      config.orgId = created.id;
      console.log(`✓ ${config.name} - created (${config.orgId})`);
    }
  }
}

async function createExternalListings() {
  console.log('\n=== Creating external_listings for auction vehicles ===\n');
  
  // Get all vehicles from our auction extractor
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, listing_url, listing_title, high_bid, bid_count, auction_end_date, reserve_status, auction_source, primary_image_url, updated_at')
    .eq('listing_source', 'auction_extractor')
    .not('auction_source', 'is', null);
  
  if (error || !vehicles) {
    console.log(`Error fetching vehicles: ${error?.message}`);
    return;
  }
  
  console.log(`Found ${vehicles.length} auction vehicles to process\n`);
  
  let created = 0;
  let updated = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const platform = SOURCE_TO_PLATFORM[vehicle.auction_source];
    if (!platform) {
      console.log(`  ⚠ Unknown source: ${vehicle.auction_source}`);
      failed++;
      continue;
    }
    
    const orgConfig = PLATFORM_ORGS[platform];
    if (!orgConfig?.orgId) {
      console.log(`  ⚠ No org for platform: ${platform}`);
      failed++;
      continue;
    }
    
    // Check if external_listing exists
    const { data: existing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('platform', platform)
      .limit(1);
    
    const listingData = {
      vehicle_id: vehicle.id,
      organization_id: orgConfig.orgId,
      platform: platform,
      listing_url: vehicle.listing_url,
      listing_status: 'active' as const,
      current_bid: vehicle.high_bid,
      bid_count: vehicle.bid_count || 0,
      end_date: vehicle.auction_end_date,
      metadata: {
        source: 'auction_extractor',
        reserve_status: vehicle.reserve_status,
        title: vehicle.listing_title,
        image_url: vehicle.primary_image_url,
      },
      updated_at: new Date().toISOString(),
    };
    
    try {
      if (existing && existing.length > 0) {
        // Update
        const { error: updateErr } = await supabase
          .from('external_listings')
          .update(listingData)
          .eq('id', existing[0].id);
        
        if (updateErr) throw updateErr;
        updated++;
      } else {
        // Insert
        const { error: insertErr } = await supabase
          .from('external_listings')
          .insert(listingData);
        
        if (insertErr) throw insertErr;
        created++;
      }
      
      const title = vehicle.listing_title?.substring(0, 50) || 'Unknown';
      console.log(`  ✓ ${platform}: ${title}...`);
    } catch (e: any) {
      console.log(`  ✗ ${platform}: ${e.message}`);
      failed++;
    }
  }
  
  console.log(`\nResults: ${created} created, ${updated} updated, ${failed} failed`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('AUCTION MARKETPLACE SETUP');
  console.log('='.repeat(60));
  
  await ensureOrganizations();
  await createExternalListings();
  
  // Show summary
  const { count } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .eq('listing_status', 'active');
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total active external_listings: ${count}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
