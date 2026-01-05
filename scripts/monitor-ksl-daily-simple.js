#!/usr/bin/env node
/**
 * Simple daily KSL monitor - Checks import_queue for new URLs
 * Then processes them with Playwright (avoids search page scraping)
 * 
 * Usage: node scripts/monitor-ksl-daily-simple.js
 * Cron: 0 6 * * * cd /Users/skylar/nuke && node scripts/monitor-ksl-daily-simple.js >> logs/ksl-monitor.log 2>&1
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../nuke_frontend/.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log(`\n🔍 Daily KSL Monitor - ${new Date().toISOString()}\n`);
  
  // Check import_queue for pending KSL URLs (1964-1991)
  const { data: pending } = await supabase
    .from('import_queue')
    .select('id, url, raw_data')
    .eq('source', 'ksl')
    .eq('status', 'pending')
    .order('discovered_at', { ascending: true })
    .limit(50); // Process up to 50 per day
  
  if (!pending || pending.length === 0) {
    console.log('✅ No pending KSL imports in queue\n');
    
    // Log summary
    const summary = {
      timestamp: new Date().toISOString(),
      pending_imports: 0,
      processed: 0,
      message: 'No new listings',
    };
    
    fs.mkdirSync('logs', { recursive: true });
    fs.writeFileSync(
      `logs/ksl-monitor-${new Date().toISOString().split('T')[0]}.json`,
      JSON.stringify(summary, null, 2)
    );
    
    return;
  }
  
  console.log(`📋 Found ${pending.length} pending KSL imports\n`);
  
  // Filter for 1964-1991 vehicles
  const vintage = pending.filter(item => {
    const year = item.raw_data?.year;
    return year && year >= 1964 && year <= 1991;
  });
  
  console.log(`🎯 ${vintage.length} are 1964-1991 vehicles\n`);
  
  if (vintage.length === 0) {
    console.log('✅ No 1964-1991 vehicles in queue\n');
    return;
  }
  
  // Process with existing Edge Function (uses Playwright for KSL)
  const stats = { processed: 0, success: 0, failed: 0 };
  
  for (const item of vintage) {
    console.log(`Processing: ${item.url}`);
    
    const { error } = await supabase.functions.invoke('process-import-queue', {
      body: { queue_id: item.id }
    });
    
    stats.processed++;
    
    if (error) {
      stats.failed++;
      console.log(`   ❌ Failed: ${error.message}`);
    } else {
      stats.success++;
      console.log(`   ✅ Imported`);
    }
    
    // Mark as processing
    await supabase
      .from('import_queue')
      .update({ status: 'processing', processed_at: new Date().toISOString() })
      .eq('id', item.id);
    
    // Rate limit
    if (stats.processed < vintage.length) {
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Processed: ${stats.processed} | Success: ${stats.success} | Failed: ${stats.failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Log summary
  const summary = {
    timestamp: new Date().toISOString(),
    pending_imports: pending.length,
    vintage_1964_1991: vintage.length,
    processed: stats.processed,
    success: stats.success,
    failed: stats.failed,
  };
  
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(
    `logs/ksl-monitor-${new Date().toISOString().split('T')[0]}.json`,
    JSON.stringify(summary, null, 2)
  );
}

main().catch(console.error);

