#!/usr/bin/env node
/**
 * diagnose-duplicates.mjs — Read-only duplicate diagnostic tool
 *
 * Analyzes vehicle records for duplicate candidates using URL normalization
 * and cross-vehicle image fingerprinting (dHash). NO MERGES — report only.
 *
 * Usage:
 *   dotenvx run -- node scripts/diagnose-duplicates.mjs --make Koenigsegg --model Regera
 *   dotenvx run -- node scripts/diagnose-duplicates.mjs --make Koenigsegg --model Regera --images
 */

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------------------------------------------------------
// URL normalization — extract canonical listing IDs from known platforms
// ---------------------------------------------------------------------------
function normalizeUrl(url) {
  if (!url) return null;

  // JamesEdition: extract numeric listing ID (7+ digits)
  const je = url.match(/jamesedition\.com.*?[/-](\d{7,})/);
  if (je) return `jamesedition:${je[1]}`;

  // RM Sotheby's: extract lot ID (e.g., r0051)
  const rm = url.match(/rmsothebys\.com.*?\/(r\d+)/);
  if (rm) return `rmsothebys:${rm[1]}`;

  // BaT: extract listing slug
  const bat = url.match(/bringatrailer\.com\/listing\/([\w-]+)/);
  if (bat) return `bat:${bat[1]}`;

  // Cars & Bids: extract listing ID
  const cab = url.match(/carsandbids\.com\/auctions\/([\w-]+)/);
  if (cab) return `carsandbids:${cab[1]}`;

  // Broad Arrow: extract lot slug
  const ba = url.match(/broadarrowauctions\.com.*?\/([\w-]+)\/?$/);
  if (ba) return `broadarrow:${ba[1]}`;

  // Gooding: extract lot slug
  const goo = url.match(/goodingco\.com.*?\/([\w-]+)\/?$/);
  if (goo) return `gooding:${goo[1]}`;

  // Mecum: extract lot slug
  const mec = url.match(/mecum\.com.*?\/([\w-]+)\/?$/);
  if (mec) return `mecum:${mec[1]}`;

  // Fallback: strip trailing slash and query params
  return url.replace(/\/$/, '').replace(/\?.*$/, '');
}

