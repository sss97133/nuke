#!/usr/bin/env node
/**
 * K5 Blazer Photo EXIF Deep Scan + Build Phase Tagging
 *
 * Uses osxphotos CLI to extract full EXIF from the K5 Blazer album,
 * then tags photos by build phase and updates vehicle_images metadata.
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-k5-photo-metadata.mjs              # dry run
 *   dotenvx run -- node scripts/enrich-k5-photo-metadata.mjs --apply      # write to DB
 */

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const ALBUM_NAME = "1977 K5 Chevrolet Blazer";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const DRY_RUN = !process.argv.includes("--apply");

// ── Build Phase Definitions ──────────────────────────────────────────────
const BUILD_PHASES = [
  { name: "BASELINE", label: "Baseline / Pre-Build", start: "2021-01-01", end: "2021-08-31", color: "#6b7280" },
  { name: "PLANNING", label: "Planning & Sourcing", start: "2021-09-01", end: "2022-06-30", color: "#3b82f6" },
  { name: "ACQUISITION", label: "Major Parts Acquisition", start: "2022-07-01", end: "2023-06-30", color: "#f59e0b" },
  { name: "FABRICATION", label: "Fabrication & Install", start: "2023-07-01", end: "2024-08-31", color: "#ef4444" },
  { name: "WIRING", label: "Wiring & Electronics", start: "2024-09-01", end: "2025-06-30", color: "#8b5cf6" },
  { name: "CURRENT", label: "Current / Final Assembly", start: "2025-07-01", end: "2027-12-31", color: "#10b981" },
];

function classifyPhase(dateStr) {
  if (!dateStr) return null;
  const d = dateStr.slice(0, 10);
  for (const phase of BUILD_PHASES) {
    if (d >= phase.start && d <= phase.end) return phase;
  }
  return null;
}

