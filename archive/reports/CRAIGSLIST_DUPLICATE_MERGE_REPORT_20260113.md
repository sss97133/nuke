## Craigslist Duplicate Merge Report (2026-01-13)

This report documents a conservative “duplicate merge” pass over Craigslist-origin vehicle profiles.

### Problem

Craigslist ingestion can create **near-identical duplicate profiles** (often the same listing ingested multiple times). These are *duplicates* (same underlying listing/car), not a “merge data from different sources” scenario.

### Approach (safe + conservative)

We only merged profiles when we had a **high-confidence identity signal**:

- **Signal**: identical set of “discriminative” `vehicle_images.file_hash` values (an image-hash signature)
- **Filters**:
  - profile `vehicles.discovery_url` contains `craigslist.org`
  - ignore common/stock hashes by only using hashes that appear in **≤ 5 vehicles**
  - require at least **10** discriminative hashes per profile
  - require exact match on normalized `(year, make, model)` for the grouped signature

**Merge semantics:** this is a *duplicate collapse*, not a fuzzy merge:
- Duplicate vehicle is marked `status='merged'`, `merged_into_vehicle_id=<primary>`, and `is_public=false`.
- The primary remains the canonical visible profile.

### Results

- **Craigslist profiles marked merged**: **137**
- **Remaining exact-signature duplicate groups** (per the criteria above): **0**
- **Merged profiles with missing/invalid primary pointer**: **0**

### Notes / Follow-ups

- This does *not* attempt to merge “99% similar” pairs that don’t have exact signature equality; those should be handled via a **proposal system** (overlap scoring + review) instead of auto-merging.
- If you want the next rung: generate merge proposals where image-hash overlap is ≥ 90% (after filtering common hashes), then route to your “qualified voices” workflow for review.

