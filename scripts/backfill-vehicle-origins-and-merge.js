#!/usr/bin/env node

/**
 * BACKFILL VEHICLE ORIGINS AND MERGE DUPLICATES
 * 
 * 1. Finds vehicles with poor origin tracking (manual_entry, null uploaded_by, empty metadata)
 * 2. Attempts to match them to BAT listings by year/make/model
 * 3. Updates origin data when matches found
 * 4. Detects and merges duplicate vehicles
 * 
 * This is core backend logic to prevent duplicate issues
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Try multiple env file locations
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local' });
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found in environment variables');
  console.error('   Please set VITE_SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

console.log('🔍 BACKFILLING VEHICLE ORIGINS AND MERGING DUPLICATES...\n');

// Step 1: Find vehicles with poor origin tracking
async function findVehiclesNeedingBackfill() {
  console.log('📋 Finding vehicles with poor origin tracking...');
  
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, profile_origin, discovery_source, discovery_url, bat_auction_url, origin_metadata, uploaded_by, user_id, created_at')
    .or('profile_origin.eq.manual_entry,profile_origin.is.null')
    .or('uploaded_by.is.null,origin_metadata.eq.{}')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  
  // Filter to those with truly poor tracking
  const poorTracking = (data || []).filter(v => 
    (!v.uploaded_by && !v.user_id) || 
    (!v.origin_metadata || Object.keys(v.origin_metadata).length === 0) ||
    (v.profile_origin === 'manual_entry' && !v.discovery_url && !v.bat_auction_url)
  );

  console.log(`   Found ${poorTracking.length} vehicles needing backfill\n`);
  return poorTracking;
}

// Step 2: Get all BAT listings to match against
async function getAllBATListings() {
  console.log('📋 Loading BAT listings for matching...');
  
  // Get vehicles with BAT URLs
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url, discovery_url, origin_metadata, bat_seller, bat_listing_title')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer%')
    .limit(2000);

  if (error) throw error;
  
  // Also check organization_vehicles for BAT-linked vehicles
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select(`
      vehicle_id,
      vehicles!inner(
        id, year, make, model, vin, bat_auction_url, discovery_url, origin_metadata, bat_seller
      )
    `)
    .eq('organization_id', VIVA_ORG_ID)
    .limit(1000);

  // Combine and deduplicate
  const allBATVehicles = new Map();
  
  (data || []).forEach(v => {
    if (v.year && v.make && v.model) {
      allBATVehicles.set(v.id, v);
    }
  });

  (orgVehicles || []).forEach(ov => {
    if (ov.vehicles && ov.vehicles.year && ov.vehicles.make && ov.vehicles.model) {
      allBATVehicles.set(ov.vehicles.id, ov.vehicles);
    }
  });

  // Build a lookup map by year/make/model
  const batMap = new Map();
  allBATVehicles.forEach(v => {
    if (v.year && v.make && v.model) {
      // Normalize model (remove common suffixes)
      const normalizedModel = v.model.toLowerCase()
        .replace(/\s+(pickup|truck|wagon|sedan|coupe|convertible)$/i, '')
        .trim();
      
      const key = `${v.year}|${v.make.toLowerCase()}|${normalizedModel}`;
      if (!batMap.has(key)) {
        batMap.set(key, []);
      }
      batMap.get(key).push(v);
    }
  });

  console.log(`   Loaded ${batMap.size} unique BAT vehicle patterns from ${allBATVehicles.size} vehicles\n`);
  return batMap;
}

// Step 3: Match vehicles to BAT listings
async function matchToBAT(vehicle, batMap) {
  if (!vehicle.year || !vehicle.make || !vehicle.model) return null;

  // Normalize model name
  const normalizedModel = vehicle.model.toLowerCase()
    .replace(/\s+(pickup|truck|wagon|sedan|coupe|convertible|k10|k20|k30|c10|c20|c30)$/i, '')
    .trim();

  const key = `${vehicle.year}|${vehicle.make.toLowerCase()}|${normalizedModel}`;
  let matches = batMap.get(key);

  // Try exact match first
  if (!matches || matches.length === 0) {
    // Try with full model name
    const fullKey = `${vehicle.year}|${vehicle.make.toLowerCase()}|${vehicle.model.toLowerCase()}`;
    matches = batMap.get(fullKey);
  }

  // Try fuzzy matching (partial model match)
  if (!matches || matches.length === 0) {
    for (const [batKey, batVehicles] of batMap.entries()) {
      const [batYear, batMake, batModel] = batKey.split('|');
      if (batYear === vehicle.year.toString() &&
          batMake === vehicle.make.toLowerCase()) {
        // Check if models are similar
        const vehicleModelLower = normalizedModel;
        const batModelLower = batModel.toLowerCase();
        
        // Check for substring match or common abbreviations
        if (vehicleModelLower.includes(batModelLower) || 
            batModelLower.includes(vehicleModelLower) ||
            areModelsSimilar(vehicleModelLower, batModelLower)) {
          matches = batVehicles;
          break;
        }
      }
    }
  }

  if (!matches || matches.length === 0) return null;

  // Return the best match (prefer one with more complete data and Viva seller)
  return matches.sort((a, b) => {
    const aScore = getVehicleCompletenessScore(a) + (a.bat_seller?.toLowerCase().includes('viva') ? 20 : 0);
    const bScore = getVehicleCompletenessScore(b) + (b.bat_seller?.toLowerCase().includes('viva') ? 20 : 0);
    return bScore - aScore;
  })[0];
}

function areModelsSimilar(model1, model2) {
  // Common model name variations
  const variations = {
    'suburban': ['sub', 'suburban'],
    'blazer': ['blazer', 'k5'],
    'silverado': ['silverado', 'silver'],
    'sierra': ['sierra'],
    'pickup': ['pickup', 'truck', 'p/u'],
    'cheyenne': ['cheyenne', 'chey'],
    'scottsdale': ['scottsdale', 'scot']
  };

  for (const [base, variants] of Object.entries(variations)) {
    const model1Has = variants.some(v => model1.includes(v));
    const model2Has = variants.some(v => model2.includes(v));
    if (model1Has && model2Has) return true;
  }

  return false;
}

// Step 4: Find duplicates for a vehicle
async function findDuplicates(vehicle) {
  const duplicates = [];

  // Exact year/make/model match
  const { data: exactMatches } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, profile_origin, bat_auction_url, origin_metadata, uploaded_by')
    .eq('year', vehicle.year)
    .ilike('make', vehicle.make)
    .ilike('model', vehicle.model)
    .neq('id', vehicle.id);

  if (exactMatches) {
    exactMatches.forEach(match => {
      // Skip if both have real VINs and they're different
      if (vehicle.vin && match.vin && 
          vehicle.vin.length >= 11 && match.vin.length >= 11 &&
          !vehicle.vin.startsWith('VIVA-') && !match.vin.startsWith('VIVA-') &&
          vehicle.vin !== match.vin) {
        return; // Different vehicles
      }

      // Determine which is better (more complete)
      const vehicleScore = getVehicleCompletenessScore(vehicle);
      const matchScore = getVehicleCompletenessScore(match);

      duplicates.push({
        ...match,
        shouldMerge: matchScore < vehicleScore, // Merge match into vehicle if vehicle is better
        confidence: 85
      });
    });
  }

  return duplicates.sort((a, b) => b.confidence - a.confidence);
}

function getVehicleCompletenessScore(vehicle) {
  let score = 0;
  if (vehicle.vin && vehicle.vin.length >= 11 && !vehicle.vin.startsWith('VIVA-')) score += 50;
  if (vehicle.bat_auction_url) score += 30;
  if (vehicle.origin_metadata && Object.keys(vehicle.origin_metadata).length > 0) score += 20;
  if (vehicle.uploaded_by) score += 10;
  if (vehicle.profile_origin && vehicle.profile_origin !== 'manual_entry') score += 10;
  return score;
}

// Step 5: Merge vehicles using RPC to avoid trigger issues
async function mergeVehicles(keepId, mergeId) {
  console.log(`   🔀 Merging ${mergeId} into ${keepId}...`);

  try {
    // Use RPC function if available, otherwise do manual merge
    const { data: rpcResult, error: rpcError } = await supabase.rpc('merge_vehicles', {
      keep_vehicle_id: keepId,
      merge_vehicle_id: mergeId
    });

    if (!rpcError && rpcResult) {
      console.log(`   ✅ Merged successfully via RPC`);
      return true;
    }

    // Fallback: Manual merge using direct SQL approach
    // First, move all related data
    const moveResults = await Promise.all([
      supabase.from('vehicle_images')
        .update({ vehicle_id: keepId })
        .eq('vehicle_id', mergeId),
      supabase.from('timeline_events')
        .update({ vehicle_id: keepId })
        .eq('vehicle_id', mergeId)
    ]);

    // Handle organization_vehicles separately
    const { data: orgLinks } = await supabase
      .from('organization_vehicles')
      .select('organization_id, relationship_type, status, start_date, end_date')
      .eq('vehicle_id', mergeId);
    
    if (orgLinks && orgLinks.length > 0) {
      for (const link of orgLinks) {
        const { data: existing } = await supabase
          .from('organization_vehicles')
          .select('id')
          .eq('vehicle_id', keepId)
          .eq('organization_id', link.organization_id)
          .single();
        
        if (!existing) {
          await supabase
            .from('organization_vehicles')
            .insert({
              vehicle_id: keepId,
              organization_id: link.organization_id,
              relationship_type: link.relationship_type,
              status: link.status || 'active',
              start_date: link.start_date,
              end_date: link.end_date
            });
        }
        
        await supabase
          .from('organization_vehicles')
          .delete()
          .eq('vehicle_id', mergeId)
          .eq('organization_id', link.organization_id);
      }
    }

    // Get merge vehicle data before deleting
    const { data: mergeVehicle } = await supabase
      .from('vehicles')
      .select('vin, bat_auction_url, discovery_url, profile_origin, uploaded_by, origin_metadata, origin_organization_id')
      .eq('id', mergeId)
      .single();

    if (mergeVehicle) {
      // Update keep vehicle with merged data (skip origin_organization_id to avoid trigger issues)
      const updates = {
        vin: mergeVehicle.vin || undefined,
        bat_auction_url: mergeVehicle.bat_auction_url || undefined,
        discovery_url: mergeVehicle.discovery_url || undefined,
        profile_origin: mergeVehicle.profile_origin !== 'manual_entry' ? mergeVehicle.profile_origin : undefined,
        uploaded_by: mergeVehicle.uploaded_by || undefined
      };

      // Remove undefined values
      Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', keepId);
      }

      // Update origin_metadata separately
      const { data: keepVehicle } = await supabase
        .from('vehicles')
        .select('origin_metadata')
        .eq('id', keepId)
        .single();

      if (keepVehicle) {
        const mergedMetadata = {
          ...(mergeVehicle.origin_metadata || {}),
          ...(keepVehicle.origin_metadata || {}),
          merged_from: mergeId,
          merged_at: new Date().toISOString()
        };

        await supabase
          .from('vehicles')
          .update({ origin_metadata: mergedMetadata })
          .eq('id', keepId);
      }
    }

    // Delete the merged vehicle
    const { error: deleteError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', mergeId);

    if (deleteError) {
      console.log(`   ⚠️  Warning: Could not delete merged vehicle: ${deleteError.message}`);
      return false;
    }

    console.log(`   ✅ Merged successfully`);
    return true;
  } catch (error) {
    console.log(`   ❌ Merge failed: ${error.message}`);
    return false;
  }
}

// Step 6: Update vehicle origin
async function updateVehicleOrigin(vehicleId, batMatch) {
  const updates = {
    profile_origin: 'bat_import',
    bat_auction_url: batMatch.bat_auction_url || batMatch.discovery_url,
    discovery_url: batMatch.discovery_url || batMatch.bat_auction_url,
    uploaded_by: VIVA_USER_ID,
    origin_metadata: {
      ...(batMatch.origin_metadata || {}),
      backfilled: true,
      backfilled_at: new Date().toISOString(),
      matched_from: batMatch.id,
      import_source: 'bat_import_backfill'
    }
  };

  const { error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId);

  if (error) {
    console.log(`   ❌ Error updating origin: ${error.message}`);
    return false;
  }

  return true;
}

// Main execution
async function main() {
  try {
    // Step 1: Find vehicles needing backfill
    const vehiclesToFix = await findVehiclesNeedingBackfill();
    
    if (vehiclesToFix.length === 0) {
      console.log('✅ No vehicles need backfilling!');
      return;
    }

    // Step 2: Load BAT listings
    const batMap = await getAllBATListings();

    let matched = 0;
    let merged = 0;
    let updated = 0;
    let skipped = 0;

    // Step 3: Process each vehicle
    for (const vehicle of vehiclesToFix) {
      console.log(`\n🔍 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id.substring(0, 8)}...)`);

      // Try to match to BAT
      const batMatch = await matchToBAT(vehicle, batMap);
      
      if (batMatch) {
        console.log(`   ✅ Matched to BAT: ${batMatch.bat_auction_url}`);
        matched++;

        // Check if this is actually a duplicate
        if (batMatch.id !== vehicle.id) {
          const vehicleScore = getVehicleCompletenessScore(vehicle);
          const batScore = getVehicleCompletenessScore(batMatch);

          if (batScore > vehicleScore) {
            // BAT vehicle is better - merge current into BAT
            console.log(`   🔀 BAT vehicle is better, merging...`);
            const mergeSuccess = await mergeVehicles(batMatch.id, vehicle.id);
            if (mergeSuccess) {
              merged++;
              continue;
            }
          } else {
            // Current vehicle is better - update it with BAT data
            console.log(`   📝 Updating vehicle with BAT data...`);
            const updateSuccess = await updateVehicleOrigin(vehicle.id, batMatch);
            if (updateSuccess) {
              updated++;
              continue;
            }
          }
        } else {
          // Same vehicle, just update origin
          const updateSuccess = await updateVehicleOrigin(vehicle.id, batMatch);
          if (updateSuccess) {
            updated++;
            continue;
          }
        }
      }

      // Step 4: Check for other duplicates
      const duplicates = await findDuplicates(vehicle);
      
      if (duplicates.length > 0) {
        console.log(`   🔍 Found ${duplicates.length} potential duplicate(s)`);
        
        for (const dup of duplicates) {
          if (dup.shouldMerge) {
            console.log(`   🔀 Merging duplicate: ${dup.year} ${dup.make} ${dup.model}`);
            const success = await mergeVehicles(vehicle.id, dup.id);
            if (success) {
              merged++;
              break; // Only merge one at a time
            }
          }
        }
      }

      // Step 5: Mark as batch import if no match found
      if (!batMatch && duplicates.length === 0) {
        // Check if this was part of a batch (created around same time as others)
        const batchWindow = new Date(vehicle.created_at);
        batchWindow.setMinutes(batchWindow.getMinutes() - 5);
        const batchWindowEnd = new Date(vehicle.created_at);
        batchWindowEnd.setMinutes(batchWindowEnd.getMinutes() + 5);

        const { data: batchVehicles } = await supabase
          .from('vehicles')
          .select('id')
          .gte('created_at', batchWindow.toISOString())
          .lte('created_at', batchWindowEnd.toISOString())
          .neq('id', vehicle.id);

        const batchSize = (batchVehicles?.length || 0) + 1;

        const { error } = await supabase
          .from('vehicles')
          .update({
            profile_origin: batchSize >= 5 ? 'bulk_import_legacy' : 'manual_entry',
            origin_metadata: {
              backfilled: true,
              backfilled_at: new Date().toISOString(),
              inferred_automation: batchSize >= 5,
              batch_import: batchSize >= 5,
              batch_size: batchSize >= 5 ? batchSize : undefined
            }
          })
          .eq('id', vehicle.id);

        if (!error) {
          console.log(`   📝 Marked as ${batchSize >= 5 ? 'bulk_import_legacy' : 'manual_entry'}${batchSize >= 5 ? ` (batch of ${batchSize})` : ''}`);
          updated++;
        }
      } else {
        skipped++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 BACKFILL SUMMARY:');
    console.log(`   Vehicles processed: ${vehiclesToFix.length}`);
    console.log(`   Matched to BAT: ${matched}`);
    console.log(`   Merged duplicates: ${merged}`);
    console.log(`   Updated origin: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

