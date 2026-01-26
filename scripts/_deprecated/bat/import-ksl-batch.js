#!/usr/bin/env node
/**
 * Batch import KSL listings
 * Imports multiple listings in parallel batches
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// List of KSL listing URLs to import
// Add more URLs here as you find them
const LISTING_URLS = [
  'https://cars.ksl.com/listing/10302276', // 1980 Chevrolet C-Series
  'https://cars.ksl.com/listing/10323198', // 1988 Chevrolet S-10
  'https://cars.ksl.com/listing/10322827', // 1970 Chevrolet Chevelle
  'https://cars.ksl.com/listing/10322112', // 1980 Chevrolet 1/2 Ton
  'https://cars.ksl.com/listing/10321970', // 1978 Chevrolet C20
  'https://cars.ksl.com/listing/10321968', // 1988 Chevrolet C/K 3500
  'https://cars.ksl.com/listing/10297247', // 1987 Chevrolet R/V 10
  'https://cars.ksl.com/listing/10321302', // 1972 Chevrolet Camaro
  'https://cars.ksl.com/listing/10321283', // 1972 Chevrolet El Camino
  'https://cars.ksl.com/listing/10269335', // 1976 Chevrolet C-Series
  'https://cars.ksl.com/listing/10299803', // 1986 Chevrolet C/K 10
  'https://cars.ksl.com/listing/10320525', // 1970 Chevrolet C/K 10
  'https://cars.ksl.com/listing/10275450', // 1989 Chevrolet Astro Van
  'https://cars.ksl.com/listing/10319968', // 1989 Chevrolet Cargo Van
  'https://cars.ksl.com/listing/10319820', // 1991 Chevrolet C/K 2500
];

async function importListing(url, index, total) {
  try {
    console.log(`[${index}/${total}] ${url}`);
    
    // Check if already exists
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', url)
      .maybeSingle();
    
    if (existing) {
      console.log(`   ⏭️  Already exists: ${existing.id}`);
      return { success: true, created: false, vehicleId: existing.id };
    }
    
    // Scrape the listing
    const { data: response, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url },
      timeout: 60000
    });
    
    if (scrapeError) {
      console.log(`   ❌ Scrape error: ${scrapeError.message}`);
      return { success: false, error: scrapeError.message };
    }
    
    // Handle wrapped response format
    const listingData = response?.data || response;
    
    if (!listingData || (!listingData.title && !listingData.listing_url)) {
      console.log(`   ⚠️  No data returned`);
      return { success: false, error: 'No data' };
    }
    
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
      console.log(`   ⚠️  Could not extract vehicle info`);
      return { success: false, error: 'Could not extract vehicle info' };
    }
    
    // Check by VIN if available
    if (listingData.vin) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', listingData.vin)
        .maybeSingle();
      
      if (vinMatch) {
        console.log(`   ⏭️  Vehicle with VIN already exists: ${vinMatch.id}`);
        await supabase
          .from('vehicles')
          .update({ discovery_url: url })
          .eq('id', vinMatch.id);
        return { success: true, created: false, vehicleId: vinMatch.id };
      }
    }
    
    // Create vehicle
    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert({
        year,
        make: make.toLowerCase(),
        model: model.toLowerCase(),
        vin: listingData.vin || null,
        mileage: listingData.mileage || null,
        asking_price: listingData.asking_price || null,
        profile_origin: 'ksl_import',
        discovery_source: 'ksl_automated_import',
        discovery_url: url,
        origin_metadata: {
          ksl_listing_title: listingData.title,
          scraped_at: new Date().toISOString()
        },
        is_public: true,
        status: 'active',
        description: listingData.description || null
      })
      .select('id')
      .single();
    
    if (vehicleError) {
      console.log(`   ❌ Error: ${vehicleError.message}`);
      return { success: false, error: vehicleError.message };
    }
    
    console.log(`   ✅ Created: ${newVehicle.id} (${year} ${make} ${model})`);
    return { success: true, created: true, vehicleId: newVehicle.id };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const maxListings = parseInt(process.argv[2]) || 20;
  
  // Try to load from Firecrawl results file first
  let urls = LISTING_URLS;
  const firecrawlFile = path.join(process.cwd(), 'ksl-listings-firecrawl.json');
  if (fs.existsSync(firecrawlFile)) {
    try {
      const firecrawlUrls = JSON.parse(fs.readFileSync(firecrawlFile, 'utf-8'));
      if (Array.isArray(firecrawlUrls) && firecrawlUrls.length > 0) {
        console.log(`📋 Loaded ${firecrawlUrls.length} URLs from Firecrawl results\n`);
        urls = firecrawlUrls;
      }
    } catch (e) {
      console.log('⚠️  Could not load Firecrawl results, using default list\n');
    }
  }
  
  // Remove duplicates and limit
  const uniqueUrls = Array.from(new Set(urls)).slice(0, maxListings);
  
  console.log('🚀 KSL Batch Import\n');
  console.log(`📋 Processing ${uniqueUrls.length} listings...\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const results = [];
  
  // Process in batches of 3 to avoid rate limiting
  const batchSize = 3;
  for (let i = 0; i < uniqueUrls.length; i += batchSize) {
    const batch = uniqueUrls.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(uniqueUrls.length / batchSize);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} listings)\n`);
    
    const batchResults = await Promise.all(
      batch.map((url, idx) => importListing(url, i + idx + 1, uniqueUrls.length))
    );
    
    batchResults.forEach(result => {
      results.push(result);
      if (result.success) {
        if (result.created) imported++;
        else skipped++;
      } else {
        errors++;
      }
    });
    
    // Rate limiting between batches
    if (i + batchSize < uniqueUrls.length) {
      console.log(`\n⏳ Waiting 3 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successfully imported: ${imported} vehicles`);
  console.log(`⏭️  Skipped (already exists): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Show summary
  if (imported > 0) {
    console.log('📊 New vehicles created:');
    results
      .filter(r => r.success && r.created)
      .forEach(r => console.log(`   - ${r.vehicleId}`));
    console.log('');
  }
}

main().catch(console.error);

