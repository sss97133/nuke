#!/usr/bin/env npx tsx
// Process Craigslist extraction backlog
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function extractCraigslist(url: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-craigslist`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  return response.json();
}

async function main() {
  console.log('Fetching pending Craigslist URLs...');

  // Get pending Craigslist URLs
  const { data: pending, error: fetchError } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .like('listing_url', '%craigslist%')
    .eq('status', 'pending')
    .order('created_at')
    .limit(100);

  if (fetchError) {
    console.error('Error fetching pending URLs:', fetchError);
    process.exit(1);
  }

  if (!pending || pending.length === 0) {
    console.log('No pending Craigslist URLs found.');
    return;
  }

  console.log(`Found ${pending.length} pending URLs to process.\n`);

  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    const { id, listing_url } = item;
    console.log(`Processing: ${listing_url}`);

    try {
      const result = await extractCraigslist(listing_url);

      if (result.success && result.extracted) {
        const ext = result.extracted;

        // Update the import_queue with extracted data
        const { error: updateError } = await supabase
          .from('import_queue')
          .update({
            listing_title: ext.title,
            listing_year: ext.year,
            listing_make: ext.make,
            listing_model: ext.model,
            listing_price: ext.price,
            thumbnail_url: ext.image_urls?.[0] || null,
            raw_data: {
              mileage: ext.mileage,
              location: ext.location,
              exterior_color: ext.exterior_color,
              transmission: ext.transmission,
              drivetrain: ext.drivetrain,
              fuel_type: ext.fuel_type,
              cylinders: ext.cylinders,
              body_style: ext.body_style,
              condition: ext.condition,
              title_status: ext.title_status,
              description: ext.description,
              image_urls: ext.image_urls,
              posted_at: ext.posted_at,
            },
            status: 'complete',
            processed_at: new Date().toISOString(),
            extractor_version: 'extract-craigslist-v1',
          })
          .eq('id', id);

        if (updateError) {
          console.log(`  -> ERROR updating DB: ${updateError.message}`);
          failed++;
        } else {
          console.log(`  -> SUCCESS: ${ext.year} ${ext.make} ${ext.model} at $${ext.price?.toLocaleString() || 'N/A'}`);
          processed++;
        }
      } else {
        const errorMsg = result.error || 'Unknown extraction error';

        // Mark as failed
        await supabase
          .from('import_queue')
          .update({
            status: 'failed',
            error_message: errorMsg,
            attempts: (await supabase.from('import_queue').select('attempts').eq('id', id).single()).data?.attempts + 1 || 1,
            last_attempt_at: new Date().toISOString(),
          })
          .eq('id', id);

        console.log(`  -> FAILED: ${errorMsg}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  -> ERROR: ${err.message}`);

      await supabase
        .from('import_queue')
        .update({
          status: 'failed',
          error_message: err.message,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', id);

      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${processed + failed}`);
}

main().catch(console.error);
