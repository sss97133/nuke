#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function checkQueue() {
  console.log('📊 Checking import_queue status...');

  const { data: queueStats, error } = await supabase
    .from('import_queue')
    .select('priority, created_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`📋 Total queue items: ${queueStats.length}`);

  const priorityStats = {};
  queueStats.forEach(item => {
    const priority = item.priority || 0;
    if (!priorityStats[priority]) priorityStats[priority] = 0;
    priorityStats[priority]++;
  });

  console.log('🏆 Queue by priority:');
  Object.entries(priorityStats)
    .sort(([a], [b]) => parseInt(b) - parseInt(a))
    .forEach(([priority, count]) => {
      console.log(`  Priority ${priority}: ${count} items`);
    });

  // Get recent items
  console.log('\n🕒 Recent queue items:');
  queueStats.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i+1}. Priority ${item.priority}, ${new Date(item.created_at).toLocaleString()}`);
  });
}

async function processQueueNow() {
  console.log('🚀 Triggering parallel processing...');

  const { data, error } = await supabase.functions.invoke('process-import-queue', {
    body: {
      batch_size: 5,  // Start with just 5 items
      priority_only: true
    }
  });

  if (error) {
    console.error('❌ Processing failed:', error);
  } else {
    console.log('✅ Processing started:', data);
  }
}

async function main() {
  await checkQueue();
  console.log('\n' + '='.repeat(50));
  await processQueueNow();
}

main().catch(console.error);