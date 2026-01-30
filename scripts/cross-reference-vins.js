#!/usr/bin/env node
/**
 * CROSS-REFERENCE-VINS
 *
 * Searches forum posts for mentions of VINs from our vehicle database.
 * This finds provenance connections - same car in forums AND auctions.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('='.repeat(60));
  console.log('VIN CROSS-REFERENCE: Forums ↔ Auctions');
  console.log('='.repeat(60));

  // Get a batch of VINs from vehicles that have auction data
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, vin, year, make, model')
    .not('vin', 'is', null)
    .limit(1000);

  console.log(`\nChecking ${vehicles?.length || 0} vehicle VINs against forum posts...\n`);

  let matches = 0;

  // Get all forum post content to search
  const { data: posts } = await supabase
    .from('build_posts')
    .select('id, content_text, build_thread_id')
    .not('content_text', 'is', null)
    .limit(10000);

  console.log(`Loaded ${posts?.length || 0} forum posts to search\n`);

  // Build searchable text from all posts
  const allContent = posts?.map(p => ({
    id: p.id,
    thread_id: p.build_thread_id,
    text: p.content_text.toUpperCase()
  })) || [];

  for (const vehicle of vehicles || []) {
    if (!vehicle.vin || vehicle.vin.length < 8) continue;

    // Search for full VIN or last 8 characters
    const fullVin = vehicle.vin.toUpperCase();
    const partialVin = fullVin.slice(-8);

    for (const post of allContent) {
      if (post.text.includes(fullVin) || post.text.includes(partialVin)) {
        matches++;
        console.log('MATCH FOUND!');
        console.log(`  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        console.log(`  VIN: ${vehicle.vin}`);
        console.log(`  Thread ID: ${post.thread_id}`);
        console.log('');

        // Link the thread to this vehicle if not already linked
        const { data: thread } = await supabase
          .from('build_threads')
          .select('id, vehicle_id, thread_title')
          .eq('id', post.thread_id)
          .single();

        if (thread && !thread.vehicle_id) {
          console.log(`  → Linking thread "${thread.thread_title?.slice(0, 40)}..." to vehicle`);
          await supabase
            .from('build_threads')
            .update({ vehicle_id: vehicle.id })
            .eq('id', thread.id);
        }
      }
    }
  }

  console.log('='.repeat(60));
  console.log(`VIN matches found: ${matches}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
