# Pre-mint memo: parts and labor taxonomy (2026-10-10)

**Status:** proposal, docs only. Nothing applied. Written by the unattended night run from read-only production reads
between 08:44Z and 08:46Z (`scripts/data/q.sh`); code read at origin/main 483775947. SCHEMA_LAW is
`lofficiel-concierge/supabase/SCHEMA_LAW.md` (a read-only copy was used).

**Recommendation: do not mint, and do not declare yet.** The taxonomy organ exists. `part_categories` is a 19-row
system tree (Engine … Wheels & Tires, plus Labor and Tax & Fees) with a self-referencing parent key and a public read
policy. `labor_operations` is a 64-row flat-rate book whose `system` column uses 10 values from the same vocabulary.
What is missing is the keys: none of the rows that should point at a category does so. They carry five different free-text
category vocabularies (121, 22, 11, 10 and 6 distinct values). The first step is a read-only crosswalk view from those
texts to `part_categories`, with its coverage measured. Key columns and a keyer follow only after the crosswalk is ruled
on. Declaring the substrate now would move four stacks on paper while no receipt or work row is keyed.

## The need

`v_stacks` (08:44:35Z; `select need, count(*) n_stacks, array_agg(stack_id order by stack_id) from v_stacks,
unnest(needs_missing) need group by 1 order by 2 desc, 1 limit 12`):

- 'text fold' is missing in 5 stacks, but open PR #910 already holds its memo (2026-10-09). This memo takes the next
  need, **'parts and labor taxonomy', missing in 4 of 65 stacks**:

| Stack | Name | Coverage (present / needs) | Other needs |
|---|---|---|---|
| S07 | Hidden-defect prior | 0 / 2 | `receipts.created_at` partial |
| S31 | Modification recipes and outcomes | 0 / 2 | 'modifications dimension' missing |
| S55 | Parts price indices | 0 / 2 | `receipts.created_at` partial |
| SB | The car as a bond | 1 / 9 (0.111) | 4 more missing (odometer kind, climate, failure mode, jurisdiction), 3 partial |

- `stack_needs` (08:44Z): all four rows are `dimension` / `abstract`. S07's note says "receipts and work keyed to it";
  SB's note says "parts taxonomy and part key".
- `stack_substrates` row: no declared table. Note: "catalog_parts is the parts catalog; no labor taxonomy is declared"
  (source: data-machine-cases.md §13, 2026-10-06/07).

## The seven questions

### 1. Search before mint: candidates read, no fit proven?

Search: `v_schema_atlas` names matching part, labor, taxonom, catalog, repair, procedure, operation, component,
service_rec, work_sess, line_item, maintenance (45 rows read, 08:44:55Z). The candidates:

| Table | Rows | Keys | What it holds | Fit |
|---|---|---|---|---|
| `part_categories` | 19 | PK `id`; `parent_category_id` → itself (0 of 19 set); RLS on, policy `part_categories_public_read` | System tree: Engine, Transmission, Transfer Case, Axles, Suspension, Steering, Brakes, Exhaust, Fuel Delivery, Cooling, Electrical, Body, Interior, Wheels & Tires, AC/Heat, Audio, Accessories, Labor, Tax & Fees. Created by `20250929000001_vehicle_build_management.sql`. Code readers: `nuke_frontend/src/services/buildImportService.ts`, `scripts/import_blazer_build.js`. | **The organ.** It is a system-level dimension, already keyed and public. It lacks a stable code, versioning and sub-levels. |
| `labor_operations` | 64 | PK `code`; no FK | Flat-rate book: operation code, name, `base_hours`, `system` (body 18, paint 8, exhaust 8, mechanical 8, interior 6, trim 5, electrical 4, glass 4, brakes 2, drivetrain 1), model-year range. Read by `estimate_labor_from_description()` (exists on prod). Created by `20251206_practical_labor_guide.sql`. | The labor side of the same taxonomy. Its `system` text is the key that should point at `part_categories`. |
| `catalog_parts` | 10,853 | PK `id`; FK to `catalog_sources`; 11 FKs in | Designated canonical parts catalog (CAPABILITY_MAP). `category` filled on 10,088 rows with **121** distinct vendor labels; 5,714 rows are NULL, "Other" or a brand/store label (mustang 3,032, Holley, Webinar …) that names no system. | A grain below the taxonomy: one catalog part. It gets a category key and does not become the taxonomy. |
| `receipt_items` | 327 | FK to receipts | OCR receipt lines; `category` has 22 values, including non-vehicle ones (food 14, gas 1, shipping 4); `part_number` on 111. Rows 2026-05-03 .. 05-08. | A row to key. |
| `line_items` | 680 | 2 FKs out | Receipt lines; `category` (6 values: parts 621, labor 21, other, supplies, fluids, fee) is a line type, not a system; `part_number` on 451. All rows 2026-01-23. | A row to key (system Unknown from its text). |
| `work_order_labor` | 23 | 4 FKs out | Labor lines; `task_category` 11 values (exhaust, brakes, body, electrical, mechanical, drivetrain, fabrication, plus non-vehicle: marketing, deal_management, consultation, administrative); `job_op_code` on 9 rows. | A row to key; `job_op_code` → `labor_operations.code`. |
| `work_order_parts` | 83 | 4 FKs out | Parts per work order / event. | A row to key. |
| `component_library` | 51 | 4 FKs in | Engineered components with datasheets (wiring build). | A different grain (one physical design); out of scope. |
| `condition_taxonomy`, `angle_taxonomy` | 202, 24 | versioned | Taxonomies with a versioning pattern. | **Grammar to copy** for codes and versions. |
| `component_definitions`, `ai_component_categories`, `condition_component_definitions` | 16, 10, 35 | — | Vision-side component lists. | Not parts or labor; out of scope. |

