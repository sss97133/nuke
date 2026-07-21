# Adjudication — DDL proposals (OWNER SIGN-OFF REQUIRED, NOTHING APPLIED)

**Filed 2026-07-20 by the `adjudicate` build. Nothing in this file has been run.**

Ontology proposals (properties, sources, kinds) go in the `schema_proposals`
table, and five were filed there — see `v_open_proposals`. **DDL does not fit
that table**: `schema_proposals_proposal_type_check` only permits
`add_property | fork_property | deprecate_property | modify_property |
add_source | modify_trust_tier | add_observation_kind | add_source_category |
add_image_attribute`. There is no `add_index` or `modify_constraint` type, so
forcing DDL through it would mean mis-typing the row. These four live here
instead, and that gap is itself finding #5.

Each is owner-gated per AGENTS.md invariant 4 and Guide 20 §7.

---

## 1. Index on the polymorphic subject — HIGH, and it is the blocker

Guide 20 §7 step 1 deferred this: *"No index yet (deferred to a concurrent
follow-up once non-vehicle rows exist)."* Non-vehicle rows now exist. The
follow-up is due.

**Measured 2026-07-20** (production-engineering law 2 — time it, don't theorize):

| query | result | time |
|---|---|---|
| `.eq('subject_id', <one org uuid>)` | 1 row | **53,511 ms** |
| `.eq('subject_type','organization')` | 5 rows | **39,469 ms** |
| same predicate via MCP SQL path | — | statement timeout |

A seq scan over **10,249,718** rows to return one. `pg_indexes` confirms 22
indexes on `vehicle_observations`, **none** on the subject columns. Note the
row count: Guide 20 says ~7.5M, so any cost estimate in that doc is stale by
~2.7M rows.

```sql
-- CONCURRENTLY: no write lock on a 10.2M-row testimony table.
-- Partial: legacy vehicle rows resolve via vehicle_id and are already indexed,
-- so indexing them again would be ~10.2M dead entries for zero benefit.
CREATE INDEX CONCURRENTLY idx_vobs_subject
  ON vehicle_observations (subject_type, subject_id)
  WHERE subject_id IS NOT NULL;
```

Cost: one index build over a small qualifying set (currently 1 row; grows with
adoption). Reversible with `DROP INDEX CONCURRENTLY`. Touches no testimony.

---

## 2. `subject_type` CHECK — extend to the types that exist — HIGH

Measured constraint:

```
CHECK (subject_type = ANY (ARRAY['vehicle','organization','user','asset'])) NOT VALID
```

`NOT VALID` still enforces on INSERT. So of the seven subject types this
platform actually has, **exactly one non-vehicle type is writable**. Measured
rejection:

```
new row for relation "vehicle_observations" violates check constraint
"vehicle_observations_subject_type_chk"        -- subject_type = 'property'
```

`property` (1,278 rows), `product` (23,731), `publication_page` (47,792) are
real, populated subject types whose facts currently cannot be observed at all.

```sql
ALTER TABLE vehicle_observations
  DROP CONSTRAINT vehicle_observations_subject_type_chk;
ALTER TABLE vehicle_observations
  ADD CONSTRAINT vehicle_observations_subject_type_chk
  CHECK (subject_type = ANY (ARRAY[
    'vehicle','organization','user','asset',
    'property','product','publication_page'   -- added
  ])) NOT VALID;   -- NOT VALID again: instant, no 10.2M-row rewrite
```

**Deliberately NOT proposed here:**
- **`person`** — `mag_people`'s PK is `name_canon` **TEXT**; `subject_id` is
  `uuid`. Person is structurally unaddressable, not merely un-permitted. It
  needs either a uuid column on `mag_people` or a decided route to
  `profiles`/`actors`. Guide 20 §7 step 4b already got blocked on exactly this
  actor↔user mapping — *do not guess the join.*
- **`brand`** — two unjoined registries (`brands` 46 with `brand_aliases`,
  `organization_brands` 136 keyed on `brand_name` TEXT). Which one is the
  entity is an owner decision that must precede any subject type.

---

## 3. `v_org_authentication.ax_mark` is dishonest — MEDIUM

Live definition: `ax_mark := (o.logo_url IS NOT NULL)`.

That scores a mark as authentic when the stored image is a blank knockout that
composites to nothing, or a 16x16 favicon standing in for a logo.
`scripts/concierge/repair-blank-marks.mjs` already **measured** both classes and
wrote `metadata.mark_quarantine` / `metadata.mark_quality`. The live view reads
neither.

**Measured 2026-07-20:** 1,011 orgs have a `logo_url`; 355 carry a
`mark_quarantine`; **8 carry `mark_quality = low_resolution_favicon` AND a
non-null `logo_url`** — i.e. 8 orgs currently score an authenticated brand mark
off a favicon. ARTISTS OF SAINT BARTH scores 4/6 `established` on a 32x23
favicon.

```sql
-- Replace ONLY the ax_mark expression in the existing view definition.
-- Everything else (axes, thresholds, bands, dispatch_gaps) stays byte-identical:
-- the L'Officiel app and the producer board read this view.
o.logo_url IS NOT NULL
  AND COALESCE((o.metadata -> 'mark_quarantine' ->> 'nulled')::boolean, false) = false
  AND COALESCE(o.metadata -> 'mark_quality' ->> 'reason', '') <> 'low_resolution_favicon'
  AS ax_mark
```

**Blast radius, measured**: over the 40 highest-scoring orgs, the generalised
scorer agrees with the live view on **39/40 across all six axes**; the single
difference is this fix on ARTISTS OF SAINT BARTH (4→3, band unchanged). Across
the whole table it can only ever move the 8 low-res orgs (the 355 quarantined
already have `logo_url IS NULL`, so they are already scoring false). No org
gains a point; up to 8 lose one.

---

## 4. `observation_kind` has no value for an org/property field claim — MEDIUM

`observation_kind` is a Postgres ENUM. The one real org observation on the
platform was written as `kind='specification'`, which is defensible for "this
org's website is X" but strains for org facts generally (opening hours, price
list, ownership). This is flagged, not solved: adding an enum value is a schema
change, and `add_observation_kind` **is** a valid `schema_proposals` type, so
when someone can state the needed kind precisely it should be filed there with
evidence rather than guessed at here.

