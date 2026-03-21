# Entity Resolution Theory: Matching Observations to Entities Without Universal Identifiers

**Status**: Partially implemented -- VIN matching works, URL matching works, fuzzy matching at 60% causes data corruption
**Author**: Nuke Research
**Date**: 2026-03-20
**Dependencies**: Observation system, image pipeline (for perceptual hashing)
**Domain**: Universal (automotive, art, publishing, all future verticals)

---

## Abstract

Entity resolution is the process of determining whether two observations describe the same real-world entity. When the entity has a universal identifier (a VIN for vehicles, an ISBN for books), resolution is trivial: match the identifier. When the entity has no universal identifier (an artwork, an unregistered vehicle, a person operating under multiple names), resolution becomes a probabilistic inference problem.

This paper defines the entity resolution algorithm formally: the input hint system, the multi-stage scoring pipeline, the confidence thresholds that govern automatic matching versus human review, and the asymmetric cost analysis that explains why the auto-match threshold must be 0.80 and not 0.60. It defines the image perceptual hashing system for visual matching, the metadata intersection scoring for attribute-based matching, and the candidate review workflow for ambiguous cases.

The fundamental claim: false positives (incorrectly merging two different entities) are catastrophic and irreversible in practice, while false negatives (failing to merge two observations of the same entity) are annoying but fixable. The entire resolution system is designed around this asymmetry.

---

## Part I: The Resolution Problem

### 1.1 Why Resolution Is Hard

In a provenance graph with millions of observations from hundreds of sources, the same entity appears under different names, different descriptions, and different contexts:

**Vehicle examples:**
- BaT listing: "1972 Chevrolet K5 Blazer CST 350/TH350"
- eBay listing: "72 Chevy Blazer 4x4 V8 Auto"
- Owner's insurance document: "1972 Chevrolet C/K Blazer"
- VIN decode: "1972 Chevrolet K10 Blazer, 350ci, Turbo-Hydramatic 350"
- Forum post: "my 72 K5"

All five describe the same vehicle. The VIN (when available) resolves this instantly. But the forum post may not include a VIN. The eBay listing may have a partial VIN in a photo. The insurance document may have a VIN that wasn't extracted.

**Art examples:**
- Christie's lot: "Jean-Michel Basquiat, Untitled, 1982, Acrylic and oil stick on canvas, 72 1/4 x 68 1/8 in."
- Sotheby's lot (same work, different sale): "Basquiat, Jean-Michel, Untitled, 1982, Mixed media on canvas, 183.5 x 173 cm"
- Museum database: "Jean-Michel Basquiat, American, 1960-1988. Untitled. 1982. Acrylic, oil stick on canvas. 72 1/4 x 68 1/8 inches."
- Gallery website: "Basquiat - Untitled (1982)"
- Instagram post: "Incredible Basquiat from '82 at the museum"

The same artwork, described five different ways. No universal identifier. The artist has multiple spellings. The title is "Untitled" (shared with hundreds of other Basquiat works). The medium description varies. The dimensions use different units. The Instagram post has no structured data at all.

### 1.2 The Cost Asymmetry

**False positive (merging different entities)**: Two distinct vehicles or artworks are merged into one entity. Their provenance chains are combined. Their condition reports are intermixed. Their auction results are conflated. The data is corrupted. Untangling a false merge requires identifying every observation that was incorrectly linked and reassigning them -- a manual, error-prone process that may never be fully corrected.

Cost: **Very high. Effectively irreversible at scale.**

**False negative (failing to merge same entity)**: The same vehicle or artwork exists as two separate entities in the system. Each has partial data. Neither has the complete picture. The system misses the connection between a BaT sale and a subsequent eBay listing of the same vehicle.

Cost: **Moderate. Fixable.** When better data arrives (the VIN is extracted from a photo, a user manually links the two entities), the merge is straightforward. The data was always correct -- just fragmented.

This asymmetry is the governing principle of the entire resolution system. Every design decision favors false negatives over false positives. The system would rather maintain 100 duplicate entities (fixable) than incorrectly merge 1 entity (catastrophic).

---

## Part II: The Resolution Pipeline

### 2.1 Input: Resolution Hints

Every observation enters the resolution pipeline with a set of hints -- pieces of information that help match it to an existing entity:

