#!/usr/bin/env node
/**
 * BaT Title Signal Audit
 *
 * Reads BaT listing titles we already have in Supabase (bat_listings.bat_listing_title)
 * and reports:
 * - how many BaT listings are in our DB
 * - how many are sold/ended/reserve_not_met
 * - what “differentiator signals” BaT uses in titles (mileage/manual/PDK/body style/option codes/swaps/etc.)
 *
 * Usage:
 *   tsx scripts/bat-title-signal-audit.ts
 *   tsx scripts/bat-title-signal-audit.ts --limit=5000
 *   tsx scripts/bat-title-signal-audit.ts --sample=50
 *
 * Env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

type BatListingRow = {
  id: string;
  bat_listing_url: string | null;
  listing_status: string | null;
  sale_price: number | null;
  sale_date: string | null;
  final_bid: number | null;
  bid_count: number | null;
  bat_listing_title: string | null;
  auction_end_date: string | null;
  raw_data: any;
};

function loadEnvFallbacks() {
  // Mirror the repo's other scripts: best-effort load .env.local (and .env) without hard failures.
  // Never print secret values.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const candidates = [
    join(__dirname, '..', '.env.local'),
    join(__dirname, '..', '.env'),
    join(__dirname, '..', 'nuke_frontend', '.env.local'),
    join(__dirname, '..', 'nuke_frontend', '.env'),
  ];

  for (const p of candidates) {
    try {
      const envFile = readFileSync(p, 'utf8');
      envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (!match) return;
        const k = match[1].trim();
        const v = match[2].trim().replace(/^["']|["']$/g, '');
        if (!k) return;
        if (!process.env[k]) process.env[k] = v;
      });
      // Stop at first readable env file
      return;
    } catch {
      // continue
    }
  }
}

function parseArgs(argv: string[]) {
  const out = { limit: 20000, sample: 20 };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) out.limit = Math.min(200000, Math.floor(n));
    } else if (a.startsWith('--sample=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) out.sample = Math.min(200, Math.floor(n));
    }
  }
  return out;
}

function normalizeTitle(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Most stored BaT titles are already clean, but keep this resilient:
  s = s.split('|')[0].trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function classifySignals(titleRaw: string) {
  const title = normalizeTitle(titleRaw);
  const t = title.toLowerCase();

  const mileage =
    /\b\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\b/.test(title) ||
    /\b\d{1,3}(?:,\d{3})+\s*[-\s]*mile\b/i.test(title) ||
    /\b\d{1,3}(?:,\d{3})+\s*miles?\b/i.test(title);

  const manual = /\b(manual|m\/t|mt|stick|3[-\s]?pedal|three[-\s]?pedal)\b/i.test(title);
  const pdk = /\bpdk\b/i.test(title);

  const bodyStyle = [
    'cabriolet', 'convertible', 'coupe', 'targa', 'roadster',
    'wagon', 'sedan', 'hatchback', 'suv',
    'pickup', 'truck', 'crew cab', 'extended cab', 'regular cab',
    'van', 'panel', 'fastback', 'hardtop'
  ].some(k => t.includes(k));

  const forcedInduction = /\b(supercharged|turbocharged|turbo|twin[-\s]?turbo|roots|procharger)\b/i.test(title);

  const swap =
    /\b(ls\d|lsx|k[-\s]?swap|engine[-\s]?swap|swapped)\b/i.test(title) ||
    /\b(coyote|2jz|1jz|k20|k24)\b/i.test(title);

  // Option codes / halo trims (starter set; we’ll expand once we see counts)
  const optionCode =
    /\b(zl1|z06|zr1|zr-1|z28|ss|rs|gt3|gt2|gts|cs|m3|m4|m5|m2|amg|srt|type\s*r)\b/i.test(title);

  return {
    title,
    mileage,
    manual,
    pdk,
    bodyStyle,
    forcedInduction,
    swap,
    optionCode,
  };
}

function inc(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

async function fetchAllBatListings(supabase: any, limit: number): Promise<BatListingRow[]> {
  const rows: BatListingRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const { data, error } = await supabase
      .from('bat_listings')
      .select('id, bat_listing_url, listing_status, sale_price, sale_date, final_bid, bid_count, bat_listing_title, auction_end_date, raw_data')
      .order('updated_at', { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, limit - 1));

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as BatListingRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  loadEnvFallbacks();

  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    '';
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in env.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const rows = await fetchAllBatListings(supabase, args.limit);
  const withTitle = rows.filter(r => (r.bat_listing_title || '').trim().length > 0);

  const statusCounts = new Map<string, number>();
  const signalCounts = new Map<string, number>();

  for (const r of withTitle) {
    inc(statusCounts, String(r.listing_status || 'unknown').toLowerCase());
    const s = classifySignals(r.bat_listing_title || '');
    if (s.mileage) inc(signalCounts, 'mileage');
    if (s.manual) inc(signalCounts, 'manual');
    if (s.pdk) inc(signalCounts, 'pdk');
    if (s.bodyStyle) inc(signalCounts, 'body_style_word');
    if (s.forcedInduction) inc(signalCounts, 'forced_induction');
    if (s.swap) inc(signalCounts, 'swap');
    if (s.optionCode) inc(signalCounts, 'option_code_or_halo_trim');
  }

  const soldLike = withTitle.filter(r => String(r.listing_status || '').toLowerCase() === 'sold' || (r.sale_price || 0) > 0);

  console.log('\n=== BaT Title Signal Audit ===\n');
  console.log(`rows scanned:          ${rows.length}`);
  console.log(`rows with title:       ${withTitle.length}`);
  console.log(`sold (status/price):   ${soldLike.length}`);
  console.log('\nstatus counts:');
  for (const [k, v] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${k}: ${v}`);
  }

  console.log('\nsignal frequency (in titles):');
  for (const [k, v] of [...signalCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = withTitle.length > 0 ? (100 * v / withTitle.length).toFixed(1) : '0.0';
    console.log(`  - ${k}: ${v} (${pct}%)`);
  }

  if (args.sample > 0) {
    console.log(`\nexamples (sample=${args.sample}):`);
    const sample = withTitle.slice(0, args.sample);
    for (const r of sample) {
      const t = normalizeTitle(r.bat_listing_title || '');
      console.log(`  - ${t}`);
    }
  }

  console.log('\nnext: use these distributions to tune the identity strategy by niche (make/model) and by outcome (sold vs ended).\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


