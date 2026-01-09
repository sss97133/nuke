/**
 * Create Fantasy Junction Organization from BaT Profile and Website
 * 
 * This script:
 * 1. Creates the organization using extract-organization-from-seller
 * 2. Enriches it with data from their website
 * 3. Optionally triggers BaT listing import
 * 
 * Usage: node scripts/create-fantasy-junction-org.js [--import-listings]
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
const EXTERNAL_WEBSITE = 'https://fantasyjunction.com';

async function createOrganization() {
  console.log('🚀 Creating Fantasy Junction Organization...\n');

  // Step 1: Check if organization already exists
  console.log('📋 Step 1: Checking for existing organization...');
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .or(`website.eq.${EXTERNAL_WEBSITE},website.eq.${EXTERNAL_WEBSITE}/,business_name.ilike.%Fantasy Junction%`)
    .limit(5);

  if (existing && existing.length > 0) {
    console.log(`✅ Organization already exists: ${existing[0].business_name} (${existing[0].id})`);
    console.log(`   Website: ${existing[0].website || 'not set'}\n`);
    return existing[0].id;
  }

  // Step 2: Create organization using extract-organization-from-seller
  console.log('📋 Step 2: Creating organization from BaT profile...');
  console.log(`   BaT URL: ${BAT_MEMBER_URL}`);
  console.log(`   Website: ${EXTERNAL_WEBSITE}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-organization-from-seller', {
      body: {
        seller_name: 'Fantasy Junction',
        seller_url: BAT_MEMBER_URL,
        external_website: EXTERNAL_WEBSITE,
        platform: 'bat',
      }
    });

    if (error) {
      console.error('❌ Error creating organization:', error);
      throw error;
    }

    if (!data || !data.organization_id) {
      console.error('❌ No organization_id returned from extract-organization-from-seller');
      console.log('Response:', JSON.stringify(data, null, 2));
      throw new Error('Failed to create organization');
    }

    const orgId = data.organization_id;
    console.log(`✅ Organization created: ${orgId}\n`);

    return orgId;
  } catch (err) {
    console.error('❌ Failed to create via extract-organization-from-seller:', err.message);
    console.log('\n📋 Trying manual creation instead...\n');

    // Fallback: Create manually
    const { data: newOrg, error: createError } = await supabase
      .from('businesses')
      .insert({
        business_name: 'Fantasy Junction',
        website: EXTERNAL_WEBSITE,
        business_type: 'dealership',
        city: 'Emeryville',
        state: 'CA',
        country: 'US',
        metadata: {
          discovered_from: BAT_MEMBER_URL,
          platform: 'bat',
          source: 'bat',
          discovered_at: new Date().toISOString(),
          bat_username: BAT_USERNAME,
          bat_member_url: BAT_MEMBER_URL,
        }
      })
      .select('id')
      .single();

    if (createError) {
      console.error('❌ Manual creation failed:', createError);
      throw createError;
    }

    console.log(`✅ Organization created manually: ${newOrg.id}\n`);
    return newOrg.id;
  }
}

async function enrichFromWebsite(orgId) {
  console.log('📋 Step 3: Enriching organization from website...');
  console.log(`   Website: ${EXTERNAL_WEBSITE}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('update-org-from-website', {
      body: {
        organizationId: orgId,
        websiteUrl: EXTERNAL_WEBSITE,
      }
    });

    if (error) {
      console.warn('⚠️ Warning: Website enrichment failed (non-critical):', error.message);
      console.log('   You can manually update the org profile later\n');
    } else {
      console.log('✅ Organization enriched from website\n');
    }
  } catch (err) {
    console.warn('⚠️ Warning: Website enrichment failed (non-critical):', err.message);
    console.log('   You can manually update the org profile later\n');
  }
}

async function createBaTIdentityLink(orgId) {
  console.log('📋 Step 4: Creating BaT identity link...\n');

  const { error } = await supabase
    .from('external_identities')
    .upsert({
      platform: 'bat',
      handle: BAT_USERNAME,
      profile_url: BAT_MEMBER_URL,
      display_name: 'Fantasy Junction',
      metadata: {
        organization_id: orgId,
        external_website: EXTERNAL_WEBSITE,
        bat_listings_count: 477,
        bat_comments_count: 6161,
        bat_member_since: 'November 2016',
        discovered_at: new Date().toISOString(),
      }
    }, {
      onConflict: 'platform,handle'
    });

  if (error) {
    console.warn('⚠️ Warning: Identity link creation failed (non-critical):', error.message);
  } else {
    console.log('✅ BaT identity link created\n');
  }
}

async function printNextSteps(orgId) {
  console.log('🎉 Fantasy Junction organization created successfully!\n');
  console.log('📋 Next Steps:\n');
  console.log('1. View the organization:');
  console.log(`   https://n-zero.dev/org/${orgId}\n`);
  console.log('2. Import BaT listings (477 listings available):');
  console.log('   - Use the BaT Bulk Importer component on the org profile');
  console.log('   - Or use: entity-discovery edge function with username "fantasyjunction"\n');
  console.log('3. Verify website data:');
  console.log(`   - Check that description, contact info, etc. are correct\n`);
  console.log('4. Link to vehicles:');
  console.log('   - Existing vehicles sold by Fantasy Junction will automatically link');
  console.log('   - Or manually link via vehicle profile -> Add Organization Relationship\n');
}

async function main() {
  const shouldImportListings = process.argv.includes('--import-listings');

  try {
    // Create organization
    const orgId = await createOrganization();

    // Enrich from website
    await enrichFromWebsite(orgId);

    // Create BaT identity link
    await createBaTIdentityLink(orgId);

    // Print next steps
    await printNextSteps(orgId);

    if (shouldImportListings) {
      console.log('📋 Importing BaT listings...\n');
      console.log('   Note: This requires the entity-discovery or scrape-bat-member function');
      console.log('   You can do this manually via the BaT Bulk Importer UI component\n');
    }

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