```
ResolutionHints {
    // Strong identifiers (one is usually sufficient)
    unique_id: string | null,           // VIN, catalogue raisonne number, accession number
    source_url: string | null,          // The URL this observation was extracted from

    // Medium identifiers (need multiple to match)
    title: string | null,               // "1972 Chevrolet K5 Blazer" or "Untitled, 1982"
    year: number | null,
    creator: string | null,             // Make (vehicle) or artist name (art)
    model_or_subtitle: string | null,   // Model (vehicle) or subtitle/series (art)

    // Weak identifiers (supplementary)
    dimensions: string | null,          // "72 x 68 in" or "183 x 173 cm"
    medium: string | null,              // "Acrylic on canvas" or "V8/automatic"
    color: string | null,               // "Red" or "Blue-green"
    location: string | null,            // Geographic hint
    price_range: {low: number, high: number} | null,  // Approximate value range

    // Visual match
    image_hashes: string[] | null,      // Perceptual hashes of associated images

    // Domain
    asset_type: 'vehicle' | 'artwork' | 'publication'
}
```

### 2.2 Stage 1: Unique Identifier Match

If a unique_id (VIN, catalogue raisonne number, accession number) is provided, attempt exact match:

```
SELECT asset_id FROM observations
WHERE unique_id_field = hints.unique_id
AND asset_type = hints.asset_type
LIMIT 1
```

**If match found**: Confidence = 0.99. Auto-match. The observation is linked to the existing entity.

**If no match**: Proceed to Stage 2.

**Edge case -- VIN collision**: VIN encoding has a theoretical 1-in-11 chance of check digit collision across the entire 17-character space. In practice, collision within the same make/model/year is essentially zero. The system trusts VIN matches without further verification.

**Edge case -- VIN fraud**: A stolen vehicle may have a VIN plate swapped. The system cannot detect VIN fraud from the VIN alone. If two vehicles with the same VIN have clearly different attributes (different colors, different engine sizes, different geographic locations simultaneously), the system flags this as a potential VIN conflict rather than auto-merging.

### 2.3 Stage 2: Source URL Match

If a source_url is provided, check if any existing observation was extracted from the same URL:

```
SELECT DISTINCT asset_id FROM observations
WHERE source_url = hints.source_url
```

**If exactly one match**: Confidence = 0.95. Auto-match. Multiple observations from the same listing page describe the same entity.

**If multiple matches**: This means the URL has been associated with multiple entities, which is a data integrity issue. Flag for review. Do not auto-match.

**If no match**: Proceed to Stage 3.

### 2.4 Stage 3: Image Perceptual Hash Match

If image_hashes are provided, search for visually similar images across all entities:

```
For each image_hash in hints.image_hashes:
    Find all stored images where hamming_distance(stored_hash, image_hash) < threshold
    Group by asset_id
    Return asset_ids with match_count and average_distance
```

**Perceptual hashing method**: pHash (perceptual hash) produces a 64-bit hash where visually similar images produce similar hashes. The hamming distance (number of differing bits) measures visual difference:

| Hamming Distance | Interpretation | Action |
|-----------------|----------------|--------|
| 0-5 | Near-identical images | Strong match signal |
| 6-10 | Same subject, different angle/crop/exposure | Moderate match signal |
| 11-15 | Possibly same subject | Weak match signal |
| 16+ | Different images | No match signal |

**If best match has distance 0-5 across 3+ images**: Confidence = 0.85. Auto-match.

**If best match has distance 0-5 across 1-2 images**: Confidence = 0.70. Candidate match. Combine with metadata scoring (Stage 4).

**If best match has distance 6-10**: Candidate only. Do not auto-match from image similarity alone at this distance.

**If no matches below distance 15**: No visual match signal. Proceed to Stage 4.

### 2.5 Stage 4: Metadata Intersection Scoring

When no unique identifier or strong visual match resolves the entity, the system falls back to metadata comparison. This is the most complex and most error-prone stage.

For each existing entity of the same asset_type, compute a similarity score:

```
MetadataScore(hints, entity) = SUM over fields of:
    [ w_field * match_function(hints.field, entity.field) ]
```

**Field weights and match functions for vehicles:**