No fit is missing. A new taxonomy table would be a synonym of `part_categories` (§8). The `stack_substrates` note
names `catalog_parts`, but that table is the catalog (a part grain), not the taxonomy (a system grain).

### 2. Is this a fact class that should be observation rows?

No for the taxonomy: it is a dimension (vocabulary), not testimony. The **assignment** of a receipt line, catalog part
or labor line to a category is a derived reading of that row's text. It belongs in the row's key column, filled by one
keyer with a crosswalk version, and left NULL when the text is ambiguous or names no vehicle system (food, marketing,
"Other"). It is not a fact about the vehicle, so it needs no observation row of its own. Work done on a vehicle remains
testimony in `vehicle_observations` and `work_sessions` and keys through those rows.

### 3. DNA columns named canonically, trust T1/T2/T3, vocabularies CHECKed and documented?

`part_categories` has no stable code: its rows are keyed by uuid and named by display text. Extending it means adding
`code text` (slug, unique, CHECK `^[a-z0-9_]+$`) and a version column on the `condition_taxonomy` / `angle_taxonomy`
pattern, with the vocabulary listed in the migration comment. A vocabulary table does not take the DNA columns; the
keyed rows keep their own. The crosswalk carries `method` (crosswalk version) and trust T3 (inferred from text).

### 4. Could a view do this? Corrections as supersession?

**Yes for the first step.** A view `v_part_category_crosswalk(source_table, source_label, part_category_id, rule)`
maps each distinct label in the five vocabularies above to a `part_categories` row, or to NULL with a reason. It is
reversible, writes nothing, and measures coverage before anything is keyed. Later corrections of a key are a new
crosswalk version plus a re-key pass; testimony is not touched.

### 5. Invariants as constraints or triggers, with attack tests?

For the later key step: nullable `part_category_id` columns with `NOT VALID` foreign keys to `part_categories`, a
unique `code`, and a PG17 contract that proves:
- an unmapped label stays NULL;
- a non-vehicle label (food, marketing) never keys;
- the keyer never overwrites a set key;
- a deleted category is refused while keyed rows exist.

Nothing is enforced today. That is a missing mechanism, recorded here.

### 6. Writer disjointness and registry rows?

One keyer owns only the new key columns; the existing writers keep their columns:
- `extract_parts_from_ocr` writes `receipt_items`;
- the catalog importers write `catalog_parts`;
- the work-order writers write `work_order_*`.

The keyer ships with its `pipeline_registry` rows, and its receipts follow the `write_receipts` path. When keys exist,
`stack_substrates` gets `declared_table = 'part_categories'` in the same PR that proves the fill.

### 7. Migration file, WHY comment, live verification, RLS posture?

`part_categories` already has RLS with a public read policy (08:45:37Z), and its writes stay with the service role.
Each later step is one migration file with its live reads in the comment. This memo installs nothing.

## First reader and what it unblocks

- **First reader: S07, "Hidden-defect prior".** It joins a vehicle's repair evidence (receipts, work) by system
  against its model's cohort. That is the smallest honest consumer: it counts keyed rows per system, with unresolved
  rows reported.
- **S55, "Parts price indices", would show coverage without substance.** Receipt lines span 5 days (`receipt_items`,
  2026-05-03 .. 05-08) and 1 day (`line_items`, 2026-01-23). `catalog_parts.price_current` is a single scraped price
  with no history; `invoice_learned_pricing` holds 157 rows. A price index over time has no time depth to read, so
  intake has to come before the index.
- **If declared after keys land:** the need moves from missing to present on S07, S31, S55 and SB. By the
  present / needs arithmetic in `v_stacks` (S07: 0 present, 1 partial → 0.0000), that is
  S07 0 → 0.50, S31 0 → 0.50, S55 0 → 0.50 and SB 0.111 → 0.222. The arithmetic alone does not make any of them
  showable, and declaring before keys exist would be a false coverage claim.

## Owner decisions

1. **Ratify `part_categories` as the parts and labor taxonomy organ**: extend it in place, with codes, versions and
   sub-levels, rather than mint a new table.
2. **Choose the depth**:
   - the current system level (19 rows), or
   - a second level such as brakes → pads, rotors, calipers, lines.
   An industry part-terminology standard would be a licensing and spending question. The cost and terms are Unknown
   here and were not researched.
3. **Approve the crosswalk-view step.** It is read-only and measures coverage before any key column is added.

## Measured state (08:44–08:46Z, 2026-10-10)

The numbers in the tables above came from three queries:
- counts and category vocabularies: `count(*)`, `count(category)`, `count(distinct category)` and `group by category`
  over `catalog_parts`, `line_items`, `receipt_items`, `work_order_labor`, `labor_operations` and `part_categories`;
- foreign keys into and out of the candidates, from `pg_constraint`;
- the function, policy and date-span checks.

No value naming a person, vendor account or amount is quoted.
