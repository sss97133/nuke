#!/usr/bin/env node
/**
 * Create duPont Registry organization profiles
 * Creates both main marketplace and Live auction platform orgs
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function setupDuPontRegistryOrgs() {
  console.log('🚀 SETTING UP DUPONT REGISTRY ORGANIZATION PROFILES\n');
  console.log('='.repeat(60));
  console.log('');

  // 1. Main Marketplace Organization
  console.log('1. Creating duPont Registry (Main Marketplace)...');
  
  const { data: existingMain } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .eq('website', 'https://www.dupontregistry.com')
    .maybeSingle();

  if (existingMain) {
    console.log(`   ✅ Already exists: ${existingMain.business_name} (${existingMain.id})`);
  } else {
    const { data: newMain, error: mainError } = await supabase
      .from('businesses')
      .insert({
        business_name: 'duPont Registry',
        business_type: 'other', // 'marketplace' not in allowed types, using 'other'
        website: 'https://www.dupontregistry.com',
        description: 'Luxury and exotic car marketplace featuring dealer and private sales',
        is_public: true,
        is_verified: false,
        metadata: {
          platforms: ['www.dupontregistry.com'],
          source_type: 'marketplace',
          has_auctions: false,
          discovered_at: new Date().toISOString()
        }
      })
      .select('id, business_name')
      .single();

    if (mainError) {
      console.error(`   ❌ Error: ${mainError.message}`);
    } else {
      console.log(`   ✅ Created: ${newMain.business_name} (${newMain.id})`);
    }
  }
  console.log('');

  // 2. Live Auctions Organization
  console.log('2. Creating duPont Registry Live (Auction Platform)...');
  
  const { data: existingLive } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .eq('website', 'https://live.dupontregistry.com')
    .maybeSingle();

  if (existingLive) {
    console.log(`   ✅ Already exists: ${existingLive.business_name} (${existingLive.id})`);
  } else {
    const { data: newLive, error: liveError } = await supabase
      .from('businesses')
      .insert({
        business_name: 'duPont Registry Live',
        business_type: 'auction_house',
        website: 'https://live.dupontregistry.com',
        description: 'Live auction platform for luxury and exotic vehicles',
        is_public: true,
        is_verified: false,
        metadata: {
          platforms: ['live.dupontregistry.com'],
          source_type: 'auction_house',
          parent_platform: 'dupontregistry.com',
          has_bidding: true,
          has_14_day_return: true,
          sell_through_rate: '100%',
          discovered_at: new Date().toISOString()
        }
      })
      .select('id, business_name')
      .single();

    if (liveError) {
      console.error(`   ❌ Error: ${liveError.message}`);
    } else {
      console.log(`   ✅ Created: ${newLive.business_name} (${newLive.id})`);
    }
  }
  console.log('');

  // 3. Verify both exist
  console.log('3. Verifying organizations...');
  const { data: allOrgs } = await supabase
    .from('businesses')
    .select('id, business_name, website, business_type')
    .or('website.eq.https://www.dupontregistry.com,website.eq.https://live.dupontregistry.com');

  if (allOrgs && allOrgs.length > 0) {
    console.log(`   ✅ Found ${allOrgs.length} duPont Registry organization(s):`);
    allOrgs.forEach(org => {
      console.log(`      - ${org.business_name} (${org.business_type}) - ${org.website}`);
    });
  } else {
    console.log('   ⚠️  No organizations found');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ SETUP COMPLETE');
  console.log('='.repeat(60));
}

setupDuPontRegistryOrgs().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

