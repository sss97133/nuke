#!/usr/bin/env npx tsx
/**
 * Autonomous profile repair loop (e.g. 7 hours).
 *
 * For each batch of bat_import vehicles with images:
 *   1. repair_bat_vehicle_gallery_images(id) — fix wrong lead image / BaT UI assets
 *   2. Backfill VIN from origin_metadata when possible
 *   3. Optionally invoke bat-simple-extract for vehicles with discovery_url but no VIN (rate-limited)
 *
 * Writes feedback to reports/autonomous-profile-repair-<date>.json every 5 min and logs to stdout.
 *
 * Usage:
 *   npx tsx scripts/autonomous-profile-repair-loop.ts --hours 7
 *   npx tsx scripts/autonomous-profile-repair-loop.ts --hours 7 --batch 30 --delay-ms 3000
 *   npx tsx scripts/autonomous-profile-repair-loop.ts --hours 1 --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_PREFIX = 'autonomous-profile-repair';

function loadEnv(): void {
  const paths = [
    path.join(ROOT, 'nuke_frontend', '.env.local'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, '.env'),
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

interface Options {
  hours: number;
  batchSize: number;
  delayMs: number;
  reportIntervalMs: number;
  dryRun: boolean;
  skipReextract: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    hours: 7,
    batchSize: 25,
    delayMs: 2500,
    reportIntervalMs: 5 * 60 * 1000,
    dryRun: false,
    skipReextract: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours' && argv[i + 1]) opts.hours = Math.max(0.1, Math.min(24, Number(argv[++i])));
    if (a === '--batch' && argv[i + 1]) opts.batchSize = Math.max(1, Math.min(100, Number(argv[++i])));
    if (a === '--delay-ms' && argv[i + 1]) opts.delayMs = Math.max(500, Math.min(30000, Number(argv[++i])));
    if (a === '--report-every-ms' && argv[i + 1]) opts.reportIntervalMs = Math.max(60000, Number(argv[++i]));
    if (a === '--dry-run') opts.dryRun = true;
    if (a === '--skip-reextract') opts.skipReextract = true;
  }
  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Feedback report ---
interface FeedbackReport {
  startedAt: string;
  options: { hours: number; batchSize: number; delayMs: number; dryRun: boolean };
  elapsedMs: number;
  elapsedHours: number;
  vehiclesProcessed: number;
  galleryRepairs: number;
  vinBackfilledFromMetadata: number;
  vinReextractInvoked: number;
  errors: Array<{ vehicleId: string; message: string; at: string }>;
  lastVehicleId: string | null;
  lastBatchAt: string;
  nextBatchPreview: number;
}

function ensureReportDir(): void {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function reportPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(REPORT_DIR, `${REPORT_PREFIX}-${date}.json`);
}

function writeReport(report: FeedbackReport): void {
  ensureReportDir();
  const p = reportPath();
  fs.writeFileSync(p, JSON.stringify(report, null, 2), 'utf8');
}

// --- DB: fetch batch of vehicles to repair (bat_import, has images, oldest first) ---
async function fetchBatch(
  supabase: SupabaseClient,
  limit: number,
  afterUpdatedAt: string | null
): Promise<{ id: string; discovery_url: string | null; vin: string | null; origin_metadata: any; updated_at: string }[]> {
  let q = supabase
    .from('vehicles')
    .select('id, discovery_url, vin, origin_metadata, updated_at')
    .eq('profile_origin', 'bat_import')
    .not('discovery_url', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit * 3);

  if (afterUpdatedAt) q = q.gt('updated_at', afterUpdatedAt);

  const { data: rows, error } = await q;
  if (error) throw new Error(`fetchBatch: ${error.message}`);
  if (!rows?.length) return [];

  const ids = rows.map((r: any) => r.id);
  const { data: withImages } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .in('vehicle_id', ids);
  const hasImage = new Set((withImages || []).map((r: any) => r.vehicle_id));
  return rows.filter((r: any) => hasImage.has(r.id)).slice(0, limit);
}

// --- DB: vehicles with no VIN but discovery_url (for optional re-extract) ---
async function fetchMissingVinBatch(
  supabase: SupabaseClient,
  limit: number,
  excludeIds: Set<string>
): Promise<{ id: string; discovery_url: string }[]> {
  const { data: rows, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .eq('profile_origin', 'bat_import')
    .not('discovery_url', 'is', null)
    .is('vin', null)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error || !rows?.length) return [];
  return rows.filter((r: any) => r.discovery_url && !excludeIds.has(r.id)).slice(0, limit);
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (e.g. in nuke_frontend/.env.local)');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRole);

  const endAt = Date.now() + opts.hours * 60 * 60 * 1000;
  const report: FeedbackReport = {
    startedAt: new Date().toISOString(),
    options: { hours: opts.hours, batchSize: opts.batchSize, delayMs: opts.delayMs, dryRun: opts.dryRun },
    elapsedMs: 0,
    elapsedHours: 0,
    vehiclesProcessed: 0,
    galleryRepairs: 0,
    vinBackfilledFromMetadata: 0,
    vinReextractInvoked: 0,
    errors: [],
    lastVehicleId: null,
    lastBatchAt: new Date().toISOString(),
    nextBatchPreview: 0,
  };

  ensureReportDir();
  writeReport(report);
  console.log(`[autonomous-profile-repair] Started. Run for ${opts.hours}h, batch=${opts.batchSize}, delay=${opts.delayMs}ms, dryRun=${opts.dryRun}`);
  console.log(`[autonomous-profile-repair] Feedback report: ${path.join(REPORT_DIR, `${REPORT_PREFIX}-${new Date().toISOString().slice(0, 10)}.json`)}`);

  let lastReportWrite = Date.now();
  let afterUpdatedAt: string | null = null;
  const processedIds = new Set<string>();

  while (Date.now() < endAt) {
    try {
      const batch = await fetchBatch(supabase, opts.batchSize, afterUpdatedAt);
      report.nextBatchPreview = batch.length;
      if (batch.length === 0) {
        console.log('[autonomous-profile-repair] No more vehicles in batch; sleeping 60s then retry.');
        await sleep(60000);
        report.elapsedMs = Date.now() - new Date(report.startedAt).getTime();
        report.elapsedHours = report.elapsedMs / (60 * 60 * 1000);
        if (Date.now() - lastReportWrite >= opts.reportIntervalMs) {
          writeReport(report);
          lastReportWrite = Date.now();
        }
        continue;
      }

      for (const v of batch) {
        if (Date.now() >= endAt) break;
        try {
          if (!opts.dryRun) {
            const { data: repairResult, error: repairErr } = await supabase.rpc('repair_bat_vehicle_gallery_images', {
              p_vehicle_id: v.id,
              p_dry_run: false,
            });
            if (repairErr) throw new Error(repairErr.message);
            if (repairResult?.set_primary || repairResult?.marked_duplicates) report.galleryRepairs += 1;
          }
          report.vehiclesProcessed += 1;
          report.lastVehicleId = v.id;
          report.lastBatchAt = new Date().toISOString();

          // VIN from origin_metadata
          const originVin = v.origin_metadata && typeof v.origin_metadata === 'object' && v.origin_metadata.vin;
          const vinStr = typeof originVin === 'string' ? originVin.trim() : null;
          if (!opts.dryRun && vinStr && (!v.vin || !String(v.vin).trim())) {
            const { error: updateErr } = await supabase
              .from('vehicles')
              .update({ vin: vinStr, updated_at: new Date().toISOString() })
              .eq('id', v.id);
            if (!updateErr) report.vinBackfilledFromMetadata += 1;
          }

          processedIds.add(v.id);
        } catch (e: any) {
          report.errors.push({
            vehicleId: v.id,
            message: e?.message || String(e),
            at: new Date().toISOString(),
          });
          console.error(`[autonomous-profile-repair] Error ${v.id}:`, e?.message || e);
        }

        await sleep(opts.delayMs);
      }

      const lastRow = batch[batch.length - 1];
      afterUpdatedAt = lastRow?.updated_at ?? null;

      // Optional: invoke bat-simple-extract for a few vehicles with discovery_url but no VIN (rate limit)
      if (!opts.dryRun && !opts.skipReextract && report.vinReextractInvoked < 10) {
        const missingVin = await fetchMissingVinBatch(supabase, 3, processedIds);
        for (const m of missingVin) {
          if (Date.now() >= endAt) break;
          try {
            const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/bat-simple-extract`;
            const res = await fetch(fnUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
              body: JSON.stringify({ url: m.discovery_url, vehicle_id: m.id }),
            });
            if (res.ok) report.vinReextractInvoked += 1;
            await sleep(120000); // 2 min between re-extracts to be nice to BaT
          } catch {
            // ignore
          }
        }
      }

      report.elapsedMs = Date.now() - new Date(report.startedAt).getTime();
      report.elapsedHours = report.elapsedMs / (60 * 60 * 1000);
      if (Date.now() - lastReportWrite >= opts.reportIntervalMs) {
        writeReport(report);
        lastReportWrite = Date.now();
        console.log(
          `[autonomous-profile-repair] ${report.elapsedHours.toFixed(2)}h | processed=${report.vehiclesProcessed} repairs=${report.galleryRepairs} vinMeta=${report.vinBackfilledFromMetadata} vinReextract=${report.vinReextractInvoked} errors=${report.errors.length}`
        );
      }
    } catch (batchErr: any) {
      console.error('[autonomous-profile-repair] Batch error:', batchErr?.message || batchErr);
      report.errors.push({
        vehicleId: '',
        message: batchErr?.message || String(batchErr),
        at: new Date().toISOString(),
      });
      await sleep(30000);
    }
  }

  report.elapsedMs = Date.now() - new Date(report.startedAt).getTime();
  report.elapsedHours = report.elapsedMs / (60 * 60 * 1000);
  writeReport(report);
  console.log('[autonomous-profile-repair] Done.');
  console.log(
    `[autonomous-profile-repair] Final: processed=${report.vehiclesProcessed} galleryRepairs=${report.galleryRepairs} vinFromMeta=${report.vinBackfilledFromMetadata} vinReextract=${report.vinReextractInvoked} errors=${report.errors.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
