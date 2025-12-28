/**
 * Organize AI Analysis Data
 * 
 * Consolidates all scattered AI analysis data into organized, queryable fields:
 * 1. Populates extraction tracking from ai_scan_metadata
 * 2. Consolidates data from ai_angle_classifications_audit
 * 3. Builds consensus from multiple sources
 * 4. Organizes images by angle, category, confidence
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 1000;
let processed = 0;
let extractionAdded = 0;
let consensusBuilt = 0;

/**
 * Add extraction from ai_scan_metadata
 */
async function addExtractionFromMetadata(imageId, metadata) {
  try {
    const extraction = {
      source: 'ai_scan_metadata',
      model: metadata?.appraiser?.model || 'gpt-4o',
      confidence: metadata?.appraiser?.condition_score 
        ? metadata.appraiser.condition_score / 10.0 
        : 0.5,
      data: {
        angle: metadata?.appraiser?.angle || metadata?.appraiser?.primary_label,
        category: metadata?.appraiser?.angle_family || 
          (metadata?.appraiser?.angle?.startsWith('exterior') ? 'exterior' :
           metadata?.appraiser?.angle?.startsWith('interior') ? 'interior' :
           metadata?.appraiser?.angle?.startsWith('engine') ? 'engine' : null),
        labels: metadata?.rekognition?.Labels 
          ? metadata.rekognition.Labels.map(l => l.Name)
          : null
      }
    };

    const { data, error } = await supabase.rpc('add_ai_extraction', {
      p_image_id: imageId,
      p_extraction_data: extraction
    });

    if (error) {
      console.error(`  ⚠️  Error adding extraction: ${error.message}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`  ⚠️  Exception: ${err.message}`);
    return false;
  }
}

/**
 * Add extraction from ai_angle_classifications_audit
 */
async function addExtractionFromAudit(imageId, auditData) {
  try {
    const extraction = {
      source: 'ai_angle_classifications_audit',
      model: 'gpt-4o', // Default, audit table might not have model
      confidence: auditData.confidence ? auditData.confidence / 100.0 : 0.7,
      data: {
        angle: auditData.primary_label || auditData.angle_family,
        category: auditData.angle_family
      }
    };

    const { data, error } = await supabase.rpc('add_ai_extraction', {
      p_image_id: imageId,
      p_extraction_data: extraction
    });

    if (error) {
      console.error(`  ⚠️  Error adding audit extraction: ${error.message}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`  ⚠️  Exception: ${err.message}`);
    return false;
  }
}

/**
 * Process a batch of images
 */
async function processBatch(offset) {
  console.log(`\n📦 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1} (offset: ${offset})...`);

  // Get images with metadata but no extractions yet
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select(`
      id,
      vehicle_id,
      ai_scan_metadata,
      ai_extractions,
      ai_extraction_consensus
    `)
    .not('ai_scan_metadata', 'is', null)
    .neq('ai_scan_metadata', '{}')
    .or('ai_extractions.is.null,ai_extractions.eq.[]')
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) {
    console.error(`❌ Error fetching images: ${error.message}`);
    return { processed: 0, added: 0 };
  }

  if (!images || images.length === 0) {
    console.log('  ✅ No more images to process');
    return { processed: 0, added: 0 };
  }

  let batchAdded = 0;

  for (const image of images) {
    // Add extraction from ai_scan_metadata if available
    if (image.ai_scan_metadata && 
        typeof image.ai_scan_metadata === 'object' &&
        Object.keys(image.ai_scan_metadata).length > 0) {
      
      const added = await addExtractionFromMetadata(image.id, image.ai_scan_metadata);
      if (added) {
        batchAdded++;
        extractionAdded++;
      }
    }

    processed++;
    
    if (processed % 100 === 0) {
      process.stdout.write(`  Processed: ${processed} | Extractions added: ${extractionAdded}\r`);
    }
  }

  return { processed: images.length, added: batchAdded };
}

/**
 * Process audit table data
 */
async function processAuditData() {
  console.log('\n📊 Processing ai_angle_classifications_audit data...');

  const { data: auditRecords, error } = await supabase
    .from('ai_angle_classifications_audit')
    .select(`
      image_id,
      primary_label,
      angle_family,
      confidence
    `)
    .limit(5000);

  if (error) {
    console.error(`❌ Error fetching audit data: ${error.message}`);
    return;
  }

  if (!auditRecords || auditRecords.length === 0) {
    console.log('  ✅ No audit records to process');
    return;
  }

  console.log(`  Found ${auditRecords.length} audit records`);

  let auditAdded = 0;
  for (const audit of auditRecords) {
    // Check if image already has this extraction
    const { data: image } = await supabase
      .from('vehicle_images')
      .select('ai_extractions')
      .eq('id', audit.image_id)
      .single();

    if (image && image.ai_extractions) {
      const hasAuditExtraction = image.ai_extractions.some(
        ext => ext.source === 'ai_angle_classifications_audit'
      );
      
      if (hasAuditExtraction) {
        continue; // Already processed
      }
    }

    const added = await addExtractionFromAudit(audit.image_id, audit);
    if (added) {
      auditAdded++;
    }

    if (auditAdded % 100 === 0) {
      process.stdout.write(`  Processed: ${auditAdded} audit records\r`);
    }
  }

  console.log(`\n  ✅ Added ${auditAdded} extractions from audit table`);
}

/**
 * Build summary statistics
 */
async function buildSummary() {
  console.log('\n📈 Building summary statistics...');

  let stats = null;
  try {
    const { data } = await supabase.rpc('get_image_organization_stats');
    stats = data;
  } catch (err) {
    // Function might not exist, that's ok
  }

  if (stats) {
    console.log('\n📊 Organization Summary:');
    console.log(`  Total images: ${stats.total_images || 'N/A'}`);
    console.log(`  With extractions: ${stats.with_extractions || 'N/A'}`);
    console.log(`  With consensus: ${stats.with_consensus || 'N/A'}`);
    console.log(`  Angle consensus: ${stats.angle_consensus || 'N/A'}`);
    console.log(`  Category consensus: ${stats.category_consensus || 'N/A'}`);
  }

  // Manual stats
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('id', { count: 'exact', head: true });

  const { count: withExtractions } = await supabase
    .from('vehicle_images')
    .select('id', { count: 'exact', head: true })
    .not('ai_extractions', 'is', null)
    .neq('ai_extractions', '[]');

  const { count: withConsensus } = await supabase
    .from('vehicle_images')
    .select('id', { count: 'exact', head: true })
    .not('ai_extraction_consensus', 'is', null)
    .neq('ai_extraction_consensus', '{}');

  console.log('\n📊 Current Status:');
  console.log(`  Total images: ${totalImages || 0}`);
  console.log(`  With extractions: ${withExtractions || 0}`);
  console.log(`  With consensus: ${withConsensus || 0}`);
  console.log(`  Extraction coverage: ${totalImages ? ((withExtractions / totalImages) * 100).toFixed(1) : 0}%`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Organizing AI Analysis Data\n');
  console.log('=' .repeat(60));

  const startTime = Date.now();

  // Step 1: Process images with ai_scan_metadata
  console.log('\n📋 Step 1: Processing ai_scan_metadata...');
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await processBatch(offset);
    
    if (result.processed === 0) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n✅ Processed ${processed} images, added ${extractionAdded} extractions`);

  // Step 2: Process audit table
  await processAuditData();

  // Step 3: Build summary
  await buildSummary();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Organization complete in ${duration}s`);
  console.log(`   Processed: ${processed} images`);
  console.log(`   Extractions added: ${extractionAdded}`);
}

// Run
main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});

