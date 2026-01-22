/**
 * NORMALIZE AUCTION_SOURCE FIELD
 *
 * Updates all vehicles to have consistent auction_source values
 * based on their discovery_url/listing_url patterns.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface SourcePattern {
  pattern: string;
  source: string;
  fields: string[];
}

const sourcePatterns: SourcePattern[] = [
  { pattern: 'bringatrailer.com', source: 'Bring a Trailer', fields: ['discovery_url', 'listing_url', 'bat_auction_url'] },
  { pattern: 'carsandbids.com', source: 'Cars & Bids', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'craigslist', source: 'Craigslist', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'mecum.com', source: 'Mecum', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'sbx', source: 'SBX Cars', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'collectingcars.com', source: 'Collecting Cars', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'broadarrowauctions', source: 'Broad Arrow', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'rmsothebys', source: 'RM Sothebys', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'goodingco', source: 'Gooding', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'pcarmarket', source: 'PCarMarket', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'hemmings', source: 'Hemmings', fields: ['discovery_url', 'listing_url'] },
  { pattern: 'designauto', source: 'Design Auto', fields: ['discovery_url', 'listing_url'] },
];

async function normalizeSource(pattern: string, source: string, fields: string[]): Promise<number> {
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    // Build OR filter for URL fields
    const orFilter = fields.map(f => `${f}.ilike.%${pattern}%`).join(',');

    const { data: toUpdate, error: fetchErr } = await supabase
      .from('vehicles')
      .select('id')
      .or(orFilter)
      .neq('auction_source', source)
      .limit(1000);

    if (fetchErr) {
      console.log(`  Error fetching: ${fetchErr.message}`);
      break;
    }

    if (toUpdate === null || toUpdate.length === 0) {
      hasMore = false;
      continue;
    }

    const ids = toUpdate.map(v => v.id);
    const { error: updateErr } = await supabase
      .from('vehicles')
      .update({ auction_source: source })
      .in('id', ids);

    if (updateErr) {
      console.log(`  Update error: ${updateErr.message}`);
      break;
    }

    totalUpdated += toUpdate.length;
  }

  return totalUpdated;
}

async function fixLegacyValues(): Promise<void> {
  const legacyFixes = [
    { from: ['bat', 'BaT', 'bringatrailer', 'Bringatrailer', 'BAT'], to: 'Bring a Trailer' },
    { from: ['cb', 'C&B', 'carsandbids', 'cars_and_bids', 'CarsAndBids'], to: 'Cars & Bids' },
    { from: ['cl', 'CL'], to: 'Craigslist' },
    { from: ['mecum', 'MECUM'], to: 'Mecum' },
  ];

  for (const { from, to } of legacyFixes) {
    for (const oldValue of from) {
      const { data: records } = await supabase
        .from('vehicles')
        .select('id')
        .eq('auction_source', oldValue)
        .limit(5000);

      if (records && records.length > 0) {
        const ids = records.map(v => v.id);
        const { error } = await supabase
          .from('vehicles')
          .update({ auction_source: to })
          .in('id', ids);

        if (error === null) {
          console.log(`  Fixed ${records.length} '${oldValue}' -> '${to}'`);
        }
      }
    }
  }
}

async function printSourceCounts(): Promise<void> {
  console.log('\n--- FINAL SOURCE COUNTS ---');

  const sources = [
    'Bring a Trailer',
    'Cars & Bids',
    'Craigslist',
    'Mecum',
    'SBX Cars',
    'Collecting Cars',
    'Broad Arrow',
    'Gooding',
    'PCarMarket',
    'Hemmings',
    'Design Auto',
  ];

  for (const src of sources) {
    const { count } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('auction_source', src);
    if (count && count > 0) {
      console.log(`${src}: ${count}`);
    }
  }

  const { count: nullCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .is('auction_source', null);
  console.log(`NULL: ${nullCount}`);

  const { count: totalCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal vehicles: ${totalCount}`);
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('NORMALIZING AUCTION_SOURCE FIELD');
  console.log('='.repeat(60));

  // Normalize each source
  for (const { pattern, source, fields } of sourcePatterns) {
    console.log(`\nUpdating ${source}...`);
    const updated = await normalizeSource(pattern, source, fields);
    if (updated > 0) {
      console.log(`  Updated ${updated} records`);
    } else {
      console.log(`  No records to update`);
    }
  }

  // Fix legacy values
  console.log('\nFixing legacy values...');
  await fixLegacyValues();

  // Print final counts
  await printSourceCounts();

  console.log('\nDone!');
}

main().catch(console.error);
