#!/usr/bin/env node
/**
 * Import KSL listings from the test JSON file
 * Tests the import functionality with the listings we already scraped
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

async function scrapeKSLListing(url) {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url }
    });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`   ❌ Error scraping ${url}:`, error.message);
    return null;
  }
}

async function findOrCreateVehicle(listingData, kslUrl) {
  // Check if vehicle already exists by discovery_url
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', kslUrl)
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, created: false };
  }
  
  // Extract year, make, model from title
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
    return { id: null, created: false, error: 'Could not extract year/make/model' };
  }
  
  // Extract price from title if available
  const priceMatch = listingData.title?.match(/\$([\d,]+)/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
  
  // Create vehicle
  const { data: newVehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .insert({
      year,
      make: make.toLowerCase(),
      model: model.toLowerCase(),
      vin: listingData.vin || null,
      mileage: listingData.mileage || null,
      asking_price: price || listingData.asking_price || null,
      profile_origin: 'ksl_import',
      discovery_source: 'ksl_automated_import',
      discovery_url: kslUrl,
      origin_metadata: {
        ksl_listing_title: listingData.title,
        ksl_listing_id: listingData.listingId,
        scraped_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active',
      description: listingData.description || null
    })
    .select('id')
    .single();
  
  if (vehicleError) {
    return { id: null, created: false, error: vehicleError.message };
  }
  
  return { id: newVehicle.id, created: true };
}

async function main() {
  const inputFile = path.join(process.cwd(), 'ksl-test-listings.json');
  
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    console.log('   Run scripts/test-ksl-scraper.js first to generate listings');
    return;
  }
  
  const listings = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`📋 Found ${listings.length} listings to import\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const results = [];
  
  // Process in batches of 5
  const batchSize = 5;
  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} (${batch.length} listings)...`);
    
    const batchResults = await Promise.all(
      batch.map(async (listing, idx) => {
        const globalIdx = i + idx + 1;
        console.log(`[${globalIdx}/${listings.length}] ${listing.url}`);
        
        try {
          // Scrape the listing for detailed data
          const listingData = await scrapeKSLListing(listing.url);
          
          if (!listingData) {
            // Try with just the title data we have
            const result = await findOrCreateVehicle(listing, listing.url);
            if (result.error) {
              errors++;
              return { url: listing.url, success: false, error: result.error };
            }
            
            if (result.created) {
              imported++;
              console.log(`   ✅ Created: ${result.id}`);
            } else {
              skipped++;
              console.log(`   ⏭️  Already exists: ${result.id}`);
            }
            
            return { url: listing.url, success: true, vehicleId: result.id, created: result.created };
          }
          
          // Merge with listing metadata
          const mergedData = {
            ...listingData,
            title: listingData.title || listing.title,
            listingId: listing.listingId
          };
          
          // Import to database
          const result = await findOrCreateVehicle(mergedData, listing.url);
          
          if (result.error) {
            errors++;
            return { url: listing.url, success: false, error: result.error };
          }
          
          if (result.created) {
            imported++;
            console.log(`   ✅ Created: ${result.id}`);
          } else {
            skipped++;
            console.log(`   ⏭️  Already exists: ${result.id}`);
          }
          
          return { url: listing.url, success: true, vehicleId: result.id, created: result.created };
          
        } catch (error) {
          errors++;
          console.error(`   ❌ Error: ${error.message}`);
          return { url: listing.url, success: false, error: error.message };
        }
      })
    );
    
    results.push(...batchResults);
    
    // Rate limiting
    if (i + batchSize < listings.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successfully imported: ${imported} vehicles`);
  console.log(`⏭️  Skipped (already exists): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Save results
  const outputFile = path.join(process.cwd(), 'ksl-import-results.json');
  fs.writeFileSync(
    outputFile,
    JSON.stringify({ results, summary: { imported, skipped, errors } }, null, 2)
  );
  console.log(`💾 Results saved to ${outputFile}`);
}

main().catch(console.error);

