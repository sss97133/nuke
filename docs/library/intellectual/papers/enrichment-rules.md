# PAPER: Enrichment Rules — The Ground Truth for Making Data Better

**Author:** System Architecture
**Date:** 2026-03-21
**Status:** ENFORCED — All agents must read before enrichment work
**References:** Engineering Manual Ch.2, TOOLS.md (enrich-* functions), BUILD_PROMPT.md

---

## What Enrichment IS

Enrichment is the process of filling empty fields on a vehicle record using data that **already exists in the system** — descriptions, comments, archived listing pages, images, VIN decode data. It is NOT creating new information. It is extracting structured data from unstructured sources we already have.

**The principle:** If a description says "factory A/C, power steering, 4-speed manual" and the `equipment` field is NULL, enrichment copies those facts into the structured field with a citation back to the description. The information doesn't change. The accessibility does.

---

## What Enrichment IS NOT

1. **Enrichment is NOT guessing.** If the description doesn't mention transmission type, do not infer it from the year/make/model. Write NULL. NULL is better than wrong.

2. **Enrichment is NOT researching.** Do not look up factory specs on external websites and write them as if they came from the listing. That's a different operation (factory spec enrichment via `enrich-factory-specs`), and those fields require `_source` tracking.

3. **Enrichment is NOT improving.** Do not rewrite descriptions to be "better." Do not correct seller grammar. Do not upgrade "nice condition" to "excellent condition." The seller's words are testimony — preserve them exactly.

4. **Enrichment is NOT merging.** Do not combine data from multiple vehicles. If you're looking at vehicle A's description to fill vehicle A's fields, that's enrichment. If you're using vehicle B's data to fill vehicle A's fields, that's something else entirely and requires explicit justification.

---

## The Rules

### Rule 1: Extract Only What Is Explicitly Stated

If the description says "350 V8" → write `engine_type: "V8"` and `engine_size: "350"`.
If the description says "V8" with no displacement → write `engine_type: "V8"` and leave `engine_size: NULL`.
If the description doesn't mention the engine → leave both NULL.

**Never infer.** A 1979 K10 probably has a 350, but "probably" is not data. Only write what the source explicitly states.

### Rule 2: Source Material Hierarchy

When enriching, use source material in this order:

1. **VIN decode** (trust 0.95) — Factory specs from NHTSA. Use `decode-vin-and-update` function.
2. **Archived listing page** (trust 0.75-0.90) — The original HTML/markdown in `listing_page_snapshots`. This is the richest source.
3. **Vehicle description field** (trust 0.70) — Already extracted text in `vehicles.description`.
4. **Auction comments** (trust 0.50-0.70) — Expert community observations in `auction_comments`. Use with caution — comments contain opinions, not just facts.
5. **AI extraction from images** (trust 0.40-0.60) — What the vision model sees. Always mark as AI-derived.

**Never enrich from:**
- External websites not already archived
- Other vehicles' data
- General knowledge / common sense
- LLM training data (the model "knowing" that K10s usually had 350s)

### Rule 3: Never Overwrite Non-NULL Values

If a field already has a value, do not replace it — even if you think you have a better one. Overwriting destroys provenance. Instead:

- If the existing value is wrong → create an observation (kind='correction') with the proposed value and flag for review
- If the existing value is incomplete → append, don't replace (e.g., equipment "A/C" → "A/C, power steering, power brakes")
- If you're unsure → leave it alone

The only exception: fields owned by a specific function in `pipeline_registry` can be rewritten by that function. Check ownership first.

### Rule 4: Track What You Did

Every enrichment action must record:
- `last_enrichment_attempt` timestamp on the vehicle
- `agent_tier` in the observation (which model did this)
- `extraction_method: "enrichment"` in the observation
- `raw_source_ref` pointing to the source material (description, snapshot ID, comment ID)

This is how we audit enrichment quality. If a field was filled incorrectly, we need to trace it back to which model, which source, and which run.

### Rule 5: Use the Right Tool

