#!/usr/bin/env node

/**
 * IMAGE ANALYSIS PROGRESS MONITOR
 * 
 * Real-time monitoring dashboard for image analysis progress
 * Shows:
 * - Processing rate
 * - Success/failure counts
 * - ETA for completion
 * - Recent errors
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const supabaseUrl = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let lastProcessedCount = 0;
let startTime = Date.now();
let samples = [];

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function renderProgressBar(current, total, width = 50) {
  const percentage = current / total;
  const filled = Math.floor(percentage * width);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = (percentage * 100).toFixed(1);
  
  return `[${bar}] ${percent}%`;
}

async function getStats() {
  // Get all images and their metadata
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata, created_at');
  
  const total = allImages?.length || 0;
  let processed = 0;
  let hasRekognition = 0;
  let hasAppraiser = 0;
  let hasSPID = 0;
  let recentProcessed = [];
  
  allImages?.forEach(img => {
    const metadata = img.ai_scan_metadata;
    if (metadata && typeof metadata === 'object' && metadata.scanned_at) {
      processed++;
      
      if (metadata.rekognition) hasRekognition++;
      if (metadata.appraiser) hasAppraiser++;
      if (metadata.spid) hasSPID++;
      
      // Track recently processed (within last hour)
      const scannedAt = new Date(metadata.scanned_at);
      if (Date.now() - scannedAt.getTime() < 3600000) {
        recentProcessed.push({
          id: img.id,
          scannedAt: scannedAt,
          hasRekognition: !!metadata.rekognition,
          hasAppraiser: !!metadata.appraiser,
          hasSPID: !!metadata.spid
        });
      }
    }
  });
  
  return {
    total,
    processed,
    unprocessed: total - processed,
    hasRekognition,
    hasAppraiser,
    hasSPID,
    recentProcessed: recentProcessed.sort((a, b) => b.scannedAt - a.scannedAt).slice(0, 10)
  };
}

async function render() {
  const stats = await getStats();
  
  // Calculate rate
  const elapsed = Date.now() - startTime;
  const processedDelta = stats.processed - lastProcessedCount;
  lastProcessedCount = stats.processed;
  
  // Track samples for rate calculation
  if (processedDelta > 0) {
    samples.push({
      timestamp: Date.now(),
      count: processedDelta
    });
    
    // Keep only last 10 samples
    if (samples.length > 10) {
      samples.shift();
    }
  }
  
  // Calculate average rate from samples
  let imagesPerMinute = 0;
  if (samples.length > 1) {
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];
    const timeDelta = (lastSample.timestamp - firstSample.timestamp) / 60000; // minutes
    const countDelta = samples.reduce((sum, s) => sum + s.count, 0);
    imagesPerMinute = timeDelta > 0 ? countDelta / timeDelta : 0;
  }
  
  // Calculate ETA
  let eta = 'calculating...';
  if (imagesPerMinute > 0 && stats.unprocessed > 0) {
    const minutesRemaining = stats.unprocessed / imagesPerMinute;
    eta = formatDuration(minutesRemaining * 60000);
  } else if (stats.unprocessed === 0) {
    eta = 'complete';
  }
  
  clearScreen();
  
  // Header
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              IMAGE ANALYSIS PROGRESS MONITOR                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  
  // Main progress
  console.log('OVERALL PROGRESS');
  console.log('─'.repeat(80));
  console.log(renderProgressBar(stats.processed, stats.total, 60));
  console.log(`\nProcessed: ${formatNumber(stats.processed)} / ${formatNumber(stats.total)}`);
  console.log(`Remaining: ${formatNumber(stats.unprocessed)}`);
  console.log(`\nProcessing Rate: ${imagesPerMinute.toFixed(1)} images/minute`);
  console.log(`Estimated Time Remaining: ${eta}`);
  console.log(`Elapsed Time: ${formatDuration(elapsed)}`);
  
  // Extraction stats
  console.log('\n\nEXTRACTION BREAKDOWN');
  console.log('─'.repeat(80));
  console.log(`Rekognition Labels:  ${formatNumber(stats.hasRekognition)} (${((stats.hasRekognition/stats.processed)*100).toFixed(1)}%)`);
  console.log(`Appraiser Analysis:  ${formatNumber(stats.hasAppraiser)} (${((stats.hasAppraiser/stats.processed)*100).toFixed(1)}%)`);
  console.log(`SPID Sheets Found:   ${formatNumber(stats.hasSPID)} (${((stats.hasSPID/stats.total)*100).toFixed(1)}% of total)`);
  
  // Recent activity
  if (stats.recentProcessed.length > 0) {
    console.log('\n\nRECENT ACTIVITY (Last Hour)');
    console.log('─'.repeat(80));
    stats.recentProcessed.slice(0, 5).forEach(item => {
      const timeAgo = Math.floor((Date.now() - item.scannedAt.getTime()) / 1000);
      const status = [
        item.hasRekognition ? '✓ Rekog' : '✗ Rekog',
        item.hasAppraiser ? '✓ Appr' : '✗ Appr',
        item.hasSPID ? '✓ SPID' : ''
      ].filter(s => s).join(' | ');
      
      console.log(`  ${item.id.substring(0, 8)}... | ${timeAgo}s ago | ${status}`);
    });
  }
  
  // Footer
  console.log('\n' + '─'.repeat(80));
  console.log('Press Ctrl+C to exit | Refreshing every 5 seconds...');
  console.log('─'.repeat(80));
}

async function main() {
  console.log('Starting monitor...\n');
  
  // Initial render
  await render();
  
  // Update every 5 seconds
  setInterval(async () => {
    await render();
  }, 5000);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

