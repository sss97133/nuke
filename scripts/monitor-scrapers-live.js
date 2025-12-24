#!/usr/bin/env node

/**
 * Live scraper monitoring - shows real-time progress
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkProgress() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  // Get vehicle counts
  const { count: total } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  const { count: lastHour } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo);

  const { count: last30Min } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyMinAgo);

  const { count: last10Min } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', tenMinAgo);

  // Get recent vehicles
  const { data: recent } = await supabase
    .from('vehicles')
    .select('id, make, model, year, created_at, discovery_source')
    .order('created_at', { ascending: false })
    .limit(10);

  // Check queue status
  const { count: clPending } = await supabase
    .from('craigslist_listing_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: importPending } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // Check active processes
  const logFiles = [
    '/tmp/scraper-aggressive-1.log',
    '/tmp/scraper-aggressive-2.log',
    '/tmp/scraper-balanced.log',
    '/tmp/scraper-fixed.log'
  ];

  const activeLogs = logFiles.filter(f => {
    try {
      const stats = fs.statSync(f);
      const age = Date.now() - stats.mtimeMs;
      return age < 5 * 60 * 1000; // Modified in last 5 minutes
    } catch {
      return false;
    }
  });

  console.clear();
  console.log('='.repeat(70));
  console.log('🚀 LIVE SCRAPER MONITOR');
  console.log('='.repeat(70));
  console.log('');
  console.log(`📊 TOTAL VEHICLES: ${total || 0}`);
  console.log(`   Last hour: ${lastHour || 0}`);
  console.log(`   Last 30 min: ${last30Min || 0}`);
  console.log(`   Last 10 min: ${last10Min || 0}`);
  console.log('');
  console.log(`📋 QUEUES: CL=${clPending || 0} pending, Import=${importPending || 0} pending`);
  console.log(`🔄 ACTIVE LOGS: ${activeLogs.length} scraper processes`);
  console.log('');
  
  if (recent && recent.length > 0) {
    console.log('🚗 RECENT VEHICLES:');
    recent.forEach((v, i) => {
      const mins = Math.round((Date.now() - new Date(v.created_at).getTime()) / 1000 / 60);
      const source = v.discovery_source || 'unknown';
      console.log(`   ${i + 1}. ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${mins}m ago, ${source})`);
    });
  }
  
  console.log('');
  console.log('Press Ctrl+C to exit');
}

// Run every 10 seconds
setInterval(checkProgress, 10000);
checkProgress(); // Run immediately

