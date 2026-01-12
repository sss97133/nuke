#!/usr/bin/env node
/**
 * Comprehensive BaT Missing Data Audit
 * Identifies vehicles missing VINs, comments, bids, sale info, specs, etc.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Prefer local env files (kept out of git) but still allow shell env to override.
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('ERROR: Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const DEFAULT_CHUNK_SIZE = 250;
const DEFAULT_PAGE_SIZE = 1000;

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) return [items.slice()];
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function errorToMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function buildVehicleIdSet({
  table,
  vehicleIds,
  chunkSize = DEFAULT_CHUNK_SIZE,
  pageSize = DEFAULT_PAGE_SIZE,
  applyFilters,
}) {
  const result = new Set();
  for (const chunk of chunkArray(vehicleIds, chunkSize)) {
    let offset = 0;
    // Offset pagination is not ideal, but is reliable and simple for audits.
    // We order deterministically to avoid page drift.
    while (true) {
      let query = supabase.from(table).select('vehicle_id').in('vehicle_id', chunk);
      if (typeof applyFilters === 'function') query = applyFilters(query);
      query = query.order('vehicle_id', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1);

      const { data, error } = await query;
      if (error) throw new Error(`Supabase error while reading ${table}: ${errorToMessage(error)}`);

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        if (row?.vehicle_id) result.add(row.vehicle_id);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;

      // Safety valve: prevents accidental infinite loops if the backend behaves unexpectedly.
      if (offset > 5_000_000) {
        throw new Error(`Pagination safety limit exceeded for ${table} (offset=${offset})`);
      }
    }
  }
  return result;
}

async function buildVehicleIdCounts({
  table,
  vehicleIds,
  chunkSize = DEFAULT_CHUNK_SIZE,
  pageSize = DEFAULT_PAGE_SIZE,
  applyFilters,
}) {
  const counts = {};
  for (const chunk of chunkArray(vehicleIds, chunkSize)) {
    let offset = 0;
    while (true) {
      let query = supabase.from(table).select('vehicle_id').in('vehicle_id', chunk);
      if (typeof applyFilters === 'function') query = applyFilters(query);
      query = query.order('vehicle_id', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1);

      const { data, error } = await query;
      if (error) throw new Error(`Supabase error while reading ${table}: ${errorToMessage(error)}`);

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        if (!row?.vehicle_id) continue;
        counts[row.vehicle_id] = (counts[row.vehicle_id] || 0) + 1;
      }

      if (rows.length < pageSize) break;
      offset += pageSize;

      if (offset > 5_000_000) {
        throw new Error(`Pagination safety limit exceeded for ${table} (offset=${offset})`);
      }
    }
  }
  return counts;
}

async function auditMissingData() {
  console.log('Auditing BaT vehicles for missing data...\n');
  
  // Get all BaT vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, mileage, color, trim, transmission, engine_size, drivetrain, description, location, sale_price, auction_outcome')
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .limit(10000);
  
  if (vehiclesError) {
    throw new Error(`Error fetching vehicles: ${errorToMessage(vehiclesError)}`);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('No BaT vehicles found');
    return;
  }
  
  console.log(`Found ${vehicles.length} BaT vehicles to audit\n`);
  
  // Get counts for related data
  const vehicleIds = vehicles.map(v => v.id);
  
  // Check for auction events
  const vehiclesWithAuctionEvents = await buildVehicleIdSet({
    table: 'auction_events',
    vehicleIds,
    // In production, `auction_events` uses `source` (not `platform`)
    applyFilters: q => q.eq('source', 'bat'),
  });
  
  // Check for comments
  const commentCounts = await buildVehicleIdCounts({
    table: 'auction_comments',
    vehicleIds,
  });
  
  // Check for images
  const imageCounts = await buildVehicleIdCounts({
    table: 'vehicle_images',
    vehicleIds,
  });
  
  // Check for external listings
  const vehiclesWithExternalListings = await buildVehicleIdSet({
    table: 'external_listings',
    vehicleIds,
    applyFilters: q => q.eq('platform', 'bat'),
  });
  
  // Analyze missing data
  const stats = {
    total: vehicles.length,
    missing_vin: 0,
    missing_mileage: 0,
    missing_color: 0,
    missing_trim: 0,
    missing_transmission: 0,
    missing_engine_size: 0,
    missing_drivetrain: 0,
    missing_description: 0,
    missing_location: 0,
    missing_sale_info: 0,
    missing_auction_event: 0,
    missing_comments: 0,
    missing_images: 0,
    missing_external_listing: 0,
    vehicles_needing_fix: []
  };
  
  vehicles.forEach(vehicle => {
    const issues = [];
    let missingScore = 0;
    
    if (!vehicle.vin || vehicle.vin.trim() === '') {
      stats.missing_vin++;
      issues.push('VIN');
      missingScore += 2; // High priority
    }
    
    if (!vehicle.mileage) {
      stats.missing_mileage++;
      issues.push('mileage');
      missingScore += 1;
    }
    
    if (!vehicle.color || vehicle.color.trim() === '') {
      stats.missing_color++;
      issues.push('color');
      missingScore += 1;
    }
    
    if (!vehicle.trim || vehicle.trim.trim() === '') {
      stats.missing_trim++;
      issues.push('trim');
      missingScore += 1;
    }
    
    if (!vehicle.transmission || vehicle.transmission.trim() === '') {
      stats.missing_transmission++;
      issues.push('transmission');
      missingScore += 1;
    }
    
    if (!vehicle.engine_size || vehicle.engine_size.trim() === '') {
      stats.missing_engine_size++;
      issues.push('engine_size');
      missingScore += 1;
    }
    
    if (!vehicle.drivetrain || vehicle.drivetrain.trim() === '') {
      stats.missing_drivetrain++;
      issues.push('drivetrain');
      missingScore += 1;
    }
    
    if (!vehicle.description || vehicle.description.length < 100) {
      stats.missing_description++;
      issues.push('description');
      missingScore += 1;
    }
    
    if (!vehicle.location || vehicle.location.trim() === '') {
      stats.missing_location++;
      issues.push('location');
      missingScore += 1;
    }
    
    if (!vehicle.sale_price && (!vehicle.auction_outcome || vehicle.auction_outcome === 'unknown')) {
      stats.missing_sale_info++;
      issues.push('sale_info');
      missingScore += 1;
    }
    
    if (!vehiclesWithAuctionEvents.has(vehicle.id)) {
      stats.missing_auction_event++;
      issues.push('auction_event');
      missingScore += 2; // High priority - needed for comments
    }
    
    const commentCount = commentCounts[vehicle.id] || 0;
    if (commentCount === 0) {
      stats.missing_comments++;
      issues.push('comments');
      missingScore += 2; // High priority
    }
    
    const imageCount = imageCounts[vehicle.id] || 0;
    if (imageCount === 0) {
      stats.missing_images++;
      issues.push('images');
      missingScore += 3; // Very high priority
    } else if (imageCount < 10) {
      issues.push(`few_images(${imageCount})`);
      missingScore += 1;
    }
    
    if (!vehiclesWithExternalListings.has(vehicle.id)) {
      stats.missing_external_listing++;
      issues.push('external_listing');
      missingScore += 1;
    }
    
    if (issues.length > 0) {
      stats.vehicles_needing_fix.push({
        id: vehicle.id,
        vehicle: `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`,
        url: vehicle.discovery_url || vehicle.bat_auction_url || 'No URL',
        missing_score: missingScore,
        issues: issues,
        comment_count: commentCount,
        image_count: imageCount,
        has_auction_event: vehiclesWithAuctionEvents.has(vehicle.id)
      });
    }
  });
  
  // Sort by missing score (worst first)
  stats.vehicles_needing_fix.sort((a, b) => b.missing_score - a.missing_score);
  
  // Print summary
  console.log('='.repeat(80));
  console.log('MISSING DATA SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total BaT Vehicles: ${stats.total}`);
  console.log('');
  console.log('Missing Core Fields:');
  console.log(`  VIN:              ${stats.missing_vin.toString().padStart(4)} (${Math.round(stats.missing_vin * 100 / stats.total)}%)`);
  console.log(`  Mileage:          ${stats.missing_mileage.toString().padStart(4)} (${Math.round(stats.missing_mileage * 100 / stats.total)}%)`);
  console.log(`  Color:            ${stats.missing_color.toString().padStart(4)} (${Math.round(stats.missing_color * 100 / stats.total)}%)`);
  console.log(`  Location:         ${stats.missing_location.toString().padStart(4)} (${Math.round(stats.missing_location * 100 / stats.total)}%)`);
  console.log('');
  console.log('Missing Specs:');
  console.log(`  Trim:             ${stats.missing_trim.toString().padStart(4)} (${Math.round(stats.missing_trim * 100 / stats.total)}%)`);
  console.log(`  Transmission:     ${stats.missing_transmission.toString().padStart(4)} (${Math.round(stats.missing_transmission * 100 / stats.total)}%)`);
  console.log(`  Engine Size:      ${stats.missing_engine_size.toString().padStart(4)} (${Math.round(stats.missing_engine_size * 100 / stats.total)}%)`);
  console.log(`  Drivetrain:       ${stats.missing_drivetrain.toString().padStart(4)} (${Math.round(stats.missing_drivetrain * 100 / stats.total)}%)`);
  console.log('');
  console.log('Missing Content:');
  console.log(`  Description:      ${stats.missing_description.toString().padStart(4)} (${Math.round(stats.missing_description * 100 / stats.total)}%)`);
  console.log(`  Images:           ${stats.missing_images.toString().padStart(4)} (${Math.round(stats.missing_images * 100 / stats.total)}%)`);
  console.log(`  Comments:         ${stats.missing_comments.toString().padStart(4)} (${Math.round(stats.missing_comments * 100 / stats.total)}%)`);
  console.log('');
  console.log('Missing Auction Data:');
  console.log(`  Auction Event:    ${stats.missing_auction_event.toString().padStart(4)} (${Math.round(stats.missing_auction_event * 100 / stats.total)}%)`);
  console.log(`  Sale Info:        ${stats.missing_sale_info.toString().padStart(4)} (${Math.round(stats.missing_sale_info * 100 / stats.total)}%)`);
  console.log(`  External Listing: ${stats.missing_external_listing.toString().padStart(4)} (${Math.round(stats.missing_external_listing * 100 / stats.total)}%)`);
  console.log('');
  console.log('='.repeat(80));
  console.log(`Vehicles Needing Fix: ${stats.vehicles_needing_fix.length} (${Math.round(stats.vehicles_needing_fix.length * 100 / stats.total)}%)`);
  console.log('='.repeat(80));
  
  if (stats.vehicles_needing_fix.length > 0) {
    console.log('\nTop 20 Vehicles Needing Most Attention:');
    console.log('-'.repeat(80));
    stats.vehicles_needing_fix.slice(0, 20).forEach((v, idx) => {
      console.log(`${(idx + 1).toString().padStart(2)}. [Score: ${v.missing_score.toString().padStart(2)}] ${v.vehicle}`);
      console.log(`     URL: ${v.url.substring(0, 70)}...`);
      console.log(`     Missing: ${v.issues.join(', ')}`);
      if (v.comment_count > 0) console.log(`     Comments: ${v.comment_count}, Images: ${v.image_count}`);
      console.log('');
    });
  }
  
  // Breakdown by issue type
  console.log('='.repeat(80));
  console.log('BREAKDOWN BY PRIORITY');
  console.log('='.repeat(80));
  
  const byPriority = {
    critical: stats.vehicles_needing_fix.filter(v => v.missing_score >= 5),
    high: stats.vehicles_needing_fix.filter(v => v.missing_score >= 3 && v.missing_score < 5),
    medium: stats.vehicles_needing_fix.filter(v => v.missing_score >= 1 && v.missing_score < 3),
    low: stats.vehicles_needing_fix.filter(v => v.missing_score < 1)
  };
  
  console.log(`Critical (Score >=5): ${byPriority.critical.length} vehicles`);
  console.log(`High (Score 3-4):     ${byPriority.high.length} vehicles`);
  console.log(`Medium (Score 1-2):   ${byPriority.medium.length} vehicles`);
  console.log(`Low (Score <1):       ${byPriority.low.length} vehicles`);
  console.log('');
  
  // Save detailed report to file
  const report = {
    audit_date: new Date().toISOString(),
    audit_version: 2,
    generator: 'scripts/audit-bat-missing-data.js',
    summary: {
      total_vehicles: stats.total,
      vehicles_needing_fix: stats.vehicles_needing_fix.length,
      missing_fields: {
        vin: stats.missing_vin,
        mileage: stats.missing_mileage,
        color: stats.missing_color,
        trim: stats.missing_trim,
        transmission: stats.missing_transmission,
        engine_size: stats.missing_engine_size,
        drivetrain: stats.missing_drivetrain,
        description: stats.missing_description,
        location: stats.missing_location,
        sale_info: stats.missing_sale_info,
        auction_event: stats.missing_auction_event,
        comments: stats.missing_comments,
        images: stats.missing_images,
        external_listing: stats.missing_external_listing
      }
    },
    vehicles: stats.vehicles_needing_fix
  };
  
  const fs = await import('fs');
  fs.writeFileSync('bat-missing-data-audit.json', JSON.stringify(report, null, 2));
  console.log('Detailed report saved to: bat-missing-data-audit.json');
  
  return stats;
}

auditMissingData().catch(err => {
  console.error(`ERROR: ${errorToMessage(err)}`);
  process.exit(1);
});

