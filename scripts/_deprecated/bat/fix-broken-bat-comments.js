#!/usr/bin/env node
/**
 * Fix broken BaT comments:
 * - Add content_hash for comments missing it
 * - Link comments to auction_events
 * - Update comment counts on vehicles
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../nuke_frontend/.env.local') });
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function fixVehicleComments(vehicleId) {
  console.log(`\n🔧 Fixing vehicle: ${vehicleId}`);
  
  // Get vehicle with BaT URL
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .select('id, bat_auction_url, discovery_url')
    .eq('id', vehicleId)
    .single();
  
  if (vError || !vehicle) {
    console.error(`  ❌ Vehicle not found: ${vehicleId}`);
    return { success: false, error: 'Vehicle not found' };
  }
  
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    console.error(`  ❌ Not a BaT vehicle: ${vehicleId}`);
    return { success: false, error: 'Not a BaT vehicle' };
  }
  
  // Get or create auction_event
  let { data: auctionEvent } = await supabase
    .from('auction_events')
    .select('id')
    .eq('source', 'bat')
    .eq('source_url', batUrl)
    .maybeSingle();
  
  if (!auctionEvent) {
    const { data: newEvent, error: eError } = await supabase
      .from('auction_events')
      .insert({
        vehicle_id: vehicleId,
        source: 'bat',
        source_url: batUrl,
        outcome: 'sold',
      })
      .select('id')
      .single();
    
    if (eError) {
      console.error(`  ❌ Failed to create auction_event: ${eError.message}`);
      return { success: false, error: eError.message };
    }
    auctionEvent = newEvent;
    console.log(`  ✅ Created auction_event: ${auctionEvent.id}`);
  } else {
    console.log(`  ✅ Found auction_event: ${auctionEvent.id}`);
  }
  
  const eventId = auctionEvent.id;
  
  // Get comments without content_hash or auction_event_id
  const { data: brokenComments, error: cError } = await supabase
    .from('auction_comments')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .or('content_hash.is.null,auction_event_id.is.null');
  
  if (cError) {
    console.error(`  ❌ Failed to fetch comments: ${cError.message}`);
    return { success: false, error: cError.message };
  }
  
  if (!brokenComments || brokenComments.length === 0) {
    console.log(`  ✅ No broken comments to repair`);
    
    // Still update comment count
    const { count: actualCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    
    await supabase
      .from('vehicles')
      .update({ bat_comments: actualCount || 0 })
      .eq('id', vehicleId);
    
    return { success: true, repaired: 0, total_comments: actualCount || 0 };
  }
  
  console.log(`  📝 Found ${brokenComments.length} broken comments to repair`);
  
  // Repair each comment
  let repaired = 0;
  let errors = 0;
  
  for (const comment of brokenComments) {
    try {
      // Generate content_hash if missing
      let contentHash = comment.content_hash;
      if (!contentHash) {
        contentHash = await sha256Hex([
          'bat',
          batUrl,
          String(comment.sequence_number || 0),
          comment.posted_at || '',
          comment.author_username || '',
          comment.comment_text || '',
        ].join('|'));
      }
      
      // Update comment with content_hash and auction_event_id
      const { error: updateError } = await supabase
        .from('auction_comments')
        .update({
          content_hash: contentHash,
          auction_event_id: eventId,
        })
        .eq('id', comment.id);
      
      if (updateError) {
        console.error(`  ⚠️  Failed to repair comment ${comment.id}: ${updateError.message}`);
        errors++;
      } else {
        repaired++;
      }
    } catch (e) {
      console.error(`  ⚠️  Error repairing comment ${comment.id}:`, e.message);
      errors++;
    }
  }
  
  // Update comment count on vehicle
  const { count: actualCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);
  
  await supabase
    .from('vehicles')
    .update({ bat_comments: actualCount || 0 })
    .eq('id', vehicleId);
  
  console.log(`  ✅ Repaired ${repaired}/${brokenComments.length} comments, ${errors} errors`);
  console.log(`  ✅ Updated comment count: ${actualCount || 0}`);
  
  return { success: true, repaired, errors, total_comments: actualCount || 0 };
}

async function main() {
  const vehicleId = process.argv[2];
  const batchSize = parseInt(process.argv[3] || '10');
  
  if (vehicleId) {
    // Fix single vehicle
    await fixVehicleComments(vehicleId);
  } else {
    // Fix batch of vehicles with broken comments
    console.log(`🔍 Finding vehicles with broken comments...`);
    
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id')
      .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%')
      .limit(batchSize);
    
    if (error) {
      console.error('❌ Failed to fetch vehicles:', error);
      process.exit(1);
    }
    
    console.log(`📦 Processing ${vehicles?.length || 0} vehicles\n`);
    
    const results = {
      total: vehicles?.length || 0,
      succeeded: 0,
      failed: 0,
      totalRepaired: 0,
    };
    
    for (const vehicle of vehicles || []) {
      const result = await fixVehicleComments(vehicle.id);
      if (result.success) {
        results.succeeded++;
        results.totalRepaired += result.repaired || 0;
      } else {
        results.failed++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\n✅ Batch complete!`);
    console.log(`   Total: ${results.total}`);
    console.log(`   Succeeded: ${results.succeeded}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Comments repaired: ${results.totalRepaired}`);
  }
}

main().catch(console.error);


