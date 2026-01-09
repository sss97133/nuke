/**
 * Extract and Import All Fantasy Junction BaT Listings
 * 
 * Uses FREE MODE - direct HTML fetch, no paid APIs
 * Slow and accurate - processes one listing at a time
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BAT_USERNAME = 'fantasyjunction';
const BAT_MEMBER_URL = `https://bringatrailer.com/member/${BAT_USERNAME}/`;
const ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';
const DELAY_BETWEEN_LISTINGS = 5000; // 5 seconds between listings (slow and accurate)

// Get sample size from command line or use default
const SAMPLE_SIZE = parseInt(process.argv[2]) || 5; // Default to 5 for testing
const FULL_RUN = process.argv.includes('--full');

// Step 1: Extract all listing URLs from BaT profile page
async function extractListingUrls() {
  console.log('📋 Step 1: Extracting all listing URLs from BaT profile...\n');
  console.log(`   Profile: ${BAT_MEMBER_URL}\n`);

  try {
    // Try extract-bat-profile-vehicles first (it has fallback logic)
    const { data: profileData, error: profileError } = await supabase.functions.invoke('extract-bat-profile-vehicles', {
      body: {
        username: BAT_USERNAME,
        queue_only: true  // Just get URLs, don't extract yet
      }
    });

    if (!profileError && profileData && profileData.listing_urls && profileData.listing_urls.length > 0) {
      console.log(`✅ Found ${profileData.listing_urls.length} listing URLs via extract-bat-profile-vehicles\n`);
      return profileData.listing_urls;
    }

    // Fallback: Direct fetch approach (FREE MODE)
    console.log('⚠️ Edge function returned no URLs, trying direct fetch...\n');
    
    const response = await fetch(BAT_MEMBER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch BaT profile: ${response.status}`);
    }

    const html = await response.text();

    // Extract URLs using multiple patterns (same as extract-bat-profile-vehicles)
    const listingUrls = new Set();

    // Pattern 1: Direct href links
    const listingUrlRegex = /href=["']([^"']*\/listing\/[^"']+)["']/gi;
    let match;
    while ((match = listingUrlRegex.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith('http')) {
        url = `https://bringatrailer.com${url}`;
      }
      // Remove anchor fragments
      url = url.split('#')[0];
      listingUrls.add(url);
    }

    // Pattern 2: JSON embedded data (for JS-rendered content)
    const jsonPatterns = [
      /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
      /window\.__NEXT_DATA__\s*=\s*({.+?})<\/script>/s,
      /__NEXT_DATA__["\s]*=\s*({.+?})<\/script>/s,
      /"listings":\s*\[([^\]]+)\]/g,
    ];

    for (const pattern of jsonPatterns) {
      const jsonMatch = html.match(pattern);
      if (jsonMatch) {
        try {
          const stateData = JSON.parse(jsonMatch[1]);
          const findUrls = (obj) => {
            if (typeof obj === 'string' && obj.includes('/listing/')) {
              const urlMatch = obj.match(/(https?:\/\/)?bringatrailer\.com\/listing\/[^\s"']+/);
              if (urlMatch) {
                let url = urlMatch[0];
                if (!url.startsWith('http')) {
                  url = `https://${url}`;
                }
                url = url.split('#')[0];
                listingUrls.add(url);
              }
            } else if (Array.isArray(obj)) {
              obj.forEach(findUrls);
            } else if (typeof obj === 'object' && obj !== null) {
              Object.values(obj).forEach(findUrls);
            }
          };
          findUrls(stateData);
        } catch (e) {
          // Extract URLs from JSON string directly
          const urlMatches = jsonMatch[1].match(/\/listing\/[a-z0-9-]+/g);
          if (urlMatches) {
            urlMatches.forEach((path) => {
              listingUrls.add(`https://bringatrailer.com${path}`);
            });
          }
        }
      }
    }

    const urlsArray = Array.from(listingUrls);
    console.log(`✅ Found ${urlsArray.length} listing URLs via direct fetch\n`);
    return urlsArray;

  } catch (err) {
    console.error('❌ Failed to extract listing URLs:', err.message);
    throw err;
  }
}

// Step 2: Process a single listing using approved two-step workflow
async function processListing(listingUrl, index, total) {
  const listingName = listingUrl.substring(listingUrl.lastIndexOf('/') + 1);
  console.log(`\n[${index + 1}/${total}] Processing: ${listingName}`);
  
  try {
    // Step 2a: Extract core vehicle data (APPROVED WORKFLOW)
    console.log('   Step 2a: Extracting core data via extract-premium-auction...');
    const step1 = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: listingUrl,
        max_vehicles: 1
      }
    });

    if (step1.error) {
      throw new Error(`Step 1 failed: ${step1.error.message}`);
    }

    if (!step1.data) {
      console.log('   ⚠️ Step 1 returned no data:', JSON.stringify(step1, null, 2));
      throw new Error(`Step 1 failed: No data returned`);
    }

    // Check for success flag or vehicles_extracted count
    if (step1.data.success === false || (step1.data.vehicles_extracted === 0 && !step1.data.created_vehicle_ids?.length && !step1.data.updated_vehicle_ids?.length)) {
      console.log('   ⚠️ Step 1 failed or extracted 0 vehicles:', step1.data.error || step1.data);
      throw new Error(`Step 1 failed: ${step1.data.error || 'No vehicles extracted'}`);
    }

    // Try to get vehicle_id from multiple possible fields
    const vehicleId = step1.data.created_vehicle_ids?.[0] || 
                     step1.data.updated_vehicle_ids?.[0] ||
                     step1.data.vehicle_id ||
                     step1.data.vehicles?.[0]?.id;

    // If still no vehicle_id, try to find by URL (common when vehicle already exists)
    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId) {
      console.log('   ⚠️ No vehicle_id in response, trying to find existing vehicle by URL...');
      
      // Try multiple URL fields to find existing vehicle
      const urlCandidates = [
        listingUrl,
        listingUrl.replace(/\/$/, ''),
        listingUrl + '/',
        listingUrl.replace('https://', 'http://'),
        listingUrl.replace('http://', 'https://')
      ];
      
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .or(`bat_auction_url.in.(${urlCandidates.join(',')}),discovery_url.in.(${urlCandidates.join(',')}),listing_url.in.(${urlCandidates.join(',')})`)
        .maybeSingle();
      
      if (existingVehicle) {
        resolvedVehicleId = existingVehicle.id;
        console.log(`   ✅ Found existing vehicle: ${resolvedVehicleId}`);
      } else {
        // Also try by checking external_listings
        const { data: extListing } = await supabase
          .from('external_listings')
          .select('vehicle_id')
          .eq('platform', 'bat')
          .in('listing_url', urlCandidates)
          .maybeSingle();
        
        if (extListing?.vehicle_id) {
          resolvedVehicleId = extListing.vehicle_id;
          console.log(`   ✅ Found via external_listings: ${resolvedVehicleId}`);
        }
      }
    }

    const wasCreated = step1.data.created_vehicle_ids?.includes(resolvedVehicleId) || 
                      (step1.data.vehicles_extracted && step1.data.vehicles_extracted > 0 && !step1.data.updated_vehicle_ids?.includes(resolvedVehicleId));
    
    if (!resolvedVehicleId) {
      console.log('   ⚠️ No vehicle_id found or returned');
      console.log('   Response:', JSON.stringify(step1.data, null, 2).substring(0, 500));
      return { success: false, vehicleId: null, listingUrl, error: 'No vehicle_id', created: false };
    }

    console.log(`   ✅ Vehicle ${wasCreated ? 'CREATED' : 'UPDATED'}: ${resolvedVehicleId}`);

    // Link to organization
    // Since these are past BaT listings, use 'consigner' (dealer consigned vehicle for auction)
    try {
      // Determine relationship type: 'consigner' for past BaT auction listings
      const relationshipType = 'consigner';

      // Add organization relationship using organization_vehicles table
      const { error: relError } = await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: ORG_ID,
          vehicle_id: resolvedVehicleId,
          relationship_type: relationshipType,
          status: 'active',
          auto_tagged: false,
          notes: `Imported from Fantasy Junction BaT profile extraction`
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });
      
      if (relError) {
        console.warn(`   ⚠️ Failed to link organization: ${relError.message}`);
      } else {
        console.log(`   ✅ Linked to Fantasy Junction (${relationshipType})`);
      }
    } catch (relError) {
      console.warn(`   ⚠️ Failed to link organization: ${relError?.message || String(relError)}`);
    }

    // Step 2b: Extract comments/bids (APPROVED WORKFLOW - non-critical)
    console.log('   Step 2b: Extracting comments/bids via extract-auction-comments...');
    try {
      const step2 = await supabase.functions.invoke('extract-auction-comments', {
        body: {
          auction_url: listingUrl,
          vehicle_id: resolvedVehicleId
        }
      });

      if (!step2.error && step2.data?.success) {
        const commentCount = step2.data.comments_extracted || 0;
        const bidCount = step2.data.bids_extracted || 0;
        console.log(`   ✅ Comments: ${commentCount}, Bids: ${bidCount}`);
      } else {
        console.log('   ⚠️ Comments extraction failed (non-critical):', step2.error?.message || step2.data?.error || 'Unknown error');
      }
    } catch (commentError) {
      console.warn(`   ⚠️ Comments extraction error (non-critical): ${commentError.message}`);
    }

    return { success: true, vehicleId: resolvedVehicleId, listingUrl, created: wasCreated };

  } catch (err) {
    console.error(`   ❌ Error processing listing: ${err.message}`);
    return { success: false, vehicleId: null, listingUrl, error: err.message, created: false };
  }
}

// Main execution
async function main() {
  console.log('🚀 Fantasy Junction BaT Listing Import (FREE MODE)\n');
  console.log(`   Organization ID: ${ORG_ID}`);
  console.log(`   BaT Username: ${BAT_USERNAME}`);
  console.log(`   Delay between listings: ${DELAY_BETWEEN_LISTINGS}ms (slow and accurate)`);
  console.log(`   Sample size: ${SAMPLE_SIZE} listings${FULL_RUN ? ' (FULL RUN)' : ''}\n`);

  try {
    // Step 1: Get all listing URLs
    const allListingUrls = await extractListingUrls();

    if (!allListingUrls || allListingUrls.length === 0) {
      console.error('❌ No listing URLs found');
      process.exit(1);
    }

    // Take sample or all listings
    const listingUrls = FULL_RUN ? allListingUrls : allListingUrls.slice(0, SAMPLE_SIZE);

    console.log(`\n📋 Found ${allListingUrls.length} total listings`);
    console.log(`📋 Processing ${listingUrls.length} listings ${FULL_RUN ? '(FULL RUN)' : `(SAMPLE - first ${SAMPLE_SIZE})`}\n`);
    console.log('📋 Using APPROVED TWO-STEP WORKFLOW:');
    console.log('   1. extract-premium-auction (core data)');
    console.log('   2. extract-auction-comments (comments/bids)\n');

    // Step 2: Process each listing one at a time (slow and accurate)
    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: []
    };

    for (let i = 0; i < listingUrls.length; i++) {
      const url = listingUrls[i];
      const result = await processListing(url, i, listingUrls.length);

      if (result.success) {
        results.processed++;
        if (result.created) {
          results.created++;
        } else {
          results.updated++;
        }
      } else {
        results.errors.push({ url, error: result.error });
      }

      // Rate limiting: wait between listings (except for the last one)
      if (i < listingUrls.length - 1) {
        console.log(`\n   ⏳ Waiting ${DELAY_BETWEEN_LISTINGS}ms before next listing...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_LISTINGS));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total listings found: ${allListingUrls.length}`);
    console.log(`Listings processed: ${listingUrls.length}`);
    console.log(`Successfully processed: ${results.processed}`);
    console.log(`Vehicles created: ${results.created}`);
    console.log(`Vehicles updated: ${results.updated}`);
    console.log(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.slice(0, 10).forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.url.substring(err.url.lastIndexOf('/') + 1)}: ${err.error}`);
      });
      if (results.errors.length > 10) {
        console.log(`  ... and ${results.errors.length - 10} more`);
      }
    }
    
    console.log('='.repeat(60));
    
    if (!FULL_RUN && allListingUrls.length > SAMPLE_SIZE) {
      console.log(`\n✅ Sample complete! To process all ${allListingUrls.length} listings, run:`);
      console.log(`   node scripts/extract-and-import-fantasy-junction-listings.js --full\n`);
    } else {
      console.log('\n✅ Import complete!\n');
    }
    
    console.log(`View organization: https://n-zero.dev/org/${ORG_ID}\n`);

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

