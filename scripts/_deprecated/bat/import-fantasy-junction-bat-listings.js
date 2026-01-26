/**
 * Import Fantasy Junction BaT Listings
 * 
 * Uses entity-discovery to scrape their BaT profile and import listings
 * 
 * Usage: node scripts/import-fantasy-junction-bat-listings.js
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
const ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69'; // From previous script

async function discoverAndImport() {
  console.log('🚀 Discovering Fantasy Junction BaT profile and importing listings...\n');
  console.log(`   BaT Username: ${BAT_USERNAME}`);
  console.log(`   Organization ID: ${ORG_ID}\n`);

  try {
    // Step 1: Discover entity (scrapes BaT profile)
    console.log('📋 Step 1: Discovering entity from BaT profile...\n');
    
    const { data: discoveryData, error: discoveryError } = await supabase.functions.invoke('entity-discovery', {
      body: {
        username: BAT_USERNAME,
        save_to_db: false, // Just get the data first
      }
    });

    if (discoveryError) {
      console.error('❌ Discovery failed:', discoveryError);
      throw discoveryError;
    }

    if (!discoveryData || !discoveryData.entity) {
      console.error('❌ No entity data returned');
      throw new Error('Discovery returned no entity data');
    }

    console.log('✅ Entity discovered:');
    console.log(`   - Display Name: ${discoveryData.entity.display_name || discoveryData.entity.username}`);
    console.log(`   - Website: ${discoveryData.entity.website || 'not found'}`);
    console.log(`   - Location: ${discoveryData.entity.location || 'not found'}`);
    if (discoveryData.entity.profiles) {
      const batProfile = discoveryData.entity.profiles.find((p) => p.platform === 'bat');
      if (batProfile && batProfile.data) {
        console.log(`   - BaT Listings: ${batProfile.data.listings_count || 0}`);
        console.log(`   - BaT Comments: ${batProfile.data.comments_count || 0}`);
      }
    }
    console.log('');

    // Step 2: Check if we should use scrape-bat-member to get listing URLs
    console.log('📋 Step 2: Getting BaT listing URLs...\n');
    
    try {
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-bat-member', {
        body: {
          memberUrl: `https://bringatrailer.com/member/${BAT_USERNAME}/`
        }
      });

      if (!scrapeError && scrapeData && scrapeData.listings) {
        console.log(`✅ Found ${scrapeData.listings.length} listing URLs\n`);
        
        if (scrapeData.listings.length > 0) {
          console.log('📋 Step 3: Importing listings (this may take a while)...\n');
          console.log('   Note: You can also use the BaT Bulk Importer UI component');
          console.log('   on the organization profile page for a better experience.\n');
          
          // Show first few listings as example
          console.log('   Sample listings:');
          scrapeData.listings.slice(0, 5).forEach((listing, i) => {
            console.log(`   ${i + 1}. ${listing}`);
          });
          if (scrapeData.listings.length > 5) {
            console.log(`   ... and ${scrapeData.listings.length - 5} more\n`);
          }
        }
      } else {
        console.log('⚠️ Could not scrape listing URLs (function may not exist or failed)');
        console.log('   You can manually import via the BaT Bulk Importer UI component\n');
      }
    } catch (scrapeErr) {
      console.log('⚠️ scrape-bat-member function not available or failed');
      console.log('   You can manually import via the BaT Bulk Importer UI component\n');
    }

    // Step 3: Print instructions
    console.log('📋 Next Steps:\n');
    console.log('1. Go to the organization profile:');
    console.log(`   https://n-zero.dev/org/${ORG_ID}\n`);
    console.log('2. Use the BaT Bulk Importer component to import listings');
    console.log('   (if available on the org profile page)\n');
    console.log('3. Or manually import listings using:');
    console.log('   - BaT Bulk Importer component');
    console.log('   - Or import-bat-listing edge function for each listing URL\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

discoverAndImport();

