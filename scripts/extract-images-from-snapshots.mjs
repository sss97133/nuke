#!/usr/bin/env node
/**
 * Extract Images from Snapshots — fills vehicle_images for vehicles without images
 *
 * Uses find_imageless_with_snapshots() SQL function to match vehicles to snapshots,
 * downloads HTML from Supabase storage, extracts image URLs, inserts into vehicle_images.
 *
 * Usage:
 *   dotenvx run -- node scripts/extract-images-from-snapshots.mjs
 *   dotenvx run -- node scripts/extract-images-from-snapshots.mjs --platform mecum
 *   dotenvx run -- node scripts/extract-images-from-snapshots.mjs --platform mecum --limit 100
 *   dotenvx run -- node scripts/extract-images-from-snapshots.mjs --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
const platformArg = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 1000;
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const concurrency = args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1]) : 5;

// Platforms to process (in priority order by image gap size)
// Exclude mecum + gooding: their snapshot HTML has no vehicle images (JS-rendered galleries)
const PLATFORMS = platformArg
  ? [platformArg]
  : ['barrett-jackson', 'craigslist', 'bonhams', 'rm-sothebys', 'bat'];

const stats = { total: 0, extracted: 0, images_inserted: 0, no_html: 0, no_images: 0, errors: 0, by_platform: {} };

async function readHtmlFromStorage(storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from('listing-snapshots')
      .download(storagePath);
    if (error) {
      if (verbose) console.error(`  Storage error for ${storagePath}: ${JSON.stringify(error)}`);
      return null;
    }
    if (!data) return null;
    const text = await data.text();
    return text && text.length > 100 ? text : null;
  } catch (e) {
    if (verbose) console.error(`  Storage exception for ${storagePath}: ${e.message}`);
    return null;
  }
}

/**
 * Extract ALL image URLs from HTML. Returns deduplicated list.
 */
function extractAllImages(html, platform) {
  const images = new Set();

  // 1. og:image (highest priority)
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::?\w*)?["'][^>]+content=["']([^"']+)["']/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !isJunk(url)) images.add(url);
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::?\w*)?["']/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (url.startsWith('http') && !isJunk(url)) images.add(url);
  }

  // 2. JSON-LD images
  for (const m of html.matchAll(/"image"\s*:\s*"(https?:\/\/[^"]+)"/g)) {
    const url = m[1].replace(/\\\//g, '/');
    if (!isJunk(url)) images.add(url);
  }

  // 3. Platform-specific
  const patterns = getPlatformPatterns(platform);
  for (const pat of patterns) {
    for (const m of html.matchAll(pat)) {
      const url = (m[1] || m[0]).replace(/&amp;/g, '&');
      if (!isJunk(url) && url.length > 25) images.add(url);
    }
  }

  // 4. img src tags
  for (const m of html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!isJunk(url) && url.length > 30) images.add(url);
  }

  // 5. data-src attributes
  for (const m of html.matchAll(/data-(?:src|original|lazy|full|zoom)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!isJunk(url) && url.length > 30) images.add(url);
  }

  return dedup([...images]);
}

