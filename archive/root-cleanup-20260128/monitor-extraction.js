#!/usr/bin/env node

/**
 * EXTRACTION MONITOR
 * Monitors steady profile extraction progress
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function monitorProgress() {
  console.log('📊 EXTRACTION PROGRESS MONITOR');
  console.log('='.repeat(50));

  const startTime = Date.now();

  setInterval(async () => {
    try {
      // Check queue status
      const { data: queueStats } = await supabase
        .from('import_queue')
        .select('priority')
        .limit(1000);

      const queueCount = queueStats?.length || 0;
      const highPriority = queueStats?.filter(q => q.priority >= 10).length || 0;

      // Check recent vehicles created
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, created_at')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(20);

      const recentCount = recentVehicles?.length || 0;
      const elapsedHours = (Date.now() - startTime) / (1000 * 60 * 60);
      const vehiclesPerHour = elapsedHours > 0 ? Math.round(recentCount / elapsedHours) : 0;

      console.log(`\\n🕒 ${new Date().toLocaleTimeString()}`);
      console.log(`📋 Queue: ${queueCount} items (${highPriority} high priority)`);
      console.log(`🚗 Vehicles created in last hour: ${recentCount}`);
      console.log(`⚡ Rate: ~${vehiclesPerHour} vehicles/hour`);

      if (recentVehicles && recentVehicles.length > 0) {
        console.log(`📈 Latest extractions:`);
        recentVehicles.slice(0, 3).forEach((v, i) => {
          console.log(`   ${i + 1}. ${v.year || '????'} ${v.make || 'Unknown'} ${v.model || 'Unknown'} (${new Date(v.created_at).toLocaleTimeString()})`);
        });
      }

    } catch (error) {
      console.error('❌ Monitor error:', error.message);
    }
  }, 30000); // Update every 30 seconds
}

monitorProgress().catch(console.error);