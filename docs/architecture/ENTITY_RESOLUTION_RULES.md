# Entity Resolution Rules

**Author:** System Architecture
**Date:** 2026-03-21
**Status:** Canonical — all merge/dedup/resolution code MUST follow these rules
**Supersedes:** entity-resolution-design.md (old three-pass cascade)

---

## The Core Truth

**The vehicle is the entity. Everything else is testimony.**

A URL does not create a vehicle. A vehicle exists in the physical world, and a URL is a digital record that testifies to its existence at a point in time, through a specific entity, with a specific level of trustworthiness.

A "merge" is not combining two profiles. A merge is **discovering that multiple testimonies refer to the same physical chassis** and linking them to a single canonical entity.

---

## What an Observation Is

Every piece of data about a vehicle is an **observation**: a claim made by a source, at a time, about a vehicle's state.

```
observation = {
  vehicle_id:     the physical entity this testimony refers to
  source_entity:  WHO is testifying (BaT, Mecum, Instagram user, forum poster)
  source_url:     WHERE the testimony lives digitally
  observed_at:    WHEN the testimony was made
  trust_score:    HOW much we trust this source
  claims:         WHAT the testimony asserts (price, condition, mileage, photos)
  evidence:       THE RAW DATA (HTML, images, JSON) backing the claims
}
```

### Key Properties

1. **Observations are immutable.** A BaT listing from 2021 said what it said. We don't update it. If the car sells again in 2024, that's a NEW observation.

2. **Observations have half-lives.** A mileage reading from 2021 is less reliable about 2024 state than a reading from last week. Different claim types decay at different rates (VIN never decays; mileage decays fast; color decays slow).

3. **Observations conflict.** Two listings may report different mileage. This is not an error to resolve — it's a signal. The vehicle's "current mileage" is computed from the most recent, highest-trust observation.

4. **Observations carry images as temporal evidence.** Photos from a 2021 listing show the car's condition *as of 2021*. Photos from a 2024 listing show it *as of 2024*. Both are true. Neither supersedes the other.

---

## What Entity Resolution Actually Means

Entity resolution answers ONE question: **do these observations refer to the same physical vehicle?**

It does NOT:
- Pick a "winner" between two records
- Overwrite data from one record with another
- Delete or hide any testimony
- Decide which data point is "more correct"

It DOES:
- Assign a canonical `vehicle_id` to observations that refer to the same chassis
- Preserve every observation's provenance (who said what, when, how trustworthy)
- Enable the vehicle's current state to be computed from all linked observations

---

## The Evidence Hierarchy

How do we know two records refer to the same physical vehicle?

### Tier 1: Definitive Identity (confidence >= 0.95)

| Signal | Confidence | Notes |
|--------|------------|-------|
| VIN match (17-char, post-1981) | 0.99 | Globally unique. Can still have OCR/typo errors. |
| Chassis number match (pre-1981) | 0.95 | Not globally unique but unique within make+era. |
| Same source URL, same platform | 0.99 | Same listing = same vehicle, always. |

### Tier 2: Strong Evidence (confidence 0.80-0.94)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Normalized URL (same listing ID, different URL format) | 0.95 | JamesEdition listing 14855981 = same car regardless of URL suffix. |
| VIN partial + year + make match | 0.90 | Last 8 of VIN + year + make is very strong. |
| Body/engine/chassis number match + year + make | 0.85 | Bonhams uses engine numbers — valid if make+year agree. |
| Perceptual image match (dHash <= 3) + year + make | 0.85 | Same hero photo appearing in two listings of same year+make. |

### Tier 3: Circumstantial Evidence (confidence 0.50-0.79)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Year + make + model + sale_price match | 0.60 | Could be a coincidence at scale (22 identical 1967 Corvettes at $110K). |
| Image similarity (dHash 4-8) + year match | 0.60 | Similar but not identical photos. |
| Year + make + color + mileage within 1% | 0.70 | Strong if all four match, but mileage changes over time. |
| GPS location match + year + make | 0.65 | Same car photographed in same location. |

### Tier 4: Weak / Contextual (confidence < 0.50)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Year + make only | 0.30 | Too many candidates at scale. |
| Facebook page reposting auction images | 0.40 | Confirms vehicle exists, but the FB page is a derived source. |
| Forum discussion referencing a listing | 0.50 | People talk about specific vehicles, but attribution is imprecise. |

### Confidence Does NOT Mean "Merge Automatically"

High confidence means we believe the observations reference the same physical vehicle. But the **action** depends on what we're doing:

- **Linking an observation** to a vehicle: confidence >= 0.60 is fine (we can always un-link later)
- **Soft-merging two vehicle records** (re-pointing children): confidence >= 0.85, ideally with AI verification
- **Hard-deleting a duplicate**: NEVER automated. Only after human review.

---

## The Observation Linking Process (replaces "merge pipeline")

When a new data source arrives (URL, scrape, user input), the process is:

### Step 1: Extract Claims
Parse the source into structured claims: year, make, model, VIN, price, condition, photos, description, seller, location, date.

### Step 2: Resolve Entity
Run the evidence hierarchy against existing vehicles:
- Tier 1 match → link with high confidence, proceed
- Tier 2 match → link with moderate confidence, flag for verification
- Tier 3 match → create a **candidate link** (stored but not active until verified)
- No match → create a new vehicle entity

