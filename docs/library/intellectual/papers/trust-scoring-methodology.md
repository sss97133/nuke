# PAPER: Trust Scoring Methodology

**Author:** System Architecture
**Date:** 2026-03-20
**Status:** Living Document
**References:** Engineering Manual Ch.4, Theoreticals: observation-half-life-model.md, Contemplations: testimony-and-half-lives.md

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
| `registry` (0.90-0.95) | Institutional, verified, no sales incentive | VIN decode = federal database. Build sheet = factory record. These sources have no reason to lie and institutional processes to prevent errors. |
| `documentation` (0.80-0.90) | Physical documents with verification | Titles, service records, window stickers. Physical documents are harder to forge than digital claims. Trust varies by document type. |
| `auction` (0.75-0.90) | Curated, moderated, reputation-dependent | BaT (0.90): heavy curation, seller verification, public comment scrutiny. Mecum (0.75): less curation, higher volume. Auction houses stake their reputation on accuracy. |
| `dealer` (0.65-0.75) | Professional but sales-incentivized | Dealers have expertise but also inventory to move. Descriptions are professional but optimistic. Hagerty (0.70) vs random dealer (0.65). |
| `owner` (0.55-0.65) | First-hand knowledge but subjective | Owners know their vehicles intimately but have emotional attachment and may overstate condition. Trust increases with documentation provided. |
| `marketplace` (0.45-0.55) | Unmoderated, anonymous, high-volume | eBay (0.55): seller ratings provide some accountability. Craigslist (0.50): fully anonymous. Facebook (0.45): real names but no vehicle verification. |
| `forum` (0.40-0.50) | Expert community but unverified | Rennlist (0.50): deep expertise, known experts. Random forum (0.40): anyone can post. Trust is in the community's self-policing. |
| `social_media` (0.30-0.40) | Entertainment-oriented, no verification | Instagram, YouTube. Content is for engagement, not accuracy. Specs may be aspirational, not actual. |

### Why These Specific Numbers?

The numbers were set heuristically, not empirically calibrated. The ranking (registry > documentation > auction > dealer > owner > marketplace > forum > social) reflects common sense about data reliability. The specific values (0.90 vs 0.85) are less important than the ordering.

**Calibration would require:** A labeled dataset of observations where we know the ground truth. For example, 1,000 vehicles where we have verified VIN data AND seller claims, so we can measure how often each source type is correct. This dataset doesn't exist yet.

---

## Contextual Confidence Adjustment

The base trust score is adjusted per-observation based on contextual signals:

```
final_confidence = min(1.0, base_trust_score + contextual_bonuses)
```

### Contextual Bonuses

| Signal | Bonus | Rationale |
|--------|-------|-----------|
| Vehicle match confidence >= 0.95 | +0.10 | We're confident this observation is about the right vehicle |
| Has source URL | +0.05 | Traceable to original source |
| Substantial content (>100 chars) | +0.05 | More content = more to verify against |

### Confidence Levels

The numeric score maps to a categorical level:

| Score Range | Level | Meaning |
|-------------|-------|---------|
| >= 0.95 | `verified` | Multiple independent sources agree, or registry-grade data |
| 0.85-0.94 | `high` | Strong single source (curated auction, official document) |
| 0.40-0.84 | `medium` | Standard observation, usable but not definitive |
| < 0.40 | `low` | Unreliable source, use only as supporting evidence |

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

**Decay is designed but not implemented in production.** The `observation_half_life_model.md` theoretical describes the full system. The `ingest-observation` function stores `observed_at` timestamps, which enables retroactive decay computation. But no function currently applies decay when querying observation data.

**Why not yet:** Decay requires a materialized view of the "best current value" for each vehicle field, computed from all observations weighted by decayed trust. This is the target architecture (Engineering Manual Ch.4: "Materialized vehicle profiles") but is not yet built.

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

**Proposed:** Evidence linking. The field_evidence table was designed for this — linking specific claims to specific source materials. At 146K rows, it's partially populated but not integrated into trust scoring.

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

## For the Next Agent

1. **Do not change base_trust_score values** in observation_sources without documenting why in a DISCOURSE.
2. **The hierarchy order matters more than the specific numbers.** Registry > Documentation > Auction > Dealer > Owner > Marketplace > Forum > Social. Any change that violates this ordering needs justification.
3. **Decay is not implemented.** Don't assume observation trust accounts for age. If you need age-adjusted trust, compute it yourself using the formula above.
4. **Contradiction resolution is manual.** The vehicles table reflects the most recent extractor's values, not the most trusted. This is a known gap.
