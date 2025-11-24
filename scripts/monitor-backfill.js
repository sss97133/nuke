#!/usr/bin/env node

/**
 * REAL-TIME BACKFILL MONITOR
 * 
 * Shows live progress of image analysis backfill
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment
const possiblePaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const SUPABASE_URL = envConfig.SUPABASE_URL || envConfig.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const REFRESH_INTERVAL = 2000; // 2 seconds
let lastCount = 0;
let startTime = Date.now();
let lastCheckTime = Date.now();

function clearScreen() {
  console.log('\x1Bc'); // Clear terminal
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function createProgressBar(percent, width = 50) {
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

async function checkProgress() {
  const now = Date.now();
  
  // Get counts
  const { data, error } = await supabase.rpc('exec', {
    sql: `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN ai_scan_metadata->'context_score' IS NOT NULL THEN 1 END) as processed,
        COUNT(CASE WHEN ai_scan_metadata->'tier_1_analysis' IS NOT NULL THEN 1 END) as tier1_done,
        COUNT(CASE WHEN ai_last_scanned IS NOT NULL THEN 1 END) as has_timestamp,
        AVG((ai_scan_metadata->>'context_score')::int) FILTER (WHERE ai_scan_metadata->>'context_score' IS NOT NULL) as avg_context_score,
        SUM((ai_scan_metadata->>'processing_cost')::numeric) FILTER (WHERE ai_scan_metadata->>'processing_cost' IS NOT NULL) as total_cost
      FROM vehicle_images 
      WHERE vehicle_id IS NOT NULL;
    `
  });

  if (error) {
    // Fallback to direct query
    const { data: counts } = await supabase
      .from('vehicle_images')
      .select('ai_scan_metadata, ai_last_scanned')
      .not('vehicle_id', 'is', null);
    
    const total = counts?.length || 0;
    const processed = counts?.filter(r => r.ai_scan_metadata?.context_score)?.length || 0;
    const tier1_done = counts?.filter(r => r.ai_scan_metadata?.tier_1_analysis)?.length || 0;
    const has_timestamp = counts?.filter(r => r.ai_last_scanned)?.length || 0;
    
    return { total, processed, tier1_done, has_timestamp, avg_context_score: 0, total_cost: 0 };
  }

  const result = data?.[0] || { total: 0, processed: 0, tier1_done: 0, has_timestamp: 0, avg_context_score: 0, total_cost: 0 };
  
  // Calculate rate
  const elapsed = now - startTime;
  const timeSinceLastCheck = now - lastCheckTime;
  const newImages = result.processed - lastCount;
  const rate = (result.processed / (elapsed / 1000 / 60)); // per minute
  const recentRate = timeSinceLastCheck > 0 ? (newImages / (timeSinceLastCheck / 1000 / 60)) : 0;
  
  lastCount = result.processed;
  lastCheckTime = now;
  
  // Calculate ETA
  const remaining = result.total - result.processed;
  const eta = rate > 0 ? remaining / rate : 0;
  
  // Display
  clearScreen();
  
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║         IMAGE ANALYSIS BACKFILL - LIVE PROGRESS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');
  
  const percent = (result.processed / result.total * 100).toFixed(1);
  console.log(`  ${createProgressBar(parseFloat(percent))}  ${percent}%\n`);
  
  console.log('  📊 PROGRESS');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  console.log(`  Total Images:          ${result.total.toLocaleString()}`);
  console.log(`  Processed:             ${result.processed.toLocaleString()} (${percent}%)`);
  console.log(`  Remaining:             ${remaining.toLocaleString()}`);
  console.log('');
  
  console.log('  ⚡ PERFORMANCE');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  console.log(`  Elapsed Time:          ${formatDuration(elapsed)}`);
  console.log(`  Average Rate:          ${rate.toFixed(1)} images/min`);
  console.log(`  Recent Rate:           ${recentRate.toFixed(1)} images/min`);
  console.log(`  ETA:                   ${formatDuration(eta * 60 * 1000)}`);
  console.log('');
  
  console.log('  💰 COST TRACKING');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  console.log(`  Avg Context Score:     ${parseFloat(result.avg_context_score || 0).toFixed(1)}`);
  console.log(`  Total Cost So Far:     $${parseFloat(result.total_cost || 0).toFixed(2)}`);
  const estimatedTotal = (result.total_cost || 0) / result.processed * result.total;
  console.log(`  Estimated Total Cost:  $${estimatedTotal.toFixed(2)}`);
  console.log('');
  
  console.log('  📈 BREAKDOWN');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  console.log(`  Tier 1 Complete:       ${result.tier1_done.toLocaleString()}`);
  console.log(`  Full Analysis:         ${result.processed.toLocaleString()}`);
  console.log(`  Has Timestamp:         ${result.has_timestamp.toLocaleString()}`);
  console.log('');
  
  console.log('  ⏱️  ESTIMATED COMPLETION');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  const completionTime = new Date(Date.now() + eta * 60 * 1000);
  console.log(`  ${completionTime.toLocaleTimeString()}`);
  console.log('');
  
  console.log('  Press Ctrl+C to stop monitoring (processing will continue)');
  console.log('  ─────────────────────────────────────────────────────────────────────');
}

async function monitor() {
  console.log('🔄 Starting real-time monitor...\n');
  
  // Initial check
  await checkProgress();
  
  // Update every 2 seconds
  setInterval(checkProgress, REFRESH_INTERVAL);
}

monitor().catch(console.error);

