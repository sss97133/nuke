#!/usr/bin/env node
/**
 * photo-manifest-builder.mjs
 *
 * Processes ALL Apple Photos vehicle albums LOCALLY.
 * Extracts EXIF metadata, clusters by GPS+time, matches to DB profiles.
 * Outputs a manifest for human review BEFORE any uploads happen.
 *
 * Usage:
 *   dotenvx run -- node scripts/photo-manifest-builder.mjs
 *   dotenvx run -- node scripts/photo-manifest-builder.mjs --album "1977 K5 Chevrolet Blazer"
 *   dotenvx run -- node scripts/photo-manifest-builder.mjs --output manifest.json
 */

import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ---------------------------------------------------------------------------
// Album name parser — extracts year/make/model + disambiguation context
// ---------------------------------------------------------------------------

const MAKES = new Set([
  'chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'plymouth', 'pontiac',
  'porsche', 'mercedes', 'lexus', 'ferrari', 'jaguar', 'austin', 'nissan',
  'dmc', 'bmw', 'toyota', 'jeep', 'bronco',
]);

const BODY_CODES = new Set([
  'swb', 'lwb', 'crew cab', 'dually', 'suburban', 'blazer', 'jimmy',
  'convertible', 'coupe', 'sedan', 'fb', 'cpe', 'roadster', 'spider',
]);

const COLORS = new Set([
  'red', 'blue', 'black', 'blk', 'white', 'brown', 'green', 'yellow',
  'orange', 'silver', 'gold', 'tan', 'copper', 'maroon', 'gray', 'grey',
]);

function parseAlbumName(name) {
  const trimmed = name.trim();
  const tokens = trimmed.split(/\s+/);

  const result = {
    raw_name: trimmed,
    year: null,
    make: null,
    model: null,
    body_style: null,
    color: null,
    person: null,
    extra: [],
    is_vehicle_album: false,
  };

  // Extract year (4 digits, 1900-2030)
  const yearMatch = trimmed.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
    result.is_vehicle_album = true;
  } else {
    // Non-vehicle album (WhatsApp, Cards, DECK, etc.)
    return result;
  }

  // Walk remaining tokens
  let afterYear = false;
  for (const token of tokens) {
    if (token === String(result.year)) { afterYear = true; continue; }
    if (!afterYear) continue;

    const lower = token.toLowerCase();

    // Make
    if (!result.make && MAKES.has(lower)) {
      result.make = capitalize(lower);
      continue;
    }

    // Color
    if (COLORS.has(lower)) {
      result.color = capitalize(lower);
      continue;
    }

    // Body style
    if (BODY_CODES.has(lower)) {
      result.body_style = (result.body_style ? result.body_style + ' ' : '') + token.toUpperCase();
      continue;
    }

    // Model (first unrecognized token after make, or after year if no make)
    if (!result.model && result.make) {
      result.model = token;
      continue;
    } else if (!result.model && !result.make) {
      // Could be make or model — check next token
      // Try as make first
      if (MAKES.has(lower)) {
        result.make = capitalize(lower);
      } else {
        result.model = token;
      }
      continue;
    }

    // Person name or extra context (e.g., "Brad", "Justin")
    if (/^[A-Z][a-z]+$/.test(token) && !MAKES.has(lower) && !COLORS.has(lower) && !BODY_CODES.has(lower)) {
      result.person = token;
      continue;
    }

    result.extra.push(token);
  }

  // Fix common patterns
  if (result.make === 'Bronco') {
    result.model = result.model || 'Bronco';
    result.make = 'Ford';
  }
  if (result.make === 'Gto') {
    result.model = 'GTO';
    result.make = result.extra[0] ? capitalize(result.extra[0].toLowerCase()) : null;
  }

  return result;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// GPS clustering — group photos by location
// ---------------------------------------------------------------------------

