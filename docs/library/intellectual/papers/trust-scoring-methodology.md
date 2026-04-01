# PAPER: Trust Scoring Methodology

**Author:** System Architecture
**Date:** 2026-03-20, extended 2026-03-29
**Status:** Living Document
**References:** Engineering Manual Ch.4, Dynamic Trust Model (theoreticals/dynamic-trust-model.md)

---

## Abstract

Not all data is equally trustworthy. A VIN decoded from NHTSA's federal database is more reliable than a seller's description on Craigslist. A mileage reading from a recent service invoice is more current than one from a 5-year-old listing. Trust scoring quantifies this — assigning a numeric confidence to every observation so the system can resolve contradictions, weight evidence, and surface uncertainty.

This paper documents the trust model: how scores are computed, why the source hierarchy exists, what decay means, and where the model breaks down.

---

## The Core Insight

**Descriptions are testimony, not data.**

When a BaT seller writes "matching numbers 350 V8," that is a claim made by a person with an incentive to sell. It may be true. It may be honestly mistaken (casting numbers are hard to read). It may be deliberately false. The system must treat it as testimony — evidence with a credibility weight — not as verified fact.

This is the philosophical foundation (see Contemplations: testimony-and-half-lives.md). The trust scoring system is the mathematical implementation.

---

## Source Trust Hierarchy

Every observation source has a `base_trust_score` in the `observation_sources` table. These are not arbitrary — they reflect the incentive structure and verification process of each source type.

### The Hierarchy

| Category | Trust Range | Rationale |
|----------|------------|-----------|
| `owner` (0.70-1.00) | First-hand knowledge, direct evidence | iMessage threads with buyers (1.00), iPhoto GPS-tagged work photos (1.00), email receipts (0.95). Owner-contributed data from Claude Extension (0.80). When the owner IS the system operator, trust is maximal. General owner input (0.70) is lower because unverified external owners have subjective bias. |
| `registry` (0.65-0.98) | Institutional, verified, no sales incentive | Ferrari Classiche, Porsche CoA, Galen Govier at 0.98 (manufacturer authentication programs). NHTSA, state DMVs, NMVTIS at 0.95 (government databases). Marque registries (356 Registry, Hemi Registry) at 0.88-0.90. Community registries (Hemmings, ConceptCarz) at 0.70-0.75. The range is wide because "registry" spans government databases to enthusiast wikis. |
| `shop` (0.60-0.90) | Professional builders with trackable output | Elite builders (Gunther Werks, ICON 4x4, Ringbrothers) at 0.85-0.90 — their reputation IS their product. Mid-tier shops at 0.60. Trust reflects build quality reputation, not just expertise. |
| `auction` (0.40-0.90) | Curated, moderated, reputation-dependent | RM Sotheby's, Gooding, Bonhams at 0.90 (white-glove, expert-catalogued). BaT, Broad Arrow at 0.85 (curated online). Cars & Bids, PCarMarket at 0.80. Mecum, Barrett-Jackson at 0.75 (high volume, less per-lot curation). Small/regional auctions (ATM, Bid Garage) at 0.40-0.60. |
| `documentation` (0.70) | Physical documents with verification | Deal Jacket OCR pipeline at 0.70. Currently only one source in this category — the pipeline that ingests scanned titles, receipts, and service records. Trust is moderate because OCR can misread and documents can be incomplete. |
| `aggregator` (0.65-0.70) | Secondary data compilations | JamesEdition (0.70), Carfax competitor analysis (0.70), Classic.com (0.65). These compile data from primary sources, introducing a layer of potential transcription error. |
| `dealer` (0.60-0.75) | Professional but sales-incentivized | Grand Prix Classics, Legendary Motorcar at 0.70-0.75 (specialist dealers, reputation-bound). Gateway Classic Cars, Streetside Classics at 0.65 (franchise dealers, volume operations). Trust tracks with specialization — a marque specialist who stakes reputation on accuracy vs a volume dealer who processes hundreds of listings monthly. |
| `internal` (0.40-0.80) | System-generated observations | Part Number OCR (0.80), photo pipeline AI vision (0.70), AI description extraction (0.65), taste model (0.65), nuke vision (0.65), system inference (0.50), external agent (0.40). Internal sources are ranked by their validation chain — OCR from clear part stamps is more reliable than AI inference from noisy images. |
| `marketplace` (0.10-0.80) | Unmoderated to lightly moderated | Classic Driver (0.80 — professional listings). Hagerty Marketplace, ClassicCars.com (0.65-0.70). Facebook Marketplace (0.60), Craigslist (0.40). OldCars.com (0.10 — stale aggregation). The range is enormous because "marketplace" spans professional dealer platforms to anonymous classified ads. |
| `forum` (0.50-0.70) | Expert community but unverified | Forum build threads (0.70 — first-person accounts with photos). Rennlist, Pelican Parts (0.60 — active moderation, known experts). Model-specific forums (0.50 — anyone can post). |
| `social_media` (0.25-0.50) | Entertainment-oriented, no verification | YouTube (0.50 — long-form content allows detail). Petrolicious (0.50). Facebook Groups (0.45). Instagram (0.40). Reddit (0.40). TikTok (0.25 — minimal detail, maximum entertainment bias). |

