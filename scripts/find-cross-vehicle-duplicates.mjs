/**
 * find-cross-vehicle-duplicates.mjs — Cross-vehicle perceptual duplicate detection
 *
 * Reads vehicle_hero_fingerprints, finds pairs of vehicles whose hero images
 * have hamming distance <= threshold, then groups them with year+make agreement
 * as additional confidence signal.
 *
 * Does NOT merge or modify anything — outputs candidate merge proposals only.
 *
 * Algorithm:
 *   1. Group fingerprints by dhash prefix (first 4 hex chars = first 16 bits)
 *   2. Within each prefix group, compute pairwise hamming distance
 *   3. Pairs with distance <= threshold are candidates
 *   4. Enrich with vehicle metadata (year, make, model) for validation
 *   5. Score each pair: exact hash = highest, hash match + year+make = confirmed
 *
 * Why prefix grouping works:
 *   If two 64-bit hashes differ by <= 5 bits, they must share at least
 *   11 of their first 16 bits. So we can group by 4-hex-char prefix and
 *   only compare within overlapping groups. This reduces from O(n^2) to
 *   O(n * avg_group_size). For additional coverage, we also check
 *   adjacent prefix groups (1-bit flip in prefix).
 *
 * Usage:
 *   dotenvx run -- node scripts/find-cross-vehicle-duplicates.mjs
 *   dotenvx run -- node scripts/find-cross-vehicle-duplicates.mjs --threshold 3
 *   dotenvx run -- node scripts/find-cross-vehicle-duplicates.mjs --output results.json
 *   dotenvx run -- node scripts/find-cross-vehicle-duplicates.mjs --min-confidence high
 *
 * Flags:
 *   --threshold N       Max hamming distance (default: 5)
 *   --output FILE       Write JSON results to file
 *   --min-confidence X  Filter: "exact", "high", "medium", "low" (default: all)
 *   --limit N           Only process first N fingerprints (for testing)
 */

import pg from "pg";
import { writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_URL = process.env.SUPABASE_DB_URL
  || "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const threshold = args.includes("--threshold")
  ? parseInt(args[args.indexOf("--threshold") + 1], 10)
  : 5;
const outputFile = args.includes("--output")
  ? args[args.indexOf("--output") + 1]
  : null;
const minConfidence = args.includes("--min-confidence")
  ? args[args.indexOf("--min-confidence") + 1]
  : null;
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : null;

// ---------------------------------------------------------------------------
// Hamming distance — exact match with dedup-vehicle-images/index.ts
// ---------------------------------------------------------------------------
function hammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) return 64;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    let xor = n1 ^ n2;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Generate all possible 4-char hex prefixes that differ by 1 bit
 * from the given prefix (for fuzzy prefix matching).
 */
function nearbyPrefixes(prefix) {
  const val = parseInt(prefix, 16);
  const neighbors = new Set([prefix]);
  for (let bit = 0; bit < 16; bit++) {
    const flipped = val ^ (1 << bit);
    neighbors.add(flipped.toString(16).padStart(4, "0"));
  }
  return neighbors;
}

/**
 * Confidence scoring for a duplicate pair.
 */
function scoreConfidence(distance, yearMatch, makeMatch) {
  if (distance === 0 && yearMatch && makeMatch) return "exact";
  if (distance === 0) return "high";
  if (distance <= 2 && yearMatch && makeMatch) return "high";
  if (distance <= 2) return "medium";
  if (distance <= 5 && yearMatch && makeMatch) return "medium";
  return "low";
}

