#!/usr/bin/env node
/**
 * VEHICLE PROVENANCE LOOKUP
 *
 * Given a VIN or vehicle ID, shows everything we know:
 * - Auction history
 * - Forum mentions
 * - Owner observations
 * - Similar vehicle insights
 *
 * Usage:
 *   node scripts/vehicle-provenance-lookup.js --vin=WBSCN93451LK60310
 *   node scripts/vehicle-provenance-lookup.js --id=6e49a37a-d619-44bc-a69b-479476d7c79f
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const vinArg = args.find(a => a.startsWith('--vin='))?.split('=')[1];
const idArg = args.find(a => a.startsWith('--id='))?.split('=')[1];

async function main() {
  if (!vinArg && !idArg) {
    // Demo mode - pick a vehicle with data
    console.log('No VIN or ID provided. Running demo with a sample vehicle...\n');
    const { data: sample } = await supabase
      .from('vehicles')
      .select('id, vin')
      .not('vin', 'is', null)
      .limit(1)
      .single();

    if (sample) {
      return lookupVehicle(sample.id, sample.vin);
    }
  }

  if (vinArg) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, vin')
      .eq('vin', vinArg.toUpperCase())
      .single();

    if (vehicle) {
      return lookupVehicle(vehicle.id, vehicle.vin);
    } else {
      console.log(`VIN ${vinArg} not found in database.`);
      console.log('Searching for similar vehicles...\n');
      return searchSimilar(vinArg);
    }
  }

  if (idArg) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, vin')
      .eq('id', idArg)
      .single();

    if (vehicle) {
      return lookupVehicle(vehicle.id, vehicle.vin);
    } else {
      console.log(`Vehicle ID ${idArg} not found.`);
    }
  }
}

async function lookupVehicle(vehicleId, vin) {
  console.log('═'.repeat(70));
  console.log('  VEHICLE PROVENANCE REPORT');
  console.log('═'.repeat(70));

  // Get vehicle details
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (!vehicle) {
    console.log('Vehicle not found');
    return;
  }

  console.log(`\n  ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  VIN: ${vehicle.vin || 'Unknown'}`);
  console.log(`  ID: ${vehicle.id}`);
  console.log('─'.repeat(70));

  // Get auction events
  const { data: auctions } = await supabase
    .from('auction_events')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('auction_date', { ascending: false });

  console.log('\n  AUCTION HISTORY');
  console.log('  ' + '─'.repeat(40));
  if (auctions?.length > 0) {
    for (const auction of auctions) {
      const price = auction.sale_price ? `$${auction.sale_price.toLocaleString()}` : 'No sale';
      console.log(`  ${auction.auction_date || 'Date unknown'} | ${auction.platform || 'Unknown'} | ${price}`);
      if (auction.lot_url) console.log(`    → ${auction.lot_url}`);
    }
  } else {
    console.log('  No auction records found');
  }

  // Get observations
  const { data: observations } = await supabase
    .from('vehicle_observations')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('observed_at', { ascending: false })
    .limit(20);

  console.log('\n  OBSERVATIONS & MENTIONS');
  console.log('  ' + '─'.repeat(40));
  if (observations?.length > 0) {
    const grouped = {};
    for (const obs of observations) {
      const kind = obs.kind || 'unknown';
      if (!grouped[kind]) grouped[kind] = [];
      grouped[kind].push(obs);
    }

    for (const [kind, obs] of Object.entries(grouped)) {
      console.log(`  ${kind}: ${obs.length} records`);
      // Show first few
      for (const o of obs.slice(0, 3)) {
        const preview = o.content_text?.slice(0, 80)?.replace(/\n/g, ' ') || '';
        const date = o.observed_at?.split('T')[0] || '';
        console.log(`    [${date}] ${preview}...`);
      }
    }
  } else {
    console.log('  No observations found');
  }

  // Get comments from BaT/auctions
  const { data: comments } = await supabase
    .from('auction_comments')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('posted_at', { ascending: false })
    .limit(10);

  console.log('\n  AUCTION COMMENTS');
  console.log('  ' + '─'.repeat(40));
  if (comments?.length > 0) {
    console.log(`  ${comments.length}+ comments found`);
    for (const c of comments.slice(0, 5)) {
      const preview = c.comment_text?.slice(0, 100)?.replace(/\n/g, ' ') || '';
      console.log(`    "${preview}..."`);
    }
  } else {
    console.log('  No comments found');
  }

  // Get forum threads linked
  const { data: threads } = await supabase
    .from('build_threads')
    .select('id, thread_title, thread_url, post_count')
    .eq('vehicle_id', vehicleId);

  console.log('\n  FORUM BUILD THREADS');
  console.log('  ' + '─'.repeat(40));
  if (threads?.length > 0) {
    for (const t of threads) {
      console.log(`  "${t.thread_title}"`);
      console.log(`    ${t.post_count || '?'} posts | ${t.thread_url}`);
    }
  } else {
    console.log('  No forum threads linked');
  }

  // Get images
  const { data: images, count: imageCount } = await supabase
    .from('vehicle_images')
    .select('url', { count: 'exact' })
    .eq('vehicle_id', vehicleId)
    .limit(5);

  console.log('\n  IMAGES');
  console.log('  ' + '─'.repeat(40));
  console.log(`  ${imageCount || 0} images on file`);

  // Similar vehicles (same year/make/model)
  const { data: similar, count: similarCount } = await supabase
    .from('vehicles')
    .select('id, year, make, model', { count: 'exact' })
    .eq('year', vehicle.year)
    .eq('make', vehicle.make)
    .eq('model', vehicle.model)
    .neq('id', vehicleId)
    .limit(5);

  console.log('\n  SIMILAR VEHICLES IN DATABASE');
  console.log('  ' + '─'.repeat(40));
  console.log(`  ${similarCount || 0} other ${vehicle.year} ${vehicle.make} ${vehicle.model} records`);

  console.log('\n' + '═'.repeat(70));
}

async function searchSimilar(vin) {
  // Decode VIN to get year/make
  const yearCodes = {
    'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014, 'F': 2015,
    'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019, 'L': 2020, 'M': 2021,
    'V': 1997, 'W': 1998, 'X': 1999, 'Y': 2000,
    '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005,
    '6': 2006, '7': 2007, '8': 2008, '9': 2009,
  };

  if (vin.length === 17) {
    const year = yearCodes[vin[9].toUpperCase()];
    if (year) {
      console.log(`Decoded year from VIN: ${year}`);
      const { data: similar } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin')
        .eq('year', year)
        .limit(10);

      if (similar?.length > 0) {
        console.log(`Found ${similar.length} vehicles from ${year}:`);
        for (const v of similar) {
          console.log(`  - ${v.year} ${v.make} ${v.model} (${v.vin || 'no VIN'})`);
        }
      }
    }
  }
}

main().catch(console.error);
