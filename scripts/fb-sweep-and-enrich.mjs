#!/usr/bin/env node
/**
 * FB Marketplace Sweep + Enrichment Pipeline
 *
 * Orchestrates the full lifecycle:
 * 1. SWEEP — Run fb-marketplace-local-scraper across metros
 * 2. EXTRACT — Run description discovery on new vehicles with descriptions
 * 3. OBSERVE — Create observations for new vehicles (bridges to observation system)
 * 4. SCORE — Compute ARS for new unscored vehicles
 * 5. REPORT — Summary of what was found
 *
 * Designed to run as a cron or scheduled task.
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-sweep-and-enrich.mjs                    # full pipeline
 *   dotenvx run -- node scripts/fb-sweep-and-enrich.mjs --sweep-only       # just scrape
 *   dotenvx run -- node scripts/fb-sweep-and-enrich.mjs --enrich-only      # just enrich existing
 *   dotenvx run -- node scripts/fb-sweep-and-enrich.mjs --metros 10        # limit metro count
 *   dotenvx run -- node scripts/fb-sweep-and-enrich.mjs --max-pages 20     # pages per metro
 */

import { execSync, spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const SWEEP_ONLY = args.includes('--sweep-only');
const ENRICH_ONLY = args.includes('--enrich-only');
const MAX_METROS = parseInt(getArg('metros', '58'));
const MAX_PAGES = parseInt(getArg('max-pages', '30'));

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ── Step 1: Sweep ──
async function runSweep() {
  log('═══ STEP 1: FB Marketplace Sweep ═══');

  const beforeCount = await getVehicleCount();
  log(`Vehicles before sweep: ${beforeCount}`);

  return new Promise((resolve) => {
    const child = spawn('node', [
      'scripts/fb-marketplace-local-scraper.mjs',
      '--all',
      `--max-pages`, String(MAX_PAGES),
      `--metros`, String(MAX_METROS),
    ], { stdio: 'inherit', env: process.env });

    child.on('close', async (code) => {
      const afterCount = await getVehicleCount();
      const newCount = afterCount - beforeCount;
      log(`Sweep complete (exit ${code}). New vehicles: ${newCount}`);
      resolve(newCount);
    });
  });
}

async function getVehicleCount() {
  const { count } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'facebook_marketplace')
    .eq('status', 'active');
  return count || 0;
}

// ── Step 2: Create observations for unobserved FB vehicles ──
async function bridgeToObservations() {
  log('═══ STEP 2: Bridge to Observation System ═══');

  // Find FB vehicles that have NO observations
  const { data: unobserved } = await supabase.rpc('execute_sql', {
    query: `
      SELECT v.id, v.year, v.make, v.model, v.listing_url, v.description, v.asking_price,
        v.city, v.state, v.created_at
      FROM vehicles v
      LEFT JOIN vehicle_observations vo ON vo.vehicle_id = v.id
      WHERE v.source = 'facebook_marketplace' AND v.status = 'active'
        AND vo.id IS NULL
      LIMIT 500
    `
  });

  if (!unobserved?.length) {
    log('No unobserved vehicles to bridge');
    return 0;
  }

  log(`Bridging ${unobserved.length} vehicles to observation system...`);
  let created = 0;

  for (const v of unobserved) {
    const obs = {
      vehicle_id: v.id,
      source_id: null, // Will use source_url to identify
      kind: 'listing',
      observed_at: v.created_at || new Date().toISOString(),
      source_url: v.listing_url,
      source_identifier: v.listing_url?.match(/\/item\/(\d+)/)?.[1] || null,
      content_text: v.description || `${v.year} ${v.make} ${v.model}`,
      structured_data: {
        year: v.year, make: v.make, model: v.model,
        asking_price: v.asking_price,
        city: v.city, state: v.state,
      },
      confidence_score: 0.50, // FB marketplace = low trust
      confidence: 'medium',
      vehicle_match_confidence: 1.0, // We created the vehicle from this listing
      vehicle_match_signals: { source: 'direct_creation' },
    };

    const { error } = await supabase.from('vehicle_observations').insert(obs);
    if (!error) created++;
  }

  log(`Created ${created} observations`);
  return created;
}

