#!/usr/bin/env node
/**
 * Live Auction Detective
 *
 * Orchestrates:
 * 1) Source discovery (auction scrape_sources)
 * 2) Live auction health audit (external_listings + vehicle_listings)
 * 3) AI source preparation (source-preparation-agent)
 * 4) Quality validation (audit-extraction-accuracy)
 * 5) Extraction trigger (scrape-multi-source + process-import-queue)
 *
 * Usage (examples):
 *   tsx scripts/auction-live-detective.ts --action audit
 *   tsx scripts/auction-live-detective.ts --action prepare --max-sources 5
 *   tsx scripts/auction-live-detective.ts --action extract --max-listings 500 --batch-size 40
 *   tsx scripts/auction-live-detective.ts --action full --max-sources 8 --quality-threshold 0.9
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Action = 'audit' | 'prepare' | 'extract' | 'full';

type Options = {
  action: Action;
  maxSources: number;
  maxListings: number;
  batchSize: number;
  staleHours: number;
  qualityThreshold: number;
  dryRun: boolean;
  includeInactive: boolean;
  processQueue: boolean;
  deepCheck: boolean;
};

type AuctionSource = {
  id: string;
  name: string | null;
  url: string;
  source_type: string | null;
  is_active?: boolean | null;
  has_live_auctions?: boolean | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    action: 'full',
    maxSources: 10,
    maxListings: 500,
    batchSize: 40,
    staleHours: 6,
    qualityThreshold: 0.95,
    dryRun: false,
    includeInactive: false,
    processQueue: true,
    deepCheck: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--action' && argv[i + 1]) opts.action = argv[++i] as Action;
    if (a === '--max-sources' && argv[i + 1]) opts.maxSources = Math.max(1, Number(argv[++i]));
    if (a === '--max-listings' && argv[i + 1]) opts.maxListings = Math.max(1, Number(argv[++i]));
    if (a === '--batch-size' && argv[i + 1]) opts.batchSize = Math.max(1, Number(argv[++i]));
    if (a === '--stale-hours' && argv[i + 1]) opts.staleHours = Math.max(1, Number(argv[++i]));
    if (a === '--quality-threshold' && argv[i + 1]) opts.qualityThreshold = Math.max(0, Math.min(1, Number(argv[++i])));
    if (a === '--dry-run') opts.dryRun = true;
    if (a === '--include-inactive') opts.includeInactive = true;
    if (a === '--no-process') opts.processQueue = false;
    if (a === '--deep-check') opts.deepCheck = true;
  }
  return opts;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

async function postJson(baseUrl: string, bearer: string, functionName: string, body: any) {
  const url = `${baseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${functionName} failed (${resp.status}): ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchAuctionSources(supabase: any, includeInactive: boolean, limit: number): Promise<AuctionSource[]> {
  let query = supabase
    .from('scrape_sources')
    .select('id, name, url, source_type, is_active, has_live_auctions')
    .eq('source_type', 'auction')
    .order('name')
    .limit(limit);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch auction sources: ${error.message}`);
  return (data || []).filter((s: any) => Boolean(s?.url));
}

async function auditLiveListings(supabase: any, staleHours: number) {
  const now = Date.now();
  const staleMs = staleHours * 60 * 60 * 1000;
  const issues = {
    stale: [] as any[],
    missing_end_date: [] as any[],
    ended_but_active: [] as any[],
    missing_url: [] as any[],
    missing_vehicle: [] as any[],
    suspicious_bids: [] as any[],
  };

  const { data: external, error: externalErr } = await supabase
    .from('external_listings')
    .select('id, platform, listing_url, listing_status, end_date, updated_at, current_bid, bid_count, vehicle_id')
    .in('listing_status', ['active', 'live'])
    .limit(5000);

  if (externalErr) throw new Error(`Failed to read external_listings: ${externalErr.message}`);

  for (const row of external || []) {
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
    const endDate = row.end_date ? new Date(row.end_date).getTime() : null;
    if (!row.listing_url) issues.missing_url.push(row);
    if (!row.vehicle_id) issues.missing_vehicle.push(row);
    if (!row.end_date) issues.missing_end_date.push(row);
    if (updatedAt && now - updatedAt > staleMs) issues.stale.push(row);
    if (endDate && endDate < now) issues.ended_but_active.push(row);
    if (row.bid_count && row.bid_count > 250 && (!row.current_bid || Number(row.current_bid) <= 0)) {
      issues.suspicious_bids.push(row);
    }
  }

  const { data: native, error: nativeErr } = await supabase
    .from('vehicle_listings')
    .select('id, vehicle_id, status, auction_end_time, current_high_bid_cents, bid_count')
    .eq('status', 'active')
    .in('sale_type', ['auction', 'live_auction'])
    .limit(2000);

  if (nativeErr) throw new Error(`Failed to read vehicle_listings: ${nativeErr.message}`);

  const nativeIssues = {
    missing_end_time: [] as any[],
    ended_but_active: [] as any[],
  };

  for (const row of native || []) {
    const endDate = row.auction_end_time ? new Date(row.auction_end_time).getTime() : null;
    if (!row.auction_end_time) nativeIssues.missing_end_time.push(row);
    if (endDate && endDate < now) nativeIssues.ended_but_active.push(row);
  }

  return {
    external_summary: {
      total_active: external?.length || 0,
      stale: issues.stale.length,
      missing_end_date: issues.missing_end_date.length,
      ended_but_active: issues.ended_but_active.length,
      missing_url: issues.missing_url.length,
      missing_vehicle: issues.missing_vehicle.length,
      suspicious_bids: issues.suspicious_bids.length,
    },
    native_summary: {
      total_active: native?.length || 0,
      missing_end_time: nativeIssues.missing_end_time.length,
      ended_but_active: nativeIssues.ended_but_active.length,
    },
    external_samples: {
      stale: issues.stale.slice(0, 10),
      missing_end_date: issues.missing_end_date.slice(0, 10),
      ended_but_active: issues.ended_but_active.slice(0, 10),
      missing_url: issues.missing_url.slice(0, 10),
      missing_vehicle: issues.missing_vehicle.slice(0, 10),
      suspicious_bids: issues.suspicious_bids.slice(0, 10),
    },
    native_samples: {
      missing_end_time: nativeIssues.missing_end_time.slice(0, 10),
      ended_but_active: nativeIssues.ended_but_active.slice(0, 10),
    },
  };
}

async function discoverSampleListings(supabaseUrl: string, invokeKey: string, sourceUrl: string, opts: Options) {
  if (opts.dryRun) {
    return { listingUrls: [] as string[], seed: null };
  }
  const seed = await postJson(supabaseUrl, invokeKey, 'scrape-multi-source', {
    source_url: sourceUrl,
    source_type: 'auction',
    extract_listings: true,
    extract_dealer_info: false,
    use_llm_extraction: false,
    cheap_mode: true,
    max_listings: Math.min(50, opts.maxListings),
  });

  const listingUrls = (seed?.sample_listings || [])
    .map((l: any) => l?.url || l?.listing_url)
    .filter(Boolean) as string[];

  return { listingUrls, seed };
}

async function runSourcePreparation(supabaseUrl: string, invokeKey: string, sourceUrl: string, testUrls: string[]) {
  return await postJson(supabaseUrl, invokeKey, 'source-preparation-agent', {
    sourceUrl: sourceUrl,
    sourceType: 'auction',
    testUrls,
  });
}

async function runQualityAudit(supabaseUrl: string, invokeKey: string, testUrl?: string) {
  if (!testUrl) return { score: 0, issues: ['No test URL available'], raw: null };
  const result = await postJson(supabaseUrl, invokeKey, 'audit-extraction-accuracy', {
    audit_type: 'source_validation',
    source_url: testUrl,
  });
  const validation = result?.validation_result || result?.validation || {};
  const score = Number.isFinite(validation?.quality_score)
    ? Number(validation.quality_score)
    : Number.isFinite(validation?.overall_accuracy)
      ? Number(validation.overall_accuracy)
      : 0;
  const issues = validation?.issues || validation?.discrepancies || [];
  return { score, issues, raw: result };
}

async function triggerExtraction(supabaseUrl: string, invokeKey: string, sourceUrl: string, opts: Options) {
  if (opts.dryRun) return { listings_queued: 0, source_id: null };
  const seed = await postJson(supabaseUrl, invokeKey, 'scrape-multi-source', {
    source_url: sourceUrl,
    source_type: 'auction',
    extract_listings: true,
    extract_dealer_info: false,
    use_llm_extraction: false,
    cheap_mode: true,
    max_listings: opts.maxListings,
  });

  if (opts.processQueue && seed?.source_id) {
    await postJson(supabaseUrl, invokeKey, 'process-import-queue', {
      batch_size: opts.batchSize,
      source_id: seed.source_id,
    });
  }

  return seed;
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || null;
  const INVOKE_KEY =
    SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for DB reads');
  if (!INVOKE_KEY) throw new Error('Missing Supabase key to invoke Edge Functions');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  console.log(`\nLive Auction Detective — action=${opts.action}`);
  console.log(`Sources: max=${opts.maxSources} listings=${opts.maxListings} batch=${opts.batchSize} threshold=${opts.qualityThreshold}`);
  console.log(`dryRun=${opts.dryRun} includeInactive=${opts.includeInactive} processQueue=${opts.processQueue}\n`);

  const sources = await fetchAuctionSources(supabase, opts.includeInactive, opts.maxSources);
  console.log(`Auction sources loaded: ${sources.length}`);

  let auditResult: any = null;
  if (opts.action === 'audit' || opts.action === 'full') {
    auditResult = await auditLiveListings(supabase, opts.staleHours);
    console.log('\nLive auction audit summary:');
    console.log(JSON.stringify(auditResult, null, 2));
  }

  const prepResults: Array<{
    source: AuctionSource;
    readiness?: any;
    deepCheck?: any;
    qualityScore: number;
    issues: string[];
    sampleUrls: string[];
  }> = [];

  if (opts.action === 'prepare' || opts.action === 'full') {
    console.log('\nPreparing auction sources (AI)...');
    for (const source of sources) {
      console.log(`\n→ ${source.name || shortUrl(source.url)} (${shortUrl(source.url)})`);
      let sampleUrls: string[] = [];
      try {
        const discovery = await discoverSampleListings(SUPABASE_URL, INVOKE_KEY, source.url, opts);
        sampleUrls = discovery.listingUrls.slice(0, 3);
      } catch (err: any) {
        console.warn(`  ⚠ sample discovery failed: ${err.message || String(err)}`);
      }

      let readiness: any = null;
      let deepCheck: any = null;
      let qualityScore = 0;
      let issues: string[] = [];

      try {
        if (!opts.dryRun) {
          readiness = await runSourcePreparation(SUPABASE_URL, INVOKE_KEY, source.url, sampleUrls);
        }
      } catch (err: any) {
        console.warn(`  ⚠ source-preparation-agent failed: ${err.message || String(err)}`);
      }

      try {
        const quality = await runQualityAudit(SUPABASE_URL, INVOKE_KEY, sampleUrls[0]);
        qualityScore = quality.score;
        issues = quality.issues || [];
      } catch (err: any) {
        console.warn(`  ⚠ quality audit failed: ${err.message || String(err)}`);
      }

      if (opts.deepCheck && sampleUrls[0] && !opts.dryRun) {
        try {
          deepCheck = await postJson(SUPABASE_URL, INVOKE_KEY, 'inspect-extraction-quality', {
            inspection_type: 'sample_extraction',
            test_url: sampleUrls[0],
            compare_extractors: false,
          });
        } catch (err: any) {
          console.warn(`  ⚠ deep check failed: ${err.message || String(err)}`);
        }
      }

      prepResults.push({
        source,
        readiness,
        deepCheck,
        qualityScore,
        issues: issues.slice(0, 5),
        sampleUrls,
      });

      console.log(`  readiness=${readiness?.sourceReadiness?.ready ?? 'n/a'} confidence=${readiness?.sourceReadiness?.confidence ?? 'n/a'} quality=${qualityScore.toFixed(2)}`);
    }
  }

  if (opts.action === 'extract' || opts.action === 'full') {
    console.log('\nTriggering extraction...');
    const readySources =
      prepResults.length > 0
        ? prepResults.filter((r) => {
            const ready = r.readiness?.sourceReadiness?.ready;
            return ready && r.qualityScore >= opts.qualityThreshold;
          })
        : sources.map((source) => ({ source }));

    for (const entry of readySources) {
      const source = entry.source;
      console.log(`\n→ ${source.name || shortUrl(source.url)} (${shortUrl(source.url)})`);
      try {
        const seed = await triggerExtraction(SUPABASE_URL, INVOKE_KEY, source.url, opts);
        console.log(`  queued=${seed?.listings_queued ?? 'n/a'} found=${seed?.listings_found ?? 'n/a'} source_id=${seed?.source_id ?? 'n/a'}`);
      } catch (err: any) {
        console.warn(`  ⚠ extraction trigger failed: ${err.message || String(err)}`);
      }
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
