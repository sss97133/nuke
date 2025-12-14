#!/usr/bin/env node
/**
 * Enrich BaT Local Partner org profiles by visiting each partner website and letting
 * `scrape-multi-source` run Brand DNA extraction (logo/banner/portfolio/favicons) against
 * the already-created `businesses` row.
 *
 * This intentionally does NOT try to extract inventory; it just upgrades org profiles.
 *
 * Prereq:
 * - Run `npm run index:bat-local-partners -- --upsert` first.
 *
 * Usage:
 *   tsx scripts/enrich-bat-local-partners.ts --limit 20
 *   tsx scripts/enrich-bat-local-partners.ts --concurrency 3
 *   tsx scripts/enrich-bat-local-partners.ts --resume-from 0
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - Prefer SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY when available
 * - Otherwise falls back to SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY (Edge Functions still run
 *   with service role on the server-side; this key is just for invocation auth).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Facility = {
  partner_name: string;
  website_origin: string | null;
  partner_referral_url: string | null;
  geographic_key: string;
};

type Snapshot = {
  source_url: string;
  scraped_at: string;
  facilities: Facility[];
};

type Options = {
  limit: number | null;
  concurrency: number;
  resumeFrom: number;
  dryRun: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];
  // Load ALL env files found (do not stop at first). This prevents anon-only env files
  // from masking a repo-root `.env` containing the service role key.
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
      }
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    limit: null,
    concurrency: 3,
    resumeFrom: 0,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.limit = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
      continue;
    }
    if (a === '--concurrency' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.concurrency = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 3;
      continue;
    }
    if (a === '--resume-from' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.resumeFrom = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
  }
  return opts;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = new Array(Math.min(limit, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const INVOKE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!INVOKE_KEY) throw new Error('Missing a Supabase key (service role or anon) to invoke Edge Functions');

  const snapshotPath = path.resolve(__dirname, '..', 'data', 'bat', 'bat_local_partners.json');
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Missing snapshot: ${snapshotPath}. Run npm run index:bat-local-partners first.`);
  }
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const facilitiesAll = Array.isArray(snapshot.facilities) ? snapshot.facilities : [];

  const facilities = facilitiesAll
    .slice(opts.resumeFrom)
    .filter((f) => !!(f.website_origin || f.partner_referral_url));

  const sliced = typeof opts.limit === 'number' ? facilities.slice(0, opts.limit) : facilities;

  console.log(`BaT Local Partners enrichment`);
  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Total facilities in snapshot: ${facilitiesAll.length}`);
  console.log(`Processing: ${sliced.length} (resumeFrom=${opts.resumeFrom}, limit=${opts.limit ?? 'none'})`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);

  let ok = 0;
  let failed = 0;

  await mapLimit(sliced, opts.concurrency, async (facility, idx) => {
    const targetUrl = facility.website_origin || facility.partner_referral_url;
    const display = `${facility.partner_name} (${facility.geographic_key})`;
    const n = idx + 1;
    process.stdout.write(`[${n}/${sliced.length}] ${display} ... `);

    try {
      if (opts.dryRun) {
        ok++;
        process.stdout.write(`OK (dry-run)\n`);
        return;
      }

      // Call scrape-multi-source to (a) create/update the business profile and (b) run Brand DNA extraction.
      const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/scrape-multi-source`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${INVOKE_KEY}`,
        },
        body: JSON.stringify({
          source_url: targetUrl,
          source_type: 'dealer_website',
          extract_listings: false,
          extract_dealer_info: true,
          // For many partner sites, dealer info is not easily parsable without LLM.
          // If OPENAI_API_KEY is set in the Edge Function environment, this will work;
          // otherwise it will still attempt brand extraction best-effort.
          use_llm_extraction: true,
          cheap_mode: false,
          max_listings: 0,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`scrape-multi-source failed: HTTP ${resp.status} ${t.slice(0, 200)}`);
      }

      // Best-effort: surface created org id to logs
      try {
        const json = await resp.json();
        const orgId = json?.organization_id || json?.organizationId || null;
        if (orgId) {
          process.stdout.write(`OK (org=${orgId})\n`);
        } else {
          process.stdout.write(`OK\n`);
        }
      } catch {
        process.stdout.write(`OK\n`);
      }

      ok++;

      // Gentle pacing to avoid hammering small business sites.
      await sleep(600);
    } catch (e: any) {
      failed++;
      process.stdout.write(`FAIL (${e?.message || String(e)})\n`);
      // brief backoff on error
      await sleep(1200);
    }
  });

  console.log(`\nDone: ok=${ok} failed=${failed}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});


