#!/usr/bin/env node
/**
 * Simple BaT data extraction - just extract and save to DB
 * Usage: node scripts/extract-bat-data-simple.js <vehicle_id> <bat_url>
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPath = join(__dirname, '..', 'nuke_frontend', '.env.local');
const envFile = readFileSync(envPath, 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
});

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const vehicleId = process.argv[2];
  const batUrl = process.argv[3];

  if (!vehicleId || !batUrl) {
    console.error('Usage: node scripts/extract-bat-data-simple.js <vehicle_id> <bat_url>');
    process.exit(1);
  }

  console.log(`🔧 Extracting BaT data for vehicle ${vehicleId} from ${batUrl}\n`);

  try {
    // Step 1: Ensure auction_event exists
    console.log('📋 Step 1: Creating/updating auction_event...');
    const { data: auctionEvent, error: eventError } = await supabase
      .from('auction_events')
      .upsert(
        {
          vehicle_id: vehicleId,
          source: 'bat',
          source_url: batUrl,
          outcome: 'sold', // Will be updated by extraction
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vehicle_id,source_url' }
      )
      .select('id')
      .single();

    if (eventError) {
      console.error('❌ Error creating auction_event:', eventError);
      process.exit(1);
    }

    const auctionEventId = auctionEvent.id;
    console.log(`✅ Auction event ID: ${auctionEventId}\n`);

    // Step 2: Trigger extract-auction-comments
    console.log('📝 Step 2: Triggering comment extraction...');
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-auction-comments', {
      body: {
        auction_url: batUrl,
        auction_event_id: auctionEventId,
        vehicle_id: vehicleId,
      },
    });

    if (extractError) {
      console.error('❌ Extraction error:', extractError);
      process.exit(1);
    }

    console.log(`✅ Extraction completed: ${JSON.stringify(extractData, null, 2)}\n`);

    // Step 3: Verify data was saved
    console.log('🔍 Step 3: Verifying saved data...');
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    const { count: bidCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .eq('comment_type', 'bid');

    console.log(`✅ Comments saved: ${commentCount || 0}`);
    console.log(`✅ Bids saved: ${bidCount || 0}`);
    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