### Production Reality (as of 2026-03-29)

**160 distinct sources** are registered in `observation_sources` across 12 categories:

| Category | Sources | Avg Trust | Min | Max |
|----------|---------|-----------|-----|-----|
| owner | 6 | 0.90 | 0.70 | 1.00 |
| registry | 36 | 0.89 | 0.65 | 0.98 |
| shop | 11 | 0.83 | 0.60 | 0.90 |
| museum | 1 | 0.80 | 0.80 | 0.80 |
| auction | 27 | 0.73 | 0.40 | 0.90 |
| documentation | 1 | 0.70 | 0.70 | 0.70 |
| aggregator | 3 | 0.68 | 0.65 | 0.70 |
| dealer | 16 | 0.65 | 0.60 | 0.75 |
| internal | 9 | 0.63 | 0.40 | 0.80 |
| marketplace | 27 | 0.61 | 0.10 | 0.80 |
| forum | 12 | 0.55 | 0.50 | 0.70 |
| social_media | 11 | 0.39 | 0.25 | 0.50 |

Note: The original hierarchy (registry > documentation > auction > dealer > owner > marketplace > forum > social) is **not the actual implementation**. In production, `owner` has the highest average trust (0.90) because iMessage and iPhoto sources get 1.00 — the system operator's own data is treated as ground truth. The `registry` category also has a wider range than originally specified because it includes everything from Ferrari Classiche (0.98) to community wikis (0.65).

### Where the Hierarchy Diverges from Theory

