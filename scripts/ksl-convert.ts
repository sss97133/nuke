#!/usr/bin/env npx tsx
/**
 * KSL Convert - Converts scraped KSL queue records to vehicles
 * Since we already have year/make/model/price from search results,
 * we can create vehicles directly without visiting individual pages.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const BATCH_SIZE = 100;

async function convertBatch(): Promise<number> {
  // Get pending KSL records with data
  const { data: records, error } = await supabase
    .from('import_queue')
    .select('*')
    .eq('status', 'pending')
    .like('listing_url', '%cars.ksl.com%')
    .not('listing_year', 'is', null)
    .not('listing_make', 'is', null)
    .limit(BATCH_SIZE);

  if (error || !records?.length) {
    if (error) console.error('Query error:', error.message);
    return 0;
  }

  let converted = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      // Check if vehicle already exists
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('source_url', record.listing_url)
        .single();

      if (existing) {
        // Mark as complete
        await supabase
          .from('import_queue')
          .update({ status: 'complete', processed_at: new Date().toISOString() })
          .eq('id', record.id);
        skipped++;
        continue;
      }

      // Create vehicle record
      const { error: insertError } = await supabase
        .from('vehicles')
        .insert({
          source_url: record.listing_url,
          title: record.listing_title,
          year: record.listing_year,
          make: record.listing_make,
          model: record.listing_model,
          sale_price: record.listing_price,
          mileage: record.raw_data?.mileage,
          location: record.raw_data?.location,
          source_platform: 'ksl',
          thumbnail_url: record.thumbnail_url,
        });

      if (insertError) {
        if (insertError.message.includes('duplicate key')) {
          await supabase
            .from('import_queue')
            .update({ status: 'complete', processed_at: new Date().toISOString() })
            .eq('id', record.id);
          skipped++;
        } else {
          await supabase
            .from('import_queue')
            .update({
              status: 'failed',
              error_message: insertError.message,
              processed_at: new Date().toISOString()
            })
            .eq('id', record.id);
        }
        continue;
      }

      // Mark as complete
      await supabase
        .from('import_queue')
        .update({ status: 'complete', processed_at: new Date().toISOString() })
        .eq('id', record.id);
      converted++;

    } catch (err: any) {
      await supabase
        .from('import_queue')
        .update({
          status: 'failed',
          error_message: err.message,
          processed_at: new Date().toISOString()
        })
        .eq('id', record.id);
    }
  }

  console.log(`  Converted: ${converted}, Skipped: ${skipped}`);
  return converted + skipped;
}

async function main() {
  console.log('🚗 KSL Convert - Creating vehicles from queue data\n');

  // First, check how many records have data
  const { count: withData } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .like('listing_url', '%cars.ksl.com%')
    .not('listing_year', 'is', null);

  console.log(`Found ${withData || 0} KSL records with data to convert\n`);

  if (!withData) {
    console.log('No records to convert. Waiting for scraper to populate data...');
    return;
  }

  let totalProcessed = 0;
  let batch = 0;

  while (true) {
    batch++;
    console.log(`Batch ${batch}...`);
    const processed = await convertBatch();
    totalProcessed += processed;

    if (processed === 0) break;

    // Progress update
    if (batch % 10 === 0) {
      console.log(`\n📊 Progress: ${totalProcessed} processed\n`);
    }
  }

  console.log(`\n✅ Complete: ${totalProcessed} KSL records processed`);
}

main().catch(console.error);