| Intent | Tool | Why |
|--------|------|-----|
| Fill equipment/highlights/flaws from description | `scripts/overnight-enrichment.mjs` or `enrich-vehicle-profile-ai` | Designed for this. Uses proper prompts, handles arrays, logs costs. |
| Decode VIN → factory specs | `decode-vin-and-update` | Calls NHTSA API. Do NOT manually write VIN-derived fields. |
| Fill MSRP | `enrich-msrp` | Owned field. Only this function writes MSRP. |
| Re-extract from archived HTML | `haiku-extraction-worker` or `batch-extract-snapshots` | Reads from `listing_page_snapshots`, not live web. |
| Compute scores (quality, completion, valuation) | `calculate-profile-completeness`, `calculate-vehicle-scores`, `compute-vehicle-valuation` | These are COMPUTED fields. Do NOT manually set completion_percentage, quality_grade, nuke_estimate, etc. |

**What agents must NOT do:**
- Write SQL UPDATE statements directly against `vehicles` for enrichable fields without going through the proper function
- Use a generic LLM prompt to "clean up" data without the structured extraction format
- Batch-update fields across thousands of vehicles without testing on 5-10 first
- Run enrichment on fields owned by other functions (check `pipeline_registry`)

### Rule 6: Test Before Blast

Before running enrichment on more than 50 vehicles:

1. Run with `--dry-run` flag on 10 vehicles
2. Manually inspect the output — are the extracted fields accurate?
3. Check for hallucination — did the model invent information not in the source?
4. Check for pollution — did HTML tags, auction boilerplate, or platform noise leak in?
5. Run on 50 vehicles and spot-check 5 random results
6. Only then run the full batch

### Rule 7: The Enrichment Priority Order

When deciding what to enrich, prioritize by impact:

1. **VIN decode** — Unlocks factory specs for 71K vehicles missing VIN data. Highest-confidence enrichment.
2. **Equipment extraction** — 229K vehicles have descriptions mentioning equipment but NULL `equipment` field. High impact on completion_percentage.
3. **Highlights extraction** — 228K missing. What makes each vehicle special. Critical for user-facing profiles.
4. **Known flaws** — 243K missing. What's wrong with each vehicle. Critical for trust and transparency.
5. **Modifications** — 229K missing. What's been changed from factory. Important for value assessment.
6. **Condition rating** — 247K missing. Requires multiple sources to assess properly — do not set from description alone.

---

## Fields and Their Rules

### Free to Enrich (No pipeline_registry owner)

These fields can be written by enrichment scripts. Always use `last_enrichment_attempt` timestamp.

| Field | What Goes Here | Source | Don't |
|-------|---------------|--------|-------|
| `equipment` | Factory + aftermarket equipment, comma-separated | Description, listing page | Don't guess from year/make/model |
| `highlights` | What makes this vehicle notable | Description, comments | Don't editorialize — use seller's words |
| `known_flaws` | Defects, issues, concerns mentioned | Description, comments | Don't invent problems not mentioned |
| `modifications` | Changes from factory spec | Description, listing page | Don't assume stock is "no modifications" — leave NULL |
| `trim` | Trim level (Scottsdale, Silverado, Custom Deluxe) | Description, VIN decode | Don't guess from photos |
| `color` | Exterior color as described | Description, listing page | Don't color-correct (if seller says "red," write "red" even if photo looks orange) |
| `interior_color` | Interior color as described | Description | Same as above |
| `transmission` | Transmission type as described | Description, VIN decode | Don't infer from drivetrain |
| `engine_type` | Engine type as described | Description, VIN decode | Don't infer from model |
| `drivetrain` | 4WD, 2WD, AWD, etc. | Description, VIN decode, model name (K=4WD, C=2WD for GM trucks) | Model-name inference is OK for K/C series only |
| `body_style` | Body configuration | Description, listing page | Use canonical values from schema |
| `mileage` | Odometer reading as stated | Description, listing page | Write TMU if "true mileage unknown" is stated |
| `condition_rating` | 1-10 condition assessment | **Only from explicit statements** | Do NOT set from AI assessment alone — requires human or multi-source verification |