// ---------------------------------------------------------------------------
// dHash computation (matches dedup-vehicle-images algorithm exactly)
// ---------------------------------------------------------------------------
function computeDHash(grayscalePixels, width, height) {
  const bits = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = grayscalePixels[y * width + x];
      const right = grayscalePixels[y * width + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

function hammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) return 64;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    let xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const makeIdx = args.indexOf('--make');
  const modelIdx = args.indexOf('--model');
  const doImages = args.includes('--images');

  if (makeIdx === -1) {
    console.log('Usage: diagnose-duplicates.mjs --make <make> [--model <model>] [--images]');
    console.log('  --images  Also fetch hero images and compute cross-vehicle dHash similarity');
    process.exit(1);
  }

  const make = args[makeIdx + 1];
  const model = modelIdx !== -1 ? args[modelIdx + 1] : null;

  console.log(`\n=== DUPLICATE DIAGNOSTIC: ${make}${model ? ' ' + model : ''} ===\n`);

  // Fetch matching vehicles
  let query = sb.from('vehicles')
    .select('id, year, make, model, status, sale_price, vin, source, listing_url, created_at')
    .ilike('make', `%${make}%`)
    .not('status', 'in', '(merged,deleted)');

  if (model) query = query.ilike('model', `%${model}%`);
  query = query.order('listing_url');

  const { data: vehicles, error } = await query;
  if (error) { console.error('Query error:', error); return; }

  console.log(`Found ${vehicles.length} active records\n`);

  // Get image counts for each vehicle
  const imgCounts = {};
  for (const v of vehicles) {
    const { count } = await sb.from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);
    imgCounts[v.id] = count || 0;
  }

  // Group by normalized URL
  const groups = {};
  const noUrl = [];

  for (const v of vehicles) {
    const normalized = normalizeUrl(v.listing_url);
    if (!normalized) {
      noUrl.push(v);
      continue;
    }
    if (!groups[normalized]) groups[normalized] = [];
    groups[normalized].push(v);
  }

  const dupGroups = Object.entries(groups).filter(([, vs]) => vs.length > 1);
  const uniqueGroups = Object.entries(groups).filter(([, vs]) => vs.length === 1);

  // --- Report: URL-based duplicate groups ---
  console.log('━━━ URL NORMALIZATION DUPLICATES ━━━');
  console.log(`${dupGroups.length} groups with 2+ records sharing a normalized listing ID\n`);

  for (const [key, vs] of dupGroups) {
    console.log(`\n┌── ${key} (${vs.length} records) ──`);
    for (const v of vs) {
      const price = v.sale_price ? `$${Number(v.sale_price).toLocaleString()}` : '—';
      console.log(`│  ${v.id.slice(0, 8)} | ${v.year || '?'} | ${price} | VIN:${v.vin || '—'} | imgs:${imgCounts[v.id]} | ${v.source || '?'}`);
      console.log(`│    URL: ${(v.listing_url || 'none').slice(0, 130)}`);
    }
    console.log('└──');
  }

  // --- Report: Unique listings ---
  console.log(`\n━━━ UNIQUE LISTINGS (${uniqueGroups.length}) ━━━`);
  for (const [key, vs] of uniqueGroups) {
    const v = vs[0];
    const price = v.sale_price ? `$${Number(v.sale_price).toLocaleString()}` : '—';
    console.log(`  ${v.id.slice(0, 8)} | ${v.year || '?'} | ${price} | VIN:${v.vin || '—'} | imgs:${imgCounts[v.id]} | ${key.slice(0, 80)}`);
  }

  // --- Report: No URL ---
  if (noUrl.length > 0) {
    console.log(`\n━━━ NO URL (${noUrl.length} records — need image-based matching) ━━━`);
    for (const v of noUrl) {
      const price = v.sale_price ? `$${Number(v.sale_price).toLocaleString()}` : '—';
      console.log(`  ${v.id.slice(0, 8)} | ${v.year || '?'} | ${v.model} | ${price} | VIN:${v.vin || '—'} | imgs:${imgCounts[v.id]} | ${v.source || '?'}`);
    }
  }

  // --- Cross-vehicle image similarity (if --images flag) ---
  if (doImages) {
    console.log('\n━━━ CROSS-VEHICLE IMAGE SIMILARITY ━━━');
    console.log('Fetching hero images and computing dHash across vehicles...\n');

    // Get existing dHash values from vehicle_images for each vehicle
    const vehicleHashes = {};

    for (const v of vehicles) {
      if (imgCounts[v.id] === 0) continue;

      // Get up to 5 images per vehicle that already have dhash computed
      const { data: images } = await sb.from('vehicle_images')
        .select('id, image_url, dhash, source')
        .eq('vehicle_id', v.id)
        .not('dhash', 'is', null)
        .limit(5);

      if (images && images.length > 0) {
        vehicleHashes[v.id] = images.map(i => ({
          image_id: i.id,
          dhash: i.dhash,
          source: i.source,
          url: i.image_url
        }));
      }
    }

    const vehiclesWithHashes = Object.keys(vehicleHashes);
    console.log(`${vehiclesWithHashes.length} vehicles have pre-computed dHash values\n`);

    // Cross-compare all vehicle pairs
    const crossMatches = [];

    for (let i = 0; i < vehiclesWithHashes.length; i++) {
      for (let j = i + 1; j < vehiclesWithHashes.length; j++) {
        const vidA = vehiclesWithHashes[i];
        const vidB = vehiclesWithHashes[j];
        const hashesA = vehicleHashes[vidA];
        const hashesB = vehicleHashes[vidB];

        let bestDistance = 64;
        let bestPair = null;

        for (const hA of hashesA) {
          for (const hB of hashesB) {
            const dist = hammingDistance(hA.dhash, hB.dhash);
            if (dist < bestDistance) {
              bestDistance = dist;
              bestPair = { imgA: hA, imgB: hB };
            }
          }
        }

        if (bestDistance <= 10) { // threshold for "likely same image"
          crossMatches.push({
            vehicleA: vidA,
            vehicleB: vidB,
            distance: bestDistance,
            confidence: bestDistance <= 3 ? 'HIGH' : bestDistance <= 6 ? 'MEDIUM' : 'LOW',
            imgA: bestPair.imgA,
            imgB: bestPair.imgB
          });
        }
      }
    }

    if (crossMatches.length === 0) {
      console.log('No cross-vehicle image matches found (threshold: hamming distance <= 10)');
      console.log('This could mean: images not yet hashed, or genuinely different vehicles.');
    } else {
      console.log(`Found ${crossMatches.length} cross-vehicle image matches:\n`);
      for (const m of crossMatches.sort((a, b) => a.distance - b.distance)) {
        const vA = vehicles.find(v => v.id === m.vehicleA);
        const vB = vehicles.find(v => v.id === m.vehicleB);
        console.log(`  [${m.confidence}] distance=${m.distance}/64`);
        console.log(`    A: ${m.vehicleA.slice(0, 8)} | ${vA?.year} | ${vA?.source} | imgs:${imgCounts[m.vehicleA]}`);
        console.log(`    B: ${m.vehicleB.slice(0, 8)} | ${vB?.year} | ${vB?.source} | imgs:${imgCounts[m.vehicleB]}`);
        console.log('');
      }
    }
  }

  // --- Summary ---
  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Total records: ${vehicles.length}`);
  console.log(`URL duplicate groups: ${dupGroups.length} (${dupGroups.reduce((s, [, v]) => s + v.length, 0)} records)`);
  console.log(`Unique listings: ${uniqueGroups.length}`);
  console.log(`No URL: ${noUrl.length}`);
  const totalDuplicateRecords = dupGroups.reduce((s, [, v]) => s + v.length - 1, 0);
  console.log(`Records that are provably duplicates (same listing ID): ${totalDuplicateRecords}`);
  console.log(`\nTo also check image similarity, run with --images flag`);
}

main().catch(console.error);
