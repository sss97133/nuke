/**
 * Update Cantech Automotive Organization Profile
 * 
 * Extracts data from their website and updates the organization profile
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CANTECH_ORG_ID = 'db6585be-dfab-4f07-ac73-11d18586d4f6';
const CANTECH_WEBSITE = 'https://cantechautomotive.com';

async function updateCantechProfile() {
  console.log('🔍 Updating Cantech Automotive profile...\n');

  // Get current organization
  const { data: org, error: orgError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', CANTECH_ORG_ID)
    .single();

  if (orgError || !org) {
    console.error('❌ Organization not found:', orgError?.message);
    return;
  }

  console.log(`Current org: ${org.business_name}`);
  console.log(`Current website: ${org.website || 'NOT SET'}\n`);

  // Fetch homepage
  console.log(`📡 Fetching ${CANTECH_WEBSITE}...`);
  const response = await fetch(CANTECH_WEBSITE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    console.error(`❌ Failed to fetch website: ${response.status}`);
    return;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract organization data
  const updates = {};

  // Extract website if not set
  if (!org.website) {
    const canonicalLink = $('link[rel="canonical"]').attr('href');
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (canonicalLink) {
      updates.website = canonicalLink;
    } else if (ogUrl) {
      updates.website = ogUrl;
    } else {
      updates.website = CANTECH_WEBSITE;
    }
    console.log(`✅ Found website: ${updates.website}`);
  }

  // Extract description
  const metaDesc = $('meta[name="description"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  if ((metaDesc || ogDesc) && !org.description) {
    updates.description = metaDesc || ogDesc;
    console.log(`✅ Found description: ${(updates.description || '').substring(0, 100)}...`);
  }

  // Extract logo
  let logoUrl = null;
  // Try og:image first
  logoUrl = $('meta[property="og:image"]').attr('content');
  
  if (!logoUrl) {
    // Try logo images
    const logoImg = $('img[alt*="logo" i], img[class*="logo" i], img[id*="logo" i], .logo img, #logo img').first();
    logoUrl = logoImg.attr('src') || logoImg.attr('data-src');
  }

  if (logoUrl) {
    // Make absolute URL
    if (logoUrl.startsWith('//')) {
      logoUrl = `https:${logoUrl}`;
    } else if (logoUrl.startsWith('/')) {
      logoUrl = `${CANTECH_WEBSITE}${logoUrl}`;
    }
    
    if (logoUrl && !org.logo_url) {
      updates.logo_url = logoUrl;
      console.log(`✅ Found logo: ${logoUrl}`);
    }
  }

  // Extract contact info
  const phonePattern = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
  const phoneMatch = html.match(phonePattern);
  if (phoneMatch && !org.phone) {
    updates.phone = phoneMatch[0].replace(/\s+/g, '-');
    console.log(`✅ Found phone: ${updates.phone}`);
  }

  // Extract address - look for common patterns
  const addressText = $('[itemprop="address"], .address, [class*="address"], [class*="location"]').first().text().trim();
  if (addressText && addressText.length > 10 && !org.address) {
    // Clean up address text
    const cleaned = addressText.replace(/\s+/g, ' ').substring(0, 200);
    updates.address = cleaned;
    console.log(`✅ Found address: ${cleaned}`);
  }

  // Update organization
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    
    const { error: updateError } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', CANTECH_ORG_ID);

    if (updateError) {
      console.error('❌ Failed to update organization:', updateError.message);
      return;
    }

    console.log(`\n✅ Updated organization with: ${Object.keys(updates).join(', ')}`);
  } else {
    console.log('\n✅ No updates needed (all fields already set)');
  }

  // Also check for vehicles that should be linked
  console.log('\n🔍 Checking for vehicles to link...');
  
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, discovery_url, origin_organization_id')
    .or(`discovery_url.ilike.%cantechautomotive.com%,origin_organization_id.eq.${CANTECH_ORG_ID}`)
    .limit(100);

  console.log(`Found ${vehicles?.length || 0} vehicles from Cantech`);

  // Check which ones are linked
  if (vehicles && vehicles.length > 0) {
    const vehicleIds = vehicles.map(v => v.id);
    const { data: links } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id, relationship_type, status')
      .eq('organization_id', CANTECH_ORG_ID)
      .in('vehicle_id', vehicleIds);

    const linkedIds = new Set(links?.map(l => l.vehicle_id) || []);
    const unlinked = vehicles.filter(v => !linkedIds.has(v.id));

    console.log(`\n📊 Link Status:`);
    console.log(`  Total vehicles: ${vehicles.length}`);
    console.log(`  Already linked: ${linkedIds.size}`);
    console.log(`  Not linked: ${unlinked.length}`);

    if (unlinked.length > 0) {
      console.log(`\n🔗 Linking ${unlinked.length} vehicles...`);
      
      const inserts = unlinked.map(v => ({
        organization_id: CANTECH_ORG_ID,
        vehicle_id: v.id,
        relationship_type: 'seller', // Cantech is a dealer/seller
        status: 'active',
        auto_tagged: true,
      }));

      const { error: linkError } = await supabase
        .from('organization_vehicles')
        .upsert(inserts, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });

      if (linkError) {
        console.error('❌ Error linking vehicles:', linkError.message);
      } else {
        console.log(`✅ Linked ${unlinked.length} vehicles to Cantech Automotive`);
      }
    }
  }

  console.log('\n✅ Done!');
}

updateCantechProfile().catch(console.error);

