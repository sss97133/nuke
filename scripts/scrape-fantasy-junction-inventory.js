#!/usr/bin/env node
/**
 * Scrape Fantasy Junction inventory
 * Extract vehicles that may not be on BaT
 * https://fantasyjunction.com/inventory
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const BASE_URL = 'https://fantasyjunction.com';
const INVENTORY_URL = `${BASE_URL}/inventory`;

async function fetchWithTimeout(url, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeoutId);
    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function parseInventoryListing(html) {
  const listings = [];
  
  // Extract vehicle links from inventory page
  // Pattern: /inventory/[year]-[make]-[model]/overview
  const linkPattern = /href="(\/inventory\/[^"]+)\/overview"/gi;
  const matches = [...html.matchAll(linkPattern)];
  
  for (const match of matches) {
    const path = match[1];
    const url = `${BASE_URL}${path}/overview`;
    listings.push({ url, path });
  }
  
  return [...new Set(listings)]; // Remove duplicates
}

function parseFantasyJunctionUrl(url) {
  // URL format: /inventory/1949-alfa-romeo-6c-2500-super-sport-cabriolet-by-pinin-farina/overview
  try {
    const match = url.match(/\/inventory\/(\d{4})-([a-z0-9-]+)\/overview/i);
    if (match && match[1] && match[2]) {
      const year = parseInt(match[1], 10);
      const parts = match[2].split('-').filter(Boolean);
      
      if (parts.length >= 2) {
        // Handle multi-word makes
        const multiWordMakes = {
          'alfa': { full: 'Alfa Romeo', requiresSecond: 'romeo' },
          'mercedes': { full: 'Mercedes-Benz', requiresSecond: 'benz' },
          'land': { full: 'Land Rover', requiresSecond: 'rover' },
          'aston': { full: 'Aston Martin', requiresSecond: 'martin' },
        };
        
        let make, model;
        const firstPart = parts[0].toLowerCase();
        const secondPart = parts[1].toLowerCase();
        
        if (multiWordMakes[firstPart] && secondPart === multiWordMakes[firstPart].requiresSecond) {
          make = multiWordMakes[firstPart].full;
          model = parts.slice(2).map(p => {
            return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          }).join(' ').trim();
        } else {
          make = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
          model = parts.slice(1).map(p => {
            return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
          }).join(' ').trim();
        }
        
        return { year, make, model };
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

function extractVehicleData(html, url) {
  const data = {
    url,
    source: 'fantasy_junction',
    discovery_url: url,
    listing_url: url,
  };
  
  // First try to parse from URL slug (most reliable)
  const urlParsed = parseFantasyJunctionUrl(url);
  if (urlParsed) {
    data.year = urlParsed.year;
    data.make = urlParsed.make;
    data.model = urlParsed.model;
  }
  
  // Extract title/heading (h4 with vehicle name)
  // DOM: div.cell.large-4 > h4
  const titleMatch = html.match(/<h4[^>]*data-cursor-element-id[^>]*>([^<]+)<\/h4>/i) || 
                     html.match(/<h4[^>]*>([^<]+)<\/h4>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    data.title = title;
    
    // Parse year/make/model from title if not already parsed from URL
    if (!data.make || !data.model) {
      const titleParts = title.match(/^(\d{4})\s+([A-Za-z][A-Za-z\s&]+?)\s+(.+?)$/);
      if (titleParts) {
        data.year = parseInt(titleParts[1], 10);
        data.make = titleParts[2].trim();
        data.model = titleParts[3].trim();
      }
    }
  }
  
  // Extract price (look for $495,000 pattern)
  const priceMatch = html.match(/\$([\d,]+)/);
  if (priceMatch) {
    data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  }
  
  // Extract from specs list (ul.no-bullet.ruled)
  // DOM: div.cell.large-4 > ul.no-bullet.ruled
  // Format: VIN 915871 Exterior Color Silver Interior Color Green leather Mileage 412 Kilometers...
  const specsMatch = html.match(/<ul[^>]*class="[^"]*no-bullet[^"]*ruled[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (specsMatch) {
    // Get text content, handling nested spans
    let specsText = specsMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // VIN - look for "VIN" followed by alphanumeric
    const vinMatch = specsText.match(/VIN\s+([A-Z0-9]+)/i);
    if (vinMatch) {
      data.vin = vinMatch[1].trim();
    }
    
    // Exterior Color
    const extColorMatch = specsText.match(/Exterior\s+Color\s+([A-Za-z][A-Za-z\s]+?)(?:\s+Interior|$)/i);
    if (extColorMatch) {
      data.color = extColorMatch[1].trim();
    }
    
    // Interior Color
    const intColorMatch = specsText.match(/Interior\s+Color\s+([A-Za-z][A-Za-z\s]+?)(?:\s+Mileage|$)/i);
    if (intColorMatch) {
      data.interior_color = intColorMatch[1].trim();
    }
    
    // Mileage - handle "412 Kilometers (TMU)" or "5000 Miles"
    const mileageMatch = specsText.match(/Mileage\s+([\d,]+)\s*(?:Kilometers|Miles|km|mi|\(TMU\))/i);
    if (mileageMatch) {
      const mileage = parseInt(mileageMatch[1].replace(/,/g, ''), 10);
      data.mileage = mileage;
    }
    
    // Engine - "2.5L inline 6-cylinder"
    const engineMatch = specsText.match(/Engine\s+([A-Za-z0-9.\-\sL]+?)(?:\s+Engine\s+no|Transmission|$)/i);
    if (engineMatch) {
      data.engine_size = engineMatch[1].trim();
    }
    
    // Engine Number
    const engineNoMatch = specsText.match(/Engine\s+no\.\s+([A-Z0-9]+)/i);
    if (engineNoMatch) {
      data.engine_code = engineNoMatch[1].trim();
    }
    
    // Transmission
    const transMatch = specsText.match(/Transmission\s+([A-Za-z0-9\-\s]+?)(?:\s+Status|Stock|$)/i);
    if (transMatch) {
      data.transmission = transMatch[1].trim();
    }
    
    // Stock Number - "Stock FJ2931"
    const stockMatch = specsText.match(/Stock\s+([A-Z0-9]+)/i);
    if (stockMatch) {
      data.stock_number = stockMatch[1].trim();
    }
  }
  
  // Extract description (div.cell.small-12 with DESCRIPTION)
  // DOM: div.cell.large-8 > div.cell.small-12
  const descSection = html.match(/<div[^>]*class="[^"]*cell[^"]*small-12[^"]*"[^>]*>([\s\S]{500,10000})<\/div>/i);
  if (descSection) {
    let description = descSection[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Remove "DESCRIPTION" prefix if present
    description = description.replace(/^DESCRIPTION\s+/i, '').trim();
    
    if (description.length > 5000) {
      description = description.substring(0, 5000) + '...';
    }
    if (description.length > 100) {
      data.description = description;
    }
  }
  
  // Extract preview text (p tag in specs section)
  // DOM: div.cell.large-4 > p
  const previewMatch = html.match(/<p[^>]*data-cursor-element-id[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*)<\/p>/i);
  if (previewMatch && !data.description) {
    let preview = previewMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (preview.length > 100 && preview.length < 1000) {
      data.description = preview;
    }
  }
  
  // Extract image URLs from gallery
  // Look for images in inventory/car directories
  const images = [];
  const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const imgMatches = [...html.matchAll(imgPattern)];
  
  for (const match of imgMatches) {
    let imgUrl = match[1];
    
    // Convert relative URLs to absolute
    if (imgUrl.startsWith('/')) {
      imgUrl = `${BASE_URL}${imgUrl}`;
    } else if (!imgUrl.startsWith('http')) {
      imgUrl = `${BASE_URL}/${imgUrl}`;
    }
    
    // Filter for vehicle images only
    if (imgUrl.includes('fantasyjunction.com') &&
        !imgUrl.includes('logo') && 
        !imgUrl.includes('icon') &&
        !imgUrl.includes('favicon') &&
        (imgUrl.includes('inventory') || imgUrl.includes('car') || imgUrl.match(/\.(jpg|jpeg|png|webp)$/i))) {
      images.push(imgUrl);
    }
  }
  
  data.images = [...new Set(images)]; // Remove duplicates
  
  return data;
}

async function scrapeInventoryPage() {
  console.log('🔍 Fetching Fantasy Junction inventory page...');
  const html = await fetchWithTimeout(INVENTORY_URL);
  const listings = parseInventoryListing(html);
  console.log(`✅ Found ${listings.length} vehicles in inventory\n`);
  return listings;
}

async function scrapeVehicleDetails(listing) {
  try {
    console.log(`  📄 Scraping: ${listing.path}`);
    const html = await fetchWithTimeout(listing.url);
    const vehicleData = extractVehicleData(html, listing.url);
    return vehicleData;
  } catch (error) {
    console.error(`  ❌ Error scraping ${listing.url}:`, error.message);
    return null;
  }
}

async function saveVehicleImages(vehicleId, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return { inserted: 0 };
  
  let inserted = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const { error } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: vehicleId,
        image_url: url,
        source: 'fantasy_junction',
        position: i,
        is_primary: i === 0
      });
    
    if (!error) inserted++;
  }
  
  return { inserted };
}

async function saveVehicle(vehicleData) {
  if (!vehicleData || !vehicleData.make || !vehicleData.model) {
    console.log(`  ⏭️  Skipping - missing make/model`);
    return { created: false, updated: false };
  }
  
  // Extract metadata before cleaning
  const images = vehicleData.images || [];
  const stockNumber = vehicleData.stock_number;
  const url = vehicleData.url;
  
  // Clean vehicleData to only include valid vehicle table fields
  const cleanVehicleData = {
    year: vehicleData.year || null,
    make: vehicleData.make,
    model: vehicleData.model,
    trim: vehicleData.trim || null,
    vin: vehicleData.vin || null,
    mileage: vehicleData.mileage || null,
    color: vehicleData.color || null,
    interior_color: vehicleData.interior_color || null,
    transmission: vehicleData.transmission || null,
    engine_size: vehicleData.engine_size || null,
    engine_code: vehicleData.engine_code || null,
    drivetrain: vehicleData.drivetrain || null,
    description: vehicleData.description || null,
    asking_price: vehicleData.asking_price || null,
    discovery_url: url,
    listing_url: url,
    discovery_source: 'fantasy_junction',
    profile_origin: 'fantasy_junction_import',
    origin_metadata: {
      source: 'fantasy_junction',
      stock_number: stockNumber,
      scraped_at: new Date().toISOString(),
      image_urls: images
    },
    is_public: true,
    status: 'active'
  };
  
  // Check if vehicle already exists by URL
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .maybeSingle();
  
  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('vehicles')
      .update(cleanVehicleData)
      .eq('id', existing.id);
    
    if (error) {
      console.error(`  ❌ Update error:`, error.message);
      return { created: false, updated: false, error };
    }
    
    // Save images
    if (images.length > 0) {
      await saveVehicleImages(existing.id, images);
    }
    
    console.log(`  ✅ Updated vehicle ${existing.id.slice(0, 8)}... (${images.length} images)`);
    return { created: false, updated: true, vehicle_id: existing.id };
  } else {
    // Create new
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert(cleanVehicleData)
      .select('id')
      .single();
    
    if (error) {
      console.error(`  ❌ Insert error:`, error.message);
      return { created: false, updated: false, error };
    }
    
    // Save images
    if (images.length > 0) {
      await saveVehicleImages(newVehicle.id, images);
    }
    
    console.log(`  ✅ Created vehicle ${newVehicle.id.slice(0, 8)}... (${images.length} images)`);
    return { created: true, updated: false, vehicle_id: newVehicle.id };
  }
}

async function main() {
  console.log('🚀 Fantasy Junction Inventory Scraper');
  console.log('='.repeat(80));
  
  const listings = await scrapeInventoryPage();
  
  if (listings.length === 0) {
    console.log('❌ No listings found');
    return;
  }
  
  console.log(`🚀 Processing ${listings.length} vehicles...\n`);
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`\n[${i + 1}/${listings.length}]`);
    
    const vehicleData = await scrapeVehicleDetails(listing);
    
    if (!vehicleData) {
      skipped++;
      continue;
    }
    
    const result = await saveVehicle(vehicleData);
    
    if (result.error) {
      errors++;
    } else if (result.created) {
      created++;
    } else if (result.updated) {
      updated++;
    } else {
      skipped++;
    }
    
    // Rate limiting
    if (i < listings.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Created: ${created}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📈 Total: ${listings.length}`);
  console.log('='.repeat(80));
}

main().catch(console.error);
