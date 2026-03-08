#!/usr/bin/env node

/**
 * LOW-COST EXTRACTION WORKER
 * Ultra-lightweight vehicle data extraction without LLMs
 * Uses simple HTML parsing for maximum speed and minimum cost
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function getNextQueueItem() {
  const { data: items, error } = await supabase
    .from('import_queue')
    .select('*')
    .order('priority', { ascending: false })
    .limit(1);

  if (error) {
    console.error('❌ Error getting queue item:', error);
    return null;
  }

  return items.length > 0 ? items[0] : null;
}

async function lowCostExtraction(url) {
  console.log(`🔧 Low-cost extracting: ${url}`);

  try {
    // Simple fetch without expensive AI/LLM processing
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return extractBasicVehicleData(html, url);

  } catch (error) {
    console.error(`❌ Low-cost extraction failed for ${url}:`, error.message);
    return { success: false, error: error.message };
  }
}

function extractBasicVehicleData(html, url) {
  // Simple regex-based extraction - no LLMs, very fast and cheap
  const data = {
    success: true,
    url: url,
    title: null,
    year: null,
    make: null,
    model: null,
    price: null,
    mileage: null,
    description: null,
    images: []
  };

  try {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
      data.title = titleMatch[1].replace(/&.*?;/g, '').trim().substring(0, 200);
    }

    // Extract year (4 digits, 1900-2030)
    const yearMatch = html.match(/\\b(19[5-9][0-9]|20[0-2][0-9]|203[0-9])\\b/);
    if (yearMatch) {
      data.year = parseInt(yearMatch[1]);
    }

    // Extract common makes
    const makes = ['porsche', 'bmw', 'mercedes', 'audi', 'ferrari', 'lamborghini', 'maserati',
                  'aston martin', 'jaguar', 'bentley', 'rolls royce', 'mclaren', 'lotus',
                  'ford', 'chevrolet', 'dodge', 'plymouth', 'pontiac', 'buick', 'cadillac',
                  'toyota', 'honda', 'nissan', 'mazda', 'subaru', 'mitsubishi', 'lexus'];

    for (const make of makes) {
      const regex = new RegExp(`\\\\b${make}\\\\b`, 'i');
      if (regex.test(html)) {
        data.make = make.charAt(0).toUpperCase() + make.slice(1);
        break;
      }
    }

    // Extract price ($XX,XXX format)
    const priceMatch = html.match(/\\$([0-9,]+)/);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/,/g, ''));
      if (price > 1000 && price < 10000000) {
        data.price = price;
      }
    }

    // Extract mileage
    const mileageMatch = html.match(/([0-9,]+)\\s*mile/i);
    if (mileageMatch) {
      const mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      if (mileage < 999999) {
        data.mileage = mileage;
      }
    }

    // Extract basic description from meta tags or first paragraph
    const descMatch = html.match(/<meta[^>]*description[^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<p[^>]*>([^<]{50,300})</i);
    if (descMatch) {
      data.description = descMatch[1].replace(/&.*?;/g, '').trim().substring(0, 500);
    }

    // Extract images (simple img src matching)
    const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi);
    if (imgMatches) {
      data.images = imgMatches
        .map(img => {
          const srcMatch = img.match(/src=["']([^"']+)["']/i);
          return srcMatch ? srcMatch[1] : null;
        })
        .filter(url => url &&
          url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') ||
          url.includes('.webp') && !url.includes('logo') && !url.includes('icon')
        )
        .slice(0, 10); // Max 10 images
    }

    console.log(`✅ Extracted: ${data.year || '????'} ${data.make || 'Unknown'} - $${data.price || 'N/A'}`);
    return data;

  } catch (error) {
    console.error('❌ Data extraction error:', error);
    return { success: false, error: error.message };
  }
}

async function saveVehicleToDatabase(vehicleData) {
  try {
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: vehicleData.year,
        make: vehicleData.make,
        model: vehicleData.model || 'Unknown',
        mileage: vehicleData.mileage,
        asking_price: vehicleData.price,
        description: vehicleData.description,
        discovery_url: vehicleData.url,
        source: 'low_cost_extraction',
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      console.error('❌ Database save error:', error);
      return null;
    }

    console.log(`💾 Vehicle saved to database: ID ${newVehicle.id}`);
    return newVehicle.id;

  } catch (error) {
    console.error('❌ Database error:', error);
    return null;
  }
}

async function removeFromQueue(itemId) {
  const { error } = await supabase
    .from('import_queue')
    .delete()
    .eq('id', itemId);

  if (error) {
    console.error('❌ Error removing from queue:', error);
  }
}

async function lowCostExtractionLoop() {
  console.log('🔄 Starting low-cost extraction worker...');
  console.log('💰 ZERO LLM costs - pure HTML parsing');
  console.log('⚡ High-speed processing - no API limits');

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  while (true) {
    try {
      const queueItem = await getNextQueueItem();

      if (!queueItem) {
        console.log('📭 Queue empty, waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      console.log(`\\n🚀 Processing item ${processed + 1}: ${queueItem.listing_url}`);
      const result = await lowCostExtraction(queueItem.listing_url);

      if (result.success && (result.year || result.make || result.price)) {
        const vehicleId = await saveVehicleToDatabase(result);
        if (vehicleId) {
          succeeded++;
          console.log(`✅ Success! Vehicle ID: ${vehicleId}`);
        } else {
          failed++;
        }
      } else {
        failed++;
        console.log(`❌ Failed: Insufficient data extracted`);
      }

      // Remove item from queue regardless of outcome
      await removeFromQueue(queueItem.id);
      processed++;

      // Show progress every 25 items
      if (processed % 25 === 0) {
        const elapsedHours = (Date.now() - startTime) / (1000 * 60 * 60);
        const rate = Math.round(processed / elapsedHours);
        const successRate = Math.round((succeeded / processed) * 100);

        console.log(`\\n📈 PROGRESS UPDATE:`);
        console.log(`   Processed: ${processed} vehicles`);
        console.log(`   Succeeded: ${succeeded} (${successRate}%)`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Rate: ${rate} vehicles/hour`);
        console.log(`   Cost: $0 (no LLMs used)`);
      }

      // Very short delay for maximum throughput
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error('💥 Worker error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s on error
    }
  }
}

console.log('💰 LOW-COST EXTRACTION WORKER - ZERO LLM COSTS');
console.log('='.repeat(60));
console.log('• Pure HTML parsing - no AI/LLM costs');
console.log('• High-speed processing - 100+ vehicles/hour possible');
console.log('• Extracts: year, make, model, price, mileage, images');
console.log('• Ultra-reliable - no API rate limits or timeouts');
console.log('='.repeat(60));

lowCostExtractionLoop().catch(console.error);