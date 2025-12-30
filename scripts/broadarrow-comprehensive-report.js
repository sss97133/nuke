#!/usr/bin/env node
/**
 * Comprehensive Broad Arrow Auctions Report
 * - Full inventory from database
 * - Upcoming auctions
 * - All contributors/contacts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getBroadArrowOrg() {
  // Try to find Broad Arrow Auctions (not Private Sales)
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, website, type, description')
    .ilike('business_name', '%Broad Arrow%');
  
  if (error) {
    console.error('Error fetching Broad Arrow org:', error);
    return null;
  }
  
  if (!orgs || orgs.length === 0) {
    return null;
  }
  
  // Prefer "Broad Arrow Auctions" over "Broad Arrow Private Sales"
  const auctionsOrg = orgs.find(o => o.business_name.toLowerCase().includes('auction'));
  return auctionsOrg || orgs[0];
}

async function getFullInventory(orgId) {
  console.log('\n📦 Fetching Full Inventory...');
  
  const inventory = {
    total: 0,
    vehicles: [],
    byStatus: {},
    byAuction: {},
    priceStats: {},
  };
  
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        vin,
        platform_url,
        origin_metadata,
        created_at
      `)
      .eq('origin_organization_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    
    if (error) {
      console.error(`Error fetching batch (offset ${offset}):`, error);
      break;
    }
    
    if (!vehicles || vehicles.length === 0) {
      hasMore = false;
      break;
    }
    
    for (const vehicle of vehicles) {
      inventory.total++;
      
      const listingStatus = vehicle.origin_metadata?.listing_status || 'unknown';
      inventory.byStatus[listingStatus] = (inventory.byStatus[listingStatus] || 0) + 1;
      
      const auctionId = vehicle.origin_metadata?.auction_id;
      if (auctionId) {
        inventory.byAuction[auctionId] = (inventory.byAuction[auctionId] || 0) + 1;
      }
      
      inventory.vehicles.push({
        id: vehicle.id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin,
        url: vehicle.platform_url,
        status: listingStatus,
        auctionId: auctionId,
        salePrice: vehicle.origin_metadata?.sale_price,
        saleDate: vehicle.origin_metadata?.sale_date,
      });
    }
    
    console.log(`  📊 Processed ${inventory.total} vehicles...`);
    
    if (vehicles.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
    }
  }
  
  // Calculate price stats
  const prices = inventory.vehicles
    .map(v => v.salePrice)
    .filter(p => p && typeof p === 'number' && p > 0);
  
  if (prices.length > 0) {
    prices.sort((a, b) => a - b);
    inventory.priceStats = {
      count: prices.length,
      min: prices[0],
      max: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
      average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    };
  }
  
  return inventory;
}

async function getUpcomingAuctions(orgId) {
  console.log('\n📅 Analyzing Upcoming Auctions...');
  
  // Check external_listings for upcoming auctions (using correct column names)
  const { data: listings, error } = await supabase
    .from('external_listings')
    .select(`
      id,
      vehicle_id,
      platform,
      listing_url,
      listing_status,
      start_date,
      end_date,
      current_bid,
      reserve_price,
      final_price,
      vehicles!inner(origin_organization_id)
    `)
    .eq('vehicles.origin_organization_id', orgId)
    .eq('platform', 'broadarrow')
    .in('listing_status', ['pending', 'active'])
    .order('start_date', { ascending: true });
  
  if (error) {
    console.warn(`  ⚠️  Error fetching upcoming auctions: ${error.message}`);
    return [];
  }
  
  // Also check vehicles directly for auction info in origin_metadata
  const now = new Date();
  const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now
  
  const { data: vehicleAuctions, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, origin_metadata, platform_url')
    .eq('origin_organization_id', orgId)
    .not('origin_metadata->auction_end_date', 'is', null);
  
  // Group by auction event (from end_date or start_date)
  const auctions = new Map();
  
  // Process external_listings
  for (const listing of listings || []) {
    const auctionDate = listing.end_date 
      ? new Date(listing.end_date).toISOString().split('T')[0]
      : (listing.start_date ? new Date(listing.start_date).toISOString().split('T')[0] : 'unknown');
    
    if (!auctions.has(auctionDate)) {
      auctions.set(auctionDate, {
        date: auctionDate,
        listings: [],
        totalLots: 0,
      });
    }
    
    const auction = auctions.get(auctionDate);
    auction.listings.push({
      url: listing.listing_url,
      status: listing.listing_status,
      currentBid: listing.current_bid,
      reservePrice: listing.reserve_price,
    });
    auction.totalLots++;
  }
  
  // Process vehicles with auction dates in metadata
  if (vehicleAuctions) {
    for (const vehicle of vehicleAuctions) {
      const endDate = vehicle.origin_metadata?.auction_end_date;
      if (endDate) {
        const auctionDate = new Date(endDate).toISOString().split('T')[0];
        const auctionDateObj = new Date(endDate);
        
        // Only include future auctions
        if (auctionDateObj > now) {
          if (!auctions.has(auctionDate)) {
            auctions.set(auctionDate, {
              date: auctionDate,
              listings: [],
              totalLots: 0,
            });
          }
          
          const auction = auctions.get(auctionDate);
          auction.listings.push({
            url: vehicle.platform_url,
            status: vehicle.origin_metadata?.listing_status || 'unknown',
            salePrice: vehicle.origin_metadata?.sale_price,
          });
          auction.totalLots++;
        }
      }
    }
  }
  
  return Array.from(auctions.values())
    .filter(a => a.totalLots > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getAllContributors(orgId) {
  console.log('\n👥 Extracting All Contributors...');
  
  const contributors = new Map();
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  let totalProcessed = 0;
  
  while (hasMore) {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, origin_metadata, platform_url')
      .eq('origin_organization_id', orgId)
      .range(offset, offset + BATCH_SIZE - 1);
    
    if (error) {
      console.error(`Error fetching batch: ${error.message}`);
      break;
    }
    
    if (!vehicles || vehicles.length === 0) {
      hasMore = false;
      break;
    }
    
    for (const vehicle of vehicles) {
      totalProcessed++;
      const contributor = vehicle.origin_metadata?.contributor;
      
      if (contributor && (contributor.name || contributor.email || contributor.phone)) {
        const key = contributor.email?.toLowerCase() || 
                   `${contributor.name?.toLowerCase().trim()}_${contributor.phone || 'unknown'}`;
        
        if (!contributors.has(key)) {
          contributors.set(key, {
            name: contributor.name,
            email: contributor.email,
            phone: contributor.phone,
            title: contributor.title,
            vehicleCount: 0,
            vehicleUrls: [],
          });
        }
        
        const cont = contributors.get(key);
        cont.vehicleCount++;
        if (vehicle.platform_url) {
          cont.vehicleUrls.push(vehicle.platform_url);
        }
      }
    }
    
    if (totalProcessed % 5000 === 0) {
      console.log(`  📊 Processed ${totalProcessed} vehicles, found ${contributors.size} unique contributors...`);
    }
    
    if (vehicles.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
    }
  }
  
  console.log(`  ✅ Found ${contributors.size} unique contributors from ${totalProcessed} vehicles`);
  
  return Array.from(contributors.values()).sort((a, b) => b.vehicleCount - a.vehicleCount);
}

async function generateReport() {
  console.log('🔍 Broad Arrow Auctions - Comprehensive Report\n');
  console.log('='.repeat(60));
  
  // Get organization
  const org = await getBroadArrowOrg();
  if (!org) {
    console.error('❌ Broad Arrow organization not found in database');
    process.exit(1);
  }
  
  console.log(`\n🏢 Organization: ${org.business_name}`);
  console.log(`   ID: ${org.id}`);
  console.log(`   Website: ${org.website || 'N/A'}`);
  console.log(`   Type: ${org.type || 'N/A'}`);
  
  // Get full inventory - try all Broad Arrow orgs if this one has no vehicles
  let inventory = await getFullInventory(org.id);
  
  // If no vehicles found, try the other Broad Arrow org
  if (inventory.total === 0) {
    const { data: allOrgs } = await supabase
      .from('businesses')
      .select('id, business_name')
      .ilike('business_name', '%Broad Arrow%');
    
    if (allOrgs && allOrgs.length > 1) {
      const otherOrg = allOrgs.find(o => o.id !== org.id);
      if (otherOrg) {
        console.log(`\n⚠️  No vehicles found for ${org.business_name}, trying ${otherOrg.business_name}...`);
        org = { ...org, ...otherOrg };
        inventory = await getFullInventory(org.id);
      }
    }
  }
  
  console.log(`\n📦 Inventory Summary:`);
  console.log(`   Total Vehicles: ${inventory.total}`);
  console.log(`   Status Breakdown:`);
  for (const [status, count] of Object.entries(inventory.byStatus)) {
    console.log(`     ${status}: ${count}`);
  }
  
  if (Object.keys(inventory.priceStats).length > 0) {
    console.log(`\n💰 Price Statistics (sold vehicles):`);
    console.log(`     Count: ${inventory.priceStats.count}`);
    console.log(`     Average: $${inventory.priceStats.average?.toLocaleString()}`);
    console.log(`     Median: $${inventory.priceStats.median?.toLocaleString()}`);
    console.log(`     Range: $${inventory.priceStats.min?.toLocaleString()} - $${inventory.priceStats.max?.toLocaleString()}`);
  }
  
  // Get upcoming auctions
  const upcomingAuctions = await getUpcomingAuctions(org.id);
  
  console.log(`\n📅 Upcoming Auctions: ${upcomingAuctions.length}`);
  for (const auction of upcomingAuctions) {
    console.log(`\n   Auction Date: ${auction.date}`);
    console.log(`   Total Lots: ${auction.totalLots}`);
    if (auction.estimateRange.low && auction.estimateRange.high) {
      console.log(`   Estimate Range: $${(auction.estimateRange.low / 100).toLocaleString()} - $${(auction.estimateRange.high / 100).toLocaleString()}`);
    }
  }
  
  // Get all contributors
  const contributors = await getAllContributors(org.id);
  
  console.log(`\n👥 Contributors: ${contributors.length}`);
  console.log(`\n   Top Contributors by Vehicle Count:`);
  contributors.slice(0, 20).forEach((cont, idx) => {
    console.log(`\n   ${idx + 1}. ${cont.name || 'Unknown'}`);
    if (cont.title) console.log(`      Title: ${cont.title}`);
    if (cont.email) console.log(`      Email: ${cont.email}`);
    if (cont.phone) console.log(`      Phone: ${cont.phone}`);
    console.log(`      Vehicles: ${cont.vehicleCount}`);
  });
  
  if (contributors.length > 20) {
    console.log(`\n   ... and ${contributors.length - 20} more contributors`);
  }
  
  // Export to JSON
  const report = {
    organization: org,
    generatedAt: new Date().toISOString(),
    inventory,
    upcomingAuctions,
    contributors,
  };
  
  const outputDir = path.join(__dirname, '../data/broadarrow-reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const jsonPath = path.join(outputDir, `report-${timestamp}.json`);
  const latestPath = path.join(outputDir, 'report-latest.json');
  
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  
  console.log(`\n💾 Report exported to:`);
  console.log(`   ${jsonPath}`);
  console.log(`   ${latestPath}`);
  
  // Export contributors CSV
  const csvRows = ['Name,Title,Email,Phone,Vehicle Count'];
  for (const cont of contributors) {
    csvRows.push([
      `"${(cont.name || '').replace(/"/g, '""')}"`,
      `"${(cont.title || '').replace(/"/g, '""')}"`,
      `"${(cont.email || '').replace(/"/g, '""')}"`,
      `"${(cont.phone || '').replace(/"/g, '""')}"`,
      cont.vehicleCount,
    ].join(','));
  }
  
  const csvPath = path.join(outputDir, `contributors-${timestamp}.csv`);
  const latestCsvPath = path.join(outputDir, 'contributors-latest.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  fs.writeFileSync(latestCsvPath, csvRows.join('\n'));
  
  console.log(`\n💾 Contributors CSV exported to:`);
  console.log(`   ${csvPath}`);
  console.log(`   ${latestCsvPath}`);
  
  return report;
}

generateReport().catch(console.error);

