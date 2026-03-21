# PAPER: Entity Resolution Design

**Author:** System Architecture
**Date:** 2026-03-20
**Status:** Living Document
**References:** Engineering Manual Ch.3, Theoreticals: entity-resolution-theory.md

---

## Abstract

Entity resolution is the problem of determining whether two data records refer to the same physical object in the real world. In Nuke, this means: does this BaT listing, this Craigslist post, and this Facebook Marketplace ad all describe the same 1979 Chevrolet K10 sitting in someone's garage in Tucson?

This paper documents why the current three-pass cascade was chosen, what alternatives were considered, what tradeoffs were accepted, and what the path forward looks like.

---

## The Problem

A single vehicle can appear in the Nuke database through multiple paths:

1. Scraped from BaT (listed for auction)
2. Scraped from Craigslist (listed for private sale after auction failed)
3. Discovered on Facebook Marketplace (relisted with different photos)
4. Owner enters it directly through Nuke (claims ownership)
5. Appears in a forum build thread (different context, same truck)
6. Shows up in a shop's portfolio (restoration documentation)

Each path creates a candidate vehicle record. Without resolution, one physical truck becomes six database entries — fragmenting its provenance, splitting its comment history, diluting its photo coverage, and producing wrong market statistics.

The cost of **false merges** (merging two different vehicles into one) is higher than the cost of **false splits** (keeping two records for the same vehicle). A false merge corrupts both vehicles' data and is hard to undo. A false split just means incomplete data that can be merged later when more evidence arrives.

This asymmetry drives every design decision.

---

## Design Decision: Three-Pass Cascade

### Why Not a Single Composite Score?

The target architecture (Engineering Manual Ch.3) describes a multi-signal composite scorer with weighted signals (VIN=0.50, URL=0.30, Year=0.10, etc.) summing to a composite confidence. This is theoretically better but was not implemented first because:

1. **Calibration requires labeled data.** What weight should "same color" get? We don't have enough verified merge/split examples to calibrate weights empirically.
2. **Most matches are trivial.** 90%+ of matches are VIN-exact or URL-exact. A cascade that handles the trivial cases cheaply and escalates the hard cases is pragmatically better than scoring everything.
3. **Failure modes are clearer.** When a VIN match fails, we know exactly why (no VIN on the new record). When a composite score of 0.73 fails the 0.80 threshold, debugging is harder.

### The Three Passes

**Pass 1: VIN Match (confidence 0.99)**

VINs are globally unique identifiers (post-1981). A VIN match is the strongest possible evidence. Confidence is 0.99 (not 1.0) because VIN data entry errors exist — a transposed digit, a misread O/0, an OCR error. At 0.99, the match is treated as certain but not infallible.

**When it fails:** Pre-1981 vehicles have non-standard chassis numbers. Many listings don't include VINs. Facebook Marketplace almost never has VINs. This pass resolves ~15% of matches.

**Pass 2: URL Match (confidence 0.95)**

If the same source URL has been seen before, the new observation belongs to the same vehicle. This works because listing URLs are unique per vehicle on each platform (bringatrailer.com/listing/1979-chevrolet-k10-4x4/ is always the same truck).

**When it fails:** Re-listed vehicles get new URLs (BaT appends a number suffix). Different platforms have different URLs for the same vehicle. URL matching is intra-platform only.

**This pass resolves ~60% of matches** — the majority, because most observations come from platforms we've already scraped.

**Pass 3: Fuzzy Year/Make Match (confidence 0.60)**

Last resort. Match by year + make, but only if there is exactly one candidate. If multiple vehicles match year+make, the observation is left unresolved (no vehicle_id assigned).

**Why not include model?** Model normalization is unsolved. Is "911S" the same model as "911 S"? Is "K10 Silverado" the same as "K10"? Is "C/K 10" the same as "C10" or "K10"? Until canonical model normalization exists, fuzzy model matching creates more false merges than it prevents.

**Why 0.60?** Because year+make alone is weak evidence. There are 6,484 Corvettes in the database spanning 70 years. Year+make only works when you have exactly one "1973 GMC" in the system — which is true early in the lifecycle of a rare vehicle but becomes false as the database grows.

**This pass resolves ~5% of matches.** The remaining ~20% stay unresolved.

---

## The Merge Pipeline