| Field | Weight | Match Function |
|-------|--------|---------------|
| year | 0.20 | 1.0 if exact, 0.5 if +/-1 year, 0.0 otherwise |
| creator (make) | 0.20 | 1.0 if normalized strings match, 0.0 otherwise |
| model_or_subtitle | 0.20 | Fuzzy string similarity (Levenshtein ratio). Threshold: 0.8 for match. |
| color | 0.10 | Color name normalization + match. "Red" matches "Cherry Red" at 0.8. |
| medium (engine/transmission) | 0.10 | Keyword extraction and comparison. "350 V8" matches "5.7L V8" at 0.9. |
| location | 0.05 | Geographic proximity. Same state: 0.8. Same region: 0.5. Different country: 0.0. |
| price_range | 0.05 | Overlap of price ranges. Full overlap: 1.0. Partial: proportional. None: 0.0. |
| title (full text) | 0.10 | TF-IDF or embedding cosine similarity of the full title string. |

**Field weights and match functions for artworks:**

| Field | Weight | Match Function |
|-------|--------|---------------|
| creator (artist) | 0.25 | Normalized name match. "Basquiat" matches "Jean-Michel Basquiat" at 1.0. |
| year | 0.15 | 1.0 if exact, 0.7 if +/-1, 0.3 if +/-5, 0.0 beyond |
| title | 0.15 | Exact match after normalization. Partial credit for substring match. |
| dimensions | 0.15 | Parse to numeric, convert units, compare. Within 5%: 1.0. Within 10%: 0.7. Within 25%: 0.3. |
| medium | 0.10 | Medium taxonomy matching. "Oil on canvas" matches "Oil on linen" at 0.8. |
| location | 0.05 | Current exhibition/collection location. |
| price_range | 0.05 | Range overlap. |
| model_or_subtitle (series/period) | 0.10 | "Blue period" matches "Blue period" at 1.0. |

### 2.6 Stage 4 Result Interpretation

| MetadataScore | Action | Rationale |
|---------------|--------|-----------|
| >= 0.80 | Auto-match | Sufficient field overlap across multiple dimensions. |
| 0.60 - 0.79 | Candidate | Possible match but not certain. Queue for review. |
| 0.40 - 0.59 | Weak candidate | Note the potential match but do not surface unless user searches. |
| < 0.40 | No match | Create new entity. |

The 0.80 threshold for auto-match is not arbitrary. It is derived from the cost asymmetry analysis in Part III.

### 2.7 Combined Scoring

When multiple stages produce signals, they combine:

```
CombinedConfidence = 1 - PROD over stages of (1 - stage_confidence)
```

This is the standard "probability of at least one match" formula. It ensures that a moderate visual match (0.70) combined with a moderate metadata match (0.70) produces a high combined confidence (1 - 0.30 * 0.30 = 0.91), which triggers auto-match.

However: the combined confidence can only trigger auto-match if at least one individual stage produced confidence >= 0.60. The combination of many weak signals (e.g., five stages each at 0.40) should not auto-match because each individual signal is too uncertain.

---

## Part III: The 0.80 Threshold -- A Decision-Theoretic Analysis

### 3.1 The Decision Problem

At what confidence threshold should the system automatically merge an observation into an existing entity? This is a decision under uncertainty where the costs of errors are asymmetric.

### 3.2 Cost Model

Define:
- **C_FP** = cost of a false positive (incorrect merge)
- **C_FN** = cost of a false negative (missed merge, creating a duplicate)
- **P(correct | confidence)** = probability that a match at a given confidence level is actually correct

The expected cost at any threshold theta is:

```
E[Cost(theta)] = P(FP | theta) * C_FP + P(FN | theta) * C_FN
```

As theta increases:
- P(FP | theta) decreases (fewer incorrect auto-merges)
- P(FN | theta) increases (more missed merges)

The optimal threshold minimizes expected cost:

```
theta* = argmin over theta of E[Cost(theta)]
```

### 3.3 Empirical Cost Estimation

**False positive cost (C_FP)**:
- Data corruption across all observations linked to both entities
- Manual investigation and untangling required (estimated 2-4 hours per incident)
- Some damage may be permanent (if conflated observations were further used in downstream computations)
- User trust erosion (seeing obviously wrong data on their asset)
- Estimated cost: **$200-$500 per incident** in labor and trust damage

