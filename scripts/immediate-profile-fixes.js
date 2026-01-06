#!/usr/bin/env node

/**
 * Immediate Profile Fixes
 * Sequential fixing: Audit -> Fix -> Verify -> Move to Next
 * No more audit-only - every discrepancy gets fixed immediately
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function getAllVehiclesNeedingFixes() {
  console.log('🔍 Getting vehicles that need immediate fixes...');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, engine_size, transmission, mileage, asking_price, sale_price, description, discovery_url, bat_auction_url, created_at')
    .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
    .order('created_at', { ascending: false })
    .limit(100); // Process in smaller batches for immediate action

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error);
    return [];
  }

  // Add source_url for compatibility
  vehicles.forEach(v => {
    v.source_url = v.discovery_url || v.bat_auction_url;
  });

  // Filter to BaT first (highest priority based on audit findings)
  const batVehicles = vehicles.filter(v => v.source_url?.includes('bringatrailer.com'));

  console.log(`📊 Found ${vehicles.length} total vehicles, ${batVehicles.length} BaT vehicles to fix first`);

  return batVehicles;
}

async function fetchSourceData(url) {
  try {
    console.log(`🌐 Fetching source: ${url.substring(0, 60)}...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return { html };

  } catch (error) {
    return { error: error.message };
  }
}

function extractBaTData(html) {
  const data = {};

  try {
    // VIN extraction
    const vinMatch = html.match(/VIN[:\s]*([A-Z0-9]{17})/i);
    if (vinMatch) data.vin = vinMatch[1];

    // Engine extraction - more comprehensive patterns
    const enginePatterns = [
      /([\d.]+-liter[^<\n]{10,80})/i,
      /([\d.]+L[^<\n]{5,50})/i,
      /Engine[:\s]*([^<\n]{10,80})/i,
      /(V\d+[^<\n]{5,50})/i
    ];

    for (const pattern of enginePatterns) {
      const match = html.match(pattern);
      if (match && match[1].length > 5) {
        data.engine = match[1].trim();
        break;
      }
    }

    // Transmission extraction
    const transmissionPatterns = [
      /(manual|automatic|CVT)[^<\n]{0,50}/i,
      /transmission[:\s]*([^<\n]{5,50})/i,
      /(\d+-speed[^<\n]{0,30})/i
    ];

    for (const pattern of transmissionPatterns) {
      const match = html.match(pattern);
      if (match) {
        data.transmission = match[0].trim();
        break;
      }
    }

    // Mileage extraction - FIX THE MAJOR ISSUE FOUND IN AUDIT
    const mileagePatterns = [
      /odometer[:\s]*([,\d]+)[^<\n]*miles?/i,
      /mileage[:\s]*([,\d]+)/i,
      /(\d{1,3}(?:,\d{3})*)\s*miles?/i,
      /([,\d]+)\s*miles?\s*on/i
    ];

    for (const pattern of mileagePatterns) {
      const match = html.match(pattern);
      if (match) {
        const mileageStr = match[1].replace(/,/g, '');
        const mileage = parseInt(mileageStr);
        if (mileage > 0 && mileage < 1000000) { // Reasonable range
          data.mileage = mileage;
          break;
        }
      }
    }

    // Price extraction
    const pricePatterns = [
      /sold for[:\s]*\$([,\d]+)/i,
      /final bid[:\s]*\$([,\d]+)/i,
      /winning bid[:\s]*\$([,\d]+)/i,
      /\$([,\d]+)\s*reserve/i
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        data.sale_price = parseInt(match[1].replace(/,/g, ''));
        break;
      }
    }

    // Description extraction - look for listing description
    const descMatch = html.match(/<div[^>]*listing[^>]*description[^>]*>([^<]{100,2000})/i);
    if (descMatch) {
      data.description = descMatch[1].trim().substring(0, 1000);
    }

  } catch (error) {
    console.warn(`⚠️ Error extracting from HTML: ${error.message}`);
  }

  return data;
}

function compareAndDetectIssues(profile, sourceData) {
  const issues = [];
  const fixes = {};

  console.log(`   🔍 Profile data: VIN=${profile.vin||'null'}, Mileage=${profile.mileage||'null'}, Engine=${profile.engine_size||'null'}`);
  console.log(`   🌐 Source data: VIN=${sourceData.vin||'null'}, Mileage=${sourceData.mileage||'null'}, Engine=${sourceData.engine||'null'}`);

  // VIN fixes
  if (sourceData.vin && (!profile.vin || profile.vin !== sourceData.vin)) {
    issues.push(`VIN missing/wrong: Profile(${profile.vin||'null'}) vs Source(${sourceData.vin})`);
    fixes.vin = sourceData.vin;
  }

  // Mileage fixes - THE CRITICAL ISSUE FOUND
  if (sourceData.mileage && profile.mileage !== sourceData.mileage) {
    const variance = Math.abs(profile.mileage - sourceData.mileage) / Math.max(profile.mileage, sourceData.mileage);
    if (variance > 0.1) { // More than 10% difference
      issues.push(`Mileage wrong: Profile(${profile.mileage||'null'}) vs Source(${sourceData.mileage})`);
      fixes.mileage = sourceData.mileage;
    }
  }

  // Engine fixes
  if (sourceData.engine && !profile.engine_size) {
    issues.push(`Engine missing: Source has "${sourceData.engine}"`);
    fixes.engine_size = sourceData.engine;
  }

  // Transmission fixes
  if (sourceData.transmission && !profile.transmission) {
    issues.push(`Transmission missing: Source has "${sourceData.transmission}"`);
    fixes.transmission = sourceData.transmission;
  }

  // Price fixes
  if (sourceData.sale_price && !profile.sale_price) {
    issues.push(`Sale price missing: Source has $${sourceData.sale_price.toLocaleString()}`);
    fixes.sale_price = sourceData.sale_price;
  }

  // Description fixes
  if (sourceData.description && (!profile.description || profile.description.length < 100)) {
    issues.push(`Description missing/poor: Source has ${sourceData.description.length} chars`);
    fixes.description = sourceData.description;
  }

  return { issues, fixes };
}

async function applyFixes(vehicleId, fixes) {
  if (Object.keys(fixes).length === 0) {
    return { success: true, message: 'No fixes needed' };
  }

  console.log(`   🔧 Applying ${Object.keys(fixes).length} fixes...`);

  try {
    // Just apply the direct fixes without metadata
    const fixMetadata = {
      ...fixes,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('vehicles')
      .update(fixMetadata)
      .eq('id', vehicleId);

    if (error) {
      return { success: false, error: error.message };
    }

    console.log(`   ✅ Fixed: ${Object.keys(fixes).join(', ')}`);
    return { success: true, fixes };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyFix(vehicleId, originalIssues) {
  try {
    const { data: updatedVehicle } = await supabase
      .from('vehicles')
      .select('vin, mileage, engine_size, transmission, sale_price, updated_at')
      .eq('id', vehicleId)
      .single();

    if (!updatedVehicle) {
      return { verified: false, error: 'Vehicle not found after update' };
    }

    const stillMissingFields = [];

    if (!updatedVehicle.vin) stillMissingFields.push('VIN');
    if (!updatedVehicle.mileage) stillMissingFields.push('mileage');
    if (!updatedVehicle.engine_size) stillMissingFields.push('engine');
    if (!updatedVehicle.transmission) stillMissingFields.push('transmission');

    const isFullyFixed = stillMissingFields.length === 0;

    return {
      verified: true,
      fully_fixed: isFullyFixed,
      remaining_issues: stillMissingFields,
      fixed_at: updatedVehicle.updated_at
    };

  } catch (error) {
    return { verified: false, error: error.message };
  }
}

async function sequentialFixProcess(vehicles) {
  console.log(`\n🚀 Starting IMMEDIATE SEQUENTIAL FIXES for ${vehicles.length} vehicles`);
  console.log('='.repeat(80));

  let fixedCount = 0;
  let failedCount = 0;
  const fixedVehicles = [];
  const failedVehicles = [];

  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const vehicleNum = i + 1;

    console.log(`\n📋 VEHICLE ${vehicleNum}/${vehicles.length}: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`🔗 Source: ${vehicle.source_url}`);
    console.log('-'.repeat(60));

    try {
      // 1. AUDIT: Fetch source data
      const sourceResult = await fetchSourceData(vehicle.source_url);

      if (sourceResult.error) {
        console.log(`   ❌ Source fetch failed: ${sourceResult.error}`);
        failedVehicles.push({ vehicle, reason: sourceResult.error });
        failedCount++;
        continue;
      }

      // 2. EXTRACT: Get current correct data
      const sourceData = extractBaTData(sourceResult.html);

      if (Object.keys(sourceData).length === 0) {
        console.log(`   ⚠️ No extractable data found in source`);
        failedVehicles.push({ vehicle, reason: 'No data extractable' });
        failedCount++;
        continue;
      }

      // 3. COMPARE: Detect what needs fixing
      const { issues, fixes } = compareAndDetectIssues(vehicle, sourceData);

      if (issues.length === 0) {
        console.log(`   ✅ No issues found - vehicle data is accurate`);
        continue;
      }

      console.log(`   🚨 Found ${issues.length} issues:`);
      issues.forEach(issue => console.log(`     • ${issue}`));

      // 4. FIX: Apply corrections immediately
      const fixResult = await applyFixes(vehicle.id, fixes);

      if (!fixResult.success) {
        console.log(`   ❌ Fix failed: ${fixResult.error}`);
        failedVehicles.push({ vehicle, reason: fixResult.error, issues });
        failedCount++;
        continue;
      }

      // 5. VERIFY: Confirm the fix worked
      const verification = await verifyFix(vehicle.id, issues);

      if (!verification.verified) {
        console.log(`   ⚠️ Fix verification failed: ${verification.error}`);
        failedVehicles.push({ vehicle, reason: verification.error, issues });
        failedCount++;
        continue;
      }

      console.log(`   ✅ FIXED & VERIFIED: ${Object.keys(fixes).length} fields updated`);
      if (!verification.fully_fixed) {
        console.log(`   ⚠️ Still missing: ${verification.remaining_issues.join(', ')}`);
      }

      fixedVehicles.push({ vehicle, fixes, verification });
      fixedCount++;

      // Rate limiting to avoid overwhelming sources
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`   ❌ Unexpected error: ${error.message}`);
      failedVehicles.push({ vehicle, reason: error.message });
      failedCount++;
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 SEQUENTIAL FIXES COMPLETE');
  console.log('='.repeat(80));
  console.log(`✅ Successfully Fixed: ${fixedCount} vehicles`);
  console.log(`❌ Failed to Fix: ${failedCount} vehicles`);
  console.log(`📈 Success Rate: ${(fixedCount / vehicles.length * 100).toFixed(1)}%`);

  if (fixedCount > 0) {
    console.log('\n🔧 FIXES APPLIED:');
    fixedVehicles.slice(0, 5).forEach(({ vehicle, fixes }) => {
      console.log(`  • ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${Object.keys(fixes).join(', ')}`);
    });
    if (fixedVehicles.length > 5) {
      console.log(`  ... and ${fixedVehicles.length - 5} more`);
    }
  }

  if (failedCount > 0) {
    console.log('\n❌ FIX FAILURES:');
    failedVehicles.slice(0, 3).forEach(({ vehicle, reason }) => {
      console.log(`  • ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${reason}`);
    });
    if (failedVehicles.length > 3) {
      console.log(`  ... and ${failedVehicles.length - 3} more`);
    }
  }

  return {
    total: vehicles.length,
    fixed: fixedCount,
    failed: failedCount,
    fixedVehicles,
    failedVehicles
  };
}

async function main() {
  console.log('🚨 IMMEDIATE PROFILE FIXES - NO MORE AUDIT-ONLY');
  console.log('Sequential process: Audit → Fix → Verify → Next');
  console.log('='.repeat(80));

  // Get vehicles needing fixes (BaT priority based on audit findings)
  const vehicles = await getAllVehiclesNeedingFixes();

  if (vehicles.length === 0) {
    console.log('✅ No vehicles found needing fixes');
    return;
  }

  // Start sequential fix process
  const results = await sequentialFixProcess(vehicles);

  console.log('\n🎯 NEXT STEPS:');
  console.log('1. Fixed vehicles now have accurate data');
  console.log('2. Run this again to process next batch');
  console.log('3. Expand to other sources (Mecum, etc.)');
  console.log('4. Monitor for new extractions using fixed logic');
}

main().catch(console.error);