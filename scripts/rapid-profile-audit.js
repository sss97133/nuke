#!/usr/bin/env node

/**
 * Rapid Profile Audit - ASAP
 * Audits ALL existing profiles with sources for accuracy immediately
 * Uses direct HTTP fetching and simple comparison logic
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const AUDIT_RESULTS_FILE = '/Users/skylar/nuke/profile_audit_results.json';

async function getAllProfilesWithSources() {
  console.log('🔍 Getting all vehicles with source URLs...');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, engine_size, transmission, mileage, asking_price, sale_price, description, discovery_url, bat_auction_url, created_at')
    .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
    .order('created_at', { ascending: false })
    .limit(1000); // Start with first 1000

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error);
    return [];
  }

  console.log(`📊 Found ${vehicles.length} vehicles with source URLs`);

  // Add source_url field for compatibility
  vehicles.forEach(v => {
    v.source_url = v.discovery_url || v.bat_auction_url;
  });

  // Group by source type
  const bySource = {};
  vehicles.forEach(v => {
    const sourceType = detectSourceType(v.source_url);
    if (!bySource[sourceType]) bySource[sourceType] = [];
    bySource[sourceType].push(v);
  });

  console.log('📋 Vehicles by source:');
  Object.entries(bySource).forEach(([source, vehicles]) => {
    console.log(`   ${source}: ${vehicles.length} vehicles`);
  });

  return vehicles;
}

function detectSourceType(url) {
  if (!url) return 'unknown';
  if (url.includes('bringatrailer.com')) return 'BaT';
  if (url.includes('mecum.com')) return 'Mecum';
  if (url.includes('barrett-jackson.com')) return 'Barrett-Jackson';
  if (url.includes('carsandbids.com')) return 'Cars & Bids';
  if (url.includes('classiccars.com')) return 'ClassicCars.com';
  if (url.includes('autotrader.com')) return 'AutoTrader';
  return 'other';
}

async function quickSourceFetch(url) {
  try {
    console.log(`🌐 Fetching: ${url.substring(0, 60)}...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
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

function extractBasicDataFromHtml(html, sourceType) {
  const data = {};

  try {
    if (sourceType === 'BaT') {
      // BaT specific extraction patterns
      const vinMatch = html.match(/VIN[:\s]*([A-Z0-9]{17})/i);
      if (vinMatch) data.vin = vinMatch[1];

      const engineMatch = html.match(/([\d.]+-liter|[\d.]+L)\s+([^<\n]{10,50})/i);
      if (engineMatch) data.engine = engineMatch[0];

      const transmissionMatch = html.match(/(manual|automatic|CVT)[^<\n]{0,30}/i);
      if (transmissionMatch) data.transmission = transmissionMatch[0];

      const mileageMatch = html.match(/([\d,]+)\s*miles?/i);
      if (mileageMatch) data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));

      const priceMatch = html.match(/\$[\d,]+/);
      if (priceMatch) data.price = parseInt(priceMatch[0].replace(/[$,]/g, ''));
    }

    // Generic patterns for other sources
    if (!data.vin) {
      const genericVin = html.match(/(?:VIN|Vehicle\s+Identification)[:\s]*([A-Z0-9]{17})/i);
      if (genericVin) data.vin = genericVin[1];
    }

    if (!data.mileage) {
      const genericMileage = html.match(/([\d,]+)\s*(?:miles?|mi)/i);
      if (genericMileage) data.mileage = parseInt(genericMileage[1].replace(/,/g, ''));
    }

  } catch (error) {
    console.warn(`⚠️ Error extracting from HTML: ${error.message}`);
  }

  return data;
}

function compareProfileWithSource(profile, sourceData) {
  const comparison = {
    vehicle_id: profile.id,
    identity: `${profile.year} ${profile.make} ${profile.model}`,
    source_url: profile.source_url,
    matches: {},
    discrepancies: [],
    accuracy_score: 0,
    profile_data: {
      vin: profile.vin,
      engine_size: profile.engine_size,
      transmission: profile.transmission,
      mileage: profile.mileage,
      price: profile.asking_price || profile.sale_price
    },
    source_data: sourceData,
    status: 'checked'
  };

  // Compare VIN
  if (profile.vin && sourceData.vin) {
    comparison.matches.vin = profile.vin === sourceData.vin;
    if (!comparison.matches.vin) {
      comparison.discrepancies.push(`VIN mismatch: Profile(${profile.vin}) vs Source(${sourceData.vin})`);
    }
  } else {
    comparison.matches.vin = null; // One missing
  }

  // Compare mileage (allow 10% variance)
  if (profile.mileage && sourceData.mileage) {
    const variance = Math.abs(profile.mileage - sourceData.mileage) / Math.max(profile.mileage, sourceData.mileage);
    comparison.matches.mileage = variance < 0.1;
    if (!comparison.matches.mileage) {
      comparison.discrepancies.push(`Mileage mismatch: Profile(${profile.mileage}) vs Source(${sourceData.mileage})`);
    }
  } else {
    comparison.matches.mileage = null;
  }

  // Compare engine (fuzzy match)
  if (profile.engine_size && sourceData.engine) {
    const profileEngine = String(profile.engine_size).toLowerCase();
    const sourceEngine = sourceData.engine.toLowerCase();
    comparison.matches.engine = profileEngine.includes(sourceEngine) || sourceEngine.includes(profileEngine);
    if (!comparison.matches.engine) {
      comparison.discrepancies.push(`Engine mismatch: Profile(${profile.engine_size}) vs Source(${sourceData.engine})`);
    }
  } else {
    comparison.matches.engine = null;
  }

  // Calculate accuracy score
  const validChecks = Object.values(comparison.matches).filter(match => match !== null);
  const passedChecks = validChecks.filter(match => match === true);
  comparison.accuracy_score = validChecks.length > 0 ? passedChecks.length / validChecks.length : 0;

  return comparison;
}

async function auditProfilesInBatch(vehicles, batchSize = 20) {
  const results = [];
  const totalBatches = Math.ceil(vehicles.length / batchSize);

  console.log(`\n🚀 Starting rapid audit of ${vehicles.length} profiles in ${totalBatches} batches...`);

  for (let i = 0; i < vehicles.length; i += batchSize) {
    const batch = vehicles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)`);
    console.log('-'.repeat(50));

    for (const vehicle of batch) {
      const sourceType = detectSourceType(vehicle.source_url);

      console.log(`🔍 ${vehicle.year} ${vehicle.make} ${vehicle.model} [${sourceType}]`);

      try {
        // Fetch source page
        const sourceResult = await quickSourceFetch(vehicle.source_url);

        if (sourceResult.error) {
          results.push({
            vehicle_id: vehicle.id,
            identity: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            source_url: vehicle.source_url,
            status: 'source_fetch_failed',
            error: sourceResult.error,
            accuracy_score: 0
          });
          console.log(`   ❌ Source fetch failed: ${sourceResult.error}`);
          continue;
        }

        // Extract basic data from HTML
        const sourceData = extractBasicDataFromHtml(sourceResult.html, sourceType);

        // Compare profile vs source
        const comparison = compareProfileWithSource(vehicle, sourceData);
        results.push(comparison);

        const accuracy = (comparison.accuracy_score * 100).toFixed(1);
        const status = comparison.accuracy_score > 0.8 ? '✅' : comparison.accuracy_score > 0.5 ? '⚠️' : '❌';
        console.log(`   ${status} Accuracy: ${accuracy}% (${comparison.discrepancies.length} discrepancies)`);

        if (comparison.discrepancies.length > 0) {
          comparison.discrepancies.slice(0, 2).forEach(disc => {
            console.log(`     • ${disc}`);
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 250));

      } catch (error) {
        results.push({
          vehicle_id: vehicle.id,
          identity: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          source_url: vehicle.source_url,
          status: 'audit_failed',
          error: error.message,
          accuracy_score: 0
        });
        console.log(`   ❌ Audit failed: ${error.message}`);
      }
    }

    // Save progress after each batch
    saveAuditResults(results);
    console.log(`💾 Progress saved - ${results.length} profiles audited`);

    // Break between batches
    if (i + batchSize < vehicles.length) {
      console.log('⏱️  Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return results;
}

function saveAuditResults(results) {
  const summary = {
    timestamp: new Date().toISOString(),
    total_audited: results.length,
    summary: generateSummary(results),
    results
  };

  fs.writeFileSync(AUDIT_RESULTS_FILE, JSON.stringify(summary, null, 2));
}

function generateSummary(results) {
  const total = results.length;
  const checked = results.filter(r => r.status === 'checked');
  const failed = results.filter(r => r.status !== 'checked');

  const avgAccuracy = checked.length > 0
    ? checked.reduce((sum, r) => sum + r.accuracy_score, 0) / checked.length
    : 0;

  const highAccuracy = checked.filter(r => r.accuracy_score > 0.8).length;
  const lowAccuracy = checked.filter(r => r.accuracy_score < 0.5).length;

  return {
    total_profiles: total,
    successfully_checked: checked.length,
    fetch_failures: failed.length,
    average_accuracy: avgAccuracy,
    high_accuracy_count: highAccuracy,
    low_accuracy_count: lowAccuracy,
    high_accuracy_rate: checked.length > 0 ? highAccuracy / checked.length : 0
  };
}

async function main() {
  console.log('🚨 RAPID PROFILE ACCURACY AUDIT - ALL SOURCES');
  console.log('='.repeat(70));
  console.log('Auditing ALL existing profiles with sources for accuracy ASAP...\n');

  // Get all vehicles with sources
  const vehicles = await getAllProfilesWithSources();

  if (vehicles.length === 0) {
    console.log('❌ No vehicles with sources found');
    return;
  }

  // Rapid audit
  const results = await auditProfilesInBatch(vehicles, 15); // Smaller batches for speed

  // Final summary
  const summary = generateSummary(results);

  console.log('\n📊 FINAL AUDIT SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total Profiles Audited: ${summary.total_profiles}`);
  console.log(`Successfully Checked: ${summary.successfully_checked}`);
  console.log(`Source Fetch Failures: ${summary.fetch_failures}`);
  console.log(`Average Accuracy: ${(summary.average_accuracy * 100).toFixed(1)}%`);
  console.log(`High Accuracy (>80%): ${summary.high_accuracy_count} (${(summary.high_accuracy_rate * 100).toFixed(1)}%)`);
  console.log(`Low Accuracy (<50%): ${summary.low_accuracy_count}`);

  console.log('\n💾 Results saved to: profile_audit_results.json');

  if (summary.average_accuracy < 0.6) {
    console.log('\n🚨 CRITICAL: Average accuracy below 60% - extraction needs major fixes');
  } else if (summary.average_accuracy < 0.8) {
    console.log('\n⚠️ WARNING: Average accuracy below 80% - some issues to resolve');
  } else {
    console.log('\n✅ EXCELLENT: High accuracy detected - extraction working well');
  }
}

main().catch(console.error);