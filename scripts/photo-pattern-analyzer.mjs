#!/usr/bin/env node
/**
 * photo-pattern-analyzer.mjs
 *
 * Derives the WHO/WHAT/WHERE/WHEN from immutable photo facts.
 * Then infers the WHY from patterns.
 *
 * Layer 1: Immutable facts (GPS, timestamp, device, dimensions)
 * Layer 2: Derived facts (locations, sessions, device fingerprints)
 * Layer 3: Patterns (frequency, duration, progression, co-occurrence)
 * Layer 4: Why (relationship inference from patterns)
 *
 * Usage:
 *   dotenvx run -- node scripts/photo-pattern-analyzer.mjs
 *   dotenvx run -- node scripts/photo-pattern-analyzer.mjs --album "1977 K5 Chevrolet Blazer"
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Layer 1: Extract immutable facts from all photos
// ---------------------------------------------------------------------------

function getAlbumPhotos(albumName) {
  try {
    const raw = execSync(
      `osxphotos query --album "${albumName}" --json 2>/dev/null`,
      { encoding: 'utf8', maxBuffer: 500 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function extractFacts(photo) {
  return {
    uuid: photo.uuid,
    filename: photo.filename,
    lat: photo.latitude || null,
    lng: photo.longitude || null,
    date: photo.date || null,
    ts: photo.date ? new Date(photo.date).getTime() : null,
    width: photo.width || null,
    height: photo.height || null,
    camera_make: photo.camera_make || null,
    camera_model: photo.camera_model || null,
    lens: photo.lens_model || null,
    is_screenshot: photo.isscreenshot || false,
    is_live: photo.live_photo || false,
    is_video: photo.ismovie || false,
    is_selfie: photo.selfie || false,
    favorite: photo.favorite || false,
    has_adjustments: photo.hasadjustments || false,
    orientation: photo.orientation || null,
    // Derived immediately
    device_fingerprint: photo.camera_make && photo.camera_model
      ? `${photo.camera_make}/${photo.camera_model}` : null,
    has_gps: !!(photo.latitude && photo.longitude),
    has_date: !!photo.date,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: Derive locations, sessions, device patterns
// ---------------------------------------------------------------------------

// Cluster GPS points into named locations
function buildLocationRegistry(allFacts) {
  const PRECISION = 0.0015; // ~150m clusters
  const clusters = new Map();

  for (const f of allFacts) {
    if (!f.has_gps) continue;
    const key = `${(Math.round(f.lat / PRECISION) * PRECISION).toFixed(4)},${(Math.round(f.lng / PRECISION) * PRECISION).toFixed(4)}`;
    if (!clusters.has(key)) clusters.set(key, { lat: 0, lng: 0, photos: [], albums: new Set() });
    const c = clusters.get(key);
    c.lat += f.lat;
    c.lng += f.lng;
    c.photos.push(f);
    c.albums.add(f._album);
  }

  // Convert to array, compute centroids, sort by count
  const locations = [];
  for (const [key, c] of clusters) {
    const n = c.photos.length;
    locations.push({
      key,
      centroid_lat: c.lat / n,
      centroid_lng: c.lng / n,
      photo_count: n,
      album_count: c.albums.size,
      albums: [...c.albums],
      // Date range at this location
      first_seen: c.photos.filter(p => p.ts).sort((a, b) => a.ts - b.ts)[0]?.date || null,
      last_seen: c.photos.filter(p => p.ts).sort((a, b) => b.ts - a.ts)[0]?.date || null,
      // Unique devices seen here
      devices: [...new Set(c.photos.filter(p => p.device_fingerprint).map(p => p.device_fingerprint))],
    });
  }

  return locations.sort((a, b) => b.photo_count - a.photo_count);
}

// Name locations by frequency and pattern
function classifyLocations(locations) {
  for (const loc of locations) {
    // Heuristics based on frequency and album diversity
    if (loc.photo_count > 500 && loc.album_count > 10) {
      loc.classification = 'PRIMARY_WORKSPACE'; // shop, studio
      loc.confidence = 'high';
    } else if (loc.photo_count > 100 && loc.album_count > 5) {
      loc.classification = 'REGULAR_LOCATION'; // secondary shop, home, storage
      loc.confidence = 'medium';
    } else if (loc.album_count >= 3 && loc.photo_count > 20) {
      loc.classification = 'RECURRING_LOCATION'; // client location, partner shop
      loc.confidence = 'medium';
    } else if (loc.album_count === 1 && loc.photo_count > 5) {
      loc.classification = 'SINGLE_VEHICLE_LOCATION'; // where a specific car lives
      loc.confidence = 'low';
    } else {
      loc.classification = 'TRANSIENT'; // car show, sighting, one-off
      loc.confidence = 'low';
    }
  }
  return locations;
}

// Build sessions: contiguous photo bursts within a single album
function buildSessions(facts, gapMinutes = 30) {
  const dated = facts.filter(f => f.ts).sort((a, b) => a.ts - b.ts);
  if (dated.length === 0) return [];

  const sessions = [];
  let current = [dated[0]];

  for (let i = 1; i < dated.length; i++) {
    const gap = (dated[i].ts - current[current.length - 1].ts) / 60000;
    if (gap > gapMinutes) {
      sessions.push(current);
      current = [dated[i]];
    } else {
      current.push(dated[i]);
    }
  }
  if (current.length > 0) sessions.push(current);

  return sessions.map((s, idx) => ({
    session_idx: idx,
    photo_count: s.length,
    start: s[0].date,
    end: s[s.length - 1].date,
    duration_minutes: Math.round((s[s.length - 1].ts - s[0].ts) / 60000),
    // GPS centroid of session
    has_gps: s.some(p => p.has_gps),
    centroid_lat: s.filter(p => p.has_gps).length > 0
      ? s.filter(p => p.has_gps).reduce((sum, p) => sum + p.lat, 0) / s.filter(p => p.has_gps).length
      : null,
    centroid_lng: s.filter(p => p.has_gps).length > 0
      ? s.filter(p => p.has_gps).reduce((sum, p) => sum + p.lng, 0) / s.filter(p => p.has_gps).length
      : null,
    devices: [...new Set(s.filter(p => p.device_fingerprint).map(p => p.device_fingerprint))],
    photos: s,
  }));
}

// ---------------------------------------------------------------------------
// Layer 3: Pattern recognition per album
// ---------------------------------------------------------------------------

function analyzeAlbumPatterns(albumName, facts, sessions, locations) {
  const totalPhotos = facts.length;
  const gpsPhotos = facts.filter(f => f.has_gps);
  const datedPhotos = facts.filter(f => f.ts);

  // Date span
  const dates = datedPhotos.map(f => f.ts).sort((a, b) => a - b);
  const firstDate = dates[0] ? new Date(dates[0]) : null;
  const lastDate = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : null;
  const spanDays = firstDate && lastDate ? Math.round((lastDate - firstDate) / 86400000) : 0;

  // Session frequency
  const sessionDates = sessions.map(s => new Date(s.start).toISOString().split('T')[0]);
  const uniqueDays = new Set(sessionDates).size;

  // GPS location mapping — which known locations does this album hit?
  const LOCATION_RADIUS = 0.003; // ~300m match radius
  const locationHits = new Map();
  for (const f of gpsPhotos) {
    for (const loc of locations) {
      const dlat = Math.abs(f.lat - loc.centroid_lat);
      const dlng = Math.abs(f.lng - loc.centroid_lng);
      if (dlat < LOCATION_RADIUS && dlng < LOCATION_RADIUS) {
        if (!locationHits.has(loc.key)) locationHits.set(loc.key, { loc, count: 0 });
        locationHits.get(loc.key).count++;
        break; // first match wins
      }
    }
  }

  // Device diversity
  const devices = new Set(facts.filter(f => f.device_fingerprint).map(f => f.device_fingerprint));

  // Photo type breakdown
  const screenshots = facts.filter(f => f.is_screenshot).length;
  const videos = facts.filter(f => f.is_video).length;
  const selfies = facts.filter(f => f.is_selfie).length;
  const favorites = facts.filter(f => f.favorite).length;
  const edited = facts.filter(f => f.has_adjustments).length;

  return {
    album_name: albumName,
    total_photos: totalPhotos,
    gps_pct: totalPhotos > 0 ? Math.round(100 * gpsPhotos.length / totalPhotos) : 0,
    date_range: firstDate && lastDate
      ? `${firstDate.toISOString().split('T')[0]} → ${lastDate.toISOString().split('T')[0]}`
      : null,
    span_days: spanDays,
    session_count: sessions.length,
    unique_days: uniqueDays,
    avg_photos_per_session: sessions.length > 0 ? Math.round(totalPhotos / sessions.length) : 0,
    // Frequency pattern
    frequency: spanDays > 0 ? +(uniqueDays / (spanDays / 7)).toFixed(2) : null, // sessions per week
    // Location breakdown
    locations_hit: [...locationHits.values()].map(h => ({
      key: h.loc.key,
      classification: h.loc.classification,
      photo_count: h.count,
      pct: Math.round(100 * h.count / gpsPhotos.length),
    })).sort((a, b) => b.photo_count - a.photo_count),
    primary_location: [...locationHits.values()].sort((a, b) => b.count - a.count)[0]?.loc.classification || null,
    // Content signals
    devices: [...devices],
    screenshots,
    videos,
    selfies,
    favorites,
    edited,
  };
}

// ---------------------------------------------------------------------------
// Layer 4: Infer WHY — relationship classification from patterns
// ---------------------------------------------------------------------------

function inferRelationship(pattern) {
  const {
    span_days, session_count, unique_days, frequency, total_photos,
    primary_location, locations_hit, screenshots, selfies, gps_pct,
  } = pattern;

  const signals = [];
  let relationship = 'UNKNOWN';
  let confidence = 0;

  // Signal: Long-term engagement (months of photos)
  if (span_days > 90 && unique_days > 10) {
    signals.push(`LONG_TERM: ${span_days} days, ${unique_days} visits`);
    confidence += 30;
  }

  // Signal: High frequency (weekly+ visits)
  if (frequency && frequency > 0.5) {
    signals.push(`HIGH_FREQUENCY: ${frequency} sessions/week`);
    confidence += 20;
  }

  // Signal: Primary workspace location
  if (primary_location === 'PRIMARY_WORKSPACE') {
    signals.push('AT_PRIMARY_WORKSPACE');
    confidence += 25;
  }

  // Signal: Volume (lots of photos = active engagement)
  if (total_photos > 100) {
    signals.push(`HIGH_VOLUME: ${total_photos} photos`);
    confidence += 15;
  }

  // Signal: Single session, different location = sighting or purchase inspection
  if (session_count === 1 && total_photos < 30) {
    signals.push('SINGLE_SESSION');
    relationship = 'SIGHTING_OR_INSPECTION';
    confidence = Math.min(confidence, 40);
  }

  // Signal: Screenshots mixed in = research/listing reference
  if (screenshots > 0 && screenshots / total_photos > 0.1) {
    signals.push(`SCREENSHOTS: ${screenshots}/${total_photos} = research`);
  }

  // Classify
  if (relationship === 'UNKNOWN') {
    if (span_days > 180 && unique_days > 20 && primary_location === 'PRIMARY_WORKSPACE') {
      relationship = 'ACTIVE_PROJECT'; // Long-term work at shop
      confidence = Math.min(95, confidence + 20);
    } else if (span_days > 90 && unique_days > 5) {
      relationship = 'ONGOING_INVOLVEMENT'; // Regular but less intense
      confidence = Math.min(80, confidence + 10);
    } else if (span_days > 30 && unique_days > 3) {
      relationship = 'SHORT_PROJECT'; // Weeks of focused work
      confidence = Math.min(70, confidence + 10);
    } else if (session_count <= 3 && span_days < 7) {
      relationship = 'BRIEF_ENCOUNTER'; // Consignment intake, inspection, show
      confidence = Math.min(60, confidence);
    } else if (total_photos > 50 && span_days < 30) {
      relationship = 'INTENSIVE_BURST'; // Rapid documentation (delivery, accident, etc.)
      confidence = Math.min(65, confidence);
    } else {
      relationship = 'CASUAL'; // Low engagement, unclear
      confidence = Math.min(40, confidence);
    }
  }

  // No GPS = lower confidence (can't verify location)
  if (gps_pct < 30) {
    confidence = Math.max(10, confidence - 20);
    signals.push('LOW_GPS: reduced confidence');
  }

  return {
    inferred_relationship: relationship,
    confidence: Math.min(100, confidence),
    signals,
  };
}

// ---------------------------------------------------------------------------
// Cross-album analysis: find albums that share vehicles (co-occurrence)
// ---------------------------------------------------------------------------

function findCoOccurrences(albumFacts) {
  // Albums that overlap in time AND location probably share vehicles
  const pairs = [];
  const albumNames = Object.keys(albumFacts);

  for (let i = 0; i < albumNames.length; i++) {
    for (let j = i + 1; j < albumNames.length; j++) {
      const a = albumFacts[albumNames[i]];
      const b = albumFacts[albumNames[j]];

      // Check temporal overlap
      const aDates = a.filter(f => f.ts).map(f => f.ts);
      const bDates = b.filter(f => f.ts).map(f => f.ts);
      if (aDates.length === 0 || bDates.length === 0) continue;

      const aMin = Math.min(...aDates), aMax = Math.max(...aDates);
      const bMin = Math.min(...bDates), bMax = Math.max(...bDates);

      const overlap = Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
      if (overlap === 0) continue;

      // Check GPS overlap
      const aGps = a.filter(f => f.has_gps);
      const bGps = b.filter(f => f.has_gps);
      if (aGps.length === 0 || bGps.length === 0) continue;

      // Simple: check if centroids are within 500m
      const aCentLat = aGps.reduce((s, f) => s + f.lat, 0) / aGps.length;
      const aCentLng = aGps.reduce((s, f) => s + f.lng, 0) / aGps.length;
      const bCentLat = bGps.reduce((s, f) => s + f.lat, 0) / bGps.length;
      const bCentLng = bGps.reduce((s, f) => s + f.lng, 0) / bGps.length;

      const dist = Math.sqrt((aCentLat - bCentLat) ** 2 + (aCentLng - bCentLng) ** 2);
      if (dist < 0.005) { // ~500m
        // Find same-day sessions
        const aDays = new Set(a.filter(f => f.ts).map(f => new Date(f.ts).toISOString().split('T')[0]));
        const bDays = new Set(b.filter(f => f.ts).map(f => new Date(f.ts).toISOString().split('T')[0]));
        const sharedDays = [...aDays].filter(d => bDays.has(d));

        if (sharedDays.length > 0) {
          pairs.push({
            album_a: albumNames[i],
            album_b: albumNames[j],
            shared_days: sharedDays.length,
            shared_location: true,
            temporal_overlap_days: Math.round(overlap / 86400000),
          });
        }
      }
    }
  }

  return pairs.sort((a, b) => b.shared_days - a.shared_days);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const singleAlbum = args.includes('--album') ? args[args.indexOf('--album') + 1] : null;

  console.log('=== Photo Pattern Analyzer ===');
  console.log('Layer 1: Extracting immutable facts...\n');

  // Get albums
  const albumListRaw = execSync('osxphotos albums 2>/dev/null', { encoding: 'utf8' });
  const albumLines = albumListRaw.split('\n').filter(l => l.match(/^\s+/));
  const albums = [];
  for (const line of albumLines) {
    const match = line.match(/^\s+'?(.+?)'?:\s+(\d+)/);
    if (match) albums.push({ name: match[1].trim(), count: parseInt(match[2]) });
  }

  // Filter to vehicle albums (has a year) or single album
  const yearRegex = /\b(19\d{2}|20[0-3]\d)\b/;
  let targetAlbums = singleAlbum
    ? albums.filter(a => a.name.includes(singleAlbum))
    : albums; // ALL albums, not just vehicle ones — non-vehicle albums establish location patterns

  console.log(`Processing ${targetAlbums.length} albums...\n`);

  // Extract facts from every album
  const allFacts = [];
  const albumFacts = {};

  for (let i = 0; i < targetAlbums.length; i++) {
    const album = targetAlbums[i];
    const pct = Math.round(100 * (i + 1) / targetAlbums.length);
    process.stdout.write(`\r[${pct}%] Extracting: ${album.name.padEnd(50)} `);

    const photos = getAlbumPhotos(album.name);
    const facts = photos.map(p => {
      const f = extractFacts(p);
      f._album = album.name;
      return f;
    });

    albumFacts[album.name] = facts;
    allFacts.push(...facts);
  }

  console.log(`\n\nTotal facts extracted: ${allFacts.length.toLocaleString()}\n`);

  // ---------------------------------------------------------------------------
  // Layer 2: Build location registry from ALL photos
  // ---------------------------------------------------------------------------

  console.log('Layer 2: Building location registry...\n');

  const rawLocations = buildLocationRegistry(allFacts);
  const locations = classifyLocations(rawLocations);

  console.log(`Discovered ${locations.length} distinct locations:\n`);

  const significantLocations = locations.filter(l => l.photo_count >= 10);
  for (const loc of significantLocations.slice(0, 20)) {
    const dateSpan = loc.first_seen && loc.last_seen
      ? `${loc.first_seen.split('T')[0]} → ${loc.last_seen.split('T')[0]}`
      : 'no dates';
    console.log(`  ${loc.classification.padEnd(25)} ${loc.key.padEnd(25)} ${String(loc.photo_count).padStart(5)} photos, ${String(loc.album_count).padStart(3)} albums  (${dateSpan})`);
  }

  // ---------------------------------------------------------------------------
  // Layer 3: Analyze patterns per vehicle album
  // ---------------------------------------------------------------------------

  console.log('\n\nLayer 3: Analyzing album patterns...\n');

  const albumAnalyses = [];
  const vehicleAlbumNames = Object.keys(albumFacts).filter(name => yearRegex.test(name));

  for (const albumName of vehicleAlbumNames) {
    const facts = albumFacts[albumName];
    if (facts.length === 0) continue;

    const sessions = buildSessions(facts);
    const pattern = analyzeAlbumPatterns(albumName, facts, sessions, locations);
    albumAnalyses.push(pattern);
  }

  // Sort by total photos descending
  albumAnalyses.sort((a, b) => b.total_photos - a.total_photos);

  // ---------------------------------------------------------------------------
  // Layer 4: Infer WHY for each album
  // ---------------------------------------------------------------------------

  console.log('Layer 4: Inferring relationships...\n');

  const results = [];
  for (const pattern of albumAnalyses) {
    const inference = inferRelationship(pattern);
    results.push({
      ...pattern,
      ...inference,
    });
  }

  // Print results grouped by inferred relationship
  const groups = {};
  for (const r of results) {
    if (!groups[r.inferred_relationship]) groups[r.inferred_relationship] = [];
    groups[r.inferred_relationship].push(r);
  }

  for (const [rel, items] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n--- ${rel} (${items.length} albums) ---`);
    for (const r of items) {
      const loc = r.locations_hit[0] ? `@ ${r.locations_hit[0].classification}` : '';
      console.log(`  "${r.album_name}" (${r.total_photos} photos, ${r.span_days}d span, ${r.session_count} sessions, ${r.confidence}% conf) ${loc}`);
      console.log(`    ${r.signals.join(' | ')}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-album analysis
  // ---------------------------------------------------------------------------

  console.log('\n\n=== Cross-Album Co-occurrence ===');
  console.log('Albums that overlap in time AND space (likely same-session photos of different vehicles):\n');

  const coOccurrences = findCoOccurrences(albumFacts);
  for (const co of coOccurrences.slice(0, 30)) {
    console.log(`  "${co.album_a}" ↔ "${co.album_b}" — ${co.shared_days} shared days, ${co.temporal_overlap_days}d overlap`);
  }

  // ---------------------------------------------------------------------------
  // Likely duplicates (same year/make, overlapping time+location)
  // ---------------------------------------------------------------------------

  console.log('\n\n=== Likely Duplicate Albums (same vehicle, different album names) ===\n');

  for (const co of coOccurrences) {
    // Check if both albums are for similar vehicles
    const yearA = co.album_a.match(yearRegex)?.[1];
    const yearB = co.album_b.match(yearRegex)?.[1];
    if (yearA && yearB && yearA === yearB) {
      // Same year + overlapping time/location = probably same vehicle
      const tokensA = new Set(co.album_a.toLowerCase().split(/\s+/));
      const tokensB = new Set(co.album_b.toLowerCase().split(/\s+/));
      const shared = [...tokensA].filter(t => tokensB.has(t) && t.length > 2);
      if (shared.length >= 2) { // share year + at least one more word
        console.log(`  LIKELY SAME: "${co.album_a}" ↔ "${co.album_b}" (${co.shared_days} shared days, tokens: ${shared.join(', ')})`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Save full analysis
  // ---------------------------------------------------------------------------

  const output = {
    generated_at: new Date().toISOString(),
    total_photos: allFacts.length,
    total_albums: targetAlbums.length,
    vehicle_albums: vehicleAlbumNames.length,
    locations: significantLocations.slice(0, 50),
    album_analyses: results,
    co_occurrences: coOccurrences.slice(0, 100),
  };

  const outputPath = '/Users/skylar/nuke/photo-analysis.json';
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n\nFull analysis saved to: ${outputPath}`);
}

main().catch(console.error);
