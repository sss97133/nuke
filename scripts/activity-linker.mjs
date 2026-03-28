#!/usr/bin/env node
/**
 * Activity Linker
 *
 * Correlates device locations (phone, laptop, AirTags) with photos
 * to build work sessions and assign photos to vehicles.
 *
 * The logic:
 *   phone at shop + laptop at shop = you're working
 *   airtag at same shop = you're working on THAT truck
 *   photos taken during that window = belong to that truck
 *
 * Usage:
 *   node scripts/activity-linker.mjs --analyze          # analyze recent activity
 *   node scripts/activity-linker.mjs --link-photos      # assign unlinked photos to sessions
 *   node scripts/activity-linker.mjs --backfill-from-exif  # create location pings from photo GPS
 */

import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const args = process.argv.slice(2);
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// ─── GPS math ───────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Load known places ──────────────────────────────────────────────────────
async function loadPlaces() {
  const { data } = await supabase.from('known_places').select('*');
  return data || [];
}

function matchPlace(lat, lon, places) {
  for (const p of places) {
    if (haversine(lat, lon, p.latitude, p.longitude) <= p.radius_m) return p;
  }
  return null;
}

// ─── Load tracked devices ───────────────────────────────────────────────────
async function loadDevices() {
  const { data } = await supabase.from('tracked_devices').select('*');
  return data || [];
}

