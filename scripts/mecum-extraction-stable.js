#!/usr/bin/env node
/**
 * Mecum Stable Extraction
 * 
 * - Processes pending vehicles from DB (natural checkpoint)
 * - Saves progress stats to .ralph/mecum_extraction_stats.json
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Rate limited to avoid overwhelming sources
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STATS_FILE = '.ralph/mecum_extraction_stats.json';
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const DELAY_MS = parseInt(process.argv[3]) || 2000;  // Delay between batches

let running = true;
let stats = {
  totalExtracted: 0,
  sessionExtracted: 0,
  sessionStarted: new Date().toISOString(),
  lastBatchAt: null,
  errors: 0
};

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SIGINT] Graceful shutdown...');
  running = false;
});
process.on('SIGTERM', () => {
  console.log('\n[SIGTERM] Graceful shutdown...');
  running = false;
});

function loadStats() {
  if (existsSync(STATS_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
      stats.totalExtracted = saved.totalExtracted || 0;
      return saved;
    } catch (e) {}
  }
  return stats;
}

function saveStats() {
  stats.lastBatchAt = new Date().toISOString();
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

async function getPendingVehicles(limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id,discovery_url&limit=${limit}`,
    { headers: { 'apikey': SUPABASE_KEY } }
  );
  return res.json();
}

async function extractVehicle(vehicle) {
  if (!vehicle.discovery_url) return false;
  
  try {
    // Call the extraction edge function
    const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-mecum-listing`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        url: vehicle.discovery_url,
        vehicle_id: vehicle.id 
      })
    });
    
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    return false;
  }
}

async function runExtractionLoop() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum Stable Extraction                                      ║');
  console.log('║  Progress auto-saved | Graceful shutdown with Ctrl+C          ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Delay: ${DELAY_MS}ms                                    ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  loadStats();
  console.log(`Previous total: ${stats.totalExtracted} extracted\n`);
  
  while (running) {
    const vehicles = await getPendingVehicles(BATCH_SIZE);
    
    if (vehicles.length === 0) {
      console.log('No pending vehicles. Waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    
    let batchSuccess = 0;
    for (const v of vehicles) {
      if (!running) break;
      
      const success = await extractVehicle(v);
      if (success) {
        batchSuccess++;
        stats.sessionExtracted++;
        stats.totalExtracted++;
      } else {
        stats.errors++;
      }
    }
    
    console.log(`[${new Date().toISOString().slice(11,19)}] Batch: ${batchSuccess}/${vehicles.length} | Session: ${stats.sessionExtracted} | Total: ${stats.totalExtracted}`);
    saveStats();
    
    // Rate limit
    if (running) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  console.log(`\n✅ Shutdown complete. Session extracted: ${stats.sessionExtracted}`);
  saveStats();
}

runExtractionLoop().catch(e => {
  console.error('Fatal:', e);
  saveStats();
  process.exit(1);
});
