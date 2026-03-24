#!/usr/bin/env node
/**
 * YONO Batch Zone Classification
 *
 * Sends unclassified vehicle images through the YONO sidecar on Modal
 * for zone classification (41 zones) + condition analysis.
 *
 * FREE — YONO runs on Modal, costs only while processing (~$0.59/hr on T4).
 * Cold start: ~15s first image, then ~200ms per image.
 *
 * Usage:
 *   dotenvx run -- node scripts/yono-batch-classify.mjs --batch 100
 *   dotenvx run -- node scripts/yono-batch-classify.mjs --batch 500 --source facebook_marketplace
 *   dotenvx run -- node scripts/yono-batch-classify.mjs --batch 100 --analyze  # also run condition analysis
 *   dotenvx run -- node scripts/yono-batch-classify.mjs --stats
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const YONO_URL = 'https://sss97133--yono-serve-fastapi-app.modal.run';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const BATCH_SIZE = parseInt(getArg('batch', '100'));
const SOURCE = getArg('source', null);
const ANALYZE = args.includes('--analyze');
const STATS_ONLY = args.includes('--stats');

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function checkHealth() {
  try {
    const res = await fetch(`${YONO_URL}/health`, { signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    return data.status === 'ok';
  } catch { return false; }
}

async function classifyImage(imageUrl) {
  const res = await fetch(`${YONO_URL}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, top_k: 3 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function analyzeImage(imageUrl) {
  const res = await fetch(`${YONO_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getUnclassifiedImages(limit) {
  // Two-step approach: get vehicle IDs first (fast), then their images
  const base = SUPABASE_URL.replace(/\/$/, '');

  // Step 1: Get FB marketplace vehicle IDs
  let vehicleUrl = `${base}/rest/v1/vehicles?select=id&status=eq.active&limit=${Math.min(limit * 2, 1000)}`;
  if (SOURCE) vehicleUrl += `&source=eq.${SOURCE}`;

  const vRes = await fetch(vehicleUrl, {
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
  });
  const vehicles = await vRes.json();
  if (!vehicles?.length) return [];

  // Step 2: Get unclassified images for these vehicles
  const vids = vehicles.map(v => v.id);
  const results = [];

  // Process in chunks of 50 vehicle IDs
  for (let i = 0; i < vids.length && results.length < limit; i += 50) {
    const chunk = vids.slice(i, i + 50);
    const imgUrl = `${base}/rest/v1/vehicle_images?select=id,vehicle_id,image_url&vehicle_id=in.(${chunk.join(',')})&or=(vehicle_zone.is.null,vehicle_zone.eq.)&image_url=like.*supabase*&limit=${limit - results.length}`;

    const iRes = await fetch(imgUrl, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    });
    const imgs = await iRes.json();
    if (imgs?.length) results.push(...imgs);
  }

  return results;
}

async function updateImageZone(imageId, zone, zoneConfidence, makeResult) {
  const updates = { vehicle_zone: zone, zone_confidence: zoneConfidence };
  if (makeResult?.make) updates.detected_make = makeResult.make;
  if (makeResult?.confidence) updates.make_confidence = makeResult.confidence;

  await supabase.from('vehicle_images').update(updates).eq('id', imageId);
}

async function updateImageAnalysis(imageId, analysis) {
  const updates = {};
  if (analysis.condition_score) updates.condition_score = analysis.condition_score;
  if (analysis.damage_flags) updates.damage_flags = analysis.damage_flags;
  if (analysis.modification_flags) updates.modification_flags = analysis.modification_flags;
  if (analysis.photo_quality) updates.photo_quality_score = analysis.photo_quality;
  updates.vision_analyzed_at = new Date().toISOString();
  updates.vision_model_version = 'yono-finetuned-v2';

  await supabase.from('vehicle_images').update(updates).eq('id', imageId);
}

async function showStats() {
  const { data } = await supabase.rpc('execute_sql', {
    query: `
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE vehicle_zone IS NOT NULL) as classified,
        count(*) FILTER (WHERE vehicle_zone IS NULL AND image_url LIKE '%supabase%') as unclassified_local,
        count(*) FILTER (WHERE condition_score IS NOT NULL) as condition_scored,
        count(*) FILTER (WHERE vision_analyzed_at IS NOT NULL) as vision_analyzed
      FROM vehicle_images
      WHERE vehicle_id IN (SELECT id FROM vehicles WHERE source = 'facebook_marketplace' AND status = 'active')
    `
  });
  const s = data?.[0] || {};
  log(`FB Marketplace Images:`);
  log(`  Total: ${s.total}`);
  log(`  Zone classified: ${s.classified} (${((s.classified/s.total)*100).toFixed(1)}%)`);
  log(`  Unclassified (local): ${s.unclassified_local}`);
  log(`  Condition scored: ${s.condition_scored}`);
  log(`  Vision analyzed: ${s.vision_analyzed}`);
}

async function main() {
  log('═══════════════════════════════════════════════════');
  log('  YONO Batch Zone Classification');
  log(`  Batch: ${BATCH_SIZE} | Source: ${SOURCE || 'all'} | Analyze: ${ANALYZE}`);
  log('═══════════════════════════════════════════════════');

  if (STATS_ONLY) { await showStats(); return; }

  // Health check (triggers cold start)
  log('Checking YONO health (may cold-start ~15s)...');
  const healthy = await checkHealth();
  if (!healthy) {
    log('YONO sidecar not responding. Deploy with: modal deploy yono/modal_serve.py');
    process.exit(1);
  }
  log('YONO healthy.');

  // Get unclassified images
  const images = await getUnclassifiedImages(BATCH_SIZE);
  if (!images?.length) {
    log('No unclassified images found.');
    return;
  }
  log(`Processing ${images.length} images...`);

  let classified = 0, analyzed = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      // Zone classification
      const result = await classifyImage(img.image_url);
      if (result?.zone && result.zone_confidence >= 0.30) {
        // High enough confidence to trust
        await updateImageZone(img.id, result.zone, result.zone_confidence, result);
        classified++;
      } else if (result?.zone) {
        // Low confidence — flag as uncertain, don't pollute zone data
        await updateImageZone(img.id, 'uncertain_' + result.zone, result.zone_confidence, result);
        classified++;
      } else {
        errors++;
      }

      // Condition analysis (optional, slower)
      if (ANALYZE && result?.zone) {
        const analysis = await analyzeImage(img.image_url);
        if (analysis?.condition_score) {
          await updateImageAnalysis(img.id, analysis);
          analyzed++;
        }
      }

      if ((i + 1) % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (classified / (elapsed / 60)).toFixed(0);
        log(`  [${i+1}/${images.length}] ${classified} classified, ${analyzed} analyzed, ${errors} errors | ${rate}/min`);
      }
    } catch (err) {
      errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  log(`\nDone: ${classified} classified, ${analyzed} analyzed, ${errors} errors in ${elapsed}s`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
