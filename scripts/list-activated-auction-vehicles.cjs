#!/usr/bin/env node
/**
 * List recently activated public auction vehicles (by source).
 * Run from repo root: node scripts/list-activated-auction-vehicles.cjs
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: rows, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_source, profile_origin, status, created_at')
    .eq('is_public', true)
    .eq('status', 'active')
    .or(
      'discovery_source.in.(gooding,bonhams,bh_auction,historics,rmsothebys,bonhams_catalog_import),' +
      'profile_origin.in.(gooding_import,bonhams_import,bonhams_catalog_import,bh_auction_import,historics_import,rmsothebys_import)'
    )
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const bySource = {};
  for (const r of rows || []) {
    const src = r.discovery_source || r.profile_origin || 'unknown';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(r);
  }

  console.log('Count by source (active public auction vehicles):');
  for (const [src, list] of Object.entries(bySource).sort((a, b) => b[1].length - a[1].length)) {
    console.log(' ', src + ':', list.length);
  }
  console.log('\nSample (newest updated first):');
  (rows || []).slice(0, 20).forEach((r, i) => {
    console.log(' ', i + 1 + '.', [r.year, r.make, r.model].filter(Boolean).join(' ') || r.id, '|', r.discovery_source || r.profile_origin);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