---

## 5. `schema_proposals` cannot express DDL — LOW, but it is why this file exists

The governance table covers ontology only. Proposals 1–3 above are DDL and have
no valid `proposal_type`. Either add `add_index` / `modify_constraint` /
`modify_view` to `schema_proposals_proposal_type_check` (itself DDL, chicken
and egg), or accept that DDL proposals live in `docs/` and are reviewed by
reading. Owner's call. Flagging rather than minting a new mechanism
(`feedback_dont_mint_new_structures_use_the_repo`).

---

## Code bugs found while building this — NOT schema, reported separately

These are in the observation write path and need no owner gate to fix:

1. **[HIGH] Content hash ignores the polymorphic subject.**
   `ingest-observation/index.ts` L139–149 hashes
   `{source, kind, vehicle_id, source_url, source_identifier, observed_at, text, data, observer}`.
   `subject_type`/`subject_id` are absent, so two observations about *different
   subjects* with otherwise identical payloads collide and the second is
   silently swallowed as a duplicate — the caller gets the first subject's
   observation_id back. This is the same bug fixed for `vehicle_id` on
   2026-05-24 and never extended to the subject.

2. **[HIGH] `_shared/observationWriter.ts` L326 hashes only
   `{source.platform, kind, identifier, text, fields}`** — no `vehicle_id`, no
   `source_url`, no subject. It never received the 2026-05-24 fix. Two write
   paths, two different hash formulas.

3. **[HIGH] `ingest-observation-batch` is vehicle-only** — passes `vehicle_id`
   alone; no `subject` support. The only subject-capable endpoint is the
   one-row-per-HTTP-call one.

4. **[MEDIUM] Competing decay models.** `observation_half_life_days()` says
   `specification` = 1825d; the `observation_half_lives` TABLE says 999999
   (permanent); `observation_sources.decay_half_life_days` says 90 for
   `ai-description-extraction` — and *that* is the one `v_observations_needing_refresh`
   applies in prod. Chapter 10 §10.5 agrees with the function. Three answers,
   one question.

## Data finding — attribution, not schema

Vehicle `a90c008a` (Skylar's 1983 GMC K2500, VIN `1GTGK24M1DJ514592`) carries a
**rival VIN** `1GTDC14H6DFA14658` from `nuke-vision`, read off
`photo://da9e4ae4-cf65-4e8d-afb4-83598f3b7ae5` on 2026-07-13. That VIN pattern
decodes to a GMC **C1500 (2WD)**, not a K2500 (4WD), and no vehicle row holds
it. Consistent with `feedback_recent_unalbumed_photos_are_shop_mixed` — a plate
photographed in the shop, attributed to the wrong truck.

The adjudicator serves the correct VIN (weight 1.4653, corroborated by iphoto +
nuke-vision) **and preserves the rival as a conflict**. Per the trust invariant
the fix is fork-and-relink (`reattribute_observation`), **never delete**. Left
untouched — attribution is owner/ownership territory.
