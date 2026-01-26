#!/usr/bin/env node
/**
 * Manual BaT Comment Extraction
 * Extracts comments from a specific BaT listing URL
 * 
 * Usage: node scripts/manual-extract-bat-comments.js <bat_url>
 * Example: node scripts/manual-extract-bat-comments.js https://bringatrailer.com/listing/1957-bmw-507-roadster/
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPath = join(__dirname, '..', 'nuke_frontend', '.env.local');
let env = {};
try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {
  console.warn('⚠️  Could not read .env.local, using environment variables');
}

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  console.error('   Set it in nuke_frontend/.env.local as VITE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    return String(url).split('#')[0].split('?')[0];
  }
}

async function findOrCreateVehicle(batUrl) {
  const normalizedUrl = normalizeUrl(batUrl);
  const urlVariants = [
    normalizedUrl,
    normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : `${normalizedUrl}/`,
    batUrl,
  ].filter((v, i, arr) => arr.indexOf(v) === i); // unique

  console.log(`🔍 Looking for existing vehicle with URL: ${normalizedUrl}`);

  // Check vehicles table
  const { data: vehicleByBatUrl } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .in('bat_auction_url', urlVariants)
    .maybeSingle();

  if (vehicleByBatUrl) {
    console.log(`✅ Found existing vehicle: ${vehicleByBatUrl.year || '?'} ${vehicleByBatUrl.make || '?'} ${vehicleByBatUrl.model || '?'} (ID: ${vehicleByBatUrl.id})`);
    return vehicleByBatUrl.id;
  }

  const { data: vehicleByDiscovery } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .in('discovery_url', urlVariants)
    .maybeSingle();

  if (vehicleByDiscovery) {
    console.log(`✅ Found existing vehicle by discovery_url: ${vehicleByDiscovery.year || '?'} ${vehicleByDiscovery.make || '?'} ${vehicleByDiscovery.model || '?'} (ID: ${vehicleByDiscovery.id})`);
    return vehicleByDiscovery.id;
  }

  // Check external_listings
  const { data: externalListing } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .eq('platform', 'bat')
    .in('listing_url', urlVariants)
    .maybeSingle();

  if (externalListing?.vehicle_id) {
    console.log(`✅ Found vehicle via external_listings (ID: ${externalListing.vehicle_id})`);
    return externalListing.vehicle_id;
  }

  // Check bat_listings
  const { data: batListing } = await supabase
    .from('bat_listings')
    .select('vehicle_id, bat_listing_title')
    .in('bat_listing_url', urlVariants)
    .maybeSingle();

  if (batListing?.vehicle_id) {
    console.log(`✅ Found vehicle via bat_listings: "${batListing.bat_listing_title || 'Untitled'}" (ID: ${batListing.vehicle_id})`);
    return batListing.vehicle_id;
  }

  // No existing vehicle found - create a minimal one
  console.log(`⚠️  No existing vehicle found. Creating minimal vehicle record...`);
  
  // Try to extract basic info from URL or title
  const urlMatch = batUrl.match(/\/(\d{4})-([^\/]+)\/(?:.*)?$/);
  let year = null;
  let make = null;
  let model = null;
  
  if (urlMatch) {
    year = parseInt(urlMatch[1]);
    const remaining = urlMatch[2].replace(/-/g, ' ');
    // Very basic parsing - might not work for all URLs
    const parts = remaining.split(/\s+/);
    if (parts.length >= 1) make = parts[0];
    if (parts.length >= 2) model = parts.slice(1).join(' ');
  }

  const { data: newVehicle, error: createError } = await supabase
    .from('vehicles')
    .insert({
      year: year || null,
      make: make || null,
      model: model || null,
      bat_auction_url: normalizedUrl,
      discovery_url: normalizedUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createError) {
    console.error(`❌ Failed to create vehicle: ${createError.message}`);
    throw createError;
  }

  console.log(`✅ Created new vehicle (ID: ${newVehicle.id})`);
  return newVehicle.id;
}

async function ensureAuctionEvent(vehicleId, batUrl) {
  const normalizedUrl = normalizeUrl(batUrl);

  const { data: existingEvent } = await supabase
    .from('auction_events')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'bat')
    .eq('source_url', normalizedUrl)
    .maybeSingle();

  if (existingEvent) {
    console.log(`✅ Found existing auction_event (ID: ${existingEvent.id})`);
    return existingEvent.id;
  }

  console.log(`📝 Creating auction_event...`);
  // Valid outcome values: sold, reserve_not_met, no_sale, bid_to, cancelled, relisted, pending
  // Use 'bid_to' as default for ended auctions (will be updated if we find sale_price)
  const { data: newEvent, error: createError } = await supabase
    .from('auction_events')
    .insert({
      vehicle_id: vehicleId,
      source: 'bat',
      source_url: normalizedUrl,
      outcome: 'bid_to', // Default for ended auctions, will be updated if sale_price found
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createError) {
    console.error(`❌ Failed to create auction_event: ${createError.message}`);
    throw createError;
  }

  console.log(`✅ Created auction_event (ID: ${newEvent.id})`);
  return newEvent.id;
}

async function extractComments(vehicleId, auctionEventId, batUrl) {
  console.log(`\n🚀 Starting comment extraction...`);
  console.log(`   Vehicle ID: ${vehicleId}`);
  console.log(`   Auction Event ID: ${auctionEventId || 'auto-resolve'}`);
  console.log(`   URL: ${batUrl}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-auction-comments', {
      body: {
        auction_url: batUrl,
        auction_event_id: auctionEventId,
        vehicle_id: vehicleId,
      },
    });

    if (error) {
      console.error(`❌ Comment extraction failed: ${error.message}`);
      throw error;
    }

    console.log(`\n✅ Extraction complete!`);
    console.log(`   Comments extracted: ${data.comments_extracted || 0}`);
    console.log(`   Vehicle ID: ${data.vehicle_id}`);
    console.log(`   Auction Event ID: ${data.auction_event_id || 'N/A'}\n`);

    // Verify comments were saved
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    const { count: batCommentCount } = await supabase
      .from('bat_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    console.log(`📊 Verification:`);
    console.log(`   auction_comments: ${commentCount || 0}`);
    console.log(`   bat_comments: ${batCommentCount || 0}`);

    return {
      success: true,
      commentsExtracted: data.comments_extracted || 0,
      vehicleId: data.vehicle_id,
      auctionEventId: data.auction_event_id,
    };
  } catch (err) {
    console.error(`❌ Extraction error: ${err.message}`);
    throw err;
  }
}

async function main() {
  const batUrl = process.argv[2];

  if (!batUrl) {
    console.error('❌ Missing BaT URL argument');
    console.error('');
    console.error('Usage: node scripts/manual-extract-bat-comments.js <bat_url>');
    console.error('Example: node scripts/manual-extract-bat-comments.js https://bringatrailer.com/listing/1957-bmw-507-roadster/');
    process.exit(1);
  }

  if (!batUrl.includes('bringatrailer.com')) {
    console.error('❌ URL does not appear to be a BaT listing');
    console.error(`   Got: ${batUrl}`);
    process.exit(1);
  }

  console.log(`🎯 Manual BaT Comment Extraction\n`);
  console.log(`   URL: ${batUrl}\n`);

  try {
    // Step 1: Find or create vehicle
    const vehicleId = await findOrCreateVehicle(batUrl);

    // Step 2: Ensure auction_event exists
    const auctionEventId = await ensureAuctionEvent(vehicleId, batUrl);

    // Step 3: Extract comments
    const result = await extractComments(vehicleId, auctionEventId, batUrl);

    console.log(`\n✅ Successfully extracted ${result.commentsExtracted} comments!`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);

