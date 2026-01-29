#!/usr/bin/env node
/**
 * Run missing-VIN-by-source: fetch vehicles missing VIN, group by source, print summary + high-likelihood list.
 * Uses Supabase client (no raw SQL). Loads env from nuke_frontend/.env.local or .env.
 *
 * Usage: node scripts/run-missing-vin-by-source.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (e.g. in nuke_frontend/.env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const HIGH_SOURCES = new Set([
  'Bring a Trailer', 'Cars & Bids', 'PCarMarket', 'Mecum',
  'Collecting Cars', 'Broad Arrow', 'RM Sothebys', 'Gooding', 'Hemmings'
]);

function sourceLabel(row) {
  const url = (row.discovery_url || row.bat_auction_url || '').toLowerCase();
  if (row.auction_source) return row.auction_source;
  if (/bringatrailer\.com|batauctions\.com/.test(url)) return 'Bring a Trailer';
  if (/carsandbids\.com/.test(url)) return 'Cars & Bids';
  if (/pcarmarket\.com/.test(url)) return 'PCarMarket';
  if (/mecum\.com/.test(url)) return 'Mecum';
  if (/collectingcars\.com/.test(url)) return 'Collecting Cars';
  if (/broadarrowauctions\.com/.test(url)) return 'Broad Arrow';
  if (/rmsothebys\.com/.test(url)) return 'RM Sothebys';
  if (/goodingco\.com/.test(url)) return 'Gooding';
  if (/hemmings\.com/.test(url)) return 'Hemmings';
  if (/sbx\.(cars|com)/.test(url)) return 'SBX Cars';
  if (/craigslist\.(com|org)/.test(url)) return 'Craigslist';
  if (/classic\.com/.test(url)) return 'Classic.com';
  if (/ebay\.com/.test(url)) return 'eBay';
  if (/facebook\.com/.test(url)) return 'Facebook';
  if (row.discovery_url || row.bat_auction_url) return 'Unknown URL';
  return row.profile_origin || row.discovery_source || 'No URL';
}

function vinLikelihood(label) {
  if (HIGH_SOURCES.has(label)) return 'High (auction)';
  if (['SBX Cars', 'Classic.com'].includes(label)) return 'Medium';
  if (['Craigslist', 'eBay', 'Facebook', 'Unknown URL'].includes(label)) return 'Low';
  return 'Examine';
}

async function main() {
  const all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, bat_auction_url, profile_origin, discovery_source, auction_source, vin')
      .is('vin', null)
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error('Fetch error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  // Include rows where vin is blank string (sometimes stored as '')
  let offset2 = 0;
  while (true) {
    const { data: blank } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, bat_auction_url, profile_origin, discovery_source, auction_source, vin')
      .eq('vin', '')
      .range(offset2, offset2 + pageSize - 1);
    if (!blank || blank.length === 0) break;
    for (const r of blank) {
      if (!all.find((x) => x.id === r.id)) all.push(r);
    }
    if (blank.length < pageSize) break;
    offset2 += pageSize;
  }

  const bySource = {};
  for (const r of all) {
    const label = sourceLabel(r);
    if (!bySource[label]) bySource[label] = [];
    bySource[label].push(r);
  }

  const order = (label) => (HIGH_SOURCES.has(label) ? 0 : ['SBX Cars', 'Classic.com'].includes(label) ? 1 : 2);
  const summary = Object.entries(bySource)
    .map(([label, rows]) => ({ source_label: label, missing_vin_count: rows.length, vin_likelihood: vinLikelihood(label), order: order(label) }))
    .sort((a, b) => a.order - b.order || b.missing_vin_count - a.missing_vin_count);

  console.log('\n--- Missing VIN by source (summary) ---\n');
  console.log('source_label\tmissing_vin_count\tvin_likelihood');
  for (const s of summary) {
    console.log(`${s.source_label}\t${s.missing_vin_count}\t${s.vin_likelihood}`);
  }

  const highList = [];
  for (const label of HIGH_SOURCES) {
    const rows = bySource[label] || [];
    for (const r of rows) {
      const url = r.discovery_url || r.bat_auction_url;
      if (url) highList.push({ id: r.id, year: r.year, make: r.make, model: r.model, source_label: label, url });
    }
  }
  highList.sort((a, b) => (a.source_label || '').localeCompare(b.source_label || '') || (b.year || 0) - (a.year || 0));

  console.log('\n--- High-likelihood (BaT + auction) — first 100 id, year, make, model, source_label, url ---\n');
  const out = highList.slice(0, 100);
  for (const r of out) {
    console.log(`${r.id}\t${r.year}\t${r.make}\t${r.model}\t${r.source_label}\t${r.url}`);
  }
  console.log(`\nTotal high-likelihood with URL: ${highList.length} (shown 100). Examine others separately.\n`);

  const reportPath = path.join(__dirname, '../reports/missing_vin_by_source.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, high_likelihood_count: highList.length, high_likelihood_sample: highList.slice(0, 500) }, null, 2),
    'utf8'
  );
  console.log('Wrote:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