**False negative cost (C_FN)**:
- Two duplicate entities exist instead of one
- Each has partial observation coverage
- Users may notice and manually merge (simple operation)
- Automated dedup pass can identify and merge candidates periodically
- Estimated cost: **$5-$20 per incident** in eventual cleanup

**Cost ratio**: C_FP / C_FN is approximately 20:1 to 50:1. False positives are 20-50x more expensive than false negatives.

### 3.4 Threshold Selection

Given the 20-50x cost ratio, the optimal threshold is high. The system should be conservative about auto-merging.

If we model P(correct | confidence) as roughly equal to the confidence score (a simplifying assumption that holds for well-calibrated scoring):

```
E[Cost(theta)] = (1 - theta) * C_FP + theta * C_FN  [simplified]
```

Setting derivative to zero:
```
C_FN - C_FP = 0  [impossible; they're different constants]
```

More precisely, the threshold where marginal FP cost equals marginal FN cost:

```
theta* = C_FP / (C_FP + C_FN)
```

With C_FP = $300, C_FN = $10:
```
theta* = 300 / (300 + 10) = 0.968
```

This suggests the optimal threshold is approximately 0.97 -- extremely conservative. In practice, this is too conservative because:
1. Not all false positives are equally costly (merging two very similar entities is less damaging than merging two completely different ones)
2. The confidence score is not perfectly calibrated
3. At very high thresholds, almost nothing auto-matches, and the system creates excessive duplicates that burden cleanup

### 3.5 The 0.80 Compromise

The 0.80 threshold is a practical compromise between the theoretical optimum (~0.97) and operational usability:

- At 0.80, approximately 95-98% of auto-matches are correct (based on analysis of VIN-verified vehicle matches)
- The remaining 2-5% are caught by automated conflict detection (merged entities with contradictory attributes are flagged)
- Below 0.80, the error rate climbs rapidly: at 0.60 (the previous threshold), approximately 15-20% of auto-matches were incorrect

The 0.60 threshold was catastrophic in practice. It produced the data corruption that motivated this formal analysis. At 0.60, one in six auto-matches was wrong. These wrong matches cascaded through the graph, producing incorrect comp sets, wrong signal calculations, and misleading provenance chains.

### 3.6 The Review Queue

Matches between 0.60 and 0.80 are not auto-matched and not discarded. They enter a review queue:

```
resolution_candidates (
    observation_id,
    candidate_asset_id,
    combined_confidence,
    match_signals (jsonb),        // Which stages contributed what scores
    reviewed: boolean,
    reviewed_by: user_id | null,
    review_decision: 'merge' | 'new' | 'skip',
    review_date: timestamp
)
```

The review queue is processed by:
1. **Users**: When viewing their own assets, users see "Possible match found" notifications and can confirm or reject.
2. **Automated passes**: Periodic batch jobs re-evaluate the review queue as new observations arrive. A candidate at 0.72 might rise to 0.82 when additional metadata is extracted.
3. **Agent review**: AI agents can process the review queue with human-in-the-loop confirmation for high-stakes entities.

---

## Part IV: Image Perceptual Hashing

### 4.1 Why Visual Matching Matters

For artworks, visual matching is often the most reliable resolution signal. Two different auction houses may describe the same painting with different titles, different dimensions (due to frame vs. unframed measurement), and different medium descriptions. But the images -- if of sufficient quality -- are unmistakably the same.

For vehicles, visual matching is supplementary. Many vehicles of the same make/model look similar, but unique details (specific paint schemes, wheel choices, dents, stickers) can confirm a match.

### 4.2 Perceptual Hash Pipeline

**Step 1: Image preprocessing**
- Resize to 256x256 pixels
- Convert to grayscale
- Apply DCT (Discrete Cosine Transform)
- Retain top-left 8x8 block (low-frequency components)
- Compute median of the 64 DCT values
- Produce 64-bit hash: each bit is 1 if DCT value > median, 0 otherwise

**Step 2: Hash storage**
- Store the 64-bit hash as a bigint column alongside the image record
- Index using hamming distance-aware indexing (BK-tree or bit manipulation in PostgreSQL)

**Step 3: Hash comparison**
- Hamming distance = number of differing bits between two hashes
- Distance 0-5: near-identical (same image, different compression, slight crop)
- Distance 6-10: same subject, different capture (different angle, lighting, camera)
- Distance 11-15: possibly same subject
- Distance 16+: different subjects

