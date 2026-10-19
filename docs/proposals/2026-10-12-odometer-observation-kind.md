# Pre-mint memo: odometer observation kind (2026-10-12)

**Status:** proposal, docs only. Nothing applied. Written by the nightly repair-loop run from read-only production reads
between 08:46Z and 08:50Z (`scripts/data/q.sh`; samples use `TABLESAMPLE SYSTEM (0.5) REPEATABLE (20261012)`). Several
whole-table counts on `vehicle_observations` and `vehicles` hit the 55 s statement ceiling and were not lengthened. The
numbers marked *sample* are scaled from a 0.5% block sample and are estimates.

**Recommendation: do not mint a new kind or table. Declare the substrate on what exists, after the binder feeds it.**
An odometer reading already has a home: the ratified property `mileage_miles` ("Odometer Reading (mi)", unit miles,
instance/multi, applies to kinds `condition`, `listing` and `work_record`) on `vehicle_observations`, with source,
`observed_at` and supersession on every row. The retained-listing projection has written it since 2026-10-10. What is
missing is not shape but binding. Most mileage evidence still sits as unkeyed `structured_data` keys on listing and
sale-result rows (about 10× the property-bound rows in the sample), and the deterministic bulk binder deliberately
leaves unitless mileage unbound (case ledger §12, 2026-10-12). A new `observation_kind` value `odometer` would create a
second dialect for the same fact.

## The need

```sql
-- 08:46:18Z
select need, count(*) n_stacks, string_agg(stack_id, ',' order by stack_id) stacks
from v_stacks, unnest(needs_missing) need group by need order by n_stacks desc, need limit 12;
```

| Rank | Need | Stacks | Why not this memo |
|---|---|---|---|
| 1 | text fold | 5 (S04, S05, S19, S34, S36) | open memo PR #910 |
| 2 | parts and labor taxonomy | 4 (S07, S31, S55, SB) | open memo PR #922 |
| 3= | dense dated sales | 3 | open memo PR #968 |
| 3= | option keys | 3 | memo on main, `2026-10-07-option-keys.md` |
| 3= | S12 | 3 | a stack, not an abstract need |
| 3= | **odometer observation kind** | **3 (S08, S28, SB)** | **this memo** |
| 3= | state-history dimension | 3 (S16, S27, S44) | lower coverage gain |
| 3= | climate dimension | 3 (S27, SB, SD) | lower coverage gain |

Tie-break among the three un-memoed needs at 3 stacks: the coverage each would add, Σ 1/n_needs over its stacks
(08:46Z). Odometer 1.611, state-history 1.533, climate 0.644.

- **S08 Odometer honesty**: "Do a vehicle's mileage readings agree across sources and over time?" Its only need is this
  one, so coverage would go 0 → 1.0.
- **S28 Use profile from odometer curves**: needs 2; the other, `receipts.created_at`, is partial. Coverage would go
  0 → 0.5.
- **SB The car as a bond**: needs 9 and is at 0.111; four other needs are missing.

The substrate note (`stack_substrates`) reads: "Mileage as one observation kind with a clock on every source (case
ledger §13 row 8). vehicle_observations listed no mileage kind among its common kinds on 2026-10-07." The `stack_needs`
notes: "a uniform observation kind with a clock on every source" (S08), "uniform odometer observations" (S28, SB).
Separate need: S39 names `odometer OCR` (mileage read from photos), which is not covered here.

## The seven questions

### 1. Search before mint: candidates read, no fit proven?

**A fit exists.** The search (`information_schema.columns` for `%odometer%` / `%mileage%`; `observation_properties` for
mile/odometer; the `observation_kind` enum), read 08:46–08:47Z:

| Candidate | What it holds (08:46–08:49Z) | Fit |
|---|---|---|
| `observation_properties` row `mileage_miles` (id `abdd7a7a-…`) | namespace core, label "Odometer Reading (mi)", unit miles, integer, `verification_scope` instance, `cardinality` multi, `applies_to_kinds` {condition, listing, work_record}, ratified 2026-05-17, not deprecated | **The key.** A reading is a property observation; the property carries the unit and the meaning. |
| `vehicle_observations` with `property_id = mileage_miles` | *sample:* 119 of 59,886 sampled rows, all live (about 24K scaled to 12.0M est_rows). By kind and source in the sample: condition/bat 104 (native description witness, `retained_odometer_witness`, 2026-10-10), listing/craigslist 15 (`auto_miles` labels, 2026-10-11) | The log, already uniform where bound: source, `observed_at` (filled on every sampled row), ingest clock, supersession. |
| `vehicle_observations.structured_data` keys `mileage` / `odometer` (no property binding) | *sample:* 1,190 sampled rows (about 238K scaled). sale_result/bat 444, listing/bat 279, listing/mecum 203, listing/cars-and-bids 119, specification/ai-description-extraction 38, listing/barrett-jackson 36, craigslist 21, pcarmarket 18, jamesedition 10, bonhams 9, facebook_marketplace 8, gooding 3 | The unbound backlog: readings with a clock and a source but no key, unit or precision. |
| `observation_kind` enum | 17 values (listing … offer); none is odometer or mileage | Adding one would duplicate the property path. |
| `vehicles.mileage` (+ `mileage_source`) | pg_stats, not a count: null_frac 0.627 of about 1.07M rows (≈ 400K filled); `mileage_source` null_frac 0.878 | A current-state scalar with no clock: a fold target, not a log. |
| `timeline_events.mileage_at_event` | pg_stats: null_frac 0.867 of about 1.22M rows (≈ 162K filled) | Dated, but an event attribute rather than a reading with its own source. Candidate input. |
| `vehicle_current_state.mileage`, `vehicle_search.mileage`, `marketplace_listings.mileage` (null_frac 0.988), `service_records.mileage` (242 rows), `deal_vehicle_details.odometer`, `vlva_vehicles.odometer`, `component_events.mileage_at_event`, `user_vehicle_relationships.mileage` | read-model copies or small side tables | Readers or minor inputs, not the substrate. |

