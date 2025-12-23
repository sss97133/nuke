#!/usr/bin/env node

/**
 * Monitor scraper progress - Check how many vehicles were created recently
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('📊 SCRAPER PROGRESS MONITOR\n');
  
  // Check vehicles created in last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { count: recentCount, error: recentError } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo);
  
  if (!recentError) {
    console.log(`✅ Vehicles created in last hour: ${recentCount || 0}`);
  }
  
  // Check queue status
  const { count: clQueuePending } = await supabase
    .from('craigslist_listing_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  const { count: importQueuePending } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  console.log(`\n📋 Queue Status:`);
  console.log(`   CL Queue: ${clQueuePending || 0} pending`);
  console.log(`   Import Queue: ${importQueuePending || 0} pending`);
  
  // Recent vehicles
  const { data: recentVehicles } = await supabase
    .from('vehicles')
    .select('id, make, model, year, created_at, discovery_source')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (recentVehicles && recentVehicles.length > 0) {
    console.log(`\n🚗 Recent Vehicles (last 10):`);
    recentVehicles.forEach((v, i) => {
      const timeAgo = Math.round((Date.now() - new Date(v.created_at).getTime()) / 1000 / 60);
      console.log(`   ${i + 1}. ${v.year} ${v.make} ${v.model} (${timeAgo}m ago, ${v.discovery_source || 'unknown'})`);
    });
  } else {
    console.log(`\n⚠️  No recent vehicles found`);
  }
  
  console.log('');
}

main();

