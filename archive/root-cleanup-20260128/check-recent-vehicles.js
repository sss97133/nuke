#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function checkRecentVehicles() {
  console.log('🔍 Checking recent vehicle extractions...');

  try {
    // Check vehicles created in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentVehicles, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, asking_price, source, created_at')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ Database error:', error);
      return;
    }

    console.log(`📊 Found ${recentVehicles.length} vehicles created in last 24 hours:`);
    recentVehicles.forEach((vehicle, index) => {
      console.log(`${index + 1}. ${vehicle.year || '????'} ${vehicle.make || 'Unknown'} ${vehicle.model || 'Model'} - $${vehicle.asking_price || 'N/A'} [${vehicle.source}] (${new Date(vehicle.created_at).toLocaleString()})`);
    });

    // Check queue status
    const { data: queueStats } = await supabase
      .from('import_queue')
      .select('priority')
      .limit(1000);

    const queueCount = queueStats?.length || 0;
    const highPriority = queueStats?.filter(q => q.priority >= 10).length || 0;

    console.log(`\n📋 Queue Status: ${queueCount} items (${highPriority} high priority)`);

  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

checkRecentVehicles();