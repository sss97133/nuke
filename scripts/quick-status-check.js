#!/usr/bin/env node

/**
 * Quick status check - See what's happening right now
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
  console.log('📊 QUICK STATUS CHECK\n');
  
  // Vehicles created in last 30 minutes
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyMinAgo);
  
  console.log(`✅ Vehicles created in last 30 min: ${recentCount || 0}`);
  
  // Last 5 vehicles
  const { data: recent } = await supabase
    .from('vehicles')
    .select('id, make, model, year, created_at, discovery_source')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (recent && recent.length > 0) {
    console.log(`\n🚗 Last 5 vehicles:`);
    recent.forEach((v, i) => {
      const mins = Math.round((Date.now() - new Date(v.created_at).getTime()) / 1000 / 60);
      console.log(`   ${i + 1}. ${v.year} ${v.make} ${v.model} (${mins}m ago)`);
    });
  }
  
  // Queue status
  const { count: clPending } = await supabase
    .from('craigslist_listing_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  const { count: importPending } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  console.log(`\n📋 Queues: CL=${clPending || 0} pending, Import=${importPending || 0} pending`);
  console.log('');
}

main();

