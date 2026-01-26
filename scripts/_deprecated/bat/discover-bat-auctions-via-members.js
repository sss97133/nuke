#!/usr/bin/env node

/**
 * Discover BaT Auction URLs via Member Profiles
 * 
 * Extracts member profiles to discover auction URLs where members commented,
 * then queues those auctions for full extraction.
 * 
 * Usage:
 *   node scripts/discover-bat-auctions-via-members.js [username1] [username2] ...
 *   
 * Or extract top members by comment count:
 *   node scripts/discover-bat-auctions-via-members.js --top 20
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_URL=') && !SUPABASE_URL) {
      SUPABASE_URL = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
    if ((line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) && !SUPABASE_SERVICE_KEY) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL not found. Set SUPABASE_URL in environment or nuke_frontend/.env.local');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found. Set SUPABASE_SERVICE_ROLE_KEY in environment or nuke_frontend/.env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function extractMemberProfile(username) {
  console.log(`\n🔍 Extracting member profile: ${username}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('extract-bat-member-comments', {
      body: { member_username: username, max_comments: 100 }
    });

    if (error) {
      console.error(`❌ Error extracting ${username}:`, error.message);
      return { username, success: false, error: error.message };
    }

    const result = data;
    if (!result.success) {
      console.error(`❌ Failed to extract ${username}:`, result.error);
      return { username, success: false, error: result.error };
    }

    console.log(`   ✅ Stats: ${result.total_comments} comments, ${result.total_listings} listings`);
    console.log(`   ✅ Chain reaction: ${result.chain_reaction?.vehicles_queued || 0} vehicles queued, ${result.chain_reaction?.new_auctions_discovered || 0} new auctions`);
    
    return {
      username,
      success: true,
      total_comments: result.total_comments,
      vehicles_queued: result.chain_reaction?.vehicles_queued || 0,
      new_auctions: result.chain_reaction?.new_auctions_discovered || 0,
      auction_urls: result.chain_reaction?.auction_urls || []
    };
  } catch (e) {
    console.error(`❌ Exception extracting ${username}:`, e.message);
    return { username, success: false, error: e.message };
  }
}

async function queueNewAuctionsForDiscovery(auctionUrls) {
  console.log(`\n📥 Queuing ${auctionUrls.length} new auction URLs for discovery...`);
  
  let queued = 0;
  let errors = 0;

  for (const url of auctionUrls) {
    try {
      // Check if vehicle already exists
      const { data: existingByBat } = await supabase
        .from('vehicles')
        .select('id, bat_auction_url, discovery_url')
        .eq('bat_auction_url', url)
        .maybeSingle();
      
      const { data: existingByDiscovery } = !existingByBat
        ? await supabase
            .from('vehicles')
            .select('id, bat_auction_url, discovery_url')
            .eq('discovery_url', url)
            .maybeSingle()
        : { data: null };
      
      const existing = existingByBat || existingByDiscovery;

      if (existing) {
        // Vehicle exists - queue for extraction
        const { error: queueError } = await supabase
          .from('bat_extraction_queue')
          .upsert({
            vehicle_id: existing.id,
            bat_url: url,
            status: 'pending',
            priority: 50,
            attempts: 0
          }, {
            onConflict: 'vehicle_id',
            ignoreDuplicates: false
          });

        if (!queueError) {
          queued++;
        } else if (!queueError.message.includes('duplicate')) {
          console.warn(`   ⚠️  Failed to queue ${url}: ${queueError.message}`);
          errors++;
        }
      } else {
        // New auction - call extract-premium-auction to create vehicle
        console.log(`   🆕 Extracting new auction: ${url}`);
        const { data: extractResult, error: extractError } = await supabase.functions.invoke(
          'extract-premium-auction',
          {
            body: { url, max_vehicles: 1 }
          }
        );

        if (extractError) {
          console.warn(`   ⚠️  Extract function error for ${url}: ${extractError.message}`);
          errors++;
          continue;
        }

        if (!extractResult || !extractResult.success) {
          console.warn(`   ⚠️  Extract failed for ${url}: ${extractResult?.error || 'Unknown error'}`);
          errors++;
          continue;
        }

        // Check for vehicle_id in various places (function might return it differently)
        const vehicleId = extractResult.vehicle_id || 
                         extractResult.vehicles?.[0]?.id || 
                         extractResult.data?.vehicle_id ||
                         extractResult.data?.vehicles?.[0]?.id;

        if (vehicleId) {
          // Queue the newly created vehicle for full extraction
          const { error: queueError } = await supabase
            .from('bat_extraction_queue')
            .upsert({
              vehicle_id: vehicleId,
              bat_url: url,
              status: 'pending',
              priority: 50,
              attempts: 0
            }, {
              onConflict: 'vehicle_id',
              ignoreDuplicates: false
            });

          if (!queueError) {
            queued++;
            console.log(`   ✅ Created and queued vehicle ${vehicleId}`);
          } else {
            console.warn(`   ⚠️  Failed to queue vehicle ${vehicleId}: ${queueError.message}`);
            errors++;
          }
        } else {
          // Try to find the vehicle that was just created by URL
          console.log(`   🔍 Vehicle ID not in response, searching by URL...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DB insert
          
          const { data: newVehicle } = await supabase
            .from('vehicles')
            .select('id')
            .eq('bat_auction_url', url)
            .maybeSingle();
          
          if (newVehicle?.id) {
            const { error: queueError } = await supabase
              .from('bat_extraction_queue')
              .upsert({
                vehicle_id: newVehicle.id,
                bat_url: url,
                status: 'pending',
                priority: 50,
                attempts: 0
              }, {
                onConflict: 'vehicle_id',
                ignoreDuplicates: false
              });

            if (!queueError) {
              queued++;
              console.log(`   ✅ Found and queued vehicle ${newVehicle.id}`);
            } else {
              errors++;
            }
          } else {
            console.warn(`   ⚠️  Could not find vehicle after extraction for ${url}`);
            errors++;
          }
        }
      }
    } catch (e) {
      console.warn(`   ⚠️  Error processing ${url}: ${e.message}`);
      errors++;
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`   ✅ Queued ${queued} auctions, ${errors} errors`);
  return { queued, errors };
}

async function getTopMembersByComments(limit = 20) {
  console.log(`\n📊 Fetching top ${limit} members by comment count...`);
  
  // Get members from bat_comments table
  const { data: topMembers, error } = await supabase
    .from('bat_comments')
    .select('bat_username')
    .not('bat_username', 'is', null)
    .group('bat_username')
    .order('count', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ Error fetching top members:', error);
    return [];
  }

  // Count comments per member
  const memberCounts = {};
  topMembers.forEach(m => {
    memberCounts[m.bat_username] = (memberCounts[m.bat_username] || 0) + 1;
  });

  const sorted = Object.entries(memberCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([username]) => username);

  console.log(`   ✅ Found ${sorted.length} top members`);
  return sorted;
}

async function main() {
  const args = process.argv.slice(2);
  
  let usernames = [];
  
  if (args.includes('--top')) {
    const topIndex = args.indexOf('--top');
    const limit = parseInt(args[topIndex + 1]) || 20;
    usernames = await getTopMembersByComments(limit);
  } else if (args.length > 0) {
    usernames = args;
  } else {
    console.log('Usage:');
    console.log('  node scripts/discover-bat-auctions-via-members.js [username1] [username2] ...');
    console.log('  node scripts/discover-bat-auctions-via-members.js --top 20');
    process.exit(1);
  }

  console.log(`\n🚀 Extracting ${usernames.length} member profiles...`);
  console.log(`   Members: ${usernames.slice(0, 5).join(', ')}${usernames.length > 5 ? '...' : ''}\n`);

  const results = [];
  const allNewAuctions = new Set();

  for (const username of usernames) {
    const result = await extractMemberProfile(username);
    results.push(result);

    if (result.success && result.auction_urls) {
      result.auction_urls.forEach(url => allNewAuctions.add(url));
    }

    // Delay between member extractions to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  
  const successful = results.filter(r => r.success);
  const totalVehiclesQueued = successful.reduce((sum, r) => sum + (r.vehicles_queued || 0), 0);
  const totalNewAuctions = successful.reduce((sum, r) => sum + (r.new_auctions || 0), 0);
  const totalComments = successful.reduce((sum, r) => sum + (r.total_comments || 0), 0);

  console.log(`✅ Successfully extracted: ${successful.length}/${usernames.length} members`);
  console.log(`📝 Total comments discovered: ${totalComments}`);
  console.log(`🚗 Vehicles queued for re-extraction: ${totalVehiclesQueued}`);
  console.log(`🆕 New auction URLs discovered: ${totalNewAuctions}`);
  console.log(`🔗 Unique new auction URLs: ${allNewAuctions.size}`);

  // Queue new auctions for discovery/extraction
  if (allNewAuctions.size > 0) {
    console.log(`\n📥 Queuing ${allNewAuctions.size} unique new auctions for discovery...`);
    const queueResult = await queueNewAuctionsForDiscovery(Array.from(allNewAuctions));
    console.log(`\n✅ Final results: ${queueResult.queued} auctions queued, ${queueResult.errors} errors`);
  }

  console.log('\n🎯 Done!');
}

main().catch(console.error);

