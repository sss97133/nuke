#!/usr/bin/env node

/**
 * Document Categorization Script
 * Scans vehicle_images and categorizes documents vs photos
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const DOCUMENT_CATEGORIES = {
  receipt: ['receipt', 'rcpt', 'recipt'],
  invoice: ['invoice', 'inv', 'bill'],
  title: ['title', 'ttl', 'ownership'],
  registration: ['registration', 'reg', 'dmv'],
  insurance: ['insurance', 'ins', 'policy'],
  service_parts_id: ['spid', 'service parts identification', 'rpo'],
  vin_plate: ['vin', 'vin plate', 'chassis'],
  window_sticker: ['window sticker', 'monroney', 'msrp sticker'],
  build_sheet: ['build sheet', 'build sheet', 'broadcast'],
  manual: ['manual', 'service manual', 'owners manual'],
  other_document: []
};

function detectDocumentType(image) {
  const url = (image.image_url || '').toLowerCase();
  const metadata = image.ai_scan_metadata || {};
  const rawText = (metadata.raw_text || '').toLowerCase();
  const extractedData = metadata.extracted_data || {};
  
  // Check SPID sheet flag
  if (metadata.is_spid_sheet === 'true' || metadata.is_spid_sheet === true) {
    return {
      isDocument: true,
      category: 'service_parts_id',
      confidence: 0.95,
      reason: 'AI flagged as SPID sheet'
    };
  }
  
  // Check for extracted RPO codes (indicates SPID)
  if (extractedData.rpo_codes && Array.isArray(extractedData.rpo_codes) && extractedData.rpo_codes.length > 0) {
    return {
      isDocument: true,
      category: 'service_parts_id',
      confidence: 0.9,
      reason: 'Contains RPO codes'
    };
  }
  
  // Check URL patterns
  for (const [category, keywords] of Object.entries(DOCUMENT_CATEGORIES)) {
    if (keywords.some(kw => url.includes(kw))) {
      return {
        isDocument: true,
        category,
        confidence: 0.85,
        reason: `URL contains ${category} keyword`
      };
    }
  }
  
  // Check raw text content
  if (rawText.length > 100) {
    // Heavy text suggests document
    for (const [category, keywords] of Object.entries(DOCUMENT_CATEGORIES)) {
      if (keywords.some(kw => rawText.includes(kw))) {
        return {
          isDocument: true,
          category,
          confidence: 0.8,
          reason: `Text content suggests ${category}`
        };
      }
    }
    
    // Generic document if heavy text but no specific match
    if (rawText.length > 500) {
      return {
        isDocument: true,
        category: 'other_document',
        confidence: 0.6,
        reason: 'Heavy text content suggests document'
      };
    }
  }
  
  // Check timeline events for context
  // (This would require a join, so we'll do it separately)
  
  return {
    isDocument: false,
    category: null,
    confidence: 0.5,
    reason: 'No document indicators found'
  };
}

async function categorizeAllImages() {
  console.log('🔍 Scanning all vehicle images for document classification...\n');
  
  // Get all images in batches (Supabase has limits)
  let allImages = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;
  
  while (hasMore) {
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url, ai_scan_metadata')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error('Error fetching images:', error);
      break;
    }
    
    if (!images || images.length === 0) {
      hasMore = false;
      break;
    }
    
    allImages = allImages.concat(images);
    offset += batchSize;
    
    if (images.length < batchSize) {
      hasMore = false;
    }
    
    console.log(`Fetched ${allImages.length} images so far...`);
  }
  
  const images = allImages;
  
  console.log(`Found ${images.length} total images to analyze\n`);
  
  let categorized = 0;
  let documents = 0;
  const categoryCounts = {};
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const classification = detectDocumentType(image);
    
    if (classification.isDocument) {
      documents++;
      categoryCounts[classification.category] = (categoryCounts[classification.category] || 0) + 1;
      
      // Update database
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({
          is_document: true,
          document_category: classification.category,
          document_classification: JSON.stringify({
            category: classification.category,
            confidence: classification.confidence,
            reason: classification.reason,
            detected_at: new Date().toISOString()
          })
        })
        .eq('id', image.id);
      
      if (updateError) {
        console.error(`  ✗ Failed to update ${image.id}:`, updateError.message);
      } else {
        categorized++;
        if (categorized % 10 === 0) {
          console.log(`  ✓ Categorized ${categorized} documents...`);
        }
      }
    }
    
    // Progress indicator
    if ((i + 1) % 100 === 0) {
      console.log(`Processed ${i + 1}/${images.length} images...`);
    }
  }
  
  console.log('\n✅ Categorization complete!');
  console.log(`\n📊 Summary:`);
  console.log(`   Total images: ${images.length}`);
  console.log(`   Documents found: ${documents}`);
  console.log(`   Successfully categorized: ${categorized}`);
  console.log(`\n📁 Categories:`);
  for (const [category, count] of Object.entries(categoryCounts)) {
    console.log(`   ${category}: ${count}`);
  }
}

// Also check timeline events for receipt context
async function linkReceiptsToEvents() {
  console.log('\n🔗 Linking receipt events to images...\n');
  
  // Find receipt events
  const { data: events, error: eventsError } = await supabase
    .from('vehicle_timeline_events')
    .select('id, vehicle_id, title, description, created_at')
    .or('title.ilike.%receipt%,description.ilike.%receipt%')
    .order('created_at', { ascending: false });
  
  if (eventsError) {
    console.error('Error fetching events:', eventsError);
    return;
  }
  
  console.log(`Found ${events.length} receipt-related events\n`);
  
  for (const event of events) {
    // Find images uploaded within 5 minutes of event
    const { data: nearbyImages, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, created_at')
      .eq('vehicle_id', event.vehicle_id)
      .gte('created_at', new Date(new Date(event.created_at).getTime() - 5 * 60 * 1000).toISOString())
      .lte('created_at', new Date(new Date(event.created_at).getTime() + 5 * 60 * 1000).toISOString());
    
    if (imagesError) {
      console.error(`  Error finding images for event ${event.id}:`, imagesError);
      continue;
    }
    
    if (nearbyImages && nearbyImages.length > 0) {
      console.log(`  Event: ${event.title} (${event.vehicle_id})`);
      console.log(`    Found ${nearbyImages.length} nearby image(s)`);
      
      // Mark as receipt
      for (const img of nearbyImages) {
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({
            is_document: true,
            document_category: 'receipt',
            document_classification: JSON.stringify({
              category: 'receipt',
              confidence: 0.9,
              reason: `Linked to timeline event: ${event.title}`,
              event_id: event.id,
              detected_at: new Date().toISOString()
            })
          })
          .eq('id', img.id);
        
        if (!updateError) {
          console.log(`    ✓ Marked image ${img.id} as receipt`);
        }
      }
    } else {
      console.log(`  Event: ${event.title} - No nearby images found (receipt may not have been saved)`);
    }
  }
}

async function main() {
  await categorizeAllImages();
  await linkReceiptsToEvents();
  
  console.log('\n🎉 Document categorization complete!');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

