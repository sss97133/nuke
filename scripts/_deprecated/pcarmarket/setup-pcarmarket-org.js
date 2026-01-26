#!/usr/bin/env node
/**
 * SETUP PCARMARKET ORGANIZATION
 * 
 * Creates PCarMarket organization profile in the businesses table
 * and adds it to the organization mapping service
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupPCarMarketOrg() {
  console.log('🚀 Setting up PCarMarket organization...\n');
  
  // Check if org already exists
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  if (existing) {
    console.log(`✅ Organization already exists:`);
    console.log(`   ID: ${existing.id}`);
    console.log(`   Name: ${existing.business_name}`);
    console.log(`   Website: ${existing.website}`);
    console.log(`\n💡 Use this ID in your .env file:`);
    console.log(`   PCARMARKET_ORG_ID=${existing.id}\n`);
    return existing.id;
  }
  
  // Create new organization
  console.log('📋 Creating new organization...');
  
  const { data: newOrg, error } = await supabase
    .from('businesses')
    .insert({
      business_name: 'PCarMarket',
      business_type: 'auction_house',
      website: 'https://www.pcarmarket.com',
      description: 'Premium car auction marketplace specializing in high-end and collectible vehicles',
      industry_focus: ['classic_cars', 'exotics', 'collectibles'],
      is_verified: false,
      is_public: true,
      status: 'active'
    })
    .select('id, business_name, website')
    .single();
  
  if (error) {
    console.error('❌ Error creating organization:', error);
    process.exit(1);
  }
  
  console.log(`✅ Created organization:`);
  console.log(`   ID: ${newOrg.id}`);
  console.log(`   Name: ${newOrg.business_name}`);
  console.log(`   Website: ${newOrg.website}`);
  console.log(`\n💡 Add this to your .env file:`);
  console.log(`   PCARMARKET_ORG_ID=${newOrg.id}\n`);
  
  return newOrg.id;
}

async function main() {
  try {
    await setupPCarMarketOrg();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