// ── Step 3: Run description extraction on FB vehicles with descriptions ──
async function extractDescriptions() {
  log('═══ STEP 3: Description Extraction ═══');

  const { data: unextracted } = await supabase.rpc('execute_sql', {
    query: `
      SELECT v.id, v.year, v.make, v.model, v.description
      FROM vehicles v
      LEFT JOIN description_discoveries dd ON dd.vehicle_id = v.id
      WHERE v.source = 'facebook_marketplace' AND v.status = 'active'
        AND v.description IS NOT NULL AND length(v.description) > 50
        AND dd.id IS NULL
      LIMIT 200
    `
  });

  if (!unextracted?.length) {
    log('No descriptions to extract');
    return 0;
  }

  log(`${unextracted.length} vehicles with unextracted descriptions`);
  log('Run: dotenvx run -- node scripts/local-description-discovery.mjs --provider ollama --batch 50 --max 200');
  // TODO: Could spawn the extraction here, but it's expensive and should be opt-in
  return unextracted.length;
}

// ── Step 4: Score unscored vehicles ──
async function scoreNewVehicles() {
  log('═══ STEP 4: ARS Scoring ═══');

  const { data: unscored } = await supabase.rpc('execute_sql', {
    query: `
      SELECT count(*) as cnt FROM vehicles v
      LEFT JOIN auction_readiness ar ON ar.vehicle_id = v.id
      WHERE v.source = 'facebook_marketplace' AND v.status = 'active'
        AND ar.vehicle_id IS NULL
    `
  });

  const count = unscored?.[0]?.cnt || 0;
  if (count === 0) {
    log('All FB vehicles already scored');
    return 0;
  }

  log(`Scoring ${count} unscored FB vehicles...`);

  // Score in batches via persist_auction_readiness
  const { data: toScore } = await supabase.rpc('execute_sql', {
    query: `
      SELECT v.id FROM vehicles v
      LEFT JOIN auction_readiness ar ON ar.vehicle_id = v.id
      WHERE v.source = 'facebook_marketplace' AND v.status = 'active'
        AND ar.vehicle_id IS NULL
      LIMIT 1000
    `
  });

  let scored = 0;
  for (const row of (toScore || [])) {
    try {
      await supabase.rpc('persist_auction_readiness', { p_vehicle_id: row.id });
      scored++;
    } catch { /* skip errors */ }
  }

  log(`Scored ${scored} vehicles`);
  return scored;
}

// ── Step 5: Report ──
async function report() {
  log('═══ REPORT ═══');

  const { data: stats } = await supabase.rpc('execute_sql', {
    query: `
      SELECT
        count(*) FILTER (WHERE status = 'active') as active,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours') as new_24h,
        count(*) FILTER (WHERE created_at > now() - interval '7 days') as new_7d,
        count(*) FILTER (WHERE description IS NOT NULL AND length(description) > 10) as with_desc,
        count(*) FILTER (WHERE asking_price IS NOT NULL) as with_price
      FROM vehicles WHERE source = 'facebook_marketplace'
    `
  });

  const s = stats?.[0] || {};
  log(`Active: ${s.active} | New 24h: ${s.new_24h} | New 7d: ${s.new_7d} | With desc: ${s.with_desc} | With price: ${s.with_price}`);
}

// ── Main ──
async function main() {
  log('═══════════════════════════════════════════════════');
  log('  FB Marketplace Sweep + Enrich Pipeline');
  log('═══════════════════════════════════════════════════');

  if (!ENRICH_ONLY) {
    await runSweep();
  }

  if (!SWEEP_ONLY) {
    await bridgeToObservations();
    await extractDescriptions();
    await scoreNewVehicles();
  }

  await report();
  log('Done.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