### 2. Observations first?
Yes, and they already are. A reading is testimony: "the odometer shows 48,000 miles" on a dated page, in a seller label,
on a service invoice or in a photo. `retained_odometer_witness()` (migration `20261010182050`) records it with the
original unit, count and precision, approximation flags, `reading_role = odometer_display` and
`true_mileage_status = unknown`. Display is not accumulated mileage, and the shape keeps that distinction. No table is
earned: S08 and S28 need per-vehicle ordered readings, which the property index `(vehicle_id, property_id)` already
serves.

### 3. DNA columns canonical, trust T1/T2/T3, vocabularies CHECKed?
`vehicle_observations` carries the grammar (`source_id`, `extraction_method`, `observed_at`, `confidence_score`,
`is_superseded`, `superseded_by`, `structured_data`). Units live on the ratified property, not in free text. Open item:
the reading-role vocabulary (`odometer_display` today; also `title_reading`, `service_reading`, `inspection_reading`
when those sources bind) exists only inside the witness function's JSON. If more roles bind, it should be written down
and CHECKed through the `schema_proposals` curator path.

### 4. Could a view do this? Supersession?
Yes. S08's reader is a read over property observations: per vehicle, readings ordered by `observed_at` with source and
precision, flagging decreases beyond the stated precision and cross-source disagreement on the same day. Corrections
are supersession on the observation row. Nothing new is stored.

### 5. Invariants as constraints, attack tests?
The existing projection owner carries drift guards (sha256 of the owner functions and the cron command) and contract
tests: `scripts/test_retained_odometer.py`, `scripts/test_retained_craigslist_odometer.py`, and
`supabase/functions/ingest-observation/retainedOdometer.test.ts` and `retainedCraigslistOdometer.test.ts`. A new
binder (below) extends those contracts. It adds a kilometre case, an approximate case ("~48k"), a TMU/exempt case
(must not bind as a reading) and a unitless case (must stay unbound).

### 6. Writers disjoint, registry rows?
One writer: the canonical intake `ingest-observation` with its retained-listing projection (cron
`project-retained-listing-properties`, every minute, 120/minute ceiling). Binding the unbound `structured_data` mileage
is a new projection version inside that owner, not a new writer. `pipeline_registry` already names
`ingest-observation` as the owner of `vehicle_observations`.

### 7. Migration file, WHY comment, live verification, RLS?
For the declaration, when it comes: one migration that sets `stack_substrates.declared_table = 'vehicle_observations'`
for `odometer observation kind`. Its WHY comment names the property id as the key and cites the bound-row count at
declaration time. Declaring flips S08 to 1.0 and S28 to 0.5 on paper (`stack_registry`: "missing until declared_table is
set; then measured as a table"), so it should land after a binder pass, not before ("declare, then feed"). No RLS
change; the table's policies already apply.

## What would close it

1. **Bind (the repair):** a projection version in the existing `ingest-observation` retained-listing owner. It binds the
   unbound `mileage`/`odometer` keys on BaT sale results and listings, Mecum, Cars & Bids and Barrett-Jackson to
   `mileage_miles`. It requires an explicit unit or source-declared unit (as the Craigslist `auto_miles` label already
   is), keeps unitless values unbound, and retains the original string. The first acceptance case is a BaT sale result
   whose description witness already bound a reading: the two readings must agree or record a disagreement.
2. **First reader:** S08's per-vehicle reading sequence as a read over the property (question 4), shown on the stack page.
   Report coverage as vehicles with ≥ 2 bound readings from distinct sources, over all public vehicles.
3. **Declare** `odometer observation kind` → `vehicle_observations`, with the bound count in the comment.

**Stacks it would unblock:** S08 Odometer honesty (0 → 1.0), S28 Use profile from odometer curves (0 → 0.5), SB The car as
a bond (0.111 → 0.222). It would also feed S39 (odometer OCR) once photo readings exist, as the same property with a
different source.

## Limits

- Whole-table counts of property-bound and unbound mileage rows timed out at the 55 s ceiling. The memo uses a 0.5% block
  sample (59,886 rows; block sampling clusters rows, so the scaled figures are rough). The `vehicles` and
  `timeline_events` fill figures come from `pg_stats` null fractions, not counts.
- The memo does not establish how many vehicles have two or more readings. That is the next measurement, best taken by
  the binder's own receipts.
- `structured_data` values were not parsed here. How many carry a unit, a TMU flag or a kilometre reading is unmeasured.
