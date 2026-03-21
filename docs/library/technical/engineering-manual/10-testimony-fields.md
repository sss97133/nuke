# Chapter 10: Testimony Fields — What "Data as Testimony" Actually Means in Columns

**Status**: Implementation spec
**Last updated**: 2026-03-21

---

## 10.1 The Concrete Structure

Every extracted claim requires 7 supporting fields to be epistemically valid. Here's what that looks like for a single claim: "This vehicle is Cortez Silver."

| # | Column | Value | Purpose |
|---|--------|-------|---------|
| 1 | `value` | Cortez Silver | The claim itself |
| 2 | `source_id` | barrett-jackson (trust: 0.75) | Who made the claim |
| 3 | `confidence_score` | 0.65 | Combined trust × extraction quality |
| 4 | `observed_at` | 2024-03-15T10:30:00Z | When the claim was made |
| 5 | `quote` | "finished in Cortez Silver" | Exact text from source that supports claim |
| 6 | `half_life_days` | 1825 (5 years for specs) | How fast this claim goes stale |
| 7 | `effective_weight` | 0.58 (computed at query time) | trust × confidence × temporal_relevance |

Without fields 2-7, the claim is just `color = "Cortez Silver"` — you can't tell if it came from a concours judge or a Craigslist ad, if it was said yesterday or 10 years ago, or if another source disagrees.

---

## 10.2 The v3 Extraction Schema

The LLM extraction prompt produces claims in this structure:

```json
{
  "specification": {
    "exterior_color": {
      "value": "Cortez Silver",
      "quote": "finished in Cortez Silver with a black interior",
      "confidence": 0.95
    },
    "engine_type": {
      "value": "L89 427ci V8",
      "quote": "L89 aluminum-head 427ci V8",
      "confidence": 0.90
    },
    "horsepower": {
      "value": 435,
      "quote": "rated at 435 horsepower",
      "confidence": 0.85
    }
  }
}
```

Each claim has three fields from the LLM:
- `value` — what was extracted
- `quote` — the exact source text (max 60 chars, for citation)
- `confidence` — the LLM's self-assessed extraction confidence

The other 4 supporting fields come from the system:
- `source_id` — looked up from observation_sources
- `observed_at` — the listing/page date
- `half_life_days` — from `observation_half_life_days(kind)`
- `effective_weight` — computed at query time by `observation_effective_weight()`

---

## 10.3 How Claims Become Observations

Each claim in the v3 extraction maps to a `vehicle_observations` row:

```
v3 extraction output → decompose → vehicle_observations INSERT

specification.exterior_color → {
  vehicle_id:       <uuid>,
  source_id:        <observation_sources.id for ai-description-extraction>,
  kind:             'specification',
  structured_data:  { field: 'exterior_color', value: 'Cortez Silver', quote: '...', confidence: 0.95 },
  content_text:     'finished in Cortez Silver with a black interior',
  confidence_score: 0.65 * 0.95 = 0.6175,  -- base_trust × llm_confidence
  observed_at:      <listing date>,
  agent_tier:       'system',
  extraction_method:'llm_extraction',
  extracted_by:     'promote-discoveries-to-observations'
}
```

---

## 10.4 How Multiple Claims Compose

A vehicle accumulates claims over time from different sources:

```
Claim 1: BaT listing (trust 0.85) says "Cortez Silver" — 2024-03-15
Claim 2: Barrett-Jackson (trust 0.75) says "Cortez Silver" — 2023-11-20
Claim 3: Forum comment (trust 0.50) says "looks dark blue to me" — 2024-06-01
```

At query time (2026-03-21):

| Claim | Trust | Confidence | Relevance (decay) | Effective Weight |
|-------|-------|-----------|-------------------|-----------------|
| BaT: Cortez Silver | 0.85 | 0.90 | 0.76 (2yr old, 5yr half-life) | 0.581 |
| BJ: Cortez Silver | 0.75 | 0.85 | 0.69 (2.3yr old) | 0.440 |
| Forum: dark blue | 0.50 | 0.60 | 0.81 (0.8yr old) | 0.243 |

**Corroboration**: BaT + BJ agree → corroboration factor 1.15 → BaT weight becomes 0.668, BJ becomes 0.506.

**Result**: "Cortez Silver" wins with combined weight 1.174 vs "dark blue" at 0.243.
**Contradiction flagged**: Forum claim disagrees — visible to user with context.

The `vehicle_current_state` view returns: `exterior_color = 'Cortez Silver'`, `confidence = 0.668`, `freshness = 'fresh'`

---

## 10.5 Staleness and Refresh

Each claim type decays at a different rate (from the half-life paper):

| Claim Category | Half-Life | After 1yr | After 3yr | After 5yr |
|---------------|-----------|-----------|-----------|-----------|
| VIN / identity | Never | 100% | 100% | 100% |
| Specification (engine, trans) | 5 years | 87% | 66% | 50% |
| Condition | 2 years | 71% | 35% | 18% |
| Work record | 10 years | 93% | 81% | 71% |
| Provenance | Never | 100% | 100% | 100% |
| Listing price | 3 months | 10% | 0% | 0% |
| Auction result | 3 years | 79% | 50% | 32% |
| Forum comment | 2 years | 71% | 35% | 18% |

**Freshness labels** (shown in UI):
- **fresh**: >70% relevance remaining
- **aging**: 50-70%
- **stale**: 25-50%
- **expired**: <25%

When a vehicle's condition observations are all "stale" or "expired", the system should coach: "No condition assessment in 3+ years. Schedule inspection."

---

## 10.6 The reference_validation Section

The v3 prompt also produces a `reference_validation` section — the LLM cross-references its findings against the injected library data:

```json
{
  "reference_validation": {
    "codes_matched": ["L89 — matches known RPO for 427/435hp aluminum head V8"],
    "codes_unrecognized": ["UPC — not found in reference data"],
    "paint_code_match": "986 matches Cortez Silver for 1969 Corvette",
    "trim_identified": "L89 is a factory performance option, not a trim level",
    "known_issues_addressed": ["aluminum head porosity — seller mentions new heads"],
    "known_issues_unaddressed": ["rear main seal — common issue not mentioned"]
  }
}
```

This is forensic extraction — not just pulling data out, but validating it against known ground truth.

---

## 10.7 Implementation Files

| File | Purpose |
|------|---------|
| `scripts/lib/extraction-prompt-v3.mjs` | The v3 prompt builder and parser |
| `scripts/lib/build-extraction-context.mjs` | Library data querier for prompt injection |
| `scripts/local-description-discovery.mjs` | Extraction runner (all providers) |
| `scripts/promote-discoveries-to-observations.mjs` | Decomposer: JSON blobs → observations |
| `scripts/compute-description-corroboration.mjs` | Multi-model consensus scoring |

### SQL Functions

| Function | Purpose |
|----------|---------|
| `observation_relevance(observed_at, half_life_days)` | Exponential decay |
| `observation_half_life_days(kind)` | Category → half-life lookup |
| `observation_effective_weight(trust, conf, observed_at, kind)` | The full weight formula |
| `observation_freshness(observed_at, kind)` | UI labels |

### Views

| View | Purpose |
|------|---------|
| `vehicle_current_state` | Weighted best-estimate per vehicle from all spec observations |