When duplicates are discovered after the fact (same listing_url, different vehicle IDs), the `dedup-vehicles` function merges them:

1. **Primary selection:** Oldest record (by created_at) becomes primary. Rationale: it was discovered first, likely has the most accumulated data.
2. **Child record migration:** All vehicle_images, auction_comments, vehicle_observations, vehicle_events are re-pointed from duplicate to primary.
3. **Field backfill:** If the duplicate has fields the primary lacks (e.g., VIN), they're copied to the primary.
4. **Soft delete:** Duplicate gets `status='merged'`, `merged_into_vehicle_id=<primary>`. Never hard-deleted — provenance requires the merge trail.

### Why Not Hard Delete?

A hard-deleted duplicate loses:
- The fact that a merge happened (audit trail)
- The ability to un-merge if the merge was wrong
- Any unique metadata on the duplicate that wasn't copied

The `merged_into_vehicle_id` field lets any query that accidentally hits a merged record follow the chain to the primary. This is more important than saving a few KB of storage.

---

## Known Limitations

### 1. Cross-Platform Resolution is Blind

A truck listed on BaT and then on Craigslist creates two records unless both have VINs. Without VIN, there is no automated cross-platform matching. This is the single largest source of duplicate records.

**Proposed solution:** Vehicle fingerprinting — a composite hash of normalized year/make/model/color/location. If a 1979 blue K10 appears in Tucson on both BaT and Craigslist, the fingerprint match confidence could be ~0.85, enough to flag for human review.

### 2. Fuzzy Match Gets Worse at Scale

When the database had 10K vehicles, year+make often produced unique matches. At 300K+ vehicles, the same query returns dozens of candidates. The fuzzy pass effectiveness degrades with growth.

**Proposed solution:** Add model to the fuzzy pass after building canonical model normalization. The THESAURUS should map all model variants to canonical forms.

### 3. No Image-Based Matching

Two photos of the same truck with the same distinctive features (custom stripe, unique damage pattern, rare color combination) should produce a match. Currently, image similarity is not used in resolution.

**Proposed solution:** Perceptual hashing of hero images. If two listings have a perceptual hash distance < threshold, flag as potential match. YONO's visual signature feature (`vehicles.visual_signature`) was designed for this but is not yet integrated into resolution.

### 4. Confidence Doesn't Decay

A URL match from 3 years ago has the same 0.95 confidence as one from today. But a 3-year-old URL might point to a vehicle that has changed owners, been modified, or been re-sold. Temporal decay should reduce match confidence over time.

---

## Decision Record

| Decision | Chosen | Alternative Rejected | Why |
|----------|--------|---------------------|-----|
| Three-pass cascade vs composite score | Cascade | Composite | No labeled data for calibration, cascade handles 80% trivially |
| Auto-match threshold | 0.80 (target), 0.60 (current fuzzy) | 0.50 / 0.90 | 0.50 too many false merges, 0.90 too many false splits |
| Primary selection | Oldest by created_at | Most complete, highest quality | Oldest is deterministic and stable; completeness changes over time |
| Merge strategy | Soft delete + re-point children | Hard delete / Keep both | Soft delete preserves audit trail, re-pointing consolidates data |
| Model matching | Excluded from fuzzy pass | Included with Levenshtein | Too many normalization edge cases, false merge risk |

---

## Metrics

As of 2026-03-20:
- **1,542,410** total observations in vehicle_observations
- **0** observations without vehicle_id (all resolved)
- **304,754** active/sold vehicles
- **~48,000** vehicles merged historically (status='merged')
- VIN match rate: ~15% of new observations
- URL match rate: ~60% of new observations
- Fuzzy match rate: ~5% of new observations
- Unresolved rate: ~20% of new observations

---

## For the Next Agent

If you're modifying entity resolution:

1. **Never lower the auto-match threshold below 0.80.** False merges corrupt data permanently.
2. **Never add model to the fuzzy pass** without building canonical model normalization first (see THESAURUS).
3. **Test any changes against the known duplicates.** Query: `SELECT count(*) FROM vehicles WHERE status='merged'` — this number should not grow unexpectedly after your change.
4. **The observation system depends on resolution.** If you break resolution, `ingest-observation` stops linking observations to vehicles, and the entire downstream pipeline (analysis engine, scoring, enrichment) goes dark.
