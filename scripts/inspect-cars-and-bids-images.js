#!/usr/bin/env node

/**
 * INSPECT CARS & BIDS IMAGES
 * 
 * Extracts images from a single Cars & Bids listing and displays them
 * so you can inspect which are real vehicle photos vs false flags
 * 
 * Usage: node scripts/inspect-cars-and-bids-images.js <url>
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-premium-auction`;

async function inspectImages(listingUrl) {
  console.log(`\n🔍 Inspecting images from: ${listingUrl}\n`);
  
  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: listingUrl,
        site_type: 'carsandbids',
        max_vehicles: 1,
        debug: true,
        download_images: false,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Extraction failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    console.log(`✅ Extraction completed`);
    console.log(`   Vehicles extracted: ${result.vehicles_extracted || 0}`);
    console.log(`   Vehicles created: ${result.vehicles_created || 0}`);
    console.log(`   Vehicles updated: ${result.vehicles_updated || 0}\n`);
    
    if (result.extracted && result.extracted.length > 0) {
      const vehicle = result.extracted[0];
      const images = vehicle.images || [];
      
      console.log(`📸 Images found: ${images.length}\n`);
      
      if (images.length > 0) {
        // Categorize images
        const editImages = [];
        const applicationImages = [];
        const validImages = [];
        
        images.forEach((url, i) => {
          const lower = String(url).toLowerCase();
          if (lower.includes('(edit)') || lower.includes('edit)') || lower.match(/\(edit/i) || lower.match(/edit\)/i)) {
            editImages.push({ index: i + 1, url });
          } else if (lower.includes('/application/') || lower.includes('/photos/application/')) {
            applicationImages.push({ index: i + 1, url });
          } else {
            validImages.push({ index: i + 1, url });
          }
        });
        
        console.log(`\n✅ VALID Images (${validImages.length}):`);
        validImages.slice(0, 15).forEach(({ index, url }) => {
          const clean = url.split('?')[0];
          console.log(`   ${index}. ${clean.substring(0, 120)}${clean.length > 120 ? '...' : ''}`);
        });
        
        if (editImages.length > 0) {
          console.log(`\n⚠️  EDIT Images (${editImages.length} - should be filtered):`);
          editImages.forEach(({ index, url }) => {
            console.log(`   ${index}. ${url.substring(0, 120)}${url.length > 120 ? '...' : ''}`);
          });
        }
        
        if (applicationImages.length > 0) {
          console.log(`\n⚠️  APPLICATION Images (${applicationImages.length} - should be filtered):`);
          applicationImages.forEach(({ index, url }) => {
            console.log(`   ${index}. ${url.substring(0, 120)}${url.length > 120 ? '...' : ''}`);
          });
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   Valid: ${validImages.length}`);
        console.log(`   Edit/Preview: ${editImages.length}`);
        console.log(`   Application: ${applicationImages.length}`);
        console.log(`   Total: ${images.length}`);
      } else {
        console.log('⚠️  No images extracted - may need Firecrawl for old listings');
      }
      
      // Show vehicle fields
      console.log(`\n📋 Vehicle Fields:`);
      console.log(`   Year: ${vehicle.year || 'NULL'}`);
      console.log(`   Make: ${vehicle.make || 'NULL'}`);
      console.log(`   Model: ${vehicle.model || 'NULL'}`);
      console.log(`   Mileage: ${vehicle.mileage || 'NULL'}`);
      console.log(`   Color: ${vehicle.color || 'NULL'}`);
      console.log(`   Transmission: ${vehicle.transmission || 'NULL'}`);
      console.log(`   Engine: ${vehicle.engine_size || 'NULL'}`);
      console.log(`   Drivetrain: ${vehicle.drivetrain || 'NULL'}`);
    } else {
      console.log('⚠️  No vehicle data extracted');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

const url = process.argv[2] || 'https://carsandbids.com/auctions/30nwwmlr/2020-lamborghini-aventador-svj';

inspectImages(url);