const CONFIDENCE_ORDER = { exact: 0, high: 1, medium: 2, low: 3 };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });

  console.log(`[cross-dup] Cross-vehicle duplicate detection`);
  console.log(`  threshold: ${threshold}, output: ${outputFile ?? "stdout"}`);
  console.log(`  min-confidence: ${minConfidence ?? "all"}`);

  // Step 1: Load all hero fingerprints with vehicle metadata
  console.log("[cross-dup] Loading hero fingerprints...");
  let query = `
    SELECT
      hf.vehicle_id,
      hf.dhash,
      hf.image_url,
      v.year,
      v.make,
      v.model,
      v.title,
      v.primary_image_url,
      v.status
    FROM vehicle_hero_fingerprints hf
    JOIN vehicles v ON v.id = hf.vehicle_id
    WHERE v.status = 'active'
    ORDER BY hf.dhash
  `;
  if (limitArg) {
    query += ` LIMIT ${limitArg}`;
  }

  const { rows: fingerprints } = await pool.query(query);
  console.log(`[cross-dup] Loaded ${fingerprints.length} fingerprints`);

  if (fingerprints.length < 2) {
    console.log("[cross-dup] Need at least 2 fingerprints. Run compute-hero-fingerprints.mjs first.");
    await pool.end();
    return;
  }

  // Step 2: Group by dhash prefix (first 4 hex chars)
  console.log("[cross-dup] Grouping by prefix...");
  const prefixGroups = new Map();
  for (const fp of fingerprints) {
    const prefix = fp.dhash.substring(0, 4);
    if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
    prefixGroups.get(prefix).push(fp);
  }
  console.log(`[cross-dup] ${prefixGroups.size} distinct prefixes`);

  // Stats on group sizes
  const groupSizes = [...prefixGroups.values()].map((g) => g.length);
  const maxGroupSize = Math.max(...groupSizes);
  const avgGroupSize = (groupSizes.reduce((a, b) => a + b, 0) / groupSizes.length).toFixed(1);
  console.log(`[cross-dup] Group sizes: avg=${avgGroupSize}, max=${maxGroupSize}`);

  // Step 3: Find duplicate pairs using prefix-based comparison
  console.log("[cross-dup] Computing pairwise distances...");
  const seenPairs = new Set();
  const candidatePairs = [];
  let comparisons = 0;

  // For each fingerprint, compare with all fingerprints in its prefix group
  // AND nearby prefix groups (to catch cases where differing bits span the prefix boundary)
  for (const [prefix, group] of prefixGroups) {
    // Compare within this prefix group
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        comparisons++;
        const dist = hammingDistance(group[i].dhash, group[j].dhash);
        if (dist <= threshold) {
          const pairKey = [group[i].vehicle_id, group[j].vehicle_id].sort().join("|");
          if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            candidatePairs.push({
              vehicle_a: group[i],
              vehicle_b: group[j],
              distance: dist,
            });
          }
        }
      }
    }

    // Compare with nearby prefix groups (1-bit flips)
    const nearby = nearbyPrefixes(prefix);
    for (const neighborPrefix of nearby) {
      if (neighborPrefix === prefix) continue;
      const neighborGroup = prefixGroups.get(neighborPrefix);
      if (!neighborGroup) continue;

      for (const fpA of group) {
        for (const fpB of neighborGroup) {
          comparisons++;
          const dist = hammingDistance(fpA.dhash, fpB.dhash);
          if (dist <= threshold) {
            const pairKey = [fpA.vehicle_id, fpB.vehicle_id].sort().join("|");
            if (!seenPairs.has(pairKey)) {
              seenPairs.add(pairKey);
              candidatePairs.push({
                vehicle_a: fpA,
                vehicle_b: fpB,
                distance: dist,
              });
            }
          }
        }
      }
    }
  }

  console.log(`[cross-dup] ${comparisons.toLocaleString()} comparisons performed`);
  console.log(`[cross-dup] ${candidatePairs.length} candidate pairs found (distance <= ${threshold})`);

  // Step 4: Enrich with confidence scoring
  const proposals = candidatePairs.map((pair) => {
    const a = pair.vehicle_a;
    const b = pair.vehicle_b;

    const yearMatch = a.year && b.year && a.year === b.year;
    const makeMatch =
      a.make && b.make && a.make.toLowerCase() === b.make.toLowerCase();
    const modelMatch =
      a.model && b.model && a.model.toLowerCase() === b.model.toLowerCase();

    const confidence = scoreConfidence(pair.distance, yearMatch, makeMatch);

    return {
      vehicle_a_id: a.vehicle_id,
      vehicle_b_id: b.vehicle_id,
      hamming_distance: pair.distance,
      confidence,
      year_match: yearMatch,
      make_match: makeMatch,
      model_match: modelMatch,
      vehicle_a: {
        year: a.year,
        make: a.make,
        model: a.model,
        title: a.title,
        image_url: a.image_url || a.primary_image_url,
      },
      vehicle_b: {
        year: b.year,
        make: b.make,
        model: b.model,
        title: b.title,
        image_url: b.image_url || b.primary_image_url,
      },
    };
  });

  // Sort by confidence (best first), then by distance
  proposals.sort((a, b) => {
    const confDiff = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
    if (confDiff !== 0) return confDiff;
    return a.hamming_distance - b.hamming_distance;
  });

  // Filter by min-confidence if specified
  let filtered = proposals;
  if (minConfidence) {
    const minOrder = CONFIDENCE_ORDER[minConfidence] ?? 3;
    filtered = proposals.filter((p) => CONFIDENCE_ORDER[p.confidence] <= minOrder);
  }

  // Step 5: Group into clusters (connected components)
  const clusters = buildClusters(filtered);

  // Step 6: Summary stats
  const byConfidence = {};
  for (const p of filtered) {
    byConfidence[p.confidence] = (byConfidence[p.confidence] || 0) + 1;
  }

  const summary = {
    total_fingerprints: fingerprints.length,
    total_comparisons: comparisons,
    candidate_pairs: candidatePairs.length,
    filtered_pairs: filtered.length,
    clusters: clusters.length,
    by_confidence: byConfidence,
    threshold,
  };

  console.log(`\n[cross-dup] === RESULTS ===`);
  console.log(`  Total fingerprints: ${summary.total_fingerprints}`);
  console.log(`  Comparisons: ${summary.total_comparisons.toLocaleString()}`);
  console.log(`  Candidate pairs: ${summary.candidate_pairs}`);
  console.log(`  By confidence:`, summary.by_confidence);
  console.log(`  Clusters: ${summary.clusters}`);

  // Show top results
  if (filtered.length > 0) {
    console.log(`\n[cross-dup] Top 20 candidates:`);
    for (const p of filtered.slice(0, 20)) {
      const aDesc = `${p.vehicle_a.year || "?"} ${p.vehicle_a.make || "?"} ${p.vehicle_a.model || "?"}`;
      const bDesc = `${p.vehicle_b.year || "?"} ${p.vehicle_b.make || "?"} ${p.vehicle_b.model || "?"}`;
      console.log(
        `  [${p.confidence.toUpperCase().padEnd(6)}] dist=${p.hamming_distance} | ` +
        `${aDesc} <-> ${bDesc} | ` +
        `year:${p.year_match ? "Y" : "N"} make:${p.make_match ? "Y" : "N"} model:${p.model_match ? "Y" : "N"}`
      );
      console.log(`           A: ${p.vehicle_a_id}`);
      console.log(`           B: ${p.vehicle_b_id}`);
    }
  }

  // Write full results if --output specified
  if (outputFile) {
    const output = {
      generated_at: new Date().toISOString(),
      summary,
      proposals: filtered,
      clusters: clusters.map((c) => ({
        vehicle_ids: c.vehicles,
        size: c.vehicles.length,
        pairs: c.pairs,
      })),
    };
    writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`\n[cross-dup] Results written to ${outputFile}`);
  }

  await pool.end();
}

