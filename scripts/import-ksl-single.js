#!/usr/bin/env node
/**
 * Import a single KSL listing
 * Uses the scrape-vehicle function which supports Firecrawl
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function importListing(url) {
  console.log(`🚀 Importing KSL Listing\n`);
  console.log(`URL: ${url}\n`);
  
  try {
    // Check if already exists
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', url)
      .maybeSingle();
    
    if (existing) {
      console.log(`⏭️  Already exists: ${existing.id}`);
      return { id: existing.id, created: false };
    }
    
    // Scrape the listing
    console.log('📥 Scraping listing...');
    const { data: response, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url },
      timeout: 60000
    });
    
    if (scrapeError) {
      throw new Error(`Scrape failed: ${scrapeError.message}`);
    }
    
    // Handle wrapped response format
    const listingData = response?.data || response;
    
    if (!listingData || (!listingData.title && !listingData.listing_url)) {
      console.log('Response structure:', JSON.stringify(response, null, 2).substring(0, 500));
      throw new Error('No data returned from scraper');
    }
    
    console.log(`✅ Scraped: ${listingData.title || listingData.listing_url}`);
    
    // Extract vehicle info
    let year = listingData.year;
    let make = listingData.make;
    let model = listingData.model;
    
    if (!year || !make || !model) {
      const title = listingData.title || '';
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0]);
      }
      
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        make = parts[0];
        model = parts.slice(1, 3).join(' ');
      }
    }
    
    if (!year || !make || !model) {
      throw new Error('Could not extract year/make/model from listing');
    }
    
    // Check by VIN if available
    if (listingData.vin) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', listingData.vin)
        .maybeSingle();
      
      if (vinMatch) {
        console.log(`⏭️  Vehicle with VIN already exists: ${vinMatch.id}`);
        await supabase
          .from('vehicles')
          .update({ discovery_url: url })
          .eq('id', vinMatch.id);
        return { id: vinMatch.id, created: false };
      }
    }
    
    console.log(`\n📝 Creating vehicle: ${year} ${make} ${model}`);
    
    // Handle dealer organization if applicable
    let organizationId = null;
    if (listingData.is_dealer && listingData.dealer_name) {
      console.log(`  🏢 Dealer: ${listingData.dealer_name}`);
      
      // Check if organization exists
      const orgSlug = listingData.dealer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { data: existingOrg } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', orgSlug)
        .maybeSingle();
      
      if (existingOrg) {
        organizationId = existingOrg.id;
        console.log(`  ✅ Organization exists: ${organizationId}`);
      } else {
        // Create organization
        const { data: newOrg } = await supabase
          .from('organizations')
          .insert({
            name: listingData.dealer_name,
            slug: orgSlug,
            type: 'dealer',
            address: listingData.dealer_address || null,
            metadata: {
              ksl_dealer: true,
              license_number: listingData.dealer_license,
              source: 'ksl_automated_import'
            },
            is_public: true
          })
          .select('id')
          .single();
        
        if (newOrg) {
          organizationId = newOrg.id;
          console.log(`  ✅ Created organization: ${organizationId}`);
        }
      }
    }
    
    // Create vehicle with ALL extracted fields
    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert({
        year,
        make: make.toLowerCase(),
        model: model.toLowerCase(),
        trim: listingData.trim || null,
        vin: listingData.vin || null,
        mileage: listingData.mileage || null,
        asking_price: listingData.asking_price || null,
        body_style: listingData.body_style || null,
        profile_origin: 'ksl_import',
        discovery_source: 'ksl_automated_import',
        discovery_url: url,  // CRITICAL: Store the source URL
        origin_metadata: {
          ksl_listing_id: listingData.ksl_listing_id || null,
          ksl_listing_title: listingData.title,
          scraped_at: new Date().toISOString(),
          dealer_name: listingData.dealer_name || null,
          dealer_license: listingData.dealer_license || null,
          listed_date: listingData.listed_date || null,
          page_views: listingData.page_views || null,
          favorites_count: listingData.favorites_count || null,
          accident_history: listingData.accident_history || null,
          service_records_count: listingData.service_records_count || null,
          listing_expiration: listingData.listing_expiration || null
        },
        is_public: true,
        status: 'active',
        description: listingData.description || null,
        location: listingData.location || listingData.seller_city || null
      })
      .select('id')
      .single();
    
    if (vehicleError) {
      throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
    }
    
    console.log(`✅ Created vehicle: ${newVehicle.id}`);
    
    // Cache favicon for KSL
    try {
      await supabase.rpc('upsert_source_favicon', {
        p_domain: 'cars.ksl.com',
        p_favicon_url: 'https://www.ksl.com/favicon.ico',
        p_source_type: 'marketplace',
        p_source_name: 'KSL Cars',
        p_metadata: {}
      });
    } catch (e) {
      // Favicon caching is non-critical, just log
      console.log('  ℹ️  Favicon caching skipped');
    }
    
    // Link to organization if dealer
    if (organizationId) {
      await supabase
        .from('organization_inventory')
        .insert({
          organization_id: organizationId,
          vehicle_id: newVehicle.id,
          relationship_type: 'inventory',
          is_active: true,
          acquisition_source: 'ksl_listing'
        });
      console.log(`  ✅ Linked to organization`);
    }
    
    // Create timeline event for when listing was posted
    if (listingData.listed_date) {
      const eventDate = listingData.listed_date.split('T')[0];  // Just the date part
      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: newVehicle.id,
          event_type: 'other',  // Using 'other' since 'listing_posted' isn't in the allowed types
          event_category: 'ownership',
          event_date: eventDate,
          title: 'Listed for Sale on KSL',
          description: `Vehicle listed for sale at $${listingData.asking_price?.toLocaleString() || 'N/A'}${listingData.dealer_name ? ` by ${listingData.dealer_name}` : ''}`,
          source: 'ksl_automated_import',
          source_type: 'dealer_record',
          metadata: {
            listing_url: url,
            platform: 'ksl',
            dealer: listingData.dealer_name || null,
            price: listingData.asking_price || null,
            ksl_listing_id: listingData.ksl_listing_id || null
          }
        });
      console.log(`  ✅ Created timeline event for ${eventDate}`);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Successfully imported!');
    console.log(`Vehicle ID: ${newVehicle.id}`);
    if (organizationId) console.log(`Organization ID: ${organizationId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return { id: newVehicle.id, created: true };
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/import-ksl-single.js <ksl_listing_url>');
  process.exit(1);
}

importListing(url).catch(console.error);