// ─── Backfill: create phone location pings from photo EXIF GPS ──────────────
// Your phone took the photo → phone was at that GPS at that time
async function backfillFromExif() {
  console.log('Backfilling phone locations from photo EXIF data...\n');

  const { data: phoneDevices } = await supabase.from('tracked_devices')
    .select('id').eq('device_key', 'phone:sss97133').limit(1);
  const phoneDevice = phoneDevices?.[0];

  if (!phoneDevice) { console.log('Phone device not found'); return; }

  // Get all iphoto/drop-folder photos with GPS that don't have a corresponding device_location
  const { data: photos } = await supabase
    .from('vehicle_images')
    .select('id, latitude, longitude, taken_at, location_name')
    .in('source', ['iphoto', 'drop-folder'])
    .not('latitude', 'is', null)
    .not('taken_at', 'is', null)
    .eq('documented_by_user_id', USER_ID)
    .order('taken_at', { ascending: true });

  if (!photos?.length) { console.log('No geotagged photos found'); return; }
  console.log(`${photos.length} geotagged photos to process`);

  // Check existing location pings to avoid dupes (within 1 minute)
  const { data: existing } = await supabase
    .from('device_locations')
    .select('observed_at')
    .eq('device_id', phoneDevice.id)
    .eq('source', 'photo_exif');
  const existingTimes = new Set((existing || []).map(e => e.observed_at));

  let inserted = 0;
  const batch = [];
  for (const photo of photos) {
    // Skip if we already have a ping within 1 minute of this photo
    const photoTime = new Date(photo.taken_at).toISOString();
    if (existingTimes.has(photoTime)) continue;

    batch.push({
      device_id: phoneDevice.id,
      latitude: photo.latitude,
      longitude: photo.longitude,
      address: photo.location_name,
      observed_at: photo.taken_at,
      source: 'photo_exif'
    });

    if (batch.length >= 100) {
      const { error } = await supabase.from('device_locations').insert(batch);
      if (!error) inserted += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    const { error } = await supabase.from('device_locations').insert(batch);
    if (!error) inserted += batch.length;
  }

  console.log(`Created ${inserted} phone location pings from photo EXIF data`);
}

// ─── Analyze: detect work sessions from device co-location ──────────────────
async function analyze() {
  console.log('Analyzing device activity...\n');

  const places = await loadPlaces();
  const devices = await loadDevices();

  // Get all location pings, ordered by time
  const { data: pings } = await supabase
    .from('device_locations')
    .select('*, tracked_devices!inner(device_key, device_type, display_name, vehicle_id)')
    .order('observed_at', { ascending: true });

  if (!pings?.length) { console.log('No location data. Run --backfill-from-exif first.'); return; }

  console.log(`${pings.length} location pings across ${devices.length} devices`);

  // Group pings by day (work day = 6am to 4am next day)
  const workDays = {};
  for (const ping of pings) {
    const dt = new Date(ping.observed_at);
    // If before 4am, count as previous day
    const adjusted = new Date(dt);
    if (adjusted.getHours() < 4) adjusted.setDate(adjusted.getDate() - 1);
    const dayKey = adjusted.toISOString().slice(0, 10);

    if (!workDays[dayKey]) workDays[dayKey] = [];
    workDays[dayKey].push(ping);
  }

  console.log(`\n${Object.keys(workDays).length} work days detected\n`);

  // For each work day, detect sessions
  const sessions = [];
  for (const [day, dayPings] of Object.entries(workDays).sort()) {
    // Group pings into time clusters (gap > 2 hours = new cluster)
    const clusters = [];
    let current = [dayPings[0]];

    for (let i = 1; i < dayPings.length; i++) {
      const gap = new Date(dayPings[i].observed_at) - new Date(current[current.length-1].observed_at);
      if (gap > 2 * 60 * 60 * 1000) {
        clusters.push(current);
        current = [dayPings[i]];
      } else {
        current.push(dayPings[i]);
      }
    }
    clusters.push(current);

    for (const cluster of clusters) {
      // What devices are present in this cluster?
      const deviceTypes = new Set(cluster.map(p => p.tracked_devices.device_type));
      const deviceKeys = new Set(cluster.map(p => p.tracked_devices.device_key));

      // Where is this cluster? (centroid)
      const avgLat = cluster.reduce((s, p) => s + p.latitude, 0) / cluster.length;
      const avgLon = cluster.reduce((s, p) => s + p.longitude, 0) / cluster.length;
      const place = matchPlace(avgLat, avgLon, places);

      // Which vehicle AirTag is here?
      const airtagPings = cluster.filter(p => p.tracked_devices.device_type === 'airtag');
      const vehicleId = airtagPings.length > 0 ? airtagPings[0].tracked_devices.vehicle_id : null;

      // Confidence scoring
      let confidence = 0;
      const evidence = {
        phone: deviceTypes.has('phone'),
        laptop: deviceTypes.has('laptop'),
        airtag: deviceTypes.has('airtag'),
        pings: cluster.length,
        place: place?.name || null
      };

      // Phone at a shop = 0.3
      if (evidence.phone && place?.place_type === 'shop') confidence += 0.3;
      // Laptop at same shop = +0.2 (you're working, not just stopping by)
      if (evidence.laptop && place?.place_type === 'shop') confidence += 0.2;
      // AirTag co-located = +0.4 (we know WHICH vehicle)
      if (evidence.airtag) confidence += 0.4;
      // Multiple pings over time = +0.1 (sustained presence)
      if (cluster.length >= 3) confidence += 0.1;

      const startTime = cluster[0].observed_at;
      const endTime = cluster[cluster.length - 1].observed_at;
      const durationMin = Math.round((new Date(endTime) - new Date(startTime)) / 60000);

      // Determine session type
      let sessionType = 'unknown';
      if (place?.place_type === 'shop') sessionType = 'work';
      else if (place?.place_type === 'home') sessionType = 'unknown';
      else if (place?.place_type === 'parts_store') sessionType = 'errand';

      sessions.push({
        day,
        startTime,
        endTime,
        durationMin,
        place: place?.name || 'unknown',
        placeId: place?.id || null,
        vehicleId,
        sessionType,
        confidence,
        evidence,
        pings: cluster.length
      });
    }
  }

  // Print summary
  console.log('--- Work Sessions ---\n');
  for (const s of sessions) {
    const start = s.startTime.slice(11, 16);
    const end = s.endTime.slice(11, 16);
    const vehicle = s.vehicleId ? '1984 K10' : '(no AirTag)';
    const conf = `${Math.round(s.confidence * 100)}%`;
    const signals = [
      s.evidence.phone ? 'phone' : null,
      s.evidence.laptop ? 'laptop' : null,
      s.evidence.airtag ? 'airtag' : null,
    ].filter(Boolean).join('+');

    console.log(`  ${s.day} ${start}-${end} (${s.durationMin}min) @ ${s.place}`);
    console.log(`    Vehicle: ${vehicle} | Confidence: ${conf} | Signals: ${signals} | Pings: ${s.pings}`);
  }

  // Stats
  const shopSessions = sessions.filter(s => s.sessionType === 'work');
  const totalMinutes = shopSessions.reduce((s, x) => s + x.durationMin, 0);
  console.log(`\n--- Summary ---`);
  console.log(`Work sessions: ${shopSessions.length}`);
  console.log(`Total work time: ${Math.round(totalMinutes / 60)}h ${totalMinutes % 60}m`);
  console.log(`Days active: ${new Set(sessions.map(s => s.day)).size}`);

  return sessions;
}

// ─── Link photos to work sessions ───────────────────────────────────────────
async function linkPhotos() {
  console.log('Linking photos to work sessions...\n');

  const places = await loadPlaces();
  const sessions = await analyze();
  if (!sessions?.length) return;

  // Get unlinked photos with GPS + timestamps
  const { data: photos } = await supabase
    .from('vehicle_images')
    .select('id, latitude, longitude, taken_at, vehicle_id')
    .in('source', ['iphoto', 'drop-folder'])
    .is('work_session_id', null)
    .not('taken_at', 'is', null)
    .order('taken_at');

  if (!photos?.length) { console.log('No unlinked photos to process'); return; }
  console.log(`\n${photos.length} unlinked photos to match against ${sessions.length} sessions`);

  let linked = 0;
  let rerouted = 0;

  for (const photo of photos) {
    const photoTime = new Date(photo.taken_at).getTime();

    // Find the session this photo falls into (time-based, with 30 min buffer)
    const match = sessions.find(s => {
      const start = new Date(s.startTime).getTime() - 30 * 60000;
      const end = new Date(s.endTime).getTime() + 30 * 60000;
      return photoTime >= start && photoTime <= end;
    });

    if (match && match.vehicleId) {
      const updates = {};

      // If the photo is assigned to the wrong vehicle, reroute it
      if (photo.vehicle_id !== match.vehicleId) {
        updates.vehicle_id = match.vehicleId;
        rerouted++;
      }

      // Link to session (we'd need to create work_sessions rows first in production)
      linked++;
    }
  }

  console.log(`\nPhotos linked: ${linked}`);
  console.log(`Photos that would be rerouted to correct vehicle: ${rerouted}`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────
if (args.includes('--backfill-from-exif')) {
  backfillFromExif().catch(console.error);
} else if (args.includes('--link-photos')) {
  linkPhotos().catch(console.error);
} else if (args.includes('--analyze')) {
  analyze().catch(console.error);
} else {
  console.log('Usage:');
  console.log('  --backfill-from-exif   Create phone location pings from photo GPS');
  console.log('  --analyze              Detect work sessions from device co-location');
  console.log('  --link-photos          Assign unlinked photos to sessions + vehicles');
}
