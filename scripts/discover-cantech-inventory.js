/**
 * Discover and Import Cantech Automotive Inventory
 * 
 * Scrapes their website to find all vehicle listings and imports them
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const CANTECH_ORG_ID = 'db6585be-dfab-4f07-ac73-11d18586d4f6';
const CANTECH_WEBSITE = 'https://cantechautomotive.com';

async function discoverInventory() {
  console.log('🔍 Discovering Cantech Automotive inventory...\n');

  // Try to find inventory/listing pages
  const inventoryUrls = [
    `${CANTECH_WEBSITE}/inventory/`,
    `${CANTECH_WEBSITE}/vehicles/`,
    `${CANTECH_WEBSITE}/listings/`,
    `${CANTECH_WEBSITE}/cars/`,
  ];

  const listingUrls = new Set();

  for (const url of inventoryUrls) {
    try {
      console.log(`📡 Checking ${url}...`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const $ = cheerio.load(html);

        // Find all listing links
        $('a[href*="/listing/"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) {
            let fullUrl = href;
            if (href.startsWith('/')) {
              fullUrl = `${CANTECH_WEBSITE}${href}`;
            } else if (!href.startsWith('http')) {
              return;
            }
            listingUrls.add(fullUrl);
          }
        });

        console.log(`   Found ${listingUrls.size} listing URLs so far`);
      }
    } catch (e) {
      console.log(`   Failed: ${e.message}`);
    }
  }

  // Also check homepage for featured vehicles
  try {
    console.log(`\n📡 Checking homepage for featured vehicles...`);
    const response = await fetch(CANTECH_WEBSITE, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);

      $('a[href*="/listing/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          let fullUrl = href;
          if (href.startsWith('/')) {
            fullUrl = `${CANTECH_WEBSITE}${href}`;
          } else if (!href.startsWith('http')) {
            return;
          }
          listingUrls.add(fullUrl);
        }
      });
    }
  } catch (e) {
    console.log(`   Failed: ${e.message}`);
  }

  console.log(`\n📋 Found ${listingUrls.size} total listing URLs\n`);

  // Check which ones are already imported
  const listingArray = Array.from(listingUrls);
  const { data: existingVehicles } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .in('discovery_url', listingArray);

  const existingUrls = new Set(existingVehicles?.map(v => v.discovery_url) || []);
  const newUrls = listingArray.filter(url => !existingUrls.has(url));

  console.log(`✅ Already imported: ${existingUrls.size}`);
  console.log(`🆕 New listings to import: ${newUrls.length}\n`);

  if (newUrls.length > 0) {
    console.log('New listings:');
    newUrls.slice(0, 10).forEach((url, i) => {
      console.log(`   ${i + 1}. ${url}`);
    });
    if (newUrls.length > 10) {
      console.log(`   ... and ${newUrls.length - 10} more`);
    }

    console.log(`\n📥 Adding ${newUrls.length} listings to import queue...`);

    // Get or create scrape source for Cantech
    let sourceId = null;
    const { data: existingSource } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('base_url', CANTECH_WEBSITE)
      .maybeSingle();

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      // Create source
      const { data: newSource, error: sourceError } = await supabase
        .from('scrape_sources')
        .insert({
          name: 'Cantech Automotive',
          base_url: CANTECH_WEBSITE,
          source_type: 'dealer_website',
          is_active: true,
        })
        .select('id')
        .single();

      if (newSource) {
        sourceId = newSource.id;
      } else {
        console.warn('⚠️  Could not create scrape source, adding without source_id');
      }
    }

    // Add to import queue
    const queueItems = newUrls.map(url => ({
      listing_url: url,
      source_id: sourceId,
      status: 'pending',
      priority: 50,
      raw_data: {
        source: 'cantechautomotive.com',
        discovered_at: new Date().toISOString(),
      },
    }));

    const { error: queueError } = await supabase
      .from('import_queue')
      .upsert(queueItems, {
        onConflict: 'listing_url',
        ignoreDuplicates: false,
      });

    if (queueError) {
      console.error('❌ Error adding to queue:', queueError.message);
    } else {
      console.log(`✅ Added ${newUrls.length} listings to import queue`);
      console.log(`   They will be processed automatically by the import queue`);
    }
  }

  // Also check for vehicles that should be linked but aren't
  if (existingVehicles && existingVehicles.length > 0) {
    const vehicleIds = existingVehicles.map(v => v.id);
    const { data: links } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id')
      .eq('organization_id', CANTECH_ORG_ID)
      .in('vehicle_id', vehicleIds);

    const linkedIds = new Set(links?.map(l => l.vehicle_id) || []);
    const unlinked = existingVehicles.filter(v => !linkedIds.has(v.id));

    if (unlinked.length > 0) {
      console.log(`\n🔗 Linking ${unlinked.length} existing vehicles to Cantech...`);
      
      const linkInserts = unlinked.map(v => ({
        organization_id: CANTECH_ORG_ID,
        vehicle_id: v.id,
        relationship_type: 'seller', // Cantech is a dealer/seller
        status: 'active',
        auto_tagged: true,
      }));

      const { error: linkError } = await supabase
        .from('organization_vehicles')
        .upsert(linkInserts, {
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

discoverInventory().catch(console.error);