function clusterByGPS(photos, precisionDeg = 0.002) {
  // ~200m precision
  const clusters = new Map();
  for (const p of photos) {
    if (!p.latitude || !p.longitude) continue;
    const key = `${(Math.round(p.latitude / precisionDeg) * precisionDeg).toFixed(3)},${(Math.round(p.longitude / precisionDeg) * precisionDeg).toFixed(3)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(p);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Session clustering — group photos by time proximity
// ---------------------------------------------------------------------------

function clusterBySessions(photos, gapMinutes = 30) {
  const sorted = photos
    .filter(p => p.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const sessions = [];
  let currentSession = [];

  for (const p of sorted) {
    if (currentSession.length === 0) {
      currentSession.push(p);
      continue;
    }
    const gap = (new Date(p.date) - new Date(currentSession[currentSession.length - 1].date)) / 60000;
    if (gap > gapMinutes) {
      sessions.push(currentSession);
      currentSession = [p];
    } else {
      currentSession.push(p);
    }
  }
  if (currentSession.length > 0) sessions.push(currentSession);
  return sessions;
}

// ---------------------------------------------------------------------------
// Match albums to existing DB vehicle profiles
// ---------------------------------------------------------------------------

async function loadExistingProfiles(userId) {
  const { data } = await supabase.rpc('get_disambiguation_queue', { p_user_id: userId });

  // Also get all vehicles the user has relationships with
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, trim, vin, status, primary_image_url')
    .in('status', ['active', 'pending', 'discovered', 'pending_backfill']);

  return vehicles || [];
}

function matchAlbumToProfile(parsed, profiles) {
  if (!parsed.year) return null;

  const candidates = profiles.filter(v => {
    if (v.year !== parsed.year) return false;
    if (parsed.make && v.make && v.make.toLowerCase() !== parsed.make.toLowerCase()) return false;
    if (parsed.model && v.model) {
      const albumModel = parsed.model.toLowerCase();
      const dbModel = v.model.toLowerCase();
      if (dbModel.includes(albumModel) || albumModel.includes(dbModel)) return true;
      return false;
    }
    return true;
  });

  if (candidates.length === 1) return { match: candidates[0], confidence: 'exact' };
  if (candidates.length > 1) return { match: candidates, confidence: 'ambiguous' };
  return null;
}

// ---------------------------------------------------------------------------
// Process a single album
// ---------------------------------------------------------------------------

function getAlbumPhotos(albumName) {
  try {
    const raw = execSync(
      `osxphotos query --album "${albumName}" --json 2>/dev/null`,
      { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function analyzeAlbum(albumName, photos) {
  const parsed = parseAlbumName(albumName);

  const hasGps = photos.filter(p => p.latitude).length;
  const hasDate = photos.filter(p => p.date).length;
  const sessions = clusterBySessions(photos);
  const gpsClusters = clusterByGPS(photos);

  // Find dominant GPS location
  let dominantLocation = null;
  let maxCount = 0;
  for (const [key, cluster] of gpsClusters) {
    if (cluster.length > maxCount) {
      maxCount = cluster.length;
      dominantLocation = key;
    }
  }

  // Date range
  const dates = photos.filter(p => p.date).map(p => new Date(p.date)).sort((a, b) => a - b);
  const firstDate = dates[0]?.toISOString().split('T')[0] || null;
  const lastDate = dates[dates.length - 1]?.toISOString().split('T')[0] || null;

  // Unique cameras/devices
  const devices = new Set(photos.filter(p => p.camera_model).map(p => `${p.camera_make} ${p.camera_model}`));

  return {
    album_name: albumName,
    parsed,
    photo_count: photos.length,
    metadata: {
      has_gps: hasGps,
      has_date: hasDate,
      gps_pct: photos.length > 0 ? Math.round(100 * hasGps / photos.length) : 0,
      date_range: firstDate && lastDate ? `${firstDate} → ${lastDate}` : null,
      session_count: sessions.length,
      gps_cluster_count: gpsClusters.size,
      dominant_location: dominantLocation,
      devices: [...devices],
    },
    db_match: null, // filled in later
    action: null, // filled in later: 'match_existing', 'create_new', 'ambiguous', 'skip'
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const singleAlbum = args.includes('--album') ? args[args.indexOf('--album') + 1] : null;
  const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'photo-manifest.json';
  const userId = '0b9f107a-d124-49de-9ded-94698f63c1c4';

  console.log('=== Photo Manifest Builder ===\n');

  // 1. Get all album names
  console.log('Loading albums from Photos library...');
  const albumListRaw = execSync('osxphotos albums 2>/dev/null', { encoding: 'utf8' });
  const albumLines = albumListRaw.split('\n').filter(l => l.match(/^\s+/));

  const albums = [];
  for (const line of albumLines) {
    const match = line.match(/^\s+'?(.+?)'?:\s+(\d+)/);
    if (match) {
      albums.push({ name: match[1].trim(), count: parseInt(match[2]) });
    }
  }
  console.log(`Found ${albums.length} albums\n`);

  // Filter to vehicle albums (or single album)
  let targetAlbums = singleAlbum
    ? albums.filter(a => a.name.includes(singleAlbum))
    : albums;

  // 2. Load existing DB profiles
  console.log('Loading existing vehicle profiles from DB...');
  const profiles = await loadExistingProfiles(userId);
  console.log(`Found ${profiles.length} existing profiles\n`);

  // 3. Process each album
  const manifest = [];
  let totalPhotos = 0;
  let totalGps = 0;

  for (let i = 0; i < targetAlbums.length; i++) {
    const album = targetAlbums[i];
    const pct = Math.round(100 * (i + 1) / targetAlbums.length);
    process.stdout.write(`\r[${pct}%] Processing: ${album.name.padEnd(45)} `);

    const photos = getAlbumPhotos(album.name);
    const analysis = analyzeAlbum(album.name, photos);

    // Match to existing profile
    if (analysis.parsed.is_vehicle_album) {
      const match = matchAlbumToProfile(analysis.parsed, profiles);
      if (match && match.confidence === 'exact') {
        analysis.db_match = {
          vehicle_id: match.match.id,
          desc: `${match.match.year} ${match.match.make || ''} ${match.match.model || ''}`.trim(),
          vin: match.match.vin,
          confidence: 'exact',
        };
        analysis.action = 'match_existing';
      } else if (match && match.confidence === 'ambiguous') {
        analysis.db_match = {
          candidates: match.match.map(v => ({
            vehicle_id: v.id,
            desc: `${v.year} ${v.make || ''} ${v.model || ''}`.trim(),
            vin: v.vin,
          })),
          confidence: 'ambiguous',
        };
        analysis.action = 'ambiguous';
      } else {
        analysis.action = 'create_new';
      }
    } else {
      analysis.action = 'skip'; // Non-vehicle album
    }

    totalPhotos += analysis.photo_count;
    totalGps += analysis.metadata.has_gps;
    manifest.push(analysis);
  }

  console.log('\n');

  // 4. Generate summary
  const vehicleAlbums = manifest.filter(m => m.parsed.is_vehicle_album);
  const matched = manifest.filter(m => m.action === 'match_existing');
  const needsNew = manifest.filter(m => m.action === 'create_new');
  const ambiguous = manifest.filter(m => m.action === 'ambiguous');
  const skipped = manifest.filter(m => m.action === 'skip');

  console.log('=== MANIFEST SUMMARY ===\n');
  console.log(`Total albums: ${manifest.length}`);
  console.log(`Total photos: ${totalPhotos.toLocaleString()}`);
  console.log(`Photos with GPS: ${totalGps.toLocaleString()} (${Math.round(100 * totalGps / totalPhotos)}%)\n`);

  console.log(`Vehicle albums: ${vehicleAlbums.length}`);
  console.log(`  ✓ Matched to existing profile: ${matched.length}`);
  console.log(`  + Need new profile: ${needsNew.length}`);
  console.log(`  ? Ambiguous (multiple candidates): ${ambiguous.length}`);
  console.log(`  ✗ Skipped (non-vehicle): ${skipped.length}\n`);

  // Show matched
  if (matched.length > 0) {
    console.log('--- MATCHED TO EXISTING PROFILES ---');
    for (const m of matched) {
      console.log(`  "${m.album_name}" (${m.photo_count} photos, ${m.metadata.gps_pct}% GPS)`);
      console.log(`    → ${m.db_match.desc} [${m.db_match.vehicle_id.slice(0, 8)}] ${m.db_match.vin || 'NO VIN'}`);
    }
    console.log();
  }

  // Show needs new
  if (needsNew.length > 0) {
    console.log('--- NEED NEW VEHICLE PROFILES ---');
    for (const m of needsNew) {
      const p = m.parsed;
      console.log(`  "${m.album_name}" (${m.photo_count} photos, ${m.metadata.gps_pct}% GPS)`);
      console.log(`    → ${p.year} ${p.make || '?'} ${p.model || '?'} ${p.body_style || ''} ${p.color || ''} ${p.person || ''}`.trimEnd());
      if (m.metadata.date_range) console.log(`    📅 ${m.metadata.date_range}`);
      if (m.metadata.dominant_location) console.log(`    📍 ${m.metadata.dominant_location}`);
    }
    console.log();
  }

  // Show ambiguous
  if (ambiguous.length > 0) {
    console.log('--- AMBIGUOUS (NEED YOUR INPUT) ---');
    for (const m of ambiguous) {
      console.log(`  "${m.album_name}" (${m.photo_count} photos)`);
      console.log(`    Candidates:`);
      for (const c of m.db_match.candidates) {
        console.log(`      - ${c.desc} [${c.vehicle_id.slice(0, 8)}] ${c.vin || 'NO VIN'}`);
      }
    }
    console.log();
  }

  // Show skipped
  if (skipped.length > 0) {
    console.log('--- SKIPPED (NON-VEHICLE) ---');
    for (const m of skipped) {
      console.log(`  "${m.album_name}" (${m.photo_count} photos)`);
    }
    console.log();
  }

  // 5. Save manifest
  const outputPath = `/Users/skylar/nuke/${outputFile}`;
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest saved to: ${outputPath}`);
  console.log('Review the manifest, then run photo-intake with --manifest to upload approved albums.');
}

main().catch(console.error);
