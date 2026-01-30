#!/usr/bin/env node
/**
 * EXTRACT-VEHICLE-IDENTIFIERS
 *
 * Scans forum posts for VINs and other vehicle identifiers.
 * Creates vehicle profiles when new VINs are discovered.
 * Links observations to specific vehicles.
 *
 * Usage:
 *   node scripts/extract-vehicle-identifiers.js
 *   node scripts/extract-vehicle-identifiers.js --dry-run
 *   node scripts/extract-vehicle-identifiers.js --limit 100
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '500');

// VIN patterns by era
const VIN_PATTERNS = [
  // Modern 17-char VIN (1981+)
  /\b([A-HJ-NPR-Z0-9]{17})\b/gi,

  // 1968-1980 GM VIN (13 chars)
  /\b([0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{6})\b/gi,

  // 1960s-70s Ford VIN patterns
  /\b([0-9][A-Z][0-9]{2}[A-Z][0-9]{6})\b/gi,

  // Porsche VIN patterns
  /\b(WP[0-9A-Z]{15})\b/gi,

  // Partial VINs often shared (last 6-8 digits)
  /\b(?:vin|serial)[:\s#]*([A-Z0-9]{6,8})\b/gi,
];

// Other identifier patterns
const IDENTIFIER_PATTERNS = {
  // Cowl tag / trim tag codes
  cowl_tag: /\b(?:cowl|trim|body)\s*(?:tag|plate)[:\s]*([A-Z0-9\-]+)/gi,

  // Engine codes
  engine_code: /\b(?:engine|motor)\s*(?:code|stamp|suffix)[:\s]*([A-Z]{2,3}[0-9]{4,6})/gi,

  // Build date codes
  build_date: /\b(?:build|assembly)\s*(?:date|code)[:\s]*([0-9]{2}[A-Z][0-9]{2})/gi,

  // Fender tag / data plate
  fender_tag: /\b(?:fender|data)\s*(?:tag|plate)[:\s]*([A-Z0-9\-\s]{8,20})/gi,
};

// Validate VIN checksum (for 17-char modern VINs)
function validateModernVIN(vin) {
  if (vin.length !== 17) return false;

  const transliteration = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  };

  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin[i].toUpperCase();
    const value = /[0-9]/.test(char) ? parseInt(char) : transliteration[char];
    if (value === undefined) return false;
    sum += value * weights[i];
  }

  const checkDigit = sum % 11;
  const expectedCheck = checkDigit === 10 ? 'X' : checkDigit.toString();

  return vin[8].toUpperCase() === expectedCheck;
}

// Decode VIN to get year, make hints
function decodeVIN(vin) {
  const info = { vin };

  if (vin.length === 17) {
    // Modern VIN decoding
    const yearCodes = {
      'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014, 'F': 2015,
      'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019, 'L': 2020, 'M': 2021,
      'N': 2022, 'P': 2023, 'R': 2024, 'S': 2025, 'T': 2026,
      'V': 1997, 'W': 1998, 'X': 1999, 'Y': 2000,
      '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005,
      '6': 2006, '7': 2007, '8': 2008, '9': 2009,
    };

    const wmiToMake = {
      '1G1': 'Chevrolet', '1G2': 'Pontiac', '1GC': 'Chevrolet', '1GT': 'GMC',
      '1FA': 'Ford', '1FB': 'Ford', '1FC': 'Ford', '1FD': 'Ford',
      '1C3': 'Chrysler', '1C4': 'Chrysler', '1C6': 'Dodge', '2C3': 'Dodge',
      '1B3': 'Dodge', '1B4': 'Dodge', '1B7': 'Dodge',
      'WP0': 'Porsche', 'WP1': 'Porsche',
      'WBA': 'BMW', 'WBS': 'BMW', 'WDB': 'Mercedes-Benz', 'WDD': 'Mercedes-Benz',
      'JT': 'Toyota', 'JN': 'Nissan', 'JH': 'Honda', 'JM': 'Mazda',
      'WAU': 'Audi', 'WVW': 'Volkswagen', 'WF0': 'Ford',
      '5FN': 'Honda', '5J6': 'Honda', '5YJ': 'Tesla',
      '2G1': 'Chevrolet', '2G2': 'Pontiac', '3G1': 'Chevrolet',
    };

    info.year = yearCodes[vin[9].toUpperCase()];

    const wmi = vin.substring(0, 3).toUpperCase();
    info.make = wmiToMake[wmi];
    if (!info.make) {
      const wmi2 = vin.substring(0, 2).toUpperCase();
      info.make = wmiToMake[wmi2];
    }

    info.is_valid = validateModernVIN(vin);
  } else if (vin.length === 13) {
    // 1968-1980 GM VIN
    const divisionCodes = {
      '1': 'Chevrolet', '2': 'Pontiac', '3': 'Oldsmobile',
      '4': 'Buick', '5': 'Cadillac', '6': 'Cadillac',
    };

    const yearCodes = {
      '8': 1968, '9': 1969, '0': 1970, '1': 1971, '2': 1972,
      '3': 1973, '4': 1974, '5': 1975, '6': 1976, '7': 1977,
      '8': 1978, '9': 1979, 'A': 1980,
    };

    info.make = divisionCodes[vin[0]];
    info.year = yearCodes[vin[4]] || yearCodes[vin[5]];
    info.is_valid = true; // Basic validation passed by regex
  }

  return info;
}

// Extract all identifiers from text
function extractIdentifiers(text) {
  if (!text) return { vins: [], others: {} };

  const vins = [];
  const others = {};

  // Extract VINs
  for (const pattern of VIN_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const vin = match[1].toUpperCase();
      // Filter out common false positives
      if (vin.length >= 13 && !isLikelyFalsePositive(vin)) {
        const decoded = decodeVIN(vin);
        if (decoded.year || decoded.make || decoded.is_valid) {
          vins.push(decoded);
        }
      }
    }
  }

  // Extract other identifiers
  for (const [type, pattern] of Object.entries(IDENTIFIER_PATTERNS)) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (!others[type]) others[type] = [];
      others[type].push(match[1].toUpperCase());
    }
  }

  return { vins, others };
}

// Filter out common false positives
function isLikelyFalsePositive(vin) {
  // All same character
  if (/^(.)\1+$/.test(vin)) return true;

  // Sequential numbers
  if (/^0123456789/.test(vin) || /^9876543210/.test(vin)) return true;

  // Common placeholder patterns
  if (/^[X]+$/.test(vin) || /^[0]+$/.test(vin)) return true;

  // URL fragments
  if (vin.includes('HTTP') || vin.includes('WWW')) return true;

  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('VEHICLE IDENTIFIER EXTRACTION');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT}`);
  console.log('='.repeat(60));

  // Get posts with content that haven't been scanned for VINs
  const { data: posts, error } = await supabase
    .from('build_posts')
    .select(`
      id, content_text, build_thread_id,
      thread:build_threads(id, thread_title, vehicle_id, vehicle_hints)
    `)
    .not('content_text', 'is', null)
    .is('vin_scanned_at', null)
    .limit(LIMIT);

  if (error) {
    // Column might not exist yet
    if (error.message.includes('vin_scanned_at')) {
      console.log('Note: vin_scanned_at column not found, scanning all posts');
      const { data: allPosts } = await supabase
        .from('build_posts')
        .select(`
          id, content_text, build_thread_id,
          thread:build_threads(id, thread_title, vehicle_id, vehicle_hints)
        `)
        .not('content_text', 'is', null)
        .limit(LIMIT);
      return processPostsForVINs(allPosts || []);
    }
    console.error('Error:', error.message);
    return;
  }

  await processPostsForVINs(posts || []);
}

async function processPostsForVINs(posts) {
  console.log(`\nScanning ${posts.length} posts for identifiers...\n`);

  let vinsFound = 0;
  let vehiclesCreated = 0;
  let vehiclesLinked = 0;
  const vinMap = new Map(); // Track unique VINs

  for (const post of posts) {
    const { vins, others } = extractIdentifiers(post.content_text);

    for (const vinInfo of vins) {
      if (vinMap.has(vinInfo.vin)) continue;
      vinMap.set(vinInfo.vin, vinInfo);
      vinsFound++;

      console.log(`Found VIN: ${vinInfo.vin}`);
      if (vinInfo.year) console.log(`  Year: ${vinInfo.year}`);
      if (vinInfo.make) console.log(`  Make: ${vinInfo.make}`);
      if (vinInfo.is_valid) console.log(`  Valid checksum: ✓`);
      console.log(`  Thread: ${post.thread?.thread_title?.slice(0, 50)}...`);
      console.log('');

      if (!DRY_RUN) {
        // Check if vehicle with this VIN exists
        const { data: existing } = await supabase
          .from('vehicles')
          .select('id, year, make, model')
          .eq('vin', vinInfo.vin)
          .single();

        if (existing) {
          // Link thread to existing vehicle if not already linked
          if (post.thread && !post.thread.vehicle_id) {
            await supabase
              .from('build_threads')
              .update({ vehicle_id: existing.id })
              .eq('id', post.thread.id);
            vehiclesLinked++;
            console.log(`  → Linked to existing: ${existing.year} ${existing.make} ${existing.model}`);
          }
        } else {
          // Create new vehicle from VIN
          const hints = post.thread?.vehicle_hints || {};
          const { data: newVehicle, error: createError } = await supabase
            .from('vehicles')
            .insert({
              vin: vinInfo.vin,
              year: vinInfo.year || hints.year,
              make: vinInfo.make || hints.make,
              model: hints.model,
              status: 'discovered',
              discovery_source: 'forum_vin_extraction',
            })
            .select('id')
            .single();

          if (newVehicle?.id) {
            vehiclesCreated++;
            console.log(`  → Created vehicle profile: ${newVehicle.id}`);

            // Link thread to new vehicle
            if (post.thread) {
              await supabase
                .from('build_threads')
                .update({ vehicle_id: newVehicle.id })
                .eq('id', post.thread.id);
            }
          } else if (createError) {
            console.log(`  → Error creating: ${createError.message}`);
          }
        }
      }
    }

    // Log other identifiers found
    for (const [type, values] of Object.entries(others)) {
      if (values.length > 0) {
        console.log(`Found ${type}: ${values.join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Posts scanned:      ${posts.length}`);
  console.log(`VINs found:         ${vinsFound}`);
  console.log(`Vehicles created:   ${vehiclesCreated}`);
  console.log(`Vehicles linked:    ${vehiclesLinked}`);
  console.log(`Unique VINs:        ${vinMap.size}`);

  if (vinMap.size > 0) {
    console.log('\nVINs discovered:');
    for (const [vin, info] of vinMap) {
      console.log(`  ${vin} - ${info.year || '?'} ${info.make || 'Unknown'}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN - no changes made]');
  }
}

main().catch(console.error);
