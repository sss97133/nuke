#!/usr/bin/env node
/**
 * Import ALL BaT listings for ALL BaT Local Partners (dealers/shops) and link them
 * to the correct organization profile in `public.businesses`.
 *
 * Prereqs:
 * - `npm run index:bat-local-partners -- --upsert`
 * - (optional) `npm run enrich:bat-local-partners` for brand/profile polish
 *
 * What it does:
 * - Reads `data/bat/bat_local_partners.json`
 * - For each facility with `bat_username`:
 *   - Finds matching business row by `geographic_key`
 *   - Loads the BaT member page `/member/<username>/` via Playwright
 *   - Clicks "Show more" until disabled (past listings)
 *   - Extracts all `/listing/.../` URLs
 *   - Invokes `complete-bat-import` Edge Function for each URL with:
 *     - `organization_id = businesses.id` (seller org link)
 *
 * Usage:
 *   tsx scripts/bat-import-local-partner-vehicles.ts --dry-run --limit-partners 5
 *   tsx scripts/bat-import-local-partner-vehicles.ts --limit-partners 20 --concurrency 1
 *   tsx scripts/bat-import-local-partner-vehicles.ts --partner-key "<geographic_key>"
 *
 * Env:
 * - SUPABASE_URL / VITE_SUPABASE_URL
 * - Prefer SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY
 * - Otherwise falls back to SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY (invoke auth only)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Facility = {
  partner_name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  website_origin: string | null;
  partner_referral_url: string | null;
  bat_username: string | null;
  bat_profile_url: string | null;
  discovered_via: 'bat_local_partners';
  source_url: string;
  geographic_key: string;
};

type Snapshot = {
  source_url: string;
  scraped_at: string;
  facilities: Facility[];
};

type Options = {
  limitPartners: number | null;
  resumeFromPartner: number;
  partnerKey: string | null;
  concurrency: number;
  listingLimit: number | null;
  imageBatchSize: number;
  maxPages: number;
  skipExistingLinked: boolean;
  requireBusinessMatch: boolean;
  dryRun: boolean;
  writeJson: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
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
    limitPartners: null,
    resumeFromPartner: 0,
    partnerKey: null,
    concurrency: 1,
    listingLimit: null,
    imageBatchSize: 25,
    maxPages: 10,
    // Default on: makes re-runs cheap + safer.
    skipExistingLinked: true,
    // Default off: still works without DB read permissions (Edge importer can auto-link by seller username).
    requireBusinessMatch: false,
    dryRun: false,
    writeJson: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit-partners' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.limitPartners = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
      continue;
    }
    if (a === '--resume-from-partner' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.resumeFromPartner = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      continue;
    }
    if (a === '--partner-key' && argv[i + 1]) {
      opts.partnerKey = String(argv[++i]).trim() || null;
      continue;
    }
    if (a === '--concurrency' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.concurrency = Number.isFinite(n) ? Math.max(1, Math.min(3, Math.floor(n))) : 1;
      continue;
    }
    if (a === '--listing-limit' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.listingLimit = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
      continue;
    }
    if (a === '--image-batch-size' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.imageBatchSize = Number.isFinite(n) ? Math.max(10, Math.min(100, Math.floor(n))) : 25;
      continue;
    }
    if (a === '--max-pages' && argv[i + 1]) {
      const n = Number(argv[++i]);
      opts.maxPages = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 10;
      continue;
    }
    if (a === '--skip-existing') {
      opts.skipExistingLinked = true;
      continue;
    }
    if (a === '--no-skip-existing') {
      opts.skipExistingLinked = false;
      continue;
    }
    if (a === '--require-business-match') {
      opts.requireBusinessMatch = true;
      continue;
    }
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--no-json') {
      opts.writeJson = false;
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

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return await resp.text();
}

function extractListingUrlsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /href="(https?:\/\/bringatrailer\.com\/listing\/[^"]+?)"/gi,
    /href='(https?:\/\/bringatrailer\.com\/listing\/[^']+?)'/gi,
    /href="(\/listing\/[^"]+?)"/gi,
    /href='(\/listing\/[^']+?)'/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      if (!href) continue;
      const full = href.startsWith('http') ? href.split('#')[0].split('?')[0] : `https://bringatrailer.com${href.split('#')[0].split('?')[0]}`;
      found.add(full.endsWith('/') ? full : `${full}/`);
    }
  }
  return Array.from(found);
}

function extractNextPageUrl(html: string, currentUrl: string): string | null {
  // Common patterns:
  // - <link rel="next" href="...">
  // - <a class="next page-numbers" href="...">
  const relNext = html.match(/rel=["']next["'][^>]*href=["']([^"']+)["']/i) || html.match(/href=["']([^"']+)["'][^>]*rel=["']next["']/i);
  const pageNumbersNext = html.match(/class=["'][^"']*\bnext\b[^"']*\bpage-numbers\b[^"']*["'][^>]*href=["']([^"']+)["']/i);
  const raw = (relNext && relNext[1]) || (pageNumbersNext && pageNumbersNext[1]) || null;
  if (!raw) return null;
  try {
    const u = new URL(raw, currentUrl);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

async function enumerateMemberListingUrls(memberUrl: string, maxPages: number): Promise<{ urls: string[]; pagesFetched: number }> {
  const visited = new Set<string>();
  const urls = new Set<string>();
  let current = memberUrl;
  let pagesFetched = 0;

  for (let p = 0; p < maxPages; p++) {
    if (visited.has(current)) break;
    visited.add(current);

    const html = await fetchHtml(current);
    pagesFetched++;

    for (const u of extractListingUrlsFromHtml(html)) {
      urls.add(u);
    }

    const next = extractNextPageUrl(html, current);
    if (!next) break;
    current = next;

    await sleep(700);
  }

  return { urls: Array.from(urls).sort(), pagesFetched };
}

function memberUrlForUsername(username: string): string {
  return `https://bringatrailer.com/member/${encodeURIComponent(username)}/`;
}

async function resolveBusinessIdByGeographicKey(supabase: any, geographicKey: string): Promise<string | null> {
  const gk = String(geographicKey || '').trim();
  if (!gk) return null;
  const { data, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('geographic_key', gk)
    .limit(1);
  if (error) return null;
  const id = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
  return id;
}

async function findLinkedListingUrls(
  supabase: any,
  organizationId: string,
  listingUrls: string[],
): Promise<Set<string>> {
  const linkedUrls = new Set<string>();
  const uniq = Array.from(new Set(listingUrls));
  if (!uniq.length) return linkedUrls;

  // Step 1: find existing vehicles by bat_auction_url
  const urlToVehicleId = new Map<string, string>();
  const chunkSize = 80;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, bat_auction_url')
      .in('bat_auction_url', chunk);
    if (error || !Array.isArray(data)) continue;
    for (const row of data) {
      if (row?.id && row?.bat_auction_url) {
        urlToVehicleId.set(String(row.bat_auction_url), String(row.id));
      }
    }
  }

  const vehicleIds = Array.from(new Set(Array.from(urlToVehicleId.values())));
  if (!vehicleIds.length) return linkedUrls;

  // Step 2: find which of those vehicles are already linked to this org
  const linkedVehicleIds = new Set<string>();
  for (let i = 0; i < vehicleIds.length; i += 200) {
    const chunk = vehicleIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id')
      .eq('organization_id', organizationId)
      .in('vehicle_id', chunk);
    if (error || !Array.isArray(data)) continue;
    for (const row of data) {
      if (row?.vehicle_id) linkedVehicleIds.add(String(row.vehicle_id));
    }
  }

  // Map back to URLs
  for (const [url, vid] of urlToVehicleId.entries()) {
    if (linkedVehicleIds.has(vid)) linkedUrls.add(url);
  }

  return linkedUrls;
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

  let facilities = facilitiesAll.filter((f) => !!(f?.bat_username && f?.geographic_key));
  if (opts.partnerKey) {
    facilities = facilities.filter((f) => f.geographic_key === opts.partnerKey);
  } else {
    facilities = facilities.slice(opts.resumeFromPartner);
  }
  if (typeof opts.limitPartners === 'number') facilities = facilities.slice(0, opts.limitPartners);

  console.log('BaT Local Partner vehicle import');
  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Facilities in snapshot: ${facilitiesAll.length}`);
  console.log(`Processing partners: ${facilities.length}`);
  console.log(`Concurrency (listing imports): ${opts.concurrency}`);
  console.log(`imageBatchSize: ${opts.imageBatchSize} (legacy/no-op)`);
  console.log(`maxPages: ${opts.maxPages}`);
  console.log(`skipExistingLinked: ${opts.skipExistingLinked}`);
  console.log(`requireBusinessMatch: ${opts.requireBusinessMatch}`);
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);

  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/complete-bat-import`;

  const partnerSummaries: any[] = [];

  let partnersOk = 0;
  let partnersFail = 0;
  let listingsOk = 0;
  let listingsFail = 0;

  const supabaseReadKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;
  const supabase = supabaseReadKey ? createClient(SUPABASE_URL, supabaseReadKey) : null;

  for (let i = 0; i < facilities.length; i++) {
      const f = facilities[i];
      const username = (f.bat_username || '').trim();
      const partnerLabel = `${f.partner_name} (${f.geographic_key})`;

      process.stdout.write(`\n[partner ${i + 1}/${facilities.length}] ${partnerLabel}\n`);

      if (!username) {
        partnersFail++;
        process.stdout.write(`  skipped: missing bat_username\n`);
        continue;
      }

      // Find business id for this facility.
      const memberUrl = memberUrlForUsername(username);
      process.stdout.write(`  member: ${memberUrl}\n`);

      let organizationId: string | null = null;
      if (supabase) {
        organizationId = await resolveBusinessIdByGeographicKey(supabase, f.geographic_key);
      }
      if (!organizationId) {
        process.stdout.write(`  org: (not resolved by geographic_key; proceeding without organizationId)\n`);
        if (opts.requireBusinessMatch) {
          partnersFail++;
          process.stdout.write(`  skipped: requireBusinessMatch=true and no org id found\n`);
          continue;
        }
      } else {
        process.stdout.write(`  org: ${organizationId}\n`);
      }

      const { urls: listingUrlsAll, pagesFetched } = await enumerateMemberListingUrls(memberUrl, opts.maxPages);
      const listingUrlsRaw = typeof opts.listingLimit === 'number' ? listingUrlsAll.slice(0, opts.listingLimit) : listingUrlsAll;

      let listingUrls = listingUrlsRaw;
      let skippedAlreadyLinked = 0;
      if (supabase && organizationId && opts.skipExistingLinked && listingUrls.length) {
        try {
          const linked = await findLinkedListingUrls(supabase, organizationId, listingUrls);
          if (linked.size) {
            listingUrls = listingUrls.filter((u) => !linked.has(u));
            skippedAlreadyLinked = linked.size;
          }
        } catch {
          // If the DB query fails (RLS, etc), just proceed; Edge importer is idempotent.
        }
      }

      process.stdout.write(
        `  listings: ${listingUrls.length} (pages-fetched=${pagesFetched}${skippedAlreadyLinked ? `, skipped_already_linked=${skippedAlreadyLinked}` : ''})\n`
      );

      partnerSummaries.push({
        geographic_key: f.geographic_key,
        partner_name: f.partner_name,
        bat_username: username,
        member_url: memberUrl,
        organization_id: organizationId,
        pages_fetched: pagesFetched,
        listings_found: listingUrlsAll.length,
        listings_to_process: listingUrls.length,
        listings_skipped_already_linked: skippedAlreadyLinked,
      });

      if (opts.dryRun) {
        partnersOk++;
        continue;
      }

      await mapLimit(listingUrls, opts.concurrency, async (batUrl, idx) => {
        const n = idx + 1;
        process.stdout.write(`    [${n}/${listingUrls.length}] ${batUrl.split('/listing/')[1]?.slice(0, 60) || batUrl} ... `);
        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${INVOKE_KEY}`,
            },
            body: JSON.stringify({
              bat_url: batUrl,
              organization_id: organizationId,
            }),
          });
          const text = await resp.text();
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 160)}`);
          listingsOk++;
          process.stdout.write(`OK\n`);
          await sleep(900);
        } catch (e: any) {
          listingsFail++;
          process.stdout.write(`FAIL (${e?.message || String(e)})\n`);
          await sleep(1500);
        }
      });

      partnersOk++;
      await sleep(1200);
  }

  if (opts.writeJson) {
    const outDir = path.resolve(__dirname, '..', 'data', 'bat');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'bat_local_partner_vehicle_import_summary.json');
    fs.writeFileSync(outPath, JSON.stringify({
      scraped_at: new Date().toISOString(),
      source_snapshot: snapshotPath,
      partners_processed: facilities.length,
      partners_ok: partnersOk,
      partners_failed: partnersFail,
      listings_ok: listingsOk,
      listings_failed: listingsFail,
      partners: partnerSummaries,
    }, null, 2));
    console.log(`\nWrote: ${outPath}`);
  }

  console.log(`\nDone`);
  console.log(`Partners: ok=${partnersOk} failed=${partnersFail}`);
  console.log(`Listings: ok=${listingsOk} failed=${listingsFail}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});


