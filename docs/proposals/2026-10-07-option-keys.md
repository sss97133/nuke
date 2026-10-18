# Pre-mint memo: option keys (2026-10-07)

**Status:** proposal, docs only. Nothing applied. Lead session skylar-64, written 12:35Z from read-only production reads
between 11:40Z and 12:40Z (`scripts/data/q.sh`; samples `TABLESAMPLE SYSTEM` with `REPEATABLE (20261007)`). Third memo of
the night after the place entity (declared, fed) and the platform entity (declared).

**Recommendation: do not declare yet, and do not mint.** The option dimension exists three times (GM only, overlapping,
no unique key on the code), while the per-vehicle option layer that would key to it holds 26 rows. Declaring any of the
three tables would flip three stacks on paper and feed nothing. The repair is intake: option observations per vehicle
from SPID sheets, build sheets and listing text, landing in `vehicle_options`, and one deduplicated dimension with a
key of (manufacturer, code, year range) chosen by the owner.

## The need

- `v_stacks` (12:30Z): 'option keys' is missing in **3 of 65 stacks**: S12 (Dimensions as evidence, not lists: 0/4, the
  other three needs partial), S14 (Option and color premiums: 0/2) and S30 (Factory batch effects: 0/2, also missing
  'VIN build sequence'). S42 (Regional taste maps) and S57 (Feature attribution by matched siblings) name stack S12,
  which stays partial on `vehicles.canonical_body_style`, `color_family` and `paint_code` whatever happens here.
- The substrate note names `gm_rpo_library` and `rpo_code_definitions` as live candidates, not declared.

## The seven questions

### 1. Search before mint: candidates read, no fit proven?

| Table | Rows | Key | Described | Readers on main | What it is |
|---|---|---|---|---|---|
| `gm_rpo_library` | 15,568 (14,539 distinct `rpo_code`) | PK `id`; **no unique on the code** (colour codes repeat up to 9×) | 7/16 | 1 (`scripts/enrich-rpo-library.mjs`) | GM RPO codes from the VPPS Nov-2002 export plus NastyZ28 year ranges; 282 categories; `first_year`/`last_year` on 1,521 rows (1967–1989); 3 sources. |
| `vintage_rpo_codes` | 1,531 (1,374 distinct) | PK `id`; no unique on the code | 0/20 | 2 | Curated vintage RPO codes with description, displacement, horsepower, torque, year range, `makes[]`, `models[]`, rarity, price impact, `mandatory_with[]`, `incompatible_with[]`, `manufacturer`. |
| `rpo_code_definitions` | 23 | PK `code` | 0/12 | 0 | A third, tiny code list (engine, transmission, trim fields). |
| `vehicle_options` | **26** | PK `id`; `vehicle_id`, `option_code` text, `option_name`, `category`, `source`, `verified_by_spid` | 0/8 | 0 | The per-vehicle option layer: one row per option seen on a vehicle. Nothing writes it. |
| `vehicle_spid_data` | 1 | | 8/57 | 6 | GM SPID (Service Parts Identification) sheet extraction; the extractor exists in code and produced one row. |
| `component_definitions.related_rpo_codes` | 16 rows | | | | Component to RPO cross-reference. |

**No fit proven, and the problem is not the dimension.** Three GM-only code libraries overlap with no shared key; the
same code (Z28, L82) names different things in different years, which only the year range disambiguates, and the year
range is filled on 1,521 of 15,568 rows. The layer that would key to a dimension, `vehicle_options`, is empty for all
practical purposes (26 rows, 0 writers).

### 2. Observations first?
Yes. An option on a vehicle is testimony: a SPID label photographed, a build sheet, a seller's "RPO Z28, L82" in the
listing text. It belongs in the observation log keyed to the vehicle and the source, folded into `vehicle_options`
(which already carries `source` and `verified_by_spid`). Listing text is a thin source for the word itself and a noisy one for codes: in a 1% sample of 4,567 vehicles with a
description (2026-10-07 12:38Z), 3 mention the word RPO and 643 contain a code-shaped token (one capital and two digits,
an upper bound: engine and model names match too). The SPID extractor and build sheets are the precise sources; text
mining needs the code dimension to filter against before it can count.

### 3. DNA
The dimension's key must be (manufacturer, code, year range), not the bare code. None of the three libraries has it as a
constraint; `vintage_rpo_codes` has the columns (`manufacturer`, `first_year`, `last_year`, `makes[]`). The per-vehicle
row needs `vehicle_id`, the code, the source observation, the method (SPID photo, build sheet, text), and a clock.

### 4. View or supersession
A view unioning the three libraries cannot be declared (`stack_coverage()` measures tables through the atlas). Library
rows are reference loads: a new release is a new row set; `vehicle_options` rows are observations: superseded, never
rewritten.

### 5. Invariants
Once a dimension is chosen: UNIQUE (manufacturer, rpo_code, first_year) on it, which today's duplicates do not allow
(dedupe first, shop-clean, no prevention trigger); then `vehicle_options.option_code` keys to it NOT VALID. Attack tests
belong with that migration.

### 6. Writers and registry
Libraries: loaded by scripts (`enrich-rpo-library.mjs`; the others Unknown). `vehicle_options`: no writer. The intake
candidates: (a) the SPID extractor (`vehicle_spid_data`, 6 code files, 1 row) pointed at the owner's own GM photos first;
(b) build-sheet uploads; (c) listing-text mining for code tokens, filtered against the keyed dimension (without it the
token match is 14% of descriptions and mostly not options).

### 7. Migration
None now. Order: intake fold (a) with a per-vehicle count as its assay → dedupe one library into the keyed dimension →
declare → key `vehicle_options`. Each a migration with a contract.

## What a declaration alone would move
S12 0/4 → 1/4, S14 0/2 → 1/2, S30 0/2 → 1/2; S42 and S57 unchanged; substrates declared 2 → 3 of 61. Registry mean
coverage would rise about 0.006 with no vehicle gaining an option.

## Decision asked
Rule on the dimension key (manufacturer, code, year range) and which library is primary (`vintage_rpo_codes` has the
shape; `gm_rpo_library` has the rows). Approve the SPID extractor run on the owner's GM photos as the first feed. Declare after the first fold
writes rows.