1. **Owner trust is NOT 0.55-0.65.** The original theory treated owners as subjective witnesses. In practice, owner sources include iMessage threads (the system operator's direct communications), GPS-tagged work photos, and email receipts — all of which are primary evidence, not testimony. The split: system operator's own data (1.00) vs external owner claims (0.70).

2. **The `internal` category didn't exist in the original theory.** AI vision models, OCR pipelines, and inference engines are sources too. Their trust ranges from 0.40 (experimental external agents) to 0.80 (high-precision OCR from clear part stamps). This category will become increasingly important as more data is AI-generated.

3. **Marketplace has a 0.10-0.80 range.** The original theory grouped all marketplaces at 0.45-0.55. In production, Classic Driver (0.80) is a professional European marketplace closer in quality to an auction house, while OldCars.com (0.10) is essentially stale aggregation barely worth indexing.

### Why These Specific Numbers?

The numbers were set heuristically, not empirically calibrated. The ranking reflects the incentive structure and verification process of each source. The specific values matter less than the ordering — but in practice, the ordering itself has proven more nuanced than the original 8-tier hierarchy suggested.

**Calibration would require:** A labeled dataset of observations where we know the ground truth. For example, 1,000 vehicles where we have verified VIN data AND seller claims, so we can measure how often each source type is correct. With 3.29M field_evidence rows across 370K vehicles and 265 distinct fields, the system is approaching the scale where empirical calibration becomes feasible — but the ground-truth labeling has not been done.

---

## Contextual Confidence Adjustment

The base trust score is adjusted per-observation based on contextual signals. This is computed in `ingest-observation/index.ts` at ingestion time and stored permanently on the observation row.

### The Implementation (exact code from ingest-observation/index.ts:260-275)

```typescript
const confidenceFactors: Record<string, number> = {};
if (vehicleMatchConfidence >= 0.95) confidenceFactors.vehicle_match = 0.1;
if (input.source_url) confidenceFactors.has_source_url = 0.05;
if (input.content_text && input.content_text.length > 100)
  confidenceFactors.substantial_content = 0.05;

const confidenceScore = Math.min(1.0,
  (source.base_trust_score || 0.5) +
  Object.values(confidenceFactors).reduce((a, b) => a + b, 0)
);

let confidenceLevel = "medium";
if (confidenceScore >= 0.95) confidenceLevel = "verified";
else if (confidenceScore >= 0.85) confidenceLevel = "high";
else if (confidenceScore < 0.4) confidenceLevel = "low";
```

Three values are stored on each `vehicle_observations` row:
- `confidence_score` (numeric) — the computed 0.0-1.0 value
- `confidence` (text) — the categorical level: verified/high/medium/low
- `confidence_factors` (jsonb) — which bonuses applied, for auditability

### Contextual Bonuses

| Signal | Bonus | Stored As | Rationale |
|--------|-------|-----------|-----------|
| Vehicle match confidence >= 0.95 | +0.10 | `confidence_factors.vehicle_match` | We're confident this observation is about the right vehicle |
| Has source URL | +0.05 | `confidence_factors.has_source_url` | Traceable to original source |
| Substantial content (>100 chars) | +0.05 | `confidence_factors.substantial_content` | More content = more to verify against |

Maximum possible bonus: +0.20 (all three signals). A source with base trust 0.80 can reach 1.00 if all bonuses apply. A source with base trust 0.75 + all bonuses = 0.95 (the verified threshold).

### Confidence Levels

| Score Range | Level | Meaning |
|-------------|-------|---------|
| >= 0.95 | `verified` | Multiple independent sources agree, or registry-grade data |
| 0.85-0.94 | `high` | Strong single source (curated auction, official document) |
| 0.40-0.84 | `medium` | Standard observation, usable but not definitive |
| < 0.40 | `low` | Unreliable source, use only as supporting evidence |

### Production Distribution (as of 2026-03-29)

| Level | Count | Avg Score | Notes |
|-------|-------|-----------|-------|
| verified | 26,263 | 0.960 | Registry sources + owner data with all bonuses |
| high | 5,494,442 | 0.855 | The vast majority — auction house listings dominate |
| medium | 183,248 | 0.692 | Marketplace, forum, social sources |
| low | 0 | — | No observations currently fall below 0.40 |

The distribution is heavily right-skewed: 96.3% of all 5.7M observations are "high" confidence. This is because the dominant data sources (BaT, Mecum, Barrett-Jackson, Cars & Bids) are all auction platforms with base trust >= 0.75, and most observations include a source URL (+0.05) and substantial content (+0.05), pushing them above the 0.85 threshold.

**The "low" bucket is empty.** No source currently has base trust below 0.25, and even TikTok (0.25) with all bonuses reaches 0.45 (medium). The "low" tier would only activate if per-entity trust reduction were implemented (see Dynamic Trust Model).

### Implication: The 4-Level System Compresses Useful Variation

A Gooding & Company expert-catalogued lot description (base 0.90 + 0.20 bonuses = 1.00) and a Mecum one-line listing (base 0.75 + 0.10 bonuses = 0.85) both land in "high." The categorical system loses this distinction. Any future system that needs finer resolution should use the numeric `confidence_score`, not the categorical `confidence` level.

---

## Temporal Decay (Half-Life Model)

Trust is not static. A mileage reading decays over time because the vehicle is being driven. A condition assessment decays because things break, rust, and wear. A price estimate decays because the market moves.

### Decay Categories

Different observation types decay at different rates:

| Observation Type | Half-Life | Rationale |
|-----------------|-----------|-----------|
| VIN / identity | Never | A VIN doesn't change |
| Factory specs | Never | What left the factory is permanent |
| Mileage | 6 months | Vehicles are driven; mileage readings become stale |
| Condition | 1 year | Condition degrades over time; stored vehicles degrade slower |
| Price / value | 3 months | Markets move; a 6-month-old valuation is unreliable |
| Ownership | 2 years | Vehicles change hands; ownership claims become uncertain |
| Location | 1 year | Vehicles move; a year-old location is probably still correct |
| Modifications | 3 years | Mods are relatively permanent but can be reversed |

### The Decay Function

```
adjusted_trust = base_trust × (0.5 ^ (age / half_life))
```

Where `age` is the time since the observation was made (not when it was ingested).

Example: A BaT listing (base trust 0.90) is 2 years old. Condition observations from that listing have a 1-year half-life:

```
adjusted_trust = 0.90 × (0.5 ^ (2 / 1)) = 0.90 × 0.25 = 0.225
```

The condition claims from that listing are now low-confidence. But the VIN from the same listing is still 0.90 (no decay).

### Current Implementation Status

**Decay is designed but not implemented in production.** The `ingest-observation` function stores `observed_at` timestamps on every observation, which enables retroactive decay computation. But no function currently applies decay when querying observation data.

**The infrastructure is ready.** Every `vehicle_observations` row has an `observed_at` timestamp (when the observation was originally made, not ingested). The `confidence_score` is stored at ingestion time without decay. To apply decay at query time:

```sql
-- Example: compute age-decayed trust for mileage observations
SELECT
  vo.id,
  vo.confidence_score as raw_trust,
  vo.confidence_score * power(0.5,
    EXTRACT(EPOCH FROM (now() - vo.observed_at)) / (180 * 86400.0)  -- 6-month half-life
  ) as decayed_trust
FROM vehicle_observations vo
WHERE vo.kind = 'specification'
  AND vo.structured_data->>'mileage' IS NOT NULL;
```

**Why not yet:** Decay requires a materialized view of the "best current value" for each vehicle field, computed from all observations weighted by decayed trust. This is the target architecture but is not yet built. The `field_evidence` table (3.29M rows) is the closest thing to a materialized profile, but it uses extractor-assigned confidence, not observation-model trust.

---

## Contradiction Resolution

When two observations disagree on the same field, the system needs to decide which to trust. Currently this is not automated — contradictions are stored as-is and the most recent value wins in the `vehicles` table.

### Target: Evidence-Weighted Resolution

The design intent:

1. For each vehicle field, collect all observations that contain a value for that field
2. Apply temporal decay to each observation's trust score
3. Group observations by value (e.g., three say "red", one says "maroon")
4. The value with the highest total weighted trust wins
5. If values are close (< 0.1 difference), flag as "contested"

### Example

Vehicle color observations:
- BaT listing 2024 (trust 0.90, age 2yr, half-life never for color): "Guards Red" → 0.90
- Craigslist 2025 (trust 0.50, age 1yr): "Red" → 0.50
- Owner input 2026 (trust 0.60, age 0yr): "Guards Red" → 0.60

"Guards Red" total trust: 0.90 + 0.60 = 1.50
"Red" total trust: 0.50

Winner: "Guards Red" with confidence. "Red" is probably the same but less precise — the THESAURUS should map "Red" as a possible alias for "Guards Red" in the Porsche context.

---

## Where the Model Breaks Down

### 1. Comment Trust Is Context-Dependent

A BaT commenter who says "I owned this car in 2015 and the engine was rebuilt by XYZ shop" has insider knowledge — their trust should be much higher than the base forum trust of 0.50. But the system has no way to elevate individual commenter trust.

**Proposed:** Commenter expertise scoring based on: account age, comment history, likes received, self-identified expertise. The `auction_comments.expertise_score` column exists but is sparsely populated.

### 2. Seller Claims Have Dual Trust

A seller's description contains both factual claims (year, make, model) and subjective claims (condition, history). The factual claims have higher trust (easy to verify, costly to fabricate) than the subjective ones (hard to verify, easy to exaggerate).

**Proposed:** Claim-level trust scoring. Parse description into individual claims, classify each as factual vs subjective, apply different trust weights. This is extraction-pipeline work, not trust-model work.

### 3. No Negative Trust

The current model only has positive trust scores. There's no mechanism for "this source has been wrong before" reducing future trust. A Craigslist listing that contained verifiably false information should lower trust for that specific seller, but the system doesn't track per-entity trust.

### 4. Photo Evidence Is Not Scored

A claim "matching numbers" backed by a photo of the engine stamp with readable casting numbers is far more trustworthy than the same claim without evidence. But the trust model treats text observations and photo observations independently — it doesn't know that the photo supports the claim.

**Partially implemented:** The `field_evidence` table links specific field values to specific source materials. As of 2026-03-29: **3.29M rows** across **370K vehicles** covering **265 distinct fields**. This is no longer "partially populated" — it is the system's largest provenance store. But it is still not integrated into trust scoring; field_evidence rows do not carry confidence weights or contribute to observation confidence.

---

## The field_evidence System

The `field_evidence` table is the bridge between the observation system (which stores raw observations) and the vehicle profile (which presents the "best current value" per field). Each row records: this field, on this vehicle, has this value, from this source, with this evidence.

### Scale

| Metric | Value |
|--------|-------|
| Total rows | 3,290,472 |
| Vehicles covered | 370,465 |
| Distinct fields tracked | 265 |

### How Confidence Is Set on field_evidence

Field evidence rows are created by extractors (primarily `enrich-bulk`, `bat-snapshot-parser`, `extract-*` functions) when they parse structured data from source material. The confidence on a field_evidence row is set by the extractor, not by the trust model. There are three patterns:

1. **Hardcoded by extractor.** Most extractors set a fixed confidence per field type: VIN = "high", color from description = "medium", mileage from title = "low". This is heuristic.

2. **Inherited from source.** Some extractors look up the source's `base_trust_score` and pass it through. The `ingest-observation` pathway does this.

3. **Not set at all.** Many older field_evidence rows have NULL confidence. These were created before the trust model existed.

### Gap: field_evidence Is Not Connected to observation_sources

The fundamental gap: `field_evidence` rows reference a `source_type` (text string like "bat", "mecum") but do NOT have a foreign key to `observation_sources`. The trust score lookup that happens in `ingest-observation` does NOT happen when field_evidence rows are created directly by extractors. This means:

- 5.7M observations have trust-scored confidence (from `ingest-observation`)
- 3.29M field_evidence rows have extractor-assigned confidence (independent of the trust model)
- The two systems do not cross-reference

**To close this gap:** Field evidence creation should look up the source's `base_trust_score` from `observation_sources` and use it as the floor for confidence assignment. Alternatively, field_evidence rows should reference the `vehicle_observations.id` that produced them, inheriting the observation's confidence.

---

## Decision Record

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Trust model | Source-based with contextual bonuses | Per-claim Bayesian | Simpler to implement, sufficient for current scale |
| Score range | 0.0-1.0 continuous | Categorical (high/medium/low) | Continuous allows arithmetic (weighted averages) |
| Decay model | Exponential half-life | Linear decay / Step function | Half-life is intuitive and handles different time scales naturally |
| Contradiction resolution | Not yet implemented | Last-write-wins | Last-write-wins is the current default; weighted resolution is the target |
| Calibration | Heuristic | Empirical | No labeled dataset for calibration; heuristic ordering is defensible |

---

## Theory vs Implementation Gap Summary

| Aspect | Theory (this paper) | Implementation | Gap |
|--------|-------------------|----------------|-----|
| Source hierarchy | 8 categories, clean ordering | 12 categories, 160 sources, overlapping ranges | Categories expanded; `owner` now top, `internal` new |
| Confidence computation | `base_trust + bonuses` | Exact match — implemented in `ingest-observation` | None (theory = code) |
| Temporal decay | Exponential half-life per observation type | `observed_at` stored; decay NOT computed | Designed, not implemented |
| Contradiction resolution | Trust-weighted voting | Last-write-wins in `vehicles` table | Fully unimplemented |
| field_evidence confidence | Should inherit from observation trust | Extractor-assigned, independent of trust model | Two parallel confidence systems |
| Per-entity trust | Dynamic trust from corroboration tracking | Static `base_trust_score` per source | Fully unimplemented (see Dynamic Trust Model) |
| Photo evidence linking | Claims + photos = higher trust | `field_evidence` has 3.29M rows but no trust integration | Data exists, scoring does not |

---

## For the Next Agent

1. **Do not change base_trust_score values** in `observation_sources` without documenting why. The 160 source entries were set based on incentive structure analysis, not arbitrary assignment.
2. **The actual hierarchy is nuanced.** Owner (0.90 avg) > Registry (0.89) > Shop (0.83) > Auction (0.73) > Aggregator (0.68) > Dealer (0.65) > Internal (0.63) > Marketplace (0.61) > Forum (0.55) > Social (0.39). Within categories, ranges overlap significantly.
3. **Decay is not implemented.** Don't assume observation trust accounts for age. If you need age-adjusted trust, compute it yourself: `trust * power(0.5, age_days / (half_life_days))`.
4. **Contradiction resolution is manual.** The `vehicles` table reflects the most recent extractor's values, not the most trusted. This is a known gap.
5. **field_evidence and vehicle_observations are parallel systems.** 3.29M field_evidence rows use extractor-assigned confidence. 5.7M observations use trust-model confidence. They don't cross-reference. Any work to unify them should start by adding an `observation_id` FK to `field_evidence`.
6. **96.3% of observations are "high" confidence.** The categorical system does not discriminate within the dominant bucket. Use `confidence_score` (numeric) for any analysis that needs resolution.
