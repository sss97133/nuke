#!/usr/bin/env node

/**
 * Full-fledged dealer profile and inventory indexing test
 * Shows complete flow: profile → organization → inventory extraction
 * 
 * Usage: node scripts/test-full-dealer-indexing.js [profile_url]
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load .env file
config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

// Use service key if available (for database queries), fallback to anon key for function invocations
const supabaseService = SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Use service client for DB queries, anon for function invocations (which handle auth internally)
const supabase = supabaseService || supabaseAnon;

/**
 * Index dealer profile and wait for inventory extraction
 */
async function testFullDealerIndexing(profileUrl) {
  console.log('='.repeat(80));
  console.log('🔥 FULL DEALER INDEXING TEST');
  console.log('='.repeat(80));
  console.log(`\n📍 Profile URL: ${profileUrl}\n`);

  // Step 1: Index dealer profile
  console.log('📋 STEP 1: Indexing Classic.com dealer profile...');
  console.log('─'.repeat(80));
  
  let orgId = null;
  let orgName = null;
  
  try {
    const { data: profileData, error: profileError } = await supabaseAnon.functions.invoke('index-classic-com-dealer', {
      body: { profile_url: profileUrl }
    });

    if (profileError) {
      throw new Error(`Profile indexing failed: ${profileError.message}`);
    }

    if (!profileData.success) {
      throw new Error(`Profile indexing failed: ${profileData.error}`);
    }

    orgId = profileData.organization_id;
    orgName = profileData.organization_name;
    
    console.log(`   ✅ Organization: ${orgName}`);
    console.log(`   ✅ Organization ID: ${orgId}`);
    console.log(`   ✅ Action: ${profileData.action}`);
    if (profileData.logo_url) {
      console.log(`   ✅ Logo: ${profileData.logo_url}`);
    }
    console.log(`   ✅ Business Type: ${profileData.dealer_data?.business_type || 'dealer'}`);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return;
  }

  // Step 2: Check organization in database
  console.log('\n📋 STEP 2: Verifying organization in database...');
  console.log('─'.repeat(80));
  
  const { data: org, error: orgError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    console.error(`   ❌ Organization not found: ${orgError?.message}`);
    return;
  }

  console.log(`   ✅ Business Name: ${org.business_name}`);
  console.log(`   ✅ Type: ${org.type || org.business_type}`);
  console.log(`   ✅ Website: ${org.website || 'N/A'}`);
  console.log(`   ✅ Location: ${org.city || 'N/A'}, ${org.state || 'N/A'}`);
  console.log(`   ✅ Dealer License: ${org.dealer_license || 'N/A'}`);
  console.log(`   ✅ Logo URL: ${org.logo_url || 'N/A'}`);
  if (org.specializations) {
    console.log(`   ✅ Specializations: ${org.specializations.join(', ')}`);
  }

  // Step 3: Check if inventory extraction was queued
  console.log('\n📋 STEP 3: Checking inventory extraction status...');
  console.log('─'.repeat(80));
  
  // Wait a bit for inventory sync to trigger
  console.log('   ⏳ Waiting 3 seconds for inventory sync to trigger...');
  await new Promise(r => setTimeout(r, 3000));
  
  // Check if inventory URL is set
  const inventoryUrl = org.metadata?.inventory_url || org.website + '/inventory';
  console.log(`   📍 Inventory URL: ${inventoryUrl}`);
  
  // Check import_queue for items from this org
  const { data: queuedItems, error: queueError } = await supabase
    .from('import_queue')
    .select('id, listing_url, listing_title, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!queueError && queuedItems && queuedItems.length > 0) {
    console.log(`   ✅ Found ${queuedItems.length} items in import queue`);
    console.log(`   📦 Sample queue items:`);
    queuedItems.slice(0, 5).forEach((item, i) => {
      console.log(`      ${i + 1}. ${item.listing_title || item.listing_url.substring(0, 60)}...`);
    });
  } else {
    console.log(`   ⚠️  No items in import queue yet (may be processing or none found)`);
  }

  // Step 4: Check for vehicles linked to this organization
  console.log('\n📋 STEP 4: Checking vehicles linked to organization...');
  console.log('─'.repeat(80));
  
  const { data: orgVehicles, error: vehiclesError } = await supabase
    .from('organization_vehicles')
    .select(`
      vehicle_id,
      relationship_type,
      status,
      vehicles (
        id,
        year,
        make,
        model,
        vin,
        discovery_url
      )
    `)
    .eq('organization_id', orgId)
    .limit(20);

  if (!vehiclesError && orgVehicles && orgVehicles.length > 0) {
    console.log(`   ✅ Found ${orgVehicles.length} vehicles linked to organization`);
    console.log(`   📦 Sample vehicles:`);
    orgVehicles.slice(0, 10).forEach((ov, i) => {
      const v = ov.vehicles;
      if (v) {
        console.log(`      ${i + 1}. ${v.year || '?'} ${v.make || ''} ${v.model || ''} (${v.vin ? v.vin.substring(0, 8) + '...' : 'No VIN'})`);
      }
    });
  } else {
    console.log(`   ⚠️  No vehicles linked yet (inventory extraction may still be processing)`);
  }

  // Step 5: Check scrape_sources
  console.log('\n📋 STEP 5: Checking scrape sources...');
  console.log('─'.repeat(80));
  
  const { data: sources, error: sourcesError } = await supabase
    .from('scrape_sources')
    .select('*')
    .or(`url.ilike.%${org.website}%,name.ilike.%${org.business_name}%`)
    .order('last_scraped_at', { ascending: false })
    .limit(5);

  if (!sourcesError && sources && sources.length > 0) {
    console.log(`   ✅ Found ${sources.length} scrape source(s):`);
    sources.forEach((source, i) => {
      console.log(`      ${i + 1}. ${source.name}`);
      console.log(`         URL: ${source.url}`);
      console.log(`         Listings found: ${source.total_listings_found || 0}`);
      console.log(`         Last scraped: ${source.last_scraped_at ? new Date(source.last_scraped_at).toLocaleString() : 'Never'}`);
    });
  } else {
    console.log(`   ⚠️  No scrape sources found yet`);
  }

  // Step 6: Trigger inventory extraction if not already done
  console.log('\n📋 STEP 6: Triggering inventory extraction...');
  console.log('─'.repeat(80));
  
  if (org.website) {
    const targetUrl = org.metadata?.inventory_url || `${org.website}/inventory`;
    console.log(`   🔥 Triggering scrape-multi-source for: ${targetUrl}`);
    
    try {
      const { data: scrapeData, error: scrapeError } = await supabaseAnon.functions.invoke('scrape-multi-source', {
        body: {
          source_url: targetUrl,
          source_type: org.type === 'auction_house' ? 'auction_house' : 'dealer_website',
          organization_id: orgId,
          max_results: 50, // Limit for testing
          use_llm_extraction: true
        }
      });

      if (scrapeError) {
        console.error(`   ❌ Scrape error: ${scrapeError.message}`);
      } else if (scrapeData.success) {
        console.log(`   ✅ Scrape successful!`);
        console.log(`      Listings found: ${scrapeData.listings_found || 0}`);
        console.log(`      Listings queued: ${scrapeData.listings_queued || 0}`);
        console.log(`      Squarebody count: ${scrapeData.squarebody_count || 0}`);
        
        if (scrapeData.sample_listings && scrapeData.sample_listings.length > 0) {
          console.log(`   📦 Sample listings extracted:`);
          scrapeData.sample_listings.slice(0, 5).forEach((listing, i) => {
            console.log(`      ${i + 1}. ${listing.title || listing.url}`);
            if (listing.price) console.log(`         Price: $${listing.price.toLocaleString()}`);
            if (listing.year && listing.make && listing.model) {
              console.log(`         Vehicle: ${listing.year} ${listing.make} ${listing.model}`);
            }
          });
        }
        
        // Wait for processing
        console.log(`\n   ⏳ Waiting 5 seconds for queue processing...`);
        await new Promise(r => setTimeout(r, 5000));
        
        // Check updated vehicle count
        const { data: updatedOrg } = await supabase
          .from('businesses')
          .select('total_vehicles')
          .eq('id', orgId)
          .single();
        
        if (updatedOrg) {
          console.log(`   ✅ Updated vehicle count: ${updatedOrg.total_vehicles || 0}`);
        }
      }
    } catch (error) {
      console.error(`   ❌ Error triggering scrape: ${error.message}`);
    }
  } else {
    console.log(`   ⚠️  No website available for inventory extraction`);
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`Organization ID: ${orgId}`);
  console.log(`Organization Name: ${orgName}`);
  console.log(`Website: ${org.website || 'N/A'}`);
  console.log(`Location: ${org.city || 'N/A'}, ${org.state || 'N/A'}`);
  console.log(`\n✅ Dealer profile indexing: COMPLETE`);
  console.log(`✅ Inventory extraction: ${org.website ? 'TRIGGERED' : 'SKIPPED (no website)'}`);
  console.log(`\n🔍 Check the database for:`);
  console.log(`   - businesses table: SELECT * FROM businesses WHERE id = '${orgId}';`);
  console.log(`   - import_queue: SELECT * FROM import_queue WHERE listing_url LIKE '%${org.website?.replace('https://', '') || ''}%';`);
  console.log(`   - organization_vehicles: SELECT * FROM organization_vehicles WHERE organization_id = '${orgId}';`);
  console.log('='.repeat(80));
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  const profileUrl = args[0] || 'https://www.classic.com/s/111-motorcars-ZnQygen/';
  
  if (!profileUrl.includes('classic.com/s/')) {
    console.error('❌ Invalid Classic.com profile URL');
    console.log('Expected format: https://www.classic.com/s/dealer-name-ID/');
    process.exit(1);
  }
  
  await testFullDealerIndexing(profileUrl);
}

main().catch(console.error);