### Owned Fields (DO NOT WRITE DIRECTLY)

| Field | Owner | How to Update |
|-------|-------|---------------|
| `completion_percentage` | `calculate-profile-completeness` | Call the function — it recalculates from current data |
| `quality_grade` | `calculate-vehicle-scores` | Call the function |
| `nuke_estimate` | `compute-vehicle-valuation` | Call the function |
| `deal_score`, `heat_score`, `signal_score` | `analyze-market-signals` | Call the function |
| `perf_*_score` | `calculate-vehicle-scores` | Call the function |
| `msrp` | `enrich-msrp` | Call the function |
| `make`, `model`, `year` (via VIN) | `decode-vin-and-update` | Call the function |
| `description` (AI-generated) | `generate-vehicle-description` | Call the function, set `description_source` |

### Trigger Fields (Auto-Computed)

| Field | Trigger | Notes |
|-------|---------|-------|
| `canonical_outcome` | `trg_resolve_canonical_columns` | Never write directly |
| `canonical_platform` | `trg_resolve_canonical_columns` | Never write directly |
| `canonical_sold_price` | `trg_resolve_canonical_columns` | Never write directly |
| `image_count` | Trigger on `vehicle_images` | Updated automatically |
| `observation_count` | Trigger on `vehicle_observations` | Updated automatically |

---

## The Enrichment Flow

```
1. SELECT vehicles WHERE equipment IS NULL AND description IS NOT NULL
2. For each vehicle:
   a. Read description (and optionally archived listing page)
   b. Send to LLM with structured extraction prompt
   c. Parse response as JSON
   d. Validate: are extracted values actually in the source text?
   e. Write ONLY NULL fields (never overwrite)
   f. Set last_enrichment_attempt = now()
   g. Log to llm_cost_tracking
3. After batch: run calculate-profile-completeness to update scores
```

---

## What Happens When Enrichment Goes Wrong

### Scenario: Agent writes "350 V8" to engine_type for a vehicle that actually has a 305

**How it happened:** The LLM inferred from the model (K10) that it probably has a 350. The description just said "V8" without displacement.

**How to prevent:** Rule 1 — extract only what is explicitly stated. The prompt must say: "Extract ONLY what is explicitly mentioned in the text."

**How to detect:** Compare `engine_type` against VIN decode data when VIN is later decoded. If they conflict, flag the enrichment-written value.

**How to fix:** The VIN decode function overwrites with factory data (higher trust). The enrichment value gets a correction observation.

### Scenario: Agent writes HTML tags into equipment field

**How it happened:** The LLM extracted from raw HTML instead of cleaned text. `<li>Power steering</li>` became the field value.

**How to prevent:** Strip HTML before sending to LLM. The enrichment script should use `description` (already clean text) not raw HTML from snapshots.

**How to detect:** Pollution check: `SELECT count(*) FROM vehicles WHERE equipment LIKE '%<%' OR equipment LIKE '%&amp;%'`

### Scenario: Agent overwrites seller-provided description with AI-generated one

**How it happened:** An agent ran `generate-vehicle-description` without checking `description_source`. The original seller description (testimony) was replaced with AI boilerplate.

**How to prevent:** Rule 3 — never overwrite non-NULL values. Check `description_source` before writing. If it's `listing` (from seller), do not overwrite.

---

## For the Next Agent

Before you touch any vehicle data:

1. Read this paper completely
2. Check `pipeline_registry` for the fields you want to write: `SELECT * FROM pipeline_registry WHERE table_name='vehicles' AND column_name='<field>';`
3. If the field has an owner and `do_not_write_directly=true`, call the owning function instead
4. If the field has no owner, follow the rules above
5. Test on 5 vehicles before running on 50. Test on 50 before running on 500.
6. Log everything: `agent_tier`, `extraction_method`, `last_enrichment_attempt`
7. After your enrichment run, call `calculate-profile-completeness` to update scores

**The goal of enrichment is not to fill every field. The goal is to fill fields correctly, with provenance, from verified sources. An empty field is better than a wrong field. NULL is data too — it means "we don't know yet."**