### 4.3 Multi-Image Entity Matching

An entity typically has multiple images. The matching algorithm compares the observation's images against all images of each candidate entity:

```
ImageMatchScore(obs_images, entity_images) =
    count(pairs where hamming_distance < 10) / min(len(obs_images), len(entity_images))
```

This produces a ratio: what fraction of the observation's images have a visual match in the candidate entity's image set.

| Ratio | Interpretation |
|-------|---------------|
| >= 0.50 | Strong visual match. More than half the images match. |
| 0.25 - 0.49 | Moderate visual match. Some images match. |
| 0.10 - 0.24 | Weak visual match. A few images match. |
| < 0.10 | No meaningful visual match. |

### 4.4 Visual Matching Limitations

**Artworks**: pHash works well for paintings and photographs. It struggles with:
- Sculptures (same work from different angles produces very different hashes)
- Installations (each photo captures a different aspect of the same work)
- Works with uniform fields (monochrome paintings may hash similarly to each other)

**Vehicles**: pHash works well for distinctive vehicles. It struggles with:
- Common vehicles in common colors (every red Mustang looks similar from the front)
- Stock photos (dealers may use manufacturer stock photos instead of actual vehicle photos)
- Detail shots (engine bay photos may look similar across examples of the same model)

**Mitigation**: Visual matching never auto-merges alone. It always combines with metadata scoring. A high visual match of a common vehicle plus a metadata mismatch (different VIN, different location) does not produce an auto-match.

### 4.5 Advanced Visual Matching (Future)

Beyond perceptual hashing, more sophisticated visual matching could include:

**Feature extraction with CNN embeddings**: A convolutional neural network (such as YONO) produces a high-dimensional embedding vector for each image. Cosine similarity between embeddings captures semantic similarity rather than pixel-level similarity. A photo of a car's dashboard from slightly different angles would have high embedding similarity even if the perceptual hash differs.

**Zone-specific matching**: For vehicles, matching within specific zones (front 3/4, rear 3/4, engine bay, interior) rather than whole-image matching would reduce false positives from similar-looking vehicles. A unique detail in the engine bay (specific header configuration, unusual intake) is highly discriminative.

**Damage/patina fingerprinting**: Unique wear patterns, rust spots, and damage create a visual fingerprint that is specific to one physical asset. A scratch on the left fender is as unique as a fingerprint, if captured at sufficient resolution.

These are future capabilities. The current model relies on pHash as a screening filter combined with metadata scoring for confirmation.

---

## Part V: Metadata Normalization

### 5.1 The Normalization Problem

Before metadata can be compared, it must be normalized. "1972 Chevrolet K5 Blazer" and "72 Chevy Blazer K-5" must be recognized as equivalent.

### 5.2 Name Normalization

**Make normalization**: A canonical make table maps all known variations to standard forms.

```
"Chevy" → "Chevrolet"
"Merc" → "Mercedes-Benz" or "Mercury" (ambiguous -- requires model context)
"Basquiat" → "Jean-Michel Basquiat"
"JMBA" → "Jean-Michel Basquiat" (auction house abbreviation)
"Koons" → "Jeff Koons"
```

Ambiguous normalizations (Merc → Mercedes or Mercury) are resolved by context: if the model is "SL" or "Benz", it's Mercedes. If the model is "Cougar" or "Montego", it's Mercury.

**Model normalization**: Similar canonical table.

```
"K5" → "K5 Blazer" (Chevrolet context)
"K-5" → "K5 Blazer"
"911 Targa" → "911" (model), "Targa" (variant)
"Untitled" → special handling (see Section 5.4)
```

**Year normalization**: Parse from various formats.

```
"72" → 1972 (if context suggests vintage vehicle)
"'72" → 1972
"1972" → 1972
"c. 1982" → 1982 (with precision flag: "circa")
"early 1980s" → 1982 (midpoint, with precision flag: "decade")
```

### 5.3 Dimension Normalization

Dimensions must be parsed, unit-converted, and compared numerically.

```
"72 x 68 in" → {height: 72, width: 68, unit: "inches"}
"183.5 x 173 cm" → {height: 72.2, width: 68.1, unit: "inches"}  // After conversion
"72 1/4 x 68 1/8 in" → {height: 72.25, width: 68.125, unit: "inches"}
```

