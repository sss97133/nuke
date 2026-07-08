#!/usr/bin/env node
// blur-nuke-reconcile-census.mjs — READ-ONLY census: match Skylar's local
// photo library (BlurMac's manifest) against Nuke's image_identities.
//
// Approved thesis (2026-07-07): "hash them back to source... identify why
// and how" — force-fed Nuke images are severed from their originals. This
// script MEASURES the reconciliation; it writes NOTHING to the database.
//
// Tiers:
//   1. EXACT — local sha256 of original bytes == image_identities.
//      content_hash_sha256. Bounded (~211 locally hashable: the Mac library
//      is iCloud-optimized) but proof-grade.
//   2. PERCEPTUAL — local dHash (CoreGraphics area-averaged 9x8 luma; see
//      blur ios/Sources/Blur/DHash.swift) vs identities backfilled in the
//      SAME box-mean space by the 2026-07-07 campaign (first_seen_source
//      IN storage_etag_rooting, ssd_nukeportable). Bands: 0-2 near-certain,
//      3-4 strong, 5-10 candidate (needs confirm before any write).
//      The pre-existing 11,681 phash rows are a FOREIGN hash space
//      (pre-campaign drawImage/daemon) — sha-tier only, NEVER hamming-
//      matched. Do not "fix" this by widening the filter.
//
// Inputs:  ~/Library/Application Support/BlurMac/dhash-index.json
//          ~/Library/Application Support/BlurMac/origin-signals-v2.json
// Output:  printed summary + output/blur-nuke-census-<ts>.json
// Run:     cd /Users/skylar/nuke && dotenvx run -- node scripts/blur-nuke-reconcile-census.mjs
//          (network required — run un-sandboxed)

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error("missing env (run under dotenvx)"); process.exit(1); }

const support = path.join(os.homedir(), "Library/Application Support/BlurMac");
const dhashLocal = JSON.parse(readFileSync(path.join(support, "dhash-index.json")));
const origins = JSON.parse(readFileSync(path.join(support, "origin-signals-v2.json")));
console.log(`local: ${dhashLocal.length} fingerprints, ${origins.length} origin entries`);

const localShaByHash = new Map();
const filenameById = new Map();
for (const row of origins) {
  if (row.sha256) localShaByHash.set(row.sha256, row.id);
  if (row.filename) filenameById.set(row.id, row.filename);
}

async function fetchAll(table, params) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const identities = await fetchAll(
  "image_identities",
  "select=id,phash_hex,content_hash_sha256,first_seen_source"
);
console.log(`nuke: ${identities.length} identities`);

// ── Tier 1: exact sha256 ─────────────────────────────────────────────────
const tier1 = [];
for (const identity of identities) {
  const sha = identity.content_hash_sha256;
  if (sha && localShaByHash.has(sha)) {
    tier1.push({ identityId: identity.id, localId: localShaByHash.get(sha), sha });
  }
}

// ── Tier 2: box-mean dHash vs campaign-backfilled rows only ─────────────
const V2_SOURCES = new Set(["storage_etag_rooting", "ssd_nukeportable"]);
const v2Rows = identities.filter(
  (identity) => identity.phash_hex && identity.phash_hex.length === 16 && V2_SOURCES.has(identity.first_seen_source)
);
console.log(`tier-2 matchable identities (campaign space): ${v2Rows.length}`);

const localHashes = dhashLocal
  .filter((row) => row.dhash && row.dhash.length === 16)
  .map((row) => ({ id: row.id, bits: BigInt("0x" + row.dhash) }));

function popcount64(value) {
  let count = 0;
  while (value) { value &= value - 1n; count++; }
  return count;
}

const bands = { "0-2": [], "3-4": [], "5-10": [] };
const started = Date.now();
for (const identity of v2Rows) {
  const target = BigInt("0x" + identity.phash_hex);
  let best = null;
  for (const local of localHashes) {
    const distance = popcount64(target ^ local.bits);
    if (distance <= 10 && (!best || distance < best.distance)) {
      best = { distance, localId: local.id };
      if (distance === 0) break;
    }
  }
  if (best) {
    const band = best.distance <= 2 ? "0-2" : best.distance <= 4 ? "3-4" : "5-10";
    bands[band].push({ identityId: identity.id, localId: best.localId, hamming: best.distance });
  }
}
console.log(`tier-2 sweep: ${((Date.now() - started) / 1000).toFixed(0)}s`);

// ── Report ───────────────────────────────────────────────────────────────
const matchedIdentityIds = new Set([
  ...tier1.map((match) => match.identityId),
  ...bands["0-2"].map((match) => match.identityId),
  ...bands["3-4"].map((match) => match.identityId),
]);
const summary = {
  ranAt: new Date().toISOString(),
  local: { fingerprints: dhashLocal.length, exactHashable: localShaByHash.size },
  nuke: {
    identities: identities.length,
    shaBearing: identities.filter((identity) => identity.content_hash_sha256).length,
    v2SpaceRows: v2Rows.length,
    foreignSpaceRows: identities.filter(
      (identity) => identity.phash_hex && !V2_SOURCES.has(identity.first_seen_source)
    ).length,
  },
  tier1_exact: tier1.length,
  tier2_hamming: {
    "0-2_nearCertain": bands["0-2"].length,
    "3-4_strong": bands["3-4"].length,
    "5-10_needsConfirm": bands["5-10"].length,
  },
  reRootable: matchedIdentityIds.size,
  orphans_noLibraryMatch: v2Rows.length + tier1.length - matchedIdentityIds.size >= 0
    ? v2Rows.filter((identity) => !matchedIdentityIds.has(identity.id)).length
    : 0,
};
console.log(JSON.stringify(summary, null, 2));

mkdirSync("output", { recursive: true });
const outPath = `output/blur-nuke-census-${Date.now()}.json`;
writeFileSync(outPath, JSON.stringify({ summary, tier1, bands }, null, 2));
console.log(`detail written: ${outPath} (read-only census — nothing was written to the DB)`);
