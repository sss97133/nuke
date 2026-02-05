#!/usr/bin/env node
/**
 * Set status = 'active' for existing public auction-import vehicles so they show on the feed.
 * Run: node scripts/activate-public-auction-vehicles.cjs
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

const SOURCES = [
  'gooding', 'bonhams', 'bh_auction', 'historics', 'rmsothebys', 'bonhams_catalog_import'
];
const ORIGINS = [
  'gooding_import', 'bonhams_import', 'bonhams_catalog_import',
  'bh_auction_import', 'historics_import', 'rmsothebys_import'
];

async function main() {
  console.log('Fetching public auction vehicles with status pending...');
  const { data: rows, error: selectError } = await supabase
    .from('vehicles')
    .select('id')
    .eq('is_public', true)
    .or('status.is.null,status.eq.pending')
    .or(
      'discovery_source.in.(' + SOURCES.join(',') + '),' +
      'profile_origin.in.(' + ORIGINS.join(',') + ')'
    );

  if (selectError) {
    console.error('Select error:', selectError.message);
    process.exit(1);
  }

  const ids = (rows || []).map((r) => r.id);
  if (ids.length === 0) {
    console.log('No matching vehicles to update.');
    return;
  }

  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .in('id', chunk);
    if (updateError) {
      console.error('Update error at batch', i / BATCH + 1, ':', updateError.message);
      process.exit(1);
    }
    updated += chunk.length;
    console.log('Updated', updated, '/', ids.length);
  }
  console.log('Done. Updated', updated, 'vehicles.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