function getPlatformPatterns(platform) {
  switch (platform) {
    case 'bat':
      return [/https:\/\/bringatrailer\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi];
    case 'mecum':
      return [
        /https?:\/\/(?:www\.)?mecum\.com\/[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
        /(https?:\/\/[^"'\s<>]*cdn[^"'\s<>]*mecum[^"'\s<>]*\.(?:jpg|jpeg|png|webp))/gi,
      ];
    case 'bonhams':
      return [
        /https?:\/\/[^"'\s<>]*\.bonhams[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*bonhams[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
      ];
    case 'barrett-jackson':
      return [
        /https?:\/\/(?:www\.)?barrett-jackson\.com\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*blob\.core\.windows\.net\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*barrett-jackson[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/BarrettJacksonCDN[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*azureedge\.net[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
      ];
    case 'carsandbids':
      return [/https?:\/\/[^"'\s<>]*carsandbids[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi];
    case 'gooding':
      return [
        /https?:\/\/[^"'\s<>]*gooding[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*cloudinary[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
      ];
    case 'craigslist':
      return [/https?:\/\/images\.craigslist\.org\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi];
    case 'rm-sothebys':
      return [
        /https?:\/\/[^"'\s<>]*rmsothebys[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]*sothebys[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi,
      ];
    default:
      return [];
  }
}

function isJunk(url) {
  const l = url.toLowerCase();
  return l.includes('logo') || l.includes('favicon') || l.includes('icon') ||
    l.includes('sprite') || l.includes('placeholder') || l.includes('blank') ||
    l.includes('tracking') || l.includes('pixel') || l.includes('1x1') ||
    l.includes('analytics') || l.includes('badge') || l.includes('arrow') ||
    l.includes('button') || l.includes('social') || l.endsWith('.gif') ||
    l.endsWith('.svg') || l.endsWith('.css') || l.endsWith('.js') ||
    l.includes('facebook.com') || l.includes('twitter.com') || l.includes('google') ||
    l.includes('register') || l.includes('menu') || l.includes('financial') ||
    l.includes('footer') || l.includes('header') || l.includes('nav-') ||
    l.includes('/nav/') || l.includes('heritage_partner') || l.includes('sponsor') ||
    l.includes('strapi-uploads') ||
    url.length < 20;
}

function dedup(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const norm = url.replace(/-\d+x\d+\./g, '.').replace(/\?.*$/, '').replace(/\/+$/, '').toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(url);
    }
  }
  return result.slice(0, 50);
}

async function processVehicle(vehicle) {
  const html = await readHtmlFromStorage(vehicle.snapshot_storage_path);
  if (!html || html.length < 500) return 'no_html';

  const imageUrls = extractAllImages(html, vehicle.snapshot_platform);
  if (imageUrls.length === 0) return 'no_images';

  if (dryRun) {
    if (verbose) console.log(`  [dry] ${vehicle.vehicle_id}: ${imageUrls.length} images found`);
    return imageUrls.length;
  }

  // Insert images
  const rows = imageUrls.map((url, idx) => ({
    vehicle_id: vehicle.vehicle_id,
    image_url: url,
    is_primary: idx === 0,
    is_external: true,
    source: 'snapshot-image-extract',
    category: 'exterior',
    position: idx,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const { error } = await supabase.from('vehicle_images').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      // Fallback: insert one by one
      for (const row of batch) {
        const { error: err2 } = await supabase.from('vehicle_images').insert(row);
        if (!err2) inserted++;
      }
    } else {
      inserted += batch.length;
    }
  }

  // Set primary_image_url on vehicle if missing
  if (!vehicle.primary_image_url && imageUrls.length > 0) {
    await supabase.from('vehicles')
      .update({ primary_image_url: imageUrls[0], updated_at: new Date().toISOString() })
      .eq('id', vehicle.vehicle_id);
  }

  return inserted;
}

async function processBatch(vehicles) {
  const results = [];
  // Process in parallel batches
  for (let i = 0; i < vehicles.length; i += concurrency) {
    const batch = vehicles.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(v => processVehicle(v).catch(e => {
      if (verbose) console.error(`  Error ${v.vehicle_id}: ${e.message}`);
      return 'error';
    })));
    results.push(...batchResults);
  }
  return results;
}

async function processPlatform(platform) {
  console.log(`\n--- ${platform} ---`);
  const pStats = { vehicles: 0, extracted: 0, images: 0, no_html: 0, no_images: 0, errors: 0 };

  // Use the SQL function to find matchable vehicles
  const { data: vehicles, error } = await supabase.rpc('find_imageless_with_snapshots', {
    p_platform: platform,
    p_limit: limitArg,
  });

  if (error) {
    console.error(`  SQL error: ${error.message}`);
    pStats.errors++;
    return pStats;
  }

  pStats.vehicles = vehicles?.length || 0;
  console.log(`  Found ${pStats.vehicles} vehicles with matching snapshots`);

  if (!vehicles || vehicles.length === 0) return pStats;

  // Process in batches
  const batchSize = 50;
  for (let i = 0; i < vehicles.length; i += batchSize) {
    const batch = vehicles.slice(i, i + batchSize);
    const results = await processBatch(batch);

    for (const r of results) {
      if (r === 'no_html') pStats.no_html++;
      else if (r === 'no_images') pStats.no_images++;
      else if (r === 'error') pStats.errors++;
      else if (typeof r === 'number' && r > 0) {
        pStats.extracted++;
        pStats.images += r;
      }
    }

    const done = Math.min(i + batchSize, vehicles.length);
    console.log(`  ${done}/${vehicles.length} done | ${pStats.extracted} extracted, ${pStats.images} images, ${pStats.no_html} no_html, ${pStats.no_images} no_imgs, ${pStats.errors} errors`);
  }

  return pStats;
}

async function main() {
  console.log(`=== Image Extraction from Snapshots ===`);
  console.log(`Platforms: ${PLATFORMS.join(', ')}`);
  console.log(`Limit/platform: ${limitArg} | Concurrency: ${concurrency} | Dry run: ${dryRun}`);

  for (const platform of PLATFORMS) {
    try {
      const pStats = await processPlatform(platform);
      stats.by_platform[platform] = pStats;
      stats.total += pStats.vehicles;
      stats.extracted += pStats.extracted;
      stats.images_inserted += pStats.images;
      stats.no_html += pStats.no_html;
      stats.no_images += pStats.no_images;
      stats.errors += pStats.errors;
    } catch (e) {
      console.error(`  ${platform} FAILED: ${e.message}`);
      stats.errors++;
    }
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`Total vehicles matched: ${stats.total}`);
  console.log(`Successfully extracted: ${stats.extracted}`);
  console.log(`Images inserted: ${stats.images_inserted}`);
  console.log(`No HTML available: ${stats.no_html}`);
  console.log(`No images found in HTML: ${stats.no_images}`);
  console.log(`Errors: ${stats.errors}`);
  for (const [p, s] of Object.entries(stats.by_platform)) {
    console.log(`  ${p}: ${s.extracted}/${s.vehicles} vehicles -> ${s.images} images`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
