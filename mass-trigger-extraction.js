#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function triggerBatch() {
  try {
    const { data, error } = await supabase.functions.invoke('process-import-queue-simple', {
      body: {
        batch_size: 20, // Process 20 at a time for speed
        priority_only: true
      }
    });

    if (error) {
      console.error('❌ Batch failed:', error);
      return 0;
    }

    const successful = data?.successful || 0;
    const total = data?.processed || 0;

    console.log(`🔥 Batch: ${successful}/${total} successful extractions`);
    return successful;

  } catch (error) {
    console.error('❌ Exception:', error.message);
    return 0;
  }
}

async function massExtraction() {
  console.log('🚀 STARTING MASS EXTRACTION - PROCESSING 1000+ PROFILES');
  console.log('='.repeat(60));

  let totalExtracted = 0;
  let batchCount = 0;

  // Run for 50 batches to process the queue
  while (batchCount < 50) {
    batchCount++;
    console.log(`\n📦 Batch ${batchCount}/50:`);

    const extracted = await triggerBatch();
    totalExtracted += extracted;

    if (extracted === 0) {
      console.log('💤 No successful extractions - API issue or queue empty');
      // Continue anyway - might be temporary API issue
    }

    console.log(`📊 Total extracted so far: ${totalExtracted} profiles`);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n🎯 MASS EXTRACTION COMPLETE');
  console.log(`📈 Total profiles extracted: ${totalExtracted}`);

  // Check final queue status
  const { data: queueStats } = await supabase
    .from('import_queue')
    .select('priority')
    .limit(100);

  console.log(`📋 Queue remaining: ${queueStats?.length || 0} items`);
}

massExtraction();