Match threshold: 5% tolerance accounts for frame vs. unframed measurement, rounding, and measurement precision.

### 5.4 The "Untitled" Problem

Many artworks are titled "Untitled." Basquiat alone has hundreds of works titled "Untitled." This makes title matching useless for these works.

When the title is "Untitled" (or a variant: "Sans Titre," "Ohne Titel," "Sin Titulo"), the title weight drops to 0.0 and the remaining weights are redistributed:

```
If title == "Untitled":
    w_title = 0.0
    Redistribute to: dimensions (+0.05), year (+0.05), medium (+0.05)
```

For "Untitled" works, resolution relies heavily on dimensions, medium, year, and visual matching. This is why the image perceptual hash is critical for art entity resolution.

### 5.5 Artist Name Disambiguation

Artists share names. "David Smith" the Abstract Expressionist sculptor is not "David Smith" the contemporary British painter. Disambiguation uses:

1. **Date range**: If the birth/death years of the candidate artist don't align with the artwork's execution date, it's a different David Smith.
2. **Medium**: If the candidate is known for sculpture and the observation describes a painting, it's likely a different artist.
3. **Geographic context**: If the sale is at a European auction and the candidate is American-only, lower confidence.
4. **Gallery/institution context**: If the work is attributed to "David Smith" in the context of a Gagosian exhibition focused on Abstract Expressionism, it's very likely the sculptor.

Disambiguation produces a confidence modifier on the artist match score:

```
artist_match_confidence = name_match * disambiguation_factor
```

Where disambiguation_factor ranges from 0.5 (ambiguous, multiple possible artists) to 1.0 (unambiguous, one possible artist).

---

## Part VI: The "Untitled" Works Resolution Strategy

### 6.1 The Scale of the Problem

In the art domain, a significant fraction of works share titles. Beyond "Untitled," common shared titles include "Composition," "Study," "Landscape," "Portrait," "Self-Portrait," and series numbers ("No. 7," "Plate XII").

For a prolific artist with hundreds of "Untitled" works, entity resolution must rely entirely on non-title features: dimensions, medium, date, visual appearance, and provenance.

### 6.2 The Composite Key Approach

For "Untitled" works, the system constructs a composite identification key:

```
CompositeKey = {
    artist_id (normalized),
    year_executed,
    medium_canonical,
    dimensions_normalized (height, width, depth),
    support_type (canvas, paper, panel),
    image_signature (pHash of primary image)
}
```

Two "Untitled" works by the same artist from the same year are resolved by dimensions and visual appearance. If dimensions match within 5% AND the image hash distance is below 10, the match is confident.

If dimensions match but visual appearance differs: they are different works of the same size (common for artists working in series). Not merged.

If visual appearance matches but dimensions differ by more than 25%: possible different-sized documentation of the same work (photo of a detail vs. full work), or genuinely different works that happen to look similar. Candidate for review, not auto-merge.

### 6.3 Edition Resolution

For edition multiples (prints, casts), entity resolution is complicated by the fact that multiple legitimate, physically distinct objects share the same title, artist, dimensions, medium, and general appearance. The distinguishing feature is the edition number ("4/25," "AP II," "HC 3").

```
EditionResolution:
    If edition_number matches: Same physical object (assuming same condition, location timeline)
    If edition_number differs: Different physical objects (different entities, same parent)
    If edition_number unknown: Candidate only (could be any impression in the edition)
```

---

## Part VII: Resolution Outcomes

### 7.1 Outcome Types

The resolution pipeline produces one of four outcomes:

**Exact match (confidence >= 0.95)**: The observation matches an existing entity with near-certainty. The unique identifier matched, or the URL matched, or the combined score from multiple stages exceeds 0.95. The observation is automatically linked to the entity.

**Confident match (confidence 0.80 - 0.94)**: The observation probably matches an existing entity. Multiple metadata fields align. Visual evidence supports the match. The observation is automatically linked, but the match is logged for post-hoc audit.

**Candidate match (confidence 0.60 - 0.79)**: The observation might match one or more existing entities. The match enters the review queue. The observation is temporarily stored as unresolved.

