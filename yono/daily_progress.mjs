#!/usr/bin/env node
/**
 * YONO Daily Progress — Nightly batch processor for vehicle image classification.
 *
 * Pulls pending images from vehicle_images, runs YONO classification (via local
 * sidecar or Modal endpoint), writes results back. Zero cloud AI cost.
 *
 * Usage:
 *   npm run yono:daily                         # default: 1000 images
 *   npm run yono:daily -- --limit 5000         # process 5000 images
 *   npm run yono:daily -- --dry-run            # classify but don't write
 *   npm run yono:daily -- --vehicle-id <uuid>  # restrict to one vehicle
 *   npm run yono:daily -- --report-only        # just print pipeline status
 *   npm run yono:daily -- --unstick            # release stuck processing rows
 *
 * Requires:
 *   - YONO sidecar running (local: localhost:8472 or Modal via YONO_SIDECAR_URL)
 *   - Supabase credentials in .env (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *
 * Idempotency:
 *   - Uses ai_processing_status = 'pending' filter — already-processed images are skipped
 *   - Locks rows by setting ai_processing_status = 'processing' before inference
 *   - On failure, resets to 'pending' so next run retries
 *   - Safe to run multiple times or kill mid-run
 *
 * Output:
 *   - Writes ai_scan_metadata.yono with classification result
 *   - Updates ai_processing_status to 'completed' (high confidence) or 'pending' (for cloud pass)
 *   - Logs metrics to stdout and logs/yono-daily-YYYY-MM-DD.json
 *
 * @module yono/daily_progress
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Config ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const NUKE_DIR = resolve(__dirname, '..');

// Load env via dotenvx pattern (expects dotenvx run --)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SIDECAR_URL = process.env.YONO_SIDECAR_URL || 'http://127.0.0.1:8472';
const SIDECAR_TOKEN = process.env.MODAL_SIDECAR_TOKEN || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Run with: dotenvx run -- node yono/daily_progress.mjs');
  process.exit(1);
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 1000;
const BATCH_SIZE = 20;                // images per sidecar call
const SIDECAR_TIMEOUT_MS = 120_000;   // 2 min per batch
const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const STALE_PROCESSING_HOURS = 1;     // rows stuck in 'processing' for >1h

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}
function flag(name) { return args.includes(name); }

const LIMIT = parseInt(arg('--limit') || String(DEFAULT_LIMIT), 10);
const DRY_RUN = flag('--dry-run');
const VEHICLE_ID = arg('--vehicle-id');
const REPORT_ONLY = flag('--report-only');
const UNSTICK = flag('--unstick');

// ── Supabase client ─────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Sidecar helpers ─────────────────────────────────────────────────────────

function sidecarHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (SIDECAR_TOKEN) headers['Authorization'] = `Bearer ${SIDECAR_TOKEN}`;
  return headers;
}

async function checkSidecar() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15_000);
    const resp = await fetch(`${SIDECAR_URL}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) return { available: false, reason: `HTTP ${resp.status}` };
    const health = await resp.json();
    return {
      available: true,
      classify: true,
      vision: health.vision_available || false,
      uptime: health.uptime_s || 0,
      tier1: health.tier1 || false,
      tier2_families: health.tier2_families || [],
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

async function classifyBatch(imageUrls) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), SIDECAR_TIMEOUT_MS);

  try {
    // Sidecar expects: { images: [{ image_url: "...", top_k: 5 }, ...] }
    const payload = {
      images: imageUrls.map(url => ({ image_url: url, top_k: 5 })),
    };
    const resp = await fetch(`${SIDECAR_URL}/classify/batch`, {
      method: 'POST',
      headers: sidecarHeaders(),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Sidecar HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }
    return await resp.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ── Pipeline status report ──────────────────────────────────────────────────

async function pipelineReport() {
  console.log('\n=== YONO Image Pipeline Status ===\n');

  // Status distribution via direct count queries
  // Note: 'pending' has 34M+ rows and exact count times out via PostgREST.
  // We count the smaller statuses directly and estimate 'pending' from the total.
  const statuses = {};
  for (const status of ['completed', 'processing', 'failed', 'skipped']) {
    try {
      const { count } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('ai_processing_status', status);
      if (count != null && count > 0) statuses[status] = count;
    } catch {
      // Skip if query fails
    }
  }
  // Estimate total and pending: total images minus known statuses
  // We use estimated count since exact count of 34M+ rows times out
  try {
    const { count: totalEstimate } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'estimated', head: true });
    if (totalEstimate != null) {
      const knownNonPending = Object.values(statuses).reduce((a, b) => a + b, 0);
      statuses['pending'] = Math.max(0, totalEstimate - knownNonPending);
    }
  } catch {
    statuses['pending'] = -1; // unknown
  }

  console.log('Image processing status:');
  for (const [status, count] of Object.entries(statuses).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(15)} ${count.toLocaleString()}`);
  }
  const total = Object.values(statuses).reduce((a, b) => a + b, 0);
  console.log(`  ${'TOTAL'.padEnd(15)} ${total.toLocaleString()}`);

  // Stuck images
  const { count: stuckCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'processing')
    .lt('updated_at', new Date(Date.now() - STALE_PROCESSING_HOURS * 3600000).toISOString());

  if (stuckCount > 0) {
    console.log(`\n  WARNING: ${stuckCount.toLocaleString()} images stuck in 'processing' for >${STALE_PROCESSING_HOURS}h`);
    console.log(`  Run with --unstick to release them`);
  }

  // Sidecar health
  console.log('\nSidecar health:');
  const health = await checkSidecar();
  if (health.available) {
    console.log(`  Status:     ONLINE at ${SIDECAR_URL}`);
    console.log(`  Classify:   ${health.classify ? 'YES' : 'NO'}`);
    console.log(`  Vision:     ${health.vision ? 'YES' : 'NO'}`);
    console.log(`  Uptime:     ${Math.round(health.uptime / 60)}min`);
    console.log(`  Tier-1:     ${health.tier1 ? 'YES' : 'NO'}`);
    console.log(`  Tier-2:     ${health.tier2_families?.length || 0} families`);
  } else {
    console.log(`  Status:     OFFLINE (${health.reason})`);
    console.log(`  URL:        ${SIDECAR_URL}`);
  }

  // Completion rate
  const completed = statuses['completed'] || 0;
  const pending = statuses['pending'] || 0;
  const pct = total > 0 ? ((completed / total) * 100).toFixed(2) : '0.00';
  console.log(`\nCompletion: ${pct}% (${completed.toLocaleString()} / ${total.toLocaleString()})`);

  // Estimate at 500 images/min sidecar throughput
  const hoursRemaining = pending / (500 * 60);
  console.log(`Estimated time to process all pending: ${Math.round(hoursRemaining)} hours (at 500 img/min)`);

  return { statuses, stuckCount, health, total, completed, pending };
}

// ── Unstick processing rows ─────────────────────────────────────────────────

async function unstickProcessing() {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_HOURS * 3600000).toISOString();

  console.log(`\nReleasing images stuck in 'processing' since before ${cutoff}...`);

  // Batch in 1000-row chunks per CLAUDE.md BATCHED MIGRATION PRINCIPLE
  let totalReleased = 0;
  while (true) {
    const { data: stuckBatch } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('ai_processing_status', 'processing')
      .lt('updated_at', cutoff)
      .limit(1000);

    if (!stuckBatch || stuckBatch.length === 0) break;

    const ids = stuckBatch.map(r => r.id);
    const { error } = await supabase
      .from('vehicle_images')
      .update({ ai_processing_status: 'pending' })
      .in('id', ids);

    if (error) {
      console.error(`  Error releasing batch: ${error.message}`);
      break;
    }

    totalReleased += ids.length;
    console.log(`  Released ${ids.length} (total: ${totalReleased})`);

    // Breathe
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nTotal released: ${totalReleased} images reset to 'pending'`);
  return totalReleased;
}

// ── Main processing loop ────────────────────────────────────────────────────

async function processImages() {
  const startTime = Date.now();
  const metrics = {
    processed: 0,
    classified: 0,
    highConfidence: 0,
    lowConfidence: 0,
    errors: 0,
    skipped: 0,
    confidenceDistribution: { '0.0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 },
    topMakes: {},
    batchTimes: [],
  };

  let remaining = LIMIT;
  let batchNum = 0;

  console.log(`\n=== YONO Daily Progress ===`);
  console.log(`Target: ${LIMIT} images`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Sidecar: ${SIDECAR_URL}`);
  console.log(`Dry run: ${DRY_RUN}`);
  if (VEHICLE_ID) console.log(`Vehicle: ${VEHICLE_ID}`);
  console.log('');

  while (remaining > 0) {
    batchNum++;
    const thisBatch = Math.min(BATCH_SIZE, remaining);

    // ── 1. Fetch pending images ──────────────────────────────────────────
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id')
      .eq('ai_processing_status', 'pending')
      .not('image_url', 'is', null)
      .limit(thisBatch);

    if (VEHICLE_ID) {
      query = query.eq('vehicle_id', VEHICLE_ID);
    }

    const { data: images, error: fetchError } = await query;

    if (fetchError) {
      console.error(`Fetch error: ${fetchError.message}`);
      metrics.errors++;
      break;
    }

    if (!images || images.length === 0) {
      console.log('No more pending images found.');
      break;
    }

    // ── 2. Lock rows (set to 'processing') ───────────────────────────────
    if (!DRY_RUN) {
      const ids = images.map(i => i.id);
      const { error: lockError } = await supabase
        .from('vehicle_images')
        .update({ ai_processing_status: 'processing', updated_at: new Date().toISOString() })
        .in('id', ids);

      if (lockError) {
        console.error(`Lock error: ${lockError.message}`);
        metrics.errors++;
        break;
      }
    }

    // ── 3. Run YONO classification ───────────────────────────────────────
    const batchStart = Date.now();
    let results;
    try {
      const urls = images.map(i => i.image_url);
      results = await classifyBatch(urls);
    } catch (e) {
      console.error(`Sidecar error on batch ${batchNum}: ${e.message}`);
      metrics.errors += images.length;

      // Reset locked rows back to pending
      if (!DRY_RUN) {
        const ids = images.map(i => i.id);
        await supabase
          .from('vehicle_images')
          .update({ ai_processing_status: 'pending' })
          .in('id', ids);
      }
      break;
    }
    const batchMs = Date.now() - batchStart;
    metrics.batchTimes.push(batchMs);

    // ── 4. Write results back ────────────────────────────────────────────
    const resultArray = Array.isArray(results) ? results : results.results || results;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const result = resultArray[i];

      if (!result || result.error) {
        metrics.errors++;
        if (!DRY_RUN) {
          await supabase
            .from('vehicle_images')
            .update({ ai_processing_status: 'pending' })
            .eq('id', img.id);
        }
        continue;
      }

      const confidence = result.confidence || 0;
      const make = result.make || null;
      const isHighConf = confidence >= HIGH_CONFIDENCE_THRESHOLD;

      // Track metrics
      metrics.classified++;
      if (isHighConf) metrics.highConfidence++;
      else metrics.lowConfidence++;

      if (make) {
        metrics.topMakes[make] = (metrics.topMakes[make] || 0) + 1;
      }

      // Confidence distribution
      if (confidence < 0.2) metrics.confidenceDistribution['0.0-0.2']++;
      else if (confidence < 0.4) metrics.confidenceDistribution['0.2-0.4']++;
      else if (confidence < 0.6) metrics.confidenceDistribution['0.4-0.6']++;
      else if (confidence < 0.8) metrics.confidenceDistribution['0.6-0.8']++;
      else metrics.confidenceDistribution['0.8-1.0']++;

      if (!DRY_RUN) {
        const yonoResult = {
          make: result.make,
          confidence: result.confidence,
          family: result.family || null,
          family_confidence: result.family_confidence || null,
          top5: result.top5 || [],
          source: result.source || 'yono',
          is_vehicle: result.is_vehicle ?? true,
          ms: result.ms || null,
          processed_at: new Date().toISOString(),
        };

        // High confidence: mark completed. Low confidence: leave for cloud pass.
        const newStatus = isHighConf ? 'completed' : 'pending';

        const updateData = {
          ai_processing_status: newStatus,
          ai_scan_metadata: {
            yono: yonoResult,
            yono_classified_at: new Date().toISOString(),
            yono_version: 'daily_v1',
          },
        };

        // If high confidence, also set the make-level fields for fast queries
        if (isHighConf && make) {
          updateData.ai_scan_metadata.predicted_make = make;
          updateData.ai_scan_metadata.predicted_confidence = confidence;
        }

        const { error: writeError } = await supabase
          .from('vehicle_images')
          .update(updateData)
          .eq('id', img.id);

        if (writeError) {
          console.error(`  Write error for ${img.id}: ${writeError.message}`);
          metrics.errors++;
        }
      }

      metrics.processed++;
    }

    remaining -= images.length;

    // Progress log
    const imgsPerSec = images.length / (batchMs / 1000);
    process.stdout.write(
      `\r  Batch ${batchNum}: ${metrics.processed}/${LIMIT} ` +
      `(${metrics.highConfidence} high-conf, ${metrics.errors} errors, ` +
      `${imgsPerSec.toFixed(1)} img/s)                `
    );
  }

  console.log('\n');

  // ── Summary ────────────────────────────────────────────────────────────
  const elapsed = (Date.now() - startTime) / 1000;
  const avgBatchMs = metrics.batchTimes.length > 0
    ? Math.round(metrics.batchTimes.reduce((a, b) => a + b, 0) / metrics.batchTimes.length)
    : 0;

  console.log('=== Results ===');
  console.log(`  Total processed:    ${metrics.processed}`);
  console.log(`  Classified:         ${metrics.classified}`);
  console.log(`  High confidence:    ${metrics.highConfidence} (>=${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`  Low confidence:     ${metrics.lowConfidence} (deferred to cloud)`);
  console.log(`  Errors:             ${metrics.errors}`);
  console.log(`  Elapsed:            ${elapsed.toFixed(1)}s`);
  console.log(`  Avg batch time:     ${avgBatchMs}ms`);
  console.log(`  Throughput:         ${(metrics.processed / elapsed).toFixed(1)} img/s`);
  console.log(`  Dry run:            ${DRY_RUN}`);

  console.log('\nConfidence distribution:');
  for (const [bucket, count] of Object.entries(metrics.confidenceDistribution)) {
    const bar = '#'.repeat(Math.round(count / Math.max(1, metrics.processed) * 40));
    console.log(`  ${bucket}: ${count.toString().padStart(5)} ${bar}`);
  }

  if (Object.keys(metrics.topMakes).length > 0) {
    console.log('\nTop 10 predicted makes:');
    const sorted = Object.entries(metrics.topMakes).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [make, count] of sorted) {
      console.log(`  ${make.padEnd(20)} ${count}`);
    }
  }

  // ── Write log file ────────────────────────────────────────────────────
  const logDir = resolve(NUKE_DIR, 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const logFile = resolve(logDir, `yono-daily-${date}.json`);

  const logEntry = {
    date,
    timestamp: new Date().toISOString(),
    limit: LIMIT,
    dryRun: DRY_RUN,
    vehicleId: VEHICLE_ID || null,
    sidecarUrl: SIDECAR_URL,
    metrics: {
      processed: metrics.processed,
      classified: metrics.classified,
      highConfidence: metrics.highConfidence,
      lowConfidence: metrics.lowConfidence,
      errors: metrics.errors,
      elapsedSeconds: Math.round(elapsed),
      avgBatchMs,
      throughputImgsPerSec: parseFloat((metrics.processed / elapsed).toFixed(1)),
    },
    confidenceDistribution: metrics.confidenceDistribution,
    topMakes: Object.entries(metrics.topMakes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {}),
  };

  // Append to or create daily log
  let existingLog = [];
  if (existsSync(logFile)) {
    try {
      existingLog = JSON.parse(readFileSync(logFile, 'utf-8'));
      if (!Array.isArray(existingLog)) existingLog = [existingLog];
    } catch { existingLog = []; }
  }
  existingLog.push(logEntry);
  writeFileSync(logFile, JSON.stringify(existingLog, null, 2));
  console.log(`\nLog written to: ${logFile}`);

  return metrics;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('YONO Daily Progress Machine');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('─'.repeat(50));

  // Always show report
  const report = await pipelineReport();

  if (REPORT_ONLY) {
    process.exit(0);
  }

  if (UNSTICK) {
    await unstickProcessing();
    process.exit(0);
  }

  // Check sidecar
  if (!report.health.available) {
    console.error('\nSidecar is not available. Cannot process images.');
    console.error('Start the sidecar first:');
    console.error('  ./scripts/yono-server-start.sh   (local)');
    console.error('  modal deploy yono/modal_serve.py  (Modal cloud)');
    process.exit(1);
  }

  // Run processing
  const metrics = await processImages();

  // Exit code: 0 if anything was processed, 1 if total failure
  process.exit(metrics.processed > 0 || metrics.errors === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
