/**
 * Batch test image extractions
 * Tests multiple images and displays results for examination
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ Error: SUPABASE_ANON_KEY not found in environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

// Sample images to test (mix of different types)
const TEST_IMAGES = [
  {
    name: 'Sample Car Image',
    url: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800',
    type: 'vehicle_exterior'
  },
  {
    name: 'Car Interior',
    url: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
    type: 'vehicle_interior'
  },
  {
    name: 'Classic Car',
    url: 'https://images.unsplash.com/photo-1493238792000-8113da705763?w=800',
    type: 'vehicle_detail'
  }
];

async function getSampleImagesFromDB(limit = 5) {
  try {
    // Try to get some actual images from the database
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('image_url, id, vehicle_id')
      .not('image_url', 'is', null)
      .limit(limit);

    if (error) {
      console.log('⚠️  Could not fetch images from DB, using sample URLs');
      return null;
    }

    return images.map((img, idx) => ({
      name: `DB Image ${idx + 1}`,
      url: img.image_url,
      type: 'database_image',
      image_id: img.id,
      vehicle_id: img.vehicle_id
    }));
  } catch (e) {
    console.log('⚠️  Could not fetch images from DB, using sample URLs');
    return null;
  }
}

async function extractImage(imageUrl, imageName) {
  console.log(`\n📸 Extracting: ${imageName}`);
  console.log(`   URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-image', {
      body: {
        image_url: imageUrl
      }
    });

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      console.error(`   Full error:`, JSON.stringify(error, null, 2));
      return { success: false, error: error.message, imageName, fullError: error };
    }

    if (!data || !data.success) {
      const errorMsg = data?.error || 'Unknown error';
      console.error(`   ❌ Extraction failed: ${errorMsg}`);
      if (data?.details) {
        console.error(`   Details: ${JSON.stringify(data.details).substring(0, 200)}...`);
      }
      return { success: false, error: errorMsg, imageName, details: data?.details, fullResponse: data };
    }

    // Display results
    console.log(`   ✅ Success!`);
    console.log(`   Model: ${data.metadata.model} (${data.metadata.model_tier})`);
    console.log(`   Tokens: ${data.metadata.tokens.total.toLocaleString()} (input: ${data.metadata.tokens.input}, output: ${data.metadata.tokens.output})`);
    console.log(`   Cost: $${data.metadata.cost.total_cost.toFixed(6)}`);
    console.log(`   Efficiency: ~${data.metadata.efficiency.images_per_1k_tokens} images per 1K tokens`);
    
    // Show extracted data summary
    const extracted = data.extracted_data;
    console.log(`\n   📊 Extracted Data Summary:`);
    if (extracted.description) {
      console.log(`   • Description: ${extracted.description.substring(0, 100)}...`);
    }
    if (extracted.type) {
      console.log(`   • Type: ${extracted.type}`);
    }
    if (extracted.objects && Array.isArray(extracted.objects)) {
      console.log(`   • Objects: ${extracted.objects.slice(0, 5).join(', ')}${extracted.objects.length > 5 ? '...' : ''}`);
    }
    if (extracted.text) {
      console.log(`   • Text found: ${extracted.text.substring(0, 80)}...`);
    }
    if (extracted.details) {
      const details = extracted.details;
      if (details.colors) console.log(`   • Colors: ${details.colors.join(', ')}`);
      if (details.brands) console.log(`   • Brands: ${details.brands.join(', ')}`);
      if (details.features) console.log(`   • Features: ${details.features.slice(0, 3).join(', ')}...`);
    }

    return {
      success: true,
      imageName,
      imageUrl,
      extracted_data: extracted,
      metadata: data.metadata,
      full_response: data
    };
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return { success: false, error: err.message, imageName };
  }
}

async function runBatchTest() {
  console.log('🧪 Batch Image Extraction Test\n');
  console.log('='.repeat(80));

  // Use public test images for now (DB images may require auth)
  console.log('📝 Using public test images for extraction testing\n');
  let imagesToTest = TEST_IMAGES;
  
  // Optionally try DB images, but don't fail if they don't work
  const dbImages = await getSampleImagesFromDB(2);
  if (dbImages && dbImages.length > 0) {
    console.log(`📝 Also found ${dbImages.length} DB images (will try after public images)\n`);
    imagesToTest = [...TEST_IMAGES, ...dbImages];
  }

  const results = [];
  
  for (let i = 0; i < imagesToTest.length; i++) {
    const image = imagesToTest[i];
    const result = await extractImage(image.url, image.name);
    results.push(result);
    
    // Small delay between requests to avoid rate limits
    if (i < imagesToTest.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    const avgTokens = successful.reduce((sum, r) => sum + (r.metadata?.tokens?.total || 0), 0) / successful.length;
    const totalCost = successful.reduce((sum, r) => sum + (r.metadata?.cost?.total_cost || 0), 0);
    const avgImagesPer1K = successful.reduce((sum, r) => sum + (r.metadata?.efficiency?.images_per_1k_tokens || 0), 0) / successful.length;
    
    console.log(`\n💰 Cost Analysis:`);
    console.log(`   Average tokens per image: ${Math.round(avgTokens).toLocaleString()}`);
    console.log(`   Total cost: $${totalCost.toFixed(6)}`);
    console.log(`   Average images per 1K tokens: ~${Math.round(avgImagesPer1K)}`);
    console.log(`   Estimated images per 1M tokens: ~${Math.round(1_000_000 / avgTokens).toLocaleString()}`);
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed Extractions:`);
    failed.forEach(f => {
      console.log(`   • ${f.imageName}: ${f.error}`);
    });
  }

  // Save detailed results to file
  const resultsFile = 'extraction-test-results.json';
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    results: results
  }, null, 2));
  
  console.log(`\n💾 Detailed results saved to: ${resultsFile}`);
  console.log(`\n📋 To examine full results:`);
  console.log(`   cat ${resultsFile} | jq '.'`);
  console.log(`   or open ${resultsFile} in your editor`);
}

runBatchTest().catch(console.error);

