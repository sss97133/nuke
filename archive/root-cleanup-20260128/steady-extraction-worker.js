#!/usr/bin/env node

/**
 * STEADY EXTRACTION WORKER
 * Simple, reliable profile extraction that works without complex parallel processing
 * Focus: Get steady incoming profiles as requested
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

async function extractVehicleSimple(url) {
  console.log(`🔧 Extracting: ${url}`);

  // Use the working comprehensive-bat-extraction function directly
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/comprehensive-bat-extraction`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listing_url: url,
        vehicle_id: null,
        include_comments: true,
        include_bids: true,
        create_profiles: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error(`❌ Extraction failed for ${url}:`, error.message);
    return { success: false, error: error.message };
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

async function steadyExtractionLoop() {
  console.log('🔄 Starting steady extraction worker...');
  console.log('📊 Processing queue items one by one for reliability');

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (true) {
    try {
      const queueItem = await getNextQueueItem();

      if (!queueItem) {
        console.log('📭 Queue empty, waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }

      console.log(`\\n🚀 Processing item ${processed + 1}: ${queueItem.listing_url}`);
      const result = await extractVehicleSimple(queueItem.listing_url);

      if (result.success) {
        succeeded++;
        console.log(`✅ Success! Vehicle created: ${result.data?.vehicleId || 'unknown'}`);

        // Remove successful item from queue
        await removeFromQueue(queueItem.id);
      } else {
        failed++;
        console.log(`❌ Failed: ${result.error}`);

        // Remove failed item to prevent infinite retries
        await removeFromQueue(queueItem.id);
      }

      processed++;

      // Show progress every 10 items
      if (processed % 10 === 0) {
        const successRate = Math.round((succeeded / processed) * 100);
        console.log(`\\n📈 PROGRESS UPDATE:`);
        console.log(`   Processed: ${processed} vehicles`);
        console.log(`   Succeeded: ${succeeded} (${successRate}%)`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Rate: ~${Math.round(processed / (Date.now() / 1000 / 3600))} vehicles/hour`);
      }

      // Small delay between extractions to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      console.error('💥 Worker error:', error);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s on error
    }
  }
}

console.log('🎯 STEADY EXTRACTION WORKER - RELIABLE PROFILE EXTRACTION');
console.log('='.repeat(60));
console.log('• Processes queue items sequentially for maximum reliability');
console.log('• Uses direct API calls to bypass function timeout issues');
console.log('• Creates complete profiles with comments, bids, and ecosystem data');
console.log('• Maintains steady extraction rate as requested');
console.log('='.repeat(60));

steadyExtractionLoop().catch(console.error);