/**
 * Build connected component clusters from pairs.
 * Each cluster = group of vehicles that are all visually similar.
 */
function buildClusters(pairs) {
  const parent = new Map();

  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const p of pairs) {
    union(p.vehicle_a_id, p.vehicle_b_id);
  }

  // Group by root
  const clusters = new Map();
  const allVehicles = new Set();
  for (const p of pairs) {
    allVehicles.add(p.vehicle_a_id);
    allVehicles.add(p.vehicle_b_id);
  }

  for (const vid of allVehicles) {
    const root = find(vid);
    if (!clusters.has(root)) clusters.set(root, { vehicles: [], pairs: [] });
    clusters.get(root).vehicles.push(vid);
  }

  // Deduplicate vehicle lists and attach relevant pairs
  const result = [];
  for (const [, cluster] of clusters) {
    cluster.vehicles = [...new Set(cluster.vehicles)];
    cluster.pairs = pairs.filter(
      (p) => cluster.vehicles.includes(p.vehicle_a_id) || cluster.vehicles.includes(p.vehicle_b_id)
    );
    if (cluster.vehicles.length >= 2) {
      result.push(cluster);
    }
  }

  return result;
}

main().catch((e) => {
  console.error("[cross-dup] Fatal error:", e);
  process.exit(1);
});