### Step 3: Ingest as Observations
Each claim becomes a `vehicle_observation` with full provenance:
```sql
INSERT INTO vehicle_observations (
  vehicle_id, source_url, source_type, observation_kind,
  field_name, field_value, observed_at, confidence_score,
  agent_tier, extraction_method, extracted_by
)
```

### Step 4: Recompute Vehicle State
The vehicle's "current" fields are computed from observations:
- Most recent observation per field wins (if trust >= threshold)
- Conflicting observations flagged for review
- Temporal decay applied per field category

---

## What Happens to the Old "Merge" Operations

### Case: Same listing ingested twice (exact URL duplicate)
**Before:** `merge_into_primary` combines records, soft-deletes duplicate.
**Now:** This should never create two vehicle records. The ingest pipeline should resolve the entity via URL match (Tier 1, 0.99) before creating a second record. If it does create a duplicate, the fix is to re-point observations and archive the empty shell.

### Case: Same car listed on BaT in 2021 and 2024
**Before:** Treated as a "merge" — combine the two records.
**Now:** These are TWO SEPARATE OBSERVATIONS on the SAME ENTITY. Each listing contributes its own observation cluster (photos, price, comments, condition). The vehicle has a richer timeline, not a merged profile.

### Case: JamesEdition clean URL + title-appended URL
**Before:** Merge the title-appended version into the clean version.
**Now:** Fix the ingestion bug (normalize URLs before entity resolution). The title-appended variant should have resolved to the existing vehicle via normalized listing ID. Archive the empty shell, re-point any unique observations.

### Case: Facebook page reposts BaT images with 1000 comments
**Before:** Not captured at all.
**Now:** The FB page is a **derived source** with low trust for vehicle specs (it's just copying) but HIGH value for engagement data (comments, reactions). Ingest the comments as observations with `source_type='social_media'`, `trust=0.30` for specs, `trust=0.80` for engagement/sentiment.

### Case: Instagram post by the owner showing the car
**Before:** Not captured.
**Now:** Owner-sourced observation with `trust=0.85` (owner knows their own car). Photos provide current condition evidence. GPS data from the photo provides location evidence.

### Case: Forum build thread documenting a restoration
**Before:** Not captured.
**Now:** Each post in the thread is an observation. Photos show condition changes over time. Technical details (engine swap, paint code, parts sourced) are high-value claims from a knowledgeable source.

---

## Rules for Automated Resolution

1. **NEVER create a new vehicle record if entity resolution finds a Tier 1 or Tier 2 match.** Link to the existing entity.

2. **ALWAYS preserve the source observation even if the entity link is uncertain.** An observation with `vehicle_id=NULL` is better than a lost observation.

3. **NEVER overwrite a field on the vehicles table from a lower-trust source.** If BaT says mileage is 45,000 (trust 0.90) and Facebook says 43,000 (trust 0.30), the BaT value stands.

4. **ALWAYS timestamp observations.** The same field from the same source at different times = two observations, both valid.

5. **Observations from derived sources (reposts, aggregators) inherit a trust penalty.** A Facebook page reposting BaT images gets `base_trust * 0.5` for vehicle specs but full trust for its own engagement data.

6. **AI verification is required for Tier 3 matches before linking.** Store as a candidate link in `merge_proposals` until verified.

7. **VINs are not always VINs.** Bonhams uses engine numbers. ExclusiveCarRegistry uses collection slugs. Pre-1981 chassis numbers aren't globally unique. Validate VIN format before treating it as definitive identity.

8. **Images are temporal evidence, not identity signals alone.** dHash matching across vehicles is Tier 2 evidence (strong) but only when combined with year+make agreement. Images alone can false-match (stock photos, press images reused across listings).

9. **The `merge_into_primary` function is a LAST RESORT for cleaning up past ingestion failures.** New data should flow through `ingest-observation` with proper entity resolution. The goal is to never need merge again.

10. **False splits are acceptable. False merges are catastrophic.** When in doubt, create a candidate link and wait for more evidence.

---

## Implementation Path

### Phase 1: Fix Ingestion (prevent new duplicates)
- Add URL normalization to entity resolution (extract platform-specific listing IDs)
- Add VIN validation (reject fake VINs from Bonhams/ECR before matching)
- All new data flows through `ingest-observation` → entity resolution → `vehicle_observations`

### Phase 2: Backfill Entity Links
- Run dHash across all vehicle_images to build the cross-vehicle image similarity index
- Generate merge proposals for all Tier 2+ candidates with AI verification
- Execute approved proposals (re-point observations, archive empty shells)

### Phase 3: Expand Observation Sources
- Facebook pages → comment ingestion pipeline
- Instagram → photo + caption ingestion
- Forum threads → post-by-post observation extraction
- Owner input (via MCP/frontend) → high-trust direct observations

### Phase 4: Computed Vehicle State
- Vehicle "profile" fields are materialized views over observations
- Each field shows its provenance chain (which observations contributed, with what trust/recency)
- Conflicting observations surfaced in the UI as "disputed" with evidence from both sides

---

## Summary

**The vehicle exists. URLs testify to its existence. Observations document its state over time. Entity resolution discovers which testimonies belong to the same chassis. Nothing is ever lost — only linked.**

The word "merge" should eventually disappear from the codebase, replaced by "resolve" and "link."
