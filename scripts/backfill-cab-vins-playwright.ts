#!/usr/bin/env npx tsx
/**
 * Backfill VINs for Cars & Bids vehicles using Playwright.
 * Fetches C&B vehicles missing VIN, visits each listing, extracts VIN from DOM, updates vehicles.vin.
 *
 * Usage:
 *   npx tsx scripts/backfill-cab-vins-playwright.ts --limit 50
 *   npx tsx scripts/backfill-cab-vins-playwright.ts --limit 200 --delay-ms 4000
 *   npx tsx scripts/backfill-cab-vins-playwright.ts --dry-run
 *
 * Report: reports/backfill-cab-vins-YYYY-MM-DD.json (processed, vinFound, vinUpdated, errors, samples).
 * Some C&B URLs may 404 (listing removed); run with a larger --limit to get more VINs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'nuke_frontend/.env.local') });
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv: string[]) {
  let limit = 50;
  let delayMs = 3000;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) limit = Math.max(1, Math.min(500, Number(argv[++i])));
    if (argv[i] === '--delay-ms' && argv[i + 1]) delayMs = Math.max(1000, Math.min(15000, Number(argv[++i])));
    if (argv[i] === '--dry-run') dryRun = true;
  }
  return { limit, delayMs, dryRun };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract VIN from C&B page (title or body). 17-char standard or 11–17 for older. */
function extractVinFromPage(): string | null {
  const bodyText = document.body?.innerText || '';
  // Standard 17-char VIN (post-1981)
  const m17 = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
  if (m17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(m17[1])) return m17[1].toUpperCase();
  // Older / chassis (11–16 chars)
  const m11 = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{11,16})\b/i);
  if (m11) {
    const v = m11[1].toUpperCase();
    if (/^[A-HJ-NPR-Z0-9]{11,16}$/.test(v)) return v;
  }
  const titleEl = document.querySelector('title');
  const titleVin = titleEl?.textContent?.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  if (titleVin) return titleVin[1].toUpperCase();
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: rows, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .ilike('discovery_url', '%carsandbids.com%')
    .is('vin', null)
    .not('discovery_url', 'is', null)
    .limit(opts.limit);

  if (error) {
    console.error('Fetch error:', error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log('No C&B vehicles missing VIN in this batch.');
    process.exit(0);
  }

  console.log(`C&B missing VIN: processing ${rows.length} vehicles (limit=${opts.limit}, delay=${opts.delayMs}ms, dryRun=${opts.dryRun})\n`);

  const report = {
    startedAt: new Date().toISOString(),
    limit: opts.limit,
    delayMs: opts.delayMs,
    dryRun: opts.dryRun,
    processed: 0,
    vinFound: 0,
    vinUpdated: 0,
    errors: [] as { id: string; url: string; message: string }[],
    samples: [] as { id: string; url: string; vin: string | null }[],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    const url = (v.discovery_url || '').trim();
    if (!url) continue;

    report.processed += 1;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      // Cloudflare "Just a moment"
      for (let w = 0; w < 12; w++) {
        const title = await page.title();
        if (!title.includes('Just a moment')) break;
        await sleep(1500);
      }
      await sleep(1500);

      const title = await page.title();
      if (title.includes('404') || title.includes('does not exist')) {
        report.errors.push({ id: v.id, url, message: '404 or not found' });
        console.log(`  [${i + 1}/${rows.length}] 404 ${url.slice(0, 60)}...`);
        await sleep(opts.delayMs);
        continue;
      }

      const vin = await page.evaluate(extractVinFromPage);
      if (report.samples.length < 20) report.samples.push({ id: v.id, url, vin });

      if (vin) {
        report.vinFound += 1;
        if (!opts.dryRun) {
          const { error: updateErr } = await supabase
            .from('vehicles')
            .update({ vin, updated_at: new Date().toISOString() })
            .eq('id', v.id);
          if (!updateErr) report.vinUpdated += 1;
          else report.errors.push({ id: v.id, url, message: updateErr.message });
        } else {
          report.vinUpdated += 1;
        }
        console.log(`  [${i + 1}/${rows.length}] VIN ${vin} → ${v.id}`);
      } else {
        console.log(`  [${i + 1}/${rows.length}] no VIN ${url.slice(0, 55)}...`);
      }
    } catch (e: any) {
      report.errors.push({ id: v.id, url, message: e?.message || String(e) });
      console.log(`  [${i + 1}/${rows.length}] error: ${e?.message || e}`);
    }

    await sleep(opts.delayMs);
  }

  await browser.close();

  const reportDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `backfill-cab-vins-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n--- Done ---');
  console.log(`Processed: ${report.processed}, VIN found: ${report.vinFound}, VIN updated: ${report.vinUpdated}, errors: ${report.errors.length}`);
  console.log('Report:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
