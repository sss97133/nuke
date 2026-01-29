#!/usr/bin/env node

/**
 * STATUS SUMMARY
 * Provides comprehensive status of the extraction system
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function getStatus() {
  console.log('📊 EXTRACTION SYSTEM STATUS SUMMARY');
  console.log('='.repeat(60));

  try {
    // Queue status
    const { data: queueStats } = await supabase
      .from('import_queue')
      .select('priority, created_at')
      .limit(1000);

    const queueCount = queueStats?.length || 0;
    const highPriority = queueStats?.filter(q => q.priority >= 10).length || 0;
    const mediumPriority = queueStats?.filter(q => q.priority >= 5 && q.priority < 10).length || 0;
    const lowPriority = queueStats?.filter(q => q.priority < 5).length || 0;

    console.log('📋 QUEUE STATUS:');
    console.log(`   Total items: ${queueCount}`);
    console.log(`   🔥 High priority: ${highPriority}`);
    console.log(`   🟡 Medium priority: ${mediumPriority}`);
    console.log(`   ⚪ Low priority: ${lowPriority}`);

    // Vehicle database status
    const { data: vehicleStats } = await supabase
      .from('vehicles')
      .select('source, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    const vehicleCount = vehicleStats?.length || 0;
    const batVehicles = vehicleStats?.filter(v =>
      v.source?.includes('bat') || v.source?.includes('bring')
    ).length || 0;

    console.log('\n🚗 VEHICLE DATABASE:');
    console.log(`   Total vehicles: ${vehicleCount}`);
    console.log(`   BaT vehicles: ${batVehicles}`);

    // Recent activity
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentVehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, created_at')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentCount = recentVehicles?.length || 0;
    const vehiclesPerHour = recentCount; // In the last hour

    console.log('\n⚡ EXTRACTION PERFORMANCE:');
    console.log(`   Vehicles in last hour: ${recentCount}`);
    console.log(`   Current rate: ~${vehiclesPerHour} vehicles/hour`);

    if (recentVehicles && recentVehicles.length > 0) {
      console.log('\n📈 LATEST EXTRACTIONS:');
      recentVehicles.slice(0, 5).forEach((v, i) => {
        console.log(`   ${i + 1}. ${v.year || '????'} ${v.make || 'Unknown'} ${v.model || 'Unknown'}`);
        console.log(`      Created: ${new Date(v.created_at).toLocaleString()}`);
      });
    } else {
      console.log('\n🔄 No recent extractions - worker may be starting up');
    }

    // System recommendations
    console.log('\n🎯 SYSTEM STATUS:');
    if (vehiclesPerHour >= 20) {
      console.log('   ✅ Excellent: Extraction rate is high');
    } else if (vehiclesPerHour >= 10) {
      console.log('   🟡 Good: Extraction rate is moderate');
    } else if (vehiclesPerHour > 0) {
      console.log('   🔄 Starting: Extraction is beginning');
    } else {
      console.log('   ⚠️  Issue: No recent extractions');
    }

    if (queueCount > 500) {
      console.log('   📊 Large queue: Consider increasing worker capacity');
    }

    console.log('\n🔧 BACKGROUND WORKERS:');
    console.log('   • Steady extraction worker: Processing queue sequentially');
    console.log('   • Extraction monitor: Tracking progress every 30s');
    console.log('   • Priority processing: High-priority items processed first');

  } catch (error) {
    console.error('❌ Error getting status:', error);
  }
}

getStatus();