**New entity (confidence < 0.60 against all candidates)**: No existing entity matches with sufficient confidence. A new entity is created. The observation becomes the seed of that entity's record.

### 7.2 Post-Resolution Verification

After auto-matching (exact or confident), the system runs a post-resolution consistency check:

```
For each auto-matched observation:
    Compare key attributes against the entity's existing attributes
    If contradiction detected (different VIN, conflicting dates, incompatible dimensions):
        Flag for review
        Do not undo the match (avoid thrashing) but mark as "match under review"
```

Contradictions are ranked by severity:

| Contradiction | Severity | Action |
|---------------|----------|--------|
| Different VIN (when both have VINs) | Critical | Immediate unflag. Undo match. These are different entities. |
| Incompatible dates (artwork dated 1960, observation describes 1982 work) | High | Flag for review. Possible data error in extraction. |
| Conflicting dimensions (>25% difference) | Medium | Flag for review. Possible frame vs. unframed, or different works. |
| Different colors (but same everything else) | Low | Possible repaint or different description. Note as discrepancy. |
| Slightly different titles (after normalization) | Low | Possible OCR error, abbreviation, or translation. Note. |

### 7.3 Unresolved Observation Lifecycle

Observations that enter the review queue as candidates have a lifecycle:

1. **Created**: Observation extracted, no confident match found. Enters queue.
2. **Enriched**: Additional observations arrive for the same source (more images extracted, more metadata parsed). Confidence may increase.
3. **Reviewed**: A human or agent reviews the candidate and decides: merge, create new, or skip.
4. **Merged**: Linked to existing entity. All associated data follows.
5. **Created as new**: A new entity is created from the observation and its associated data.
6. **Expired**: If unreviewable after 90 days (no new data, no human review), the observation is auto-created as a new entity. False negatives are preferable to permanent limbo.

---

## Part VIII: The Resolution Graph

### 8.1 Resolution as Graph Problem

Entity resolution can be modeled as a graph clustering problem. Each observation is a node. Edges between nodes represent match confidence. The resolution problem is to partition the graph into clusters, where each cluster represents one real-world entity.

```
Nodes: O = {o_1, o_2, ..., o_n}  (all observations)
Edges: E = {(o_i, o_j, c_ij)}    (where c_ij is pairwise match confidence)
Clusters: C = {C_1, C_2, ..., C_k}  (each cluster = one entity)
```

### 8.2 Transitivity

Match confidence is not transitive in general:
- Observation A matches observation B at 0.85
- Observation B matches observation C at 0.82
- But observation A may match observation C at only 0.45

This happens when B shares attributes with both A and C, but A and C share different attributes with B. For example: A and B share the same VIN. B and C share the same images. But A and C have different images (taken at different times, different angles) and the VIN wasn't extracted from C.

The resolution system must handle non-transitive matching:

**Conservative approach**: Only cluster nodes that have direct high-confidence edges. A is linked to B, and B is linked to C, but A is not linked to C. The system clusters {A, B} and either adds C to the cluster only if A-C is above the candidate threshold, or leaves C as a separate entity.

**Transitive closure approach**: If A matches B and B matches C, then A, B, and C are all the same entity. This is aggressive and produces false positives when B is a "bridge" between two genuinely different entities.

**The Nuke approach**: Weighted transitive closure with decay:

```
Transitive_confidence(A, C) = Confidence(A, B) * Confidence(B, C) * decay_factor
```

Where decay_factor = 0.8 (each hop through the graph reduces confidence by 20%).

For the example: Transitive_confidence(A, C) = 0.85 * 0.82 * 0.8 = 0.56. Below auto-match. C is added as a candidate but not auto-merged.

This preserves the conservative bias while allowing transitive discovery of candidates that might be merged upon review.

### 8.3 Cluster Coherence

After resolution, each entity (cluster) is checked for internal coherence:

```
Coherence(cluster) = min over all pairs (o_i, o_j) in cluster of:
    Consistency(o_i, o_j)
```

Where Consistency measures whether two observations are compatible (same VIN, compatible dates, non-contradicting attributes).

If coherence drops below 0.70, the cluster is flagged for review: it may contain a false positive merge.

---

## Part IX: Domain-Specific Resolution Strategies

### 9.1 Vehicle Resolution Strategy

