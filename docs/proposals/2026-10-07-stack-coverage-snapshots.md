# Pre-mint memo: a time series of stack coverage (`stack_coverage_snapshots`)

Lead skylar-64, 2026-10-07 11:00Z. The owner asked (through skylar-c4, 04:40Z) for the expansion loop to be
measurable: "a nightly snapshot of v_stacks coverage, so expansion becomes a time series", brought as a
SCHEMA_LAW proposal, not minted. This memo answers the seven pre-mint questions with live reads. Nothing here
is applied; the migration is a separate decision.

## What exists tonight

- `public.stacks`, `stack_needs`, `stack_substrates` (20261007014500, #721): the registry; append-only; 65
  stacks, 61 substrates on 2026-10-07 10:43Z.
- `public.stack_coverage(p_stack_id)` and `v_stacks`: coverage computed **live** from the atlas, `pg_stats`,
  `pg_proc` and the substrate declarations; it returns `measured_at` but stores nothing. Every reading since
  2026-10-07 02:08Z lives only in DONE.md and LANES rows (SA 0.60 of 5 → 0.50 of 16 → 0.50 of 18; registry mean
  0.12 → 0.11 as stacks were added).
- Candidates searched for an existing dated-measurement shape (§1, search before mint):
  - `vein_runs` (C25): one row per vein version per grading run, written only by `run_vein_<family>()`; grain is
    a thesis grading (sample, window, effect, verdict), not a registry reading. No fit.
  - `data_quality_snapshots`: field completion rates sampled every 10 minutes by `compute-data-quality-snapshot`
    from 2026-04-07 to 2026-04-14 (1,002 rows, then silence); columns `field_stats`, `pipeline_stats`,
    `workforce_status` jsonb per capture. A dead organ with a vehicle-field grain. No fit, and not to be revived
    for this.
  - `source_quality_snapshots`: one row per source per snapshot (ymm/vin/price validity); grain is a source. No fit.
  - `image_coverage_by_vehicle`: a per-vehicle cache refreshed one vehicle at a time. No fit.
  Conclusion: no existing table carries "one stack version at one clock with its coverage and verdicts".

## The seven questions

1. **§1 search.** Done above: three dated-measurement tables and the registry's own function read; none holds a
   stack-version reading at a clock. No fit proven.
2. **§2 observations first.** Coverage is a measurement of the registry against the catalog, not a fact about a
   vehicle, person or organization; it has no subject in `vehicle_observations`' sense. It is a metric row, like a
   vein run. A table is earned the first time someone asks "how did coverage move last week", which is tonight.
3. **§3 DNA.** Keys: `stack_id text`, `version integer` (FK to `stacks`); clock: `measured_at timestamptz`;
   measure: `coverage numeric`, `n_needs`, `n_present`, `n_partial`, `n_missing integer`; evidence:
   `needs jsonb` (the function's per-need verdicts, so a later reader can ask *why* a number moved); source:
   `source text` = `'stack_coverage()'` plus `registered_by`. Trust: T1 (computed from the catalog by a
   deterministic function). No free-text vocabulary; the verdict words come from `stack_coverage()` and are
   CHECKed there.
4. **§4 view or supersession.** A view cannot hold a past reading; the point of the series is point-in-time.
   Rows are never corrected: a wrong reading is superseded by the next clock's row, and the function that wrote it
   is fixed. Append-only through the registry's own `vein_append_only()` trigger.
5. **§5 invariants.** Primary key `(stack_id, version, measured_at)`; `coverage` between 0 and 1;
   `n_present + n_partial + n_missing = n_needs`; a row's `(stack_id, version)` must be the latest version at
   `measured_at` (checked in the writer, asserted in the contract); attack tests: UPDATE and DELETE raise, a row
   for a version that is not latest is refused, a replay of the same clock is a no-op.
6. **§6 writer.** One sanctioned writer `snapshot_stack_coverage()` (SECURITY DEFINER, EXECUTE service_role
   only, app.writer set with set_config in the body) that inserts one row per stack from `stack_coverage(NULL)`
   at one `measured_at`, one `write_receipts` row per call. Caller: a `pg_cron` job once a night after the
   generator and the night run (03:30 and 01:30 local), with a `v_job_health` assay that the night's row count
   equals the stack count; or, until the owner's standing-runner ruling, a hand call after each registry change.
   Registry rows: the table (owner `snapshot_stack_coverage`) and the writer in `pipeline_registry`.
7. **§7 migration.** One file with the WHY header, the table, the trigger, the function, the grants (service_role
   SELECT, RLS on with no policy, as the registry), the registry rows, and the first row set written in the same
   transaction so the series starts at the deploy clock; a PG17 contract wired into `metric-fold-health-contract`.

## What the first reader would show

`select measured_at, count(*) stacks, count(*) filter (where coverage >= 0.9) showable, round(avg(coverage),2)
from stack_coverage_snapshots group by 1 order by 1` — the owner's "expansion as a time series", and per stack
the night a layer moved from missing to partial to present (SA: 8/16 → 9/18 tonight).

## Decision asked

Mint `stack_coverage_snapshots` with the writer above (one migration, one contract), and schedule its nightly
call under the standing-runner ruling. Cost: 65 rows a night, under 100 KB a month. Alternative: keep reading
`v_stacks` by hand and lose the series.
