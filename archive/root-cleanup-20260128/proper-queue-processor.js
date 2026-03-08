#!/usr/bin/env node

/**
 * PROPER QUEUE PROCESSOR
 * Uses process-import-queue Edge Function (with access to all secrets)
 * Instead of trying to call functions externally
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function triggerProcessImportQueue() {
  console.log('🚀 Triggering process-import-queue (has access to all secrets)...');

  try {
    const { data, error } = await supabase.functions.invoke('process-import-queue-simple', {
      body: {
        batch_size: 10,  // Process 10 items
        priority_only: true
      }
    });

    if (error) {
      console.error('❌ Failed to trigger processing:', error);
      return false;
    }

    console.log('✅ Process triggered successfully:', data);
    return true;

  } catch (error) {
    console.error('❌ Error triggering process:', error.message);
    return false;
  }
}

async function monitorProcessing() {
  console.log('📊 Monitoring processing...');

  let lastQueueCount = 0;
  let lastVehicleCount = 0;

  setInterval(async () => {
    try {
      // Check queue status
      const { data: queueStats } = await supabase
        .from('import_queue')
        .select('priority')
        .limit(1000);

      const queueCount = queueStats?.length || 0;
      const highPriority = queueStats?.filter(q => q.priority >= 10).length || 0;

      // Check recent vehicles
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .gte('created_at', fiveMinutesAgo);

      const vehicleCount = recentVehicles?.length || 0;

      console.log(`🕒 ${new Date().toLocaleTimeString()}`);
      console.log(`📋 Queue: ${queueCount} items (${highPriority} high priority)`);
      console.log(`🚗 Vehicles in last 5min: ${vehicleCount}`);

      if (queueCount < lastQueueCount) {
        console.log(`✅ Queue decreasing: ${lastQueueCount} → ${queueCount} (processing working!)`);
      }

      if (vehicleCount > lastVehicleCount) {
        console.log(`🎉 New vehicles created: ${vehicleCount - lastVehicleCount}`);
      }

      lastQueueCount = queueCount;
      lastVehicleCount = vehicleCount;

    } catch (error) {
      console.error('❌ Monitor error:', error.message);
    }
  }, 30000); // Every 30 seconds
}

async function continuousProcessing() {
  console.log('🔄 Starting continuous processing...');

  // Trigger initial processing
  await triggerProcessImportQueue();

  // Wait and trigger again every 5 minutes
  setInterval(async () => {
    console.log('🔄 Triggering next batch...');
    await triggerProcessImportQueue();
  }, 5 * 60 * 1000); // Every 5 minutes
}

async function main() {
  console.log('🎯 PROPER QUEUE PROCESSOR - USING EDGE FUNCTIONS CORRECTLY');
  console.log('='.repeat(60));
  console.log('• Calls process-import-queue (has access to all secrets)');
  console.log('• Edge functions can call each other internally');
  console.log('• Firecrawl API key available in Edge Function environment');
  console.log('• Continuous batch processing every 5 minutes');
  console.log('='.repeat(60));

  // Start monitoring
  monitorProcessing();

  // Start continuous processing
  await continuousProcessing();
}

main().catch(console.error);