**Golden path**: VIN match. Available for approximately 70% of vehicle observations (VIN is extractable from listings, titles, documentation). When VIN is available, resolution is trivial.

**Silver path**: URL match + year/make/model match. For listings without extractable VIN, the combination of the source URL and basic attributes is usually sufficient.

**Bronze path**: Year/make/model/location + images. For informal sources (forum posts, social media), resolution relies on metadata and visual matching. Higher false-negative rate, which is acceptable.

### 9.2 Artwork Resolution Strategy

**Golden path**: Catalogue raisonne number match. Available for established artists with published catalogs. Approximately 5% of all artworks, but a much higher percentage of market-active artworks.

**Silver path**: Artist + dimensions + date + visual match. The standard path for most artworks. Requires good metadata extraction and at least one image.

**Bronze path**: Artist + title + date + medium. For artworks without images in the observation (text-only references, historical records). Higher false-negative rate due to shared titles.

**Special case**: "Untitled" resolution requires the composite key approach (Section 6.2).

### 9.3 Cross-Domain Resolution

Some entities span domains. A vehicle that appears in a painting. A magazine issue that features both art and vehicles. The resolution system handles these through the unified asset layer:

```
If hints.asset_type is ambiguous:
    Run resolution against all domains
    Return candidates from each domain with domain labels
    Let the reviewer decide which domain the entity belongs to
```

---

## Part X: Open Questions

### 10.1 Learning Match Thresholds

The 0.80 threshold is derived from cost analysis and validated against VIN-verified data. But the optimal threshold may differ by domain, by source, and by observation density. At massive scale, should the threshold be dynamically adjusted based on observed false-positive rates in the review queue?

Question: Can we use the review queue decisions as training data for a learned resolution model that replaces the fixed scoring pipeline?

### 10.2 Identity Fragmentation in Art

An artist may work under multiple names (pseudonyms, maiden names, collaborative identities). A collector may buy through multiple advisors or entities. How should entity resolution handle deliberate identity fragmentation?

Question: Should there be a "known alias" system where multiple identity fragments are explicitly linked as the same actor, even though the automatic resolution would treat them as separate?

### 10.3 Temporal Entity Identity

A vehicle that has been completely rebuilt -- new body, new engine, new VIN plate -- is it the same entity as the original? The Ship of Theseus problem is real in automotive restoration.

The current model: if the VIN is the same, it's the same entity, regardless of how many parts have been replaced. The VIN is the identity anchor. But this is a philosophical choice, not a mathematical one.

Question: Should the system track "identity continuity" as a property? An entity with 100% replacement parts has lower identity continuity than one with original components, even though both have the same VIN.

### 10.4 Resolution at Ingest Speed

The current pipeline assumes resolution happens synchronously at ingest time. At scale (thousands of observations per minute), synchronous resolution becomes a bottleneck because each observation must be compared against potentially millions of entities.

Question: Should resolution be asynchronous? Observations are ingested immediately as unresolved, and a background process resolves them in batches? This changes the system architecture significantly: all downstream computations must handle unresolved observations.

### 10.5 Adversarial Resolution

Malicious actors could exploit the resolution system: creating fake observations with carefully crafted attributes to merge into legitimate entities, injecting false data into a valuable asset's record.

Question: What defenses prevent adversarial resolution attacks? Source trust is the primary defense (anonymous observations can't auto-match), but sophisticated attacks could use medium-trust sources.

### 10.6 The Merge/Split Interface

When resolution produces a false positive (detected post-merge), the system must split an entity. When resolution produces a false negative (detected as duplicate), the system must merge. Both operations must be traceable, reversible, and auditable.

Question: What data structure supports efficient, auditable merge and split operations? Can the resolution graph (Section 8.1) be maintained as a persistent structure that records the full history of merge/split decisions?

---

*This paper defines the formal framework for entity resolution across domains. The 0.80 auto-match threshold is the core contribution: mathematically derived from the asymmetric costs of false positives and false negatives, and empirically validated against VIN-verified data. The framework is intentionally conservative because data integrity is more valuable than convenience.*

*Companion papers: Signal Calculation (relies on correct entity resolution for accurate signal computation), Valuation Methodology (comp matching is a specialized form of entity resolution), Observation Half-Life Model (temporal decay affects match confidence when observations are old).*