function clusterLocation(lat, lon) {
  if (!lat || !lon) return null;

  // Known locations for K5 build (from GPS cluster analysis)
  const locations = [
    { name: "Home Workshop (Boulder City)", lat: 35.9773, lon: -114.8541, radius: 0.003 },
    { name: "Secondary Location (nearby)", lat: 35.9727, lon: -114.8552, radius: 0.002 },
    { name: "Overlook / Testing Area", lat: 35.9800, lon: -114.8532, radius: 0.002 },
  ];

  for (const loc of locations) {
    const dist = Math.sqrt(Math.pow(lat - loc.lat, 2) + Math.pow(lon - loc.lon, 2));
    if (dist < loc.radius) return loc.name;
  }

  return `Unknown (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

async function main() {
  console.log("=".repeat(70));
  console.log("K5 Blazer Photo EXIF Deep Scan + Build Phase Tagging");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "APPLYING"}`);
  console.log("=".repeat(70));

  // 1. Get photo metadata from osxphotos
  console.log("\nQuerying osxphotos for album metadata...");
  let photos;
  try {
    const raw = execSync(
      `osxphotos query --album "${ALBUM_NAME}" --json 2>/dev/null`,
      { maxBuffer: 100 * 1024 * 1024, timeout: 120000 }
    ).toString();
    photos = JSON.parse(raw);
  } catch (err) {
    console.error("osxphotos query failed:", err.message);
    console.log("Trying with trailing space in album name...");
    try {
      const raw = execSync(
        `osxphotos query --album "${ALBUM_NAME} " --json 2>/dev/null`,
        { maxBuffer: 100 * 1024 * 1024, timeout: 120000 }
      ).toString();
      photos = JSON.parse(raw);
    } catch (err2) {
      console.error("Both album name variants failed. Listing albums...");
      try {
        const albums = execSync("osxphotos albums 2>/dev/null").toString();
        const matching = albums.split("\n").filter(l => l.toLowerCase().includes("blazer") || l.toLowerCase().includes("k5"));
        console.log("Matching albums:", matching.length ? matching : "none found");
      } catch (e) { /* ignore */ }
      process.exit(1);
    }
  }

  console.log(`  Photos in album: ${photos.length}`);

  // 2. Extract and classify metadata
  const enriched = [];
  const phaseCounts = {};
  const locationCounts = {};
  const cameraCounts = {};

  for (const p of photos) {
    const date = p.date || p.date_original || null;
    const lat = p.latitude || p.exif?.latitude || null;
    const lon = p.longitude || p.exif?.longitude || null;
    const camera = p.exif?.camera_make
      ? `${p.exif.camera_make} ${p.exif.camera_model || ""}`.trim()
      : null;

    const phase = classifyPhase(date);
    const location = clusterLocation(lat, lon);

    if (phase) {
      phaseCounts[phase.name] = (phaseCounts[phase.name] || 0) + 1;
    }
    if (location) {
      locationCounts[location] = (locationCounts[location] || 0) + 1;
    }
    if (camera) {
      cameraCounts[camera] = (cameraCounts[camera] || 0) + 1;
    }

    enriched.push({
      uuid: p.uuid,
      filename: p.filename || p.original_filename,
      date,
      lat,
      lon,
      camera,
      phase: phase?.name || null,
      phaseLabel: phase?.label || null,
      location,
      width: p.width,
      height: p.height,
      isScreenshot: p.screenshot || false,
      isFavorite: p.favorite || false,
    });
  }

  // 3. Print analysis
  console.log(`\n${"─".repeat(70)}`);
  console.log("BUILD PHASE DISTRIBUTION");
  console.log("─".repeat(70));
  for (const phase of BUILD_PHASES) {
    const count = phaseCounts[phase.name] || 0;
    const bar = "█".repeat(Math.ceil(count / 5));
    console.log(`  ${phase.name.padEnd(14)} ${String(count).padStart(4)} photos  ${bar}  ${phase.label}`);
  }
  const unphased = enriched.filter(p => !p.phase).length;
  if (unphased > 0) console.log(`  ${"UNKNOWN".padEnd(14)} ${String(unphased).padStart(4)} photos`);

  console.log(`\n${"─".repeat(70)}`);
  console.log("LOCATION CLUSTERS");
  console.log("─".repeat(70));
  const locEntries = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]);
  for (const [loc, count] of locEntries) {
    console.log(`  ${loc}: ${count} photos`);
  }
  if (locEntries.length === 0) console.log("  No GPS data found in photos");

  console.log(`\n${"─".repeat(70)}`);
  console.log("CAMERAS USED");
  console.log("─".repeat(70));
  const camEntries = Object.entries(cameraCounts).sort((a, b) => b[1] - a[1]);
  for (const [cam, count] of camEntries) {
    console.log(`  ${cam}: ${count} photos`);
  }
  if (camEntries.length === 0) console.log("  No camera EXIF data found");

  // 4. Match to vehicle_images and update
  console.log(`\n${"─".repeat(70)}`);
  console.log("MATCHING TO VEHICLE_IMAGES");
  console.log("─".repeat(70));

  // Load existing vehicle_images for this vehicle
  const { data: dbImages, error: imgErr } = await sb
    .from("vehicle_images")
    .select("id, image_url, storage_path, filename, file_name, ai_scan_metadata, source")
    .eq("vehicle_id", VEHICLE_ID)
    .eq("source", "iphoto")
    .limit(2000);

  if (imgErr) { console.error("Failed to load vehicle_images:", imgErr); process.exit(1); }
  console.log(`  DB images (source=iphoto): ${(dbImages || []).length}`);

  // Build basename → DB image lookup
  // DB file_name examples: "53E912D4-2E8E-42FE-86C7-DE2E4458B3DD.jpg", "IMG_0043.jpg"
  // osxphotos filename examples: "53E912D4-2E8E-42FE-86C7-DE2E4458B3DD.heic", "IMG_0043.HEIC"
  // Match on base name (without extension), case-insensitive
  const dbByBasename = {};
  for (const img of dbImages || []) {
    const fname = img.file_name || "";
    const base = fname.replace(/\.[^.]+$/, "").toLowerCase();
    if (base) dbByBasename[base] = img;
  }
  console.log(`  DB basename index size: ${Object.keys(dbByBasename).length}`);

  let matched = 0, unmatched = 0;
  const updates = [];

  for (const photo of enriched) {
    // osxphotos gives us 'filename' which is the Photos library filename
    // Match by base name without extension (handles heic→jpg conversion)
    const photoBase = (photo.filename || "").replace(/\.[^.]+$/, "").toLowerCase();
    const dbImg = dbByBasename[photoBase];
    if (!dbImg) {
      unmatched++;
      continue;
    }
    matched++;

    const newMetadata = {
      ...(dbImg.ai_scan_metadata || {}),
      build_phase: photo.phase,
      build_phase_label: photo.phaseLabel,
      photo_date: photo.date,
      gps_lat: photo.lat,
      gps_lon: photo.lon,
      gps_location_cluster: photo.location,
      camera: photo.camera,
      dimensions: photo.width && photo.height ? `${photo.width}x${photo.height}` : null,
      is_screenshot: photo.isScreenshot,
      is_favorite: photo.isFavorite,
      iphoto_uuid: photo.uuid,
      exif_enriched_at: new Date().toISOString(),
    };

    updates.push({ id: dbImg.id, metadata: newMetadata });
  }

  console.log(`  Matched: ${matched}, Unmatched: ${unmatched}`);

  if (DRY_RUN) {
    console.log(`\nDRY RUN — ${updates.length} images would be updated.`);
    // Show sample
    if (updates.length > 0) {
      console.log("\nSample update:");
      const s = updates[0];
      console.log(`  ID: ${s.id}`);
      console.log(`  Phase: ${s.metadata.build_phase} (${s.metadata.build_phase_label})`);
      console.log(`  Date: ${s.metadata.photo_date}`);
      console.log(`  Location: ${s.metadata.gps_location_cluster || "none"}`);
    }
    return;
  }

  // Apply updates in batches
  console.log(`\nUpdating ${updates.length} vehicle_images...`);
  const BATCH = 100;
  let ok = 0, fail = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    for (const u of batch) {
      const { error } = await sb
        .from("vehicle_images")
        .update({ ai_scan_metadata: u.metadata })
        .eq("id", u.id);
      if (error) { fail++; } else { ok++; }
    }
    if ((i + BATCH) % 500 === 0) console.log(`  Progress: ${i + BATCH}/${updates.length}`);
  }

  console.log(`  Updated: ${ok}, Failed: ${fail}`);

  // 5. Also write phase definitions as structured data for the chart
  console.log("\nWriting build phase definitions...");
  const phaseData = BUILD_PHASES.map(p => ({
    name: p.name,
    label: p.label,
    start: p.start,
    end: p.end,
    color: p.color,
    photo_count: phaseCounts[p.name] || 0,
  }));

  // Store phases in vehicle metadata via vehicle_observations
  // This will be picked up by the timeline chart
  console.log("  Phase data:", JSON.stringify(phaseData, null, 2));
  console.log("\nDone.");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
