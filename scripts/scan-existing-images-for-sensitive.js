#!/usr/bin/env node

/**
 * Scan ALL existing vehicle images for sensitive documents
 * Retroactively applies detection to already-uploaded images
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Available env keys:', Object.keys(process.env).filter(k => k.includes('SUPABASE')).join(', '));
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function scanAllImages() {
  const forceAll = process.argv.includes('--force');
  
  console.log('🔍 Starting retroactive sensitive document scan...\n');
  if (forceAll) {
    console.log('⚠️  FORCE MODE: Scanning ALL images (ignoring previous scans)\n');
  }

  // Get all vehicle images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, is_sensitive')
    .order('created_at', { ascending: false })
    .limit(100); // Limit to 100 for testing

  if (error) {
    console.error('❌ Error fetching images:', error);
    return;
  }

  console.log(`📊 Found ${images.length} total images\n`);

  // Filter to images that need scanning
  const imagesToScan = forceAll 
    ? images 
    : images.filter(img => img.is_sensitive === null);
  
  console.log(`🔎 ${imagesToScan.length} images need scanning\n`);

  let processed = 0;
  let sensitive = 0;
  let errors = 0;

  for (const image of imagesToScan) {
    try {
      console.log(`[${processed + 1}/${imagesToScan.length}] Analyzing ${image.id.substring(0, 8)}...`);

      // Call the detect-sensitive-document edge function
      const { data, error: funcError } = await supabase.functions.invoke('detect-sensitive-document', {
        body: {
          image_url: image.image_url,
          vehicle_id: image.vehicle_id,
          image_id: image.id
        }
      });

      if (funcError) {
        console.error(`   ❌ Error: ${funcError.message}`);
        errors++;
      } else if (data?.is_sensitive) {
        console.log(`   🔒 SENSITIVE DETECTED: ${data.document_type}`);
        sensitive++;
      } else {
        console.log(`   ✅ Clean`);
      }

      processed++;

      // Rate limit: 1 request per second (OpenAI quota)
      if (processed < imagesToScan.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (err) {
      console.error(`   ❌ Exception: ${err.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📈 SCAN COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total Processed: ${processed}`);
  console.log(`Sensitive Found: ${sensitive}`);
  console.log(`Errors: ${errors}`);
  console.log(`Clean Images: ${processed - sensitive - errors}`);

  // Show summary of sensitive documents found
  if (sensitive > 0) {
    console.log('\n🔒 SENSITIVE DOCUMENTS DETECTED:');
    const { data: titleDocs } = await supabase
      .from('vehicle_title_documents')
      .select('id, document_type, vin, title_number, owner_name, extraction_confidence')
      .order('created_at', { ascending: false })
      .limit(sensitive);

    if (titleDocs) {
      titleDocs.forEach((doc, idx) => {
        console.log(`\n${idx + 1}. ${doc.document_type.toUpperCase()}`);
        console.log(`   VIN: ${doc.vin || 'N/A'}`);
        console.log(`   Title #: ${doc.title_number || 'N/A'}`);
        console.log(`   Owner: ${doc.owner_name || 'N/A'}`);
        console.log(`   Confidence: ${Math.round((doc.extraction_confidence || 0) * 100)}%`);
      });
    }
  }
}

// Run the scan
scanAllImages().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

