#!/usr/bin/env node
/**
 * Unified Extraction Runner with State Tracking
 *
 * Runs extraction for all viable Playwright sources.
 * Tracks state persistently for zero-context agents.
 *
 * Usage:
 *   node run-extractions.js              # Run all sources
 *   node run-extractions.js mecum        # Run specific source
 *   node run-extractions.js --status     # Just show status
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = '/Users/skylar/nuke/.extraction-state.json';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Source configs - only Playwright-compatible sources
const SOURCES = {
  mecum: {
    script: 'scripts/mecum-proper-extract.js',
    batchSize: 200,
    workers: 3,
    cloudflare: false,
  },
  hagerty: {
    script: 'scripts/hagerty-proper-extract.js',
    batchSize: 50,
    workers: 2,
    cloudflare: false,
  },
  pcarmarket: {
    script: 'scripts/pcarmarket-proper-extract.js',
    batchSize: 50,
    workers: 2,
    cloudflare: false,
  },
  // Cloudflare-blocked sources (need Firecrawl)
  carsandbids: {
    script: null,
    cloudflare: true,
    note: 'Blocked by Cloudflare - needs Firecrawl',
  },
  hemmings: {
    script: null,
    cloudflare: true,
    note: 'Blocked by Cloudflare - needs Firecrawl',
  },
};

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      return { sources: {}, last_updated: null };
    }
  }
  return { sources: {}, last_updated: null };
}

function saveState(state) {
  state.last_updated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getDbCounts(source) {
  const pending = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${source}&status=eq.pending&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );
  const active = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${source}&status=eq.active&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );
  const events = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source=eq.${source}&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );

  return {
    pending: parseInt(pending.headers.get('content-range')?.split('/')[1] || '0'),
    active: parseInt(active.headers.get('content-range')?.split('/')[1] || '0'),
    events: parseInt(events.headers.get('content-range')?.split('/')[1] || '0'),
  };
}

async function showStatus() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  EXTRACTION STATUS                                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const state = loadState();

  for (const [source, config] of Object.entries(SOURCES)) {
    const counts = await getDbCounts(source);
    const s = state.sources[source] || {};

    console.log(`${source.toUpperCase()}`);
    console.log(`  Pending:    ${counts.pending.toLocaleString()}`);
    console.log(`  Active:     ${counts.active.toLocaleString()}`);
    console.log(`  Events:     ${counts.events.toLocaleString()}`);

    if (config.cloudflare) {
      console.log(`  ⚠️  ${config.note}`);
    } else {
      console.log(`  ✓ Playwright extraction available`);
    }

    if (s.last_run) {
      console.log(`  Last run:   ${s.last_run}`);
      console.log(`  Processed:  ${s.total_processed || 0}`);
    }
    console.log('');
  }
}

async function runExtraction(source) {
  const config = SOURCES[source];

  if (!config) {
    console.log(`Unknown source: ${source}`);
    return;
  }

  if (config.cloudflare) {
    console.log(`⚠️ ${source}: ${config.note}`);
    return;
  }

  const counts = await getDbCounts(source);

  if (counts.pending === 0) {
    console.log(`✓ ${source}: No pending vehicles`);
    return;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Starting ${source.toUpperCase()} extraction`);
  console.log(`Pending: ${counts.pending} | Batch: ${config.batchSize} | Workers: ${config.workers}`);
  console.log('═'.repeat(60));

  const state = loadState();
  if (!state.sources[source]) {
    state.sources[source] = { total_processed: 0, total_errors: 0, sessions: [] };
  }

  let totalProcessed = 0;
  let totalErrors = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const currentCounts = await getDbCounts(source);

    if (currentCounts.pending === 0) {
      console.log(`\n✓ ${source}: All vehicles processed!`);
      break;
    }

    console.log(`\nBatch ${batchNum} - ${currentCounts.pending} pending`);

    // Run the extraction script
    const result = await new Promise((resolve) => {
      const child = spawn('node', [
        config.script,
        String(config.batchSize),
        String(config.workers),
      ], {
        cwd: '/Users/skylar/nuke',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
        process.stdout.write(data);
      });
      child.stderr.on('data', (data) => {
        output += data.toString();
        process.stderr.write(data);
      });

      child.on('close', (code) => {
        // Parse processed count from output
        const processedMatch = output.match(/(\d+)\s*processed/i);
        const errorsMatch = output.match(/(\d+)\s*errors/i);

        resolve({
          code,
          processed: processedMatch ? parseInt(processedMatch[1]) : 0,
          errors: errorsMatch ? parseInt(errorsMatch[1]) : 0,
        });
      });
    });

    totalProcessed += result.processed;
    totalErrors += result.errors;

    // Update state after each batch
    state.sources[source].total_processed += result.processed;
    state.sources[source].total_errors += result.errors;
    state.sources[source].last_run = new Date().toISOString();
    state.sources[source].last_batch = {
      num: batchNum,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    };
    saveState(state);

    if (result.code !== 0) {
      console.log(`\n⚠️ Batch failed with code ${result.code}, waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
    }

    // Brief pause between batches
    await new Promise(r => setTimeout(r, 3000));
  }

  // Final state update
  state.sources[source].completed_at = new Date().toISOString();
  state.sources[source].sessions.unshift({
    timestamp: new Date().toISOString(),
    batches: batchNum,
    processed: totalProcessed,
    errors: totalErrors,
  });
  state.sources[source].sessions = state.sources[source].sessions.slice(0, 10);
  saveState(state);

  console.log(`\n✅ ${source}: Complete - ${totalProcessed} processed, ${totalErrors} errors`);
}

async function runAll() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  UNIFIED EXTRACTION RUNNER                                 ║');
  console.log('║  Processing all Playwright-compatible sources              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  for (const source of Object.keys(SOURCES)) {
    if (!SOURCES[source].cloudflare) {
      await runExtraction(source);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('All Playwright extractions complete!');
  console.log('\nBlocked sources (need Firecrawl):');
  for (const [source, config] of Object.entries(SOURCES)) {
    if (config.cloudflare) {
      const counts = await getDbCounts(source);
      console.log(`  - ${source}: ${counts.pending} pending`);
    }
  }
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--status') || args.includes('-s')) {
  showStatus().catch(console.error);
} else if (args.length > 0 && !args[0].startsWith('-')) {
  runExtraction(args[0]).catch(console.error);
} else {
  runAll().catch(console.error);
}
