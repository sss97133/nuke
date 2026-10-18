-- projection_outcomes: declare the vehicle key its writer already honors (key gap, repair loop; data-machine-cases.md
-- section 12). No row is written; no column is added.
--
-- WHY. public.v_residual tags projection_outcomes "key" because it has no foreign key in or out (fk_in + fk_out = 0),
-- rank 2.2 Mrows, the highest-ranked key gap with a key to declare on 2026-10-07 08:35Z. (write_receipts ranks above it
-- at 2.8 but keys by table name and transaction id, which no foreign key can reference.) vehicle_id is the table's only
-- reference column; nothing in the catalog says it points at vehicles.
--
-- EVIDENCE (read-only, prod, 2026-10-07 08:35-08:39Z through scripts/data/q.sh):
--   1,161,765 rows on 668,240 distinct vehicle_id values; vehicle_id is filled on every row (pg_stats null_frac 0).
--   Writer: compute-vehicle-valuation is the only one (pipeline_registry table-level row; supabase/functions/
--   compute-vehicle-valuation/index.ts, the insert after the nuke_estimates upsert). That upsert already needs the
--   vehicle to exist (nuke_estimates has a foreign key to vehicles), so the new key adds no failure the writer can
--   reach today.
--   Rows written in the last 90 days: 114,732, of which 0 name a vehicle id missing from vehicles; last write
--   2026-10-06 08:00Z.
--   Older rows: a 2% TABLESAMPLE SYSTEM read 3,555 of 22,944 sampled rows (about 15%) whose vehicle_id is not in
--   vehicles. The exact full-table count exceeded the 55 s read bound. These are the historical orphans of the
--   ghost-vehicle ids, whose stub-or-retire ruling is held for the owner; this migration does not decide it.
--   Deletes: vehicles has n_tup_del = 0 in pg_stat_user_tables and no DELETE write receipt in 30 days, and none of the
--   six live merge functions (merge_into_primary, merge_duplicate_vehicles, merge_vehicle_into_primary_by_url, ...)
--   contains a DELETE FROM vehicles (pg_proc.prosrc), so ON DELETE NO ACTION blocks no running path.
--
-- WHAT. One foreign key, NOT VALID: Postgres enforces it for every new or re-keyed row now and leaves the existing
-- rows unchecked. It does not refuse updates to an old orphan row that leave vehicle_id unchanged, so grading
-- (actual_value, accuracy_score) still works on them. VALIDATE CONSTRAINT waits for the ghost-vehicle ruling.
-- ON DELETE NO ACTION on purpose: this is a log of predictions to be graded, so deleting a vehicle must not silently
-- delete its predictions (the same choice as analysis_events, 20261003180000).
-- Guarded by NOT EXISTS so a re-apply is a no-op.
--
-- CONTRACT: supabase/sql/test_projection_outcomes_vehicle_key.sql (PostgreSQL 17, synthetic rows, CI job
-- metric-fold-health-contract in .github/workflows/frontend-tests.yml).
-- MEASURED BEFORE: v_residual projection_outcomes gaps {describe,key}, rank_mrows 2.2 (2026-10-07 08:35Z).
-- EXPECTED AFTER: gaps {describe}, rank_mrows 1.1 (v_residual counts foreign keys from pg_constraint whether or not
-- they are validated).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.projection_outcomes'::regclass
      AND conname = 'projection_outcomes_vehicle_id_fkey'
  ) THEN
    ALTER TABLE public.projection_outcomes
      ADD CONSTRAINT projection_outcomes_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT projection_outcomes_vehicle_id_fkey ON public.projection_outcomes IS
'The vehicle a prediction is about. NOT VALID since 2026-10-07: enforced for new and re-keyed rows. About 15% of all rows (2% sample, 2026-10-07), all older than 90 days, name vehicle ids missing from vehicles; they stay unchecked until the ghost-vehicle ruling. ON DELETE NO ACTION: a vehicle''s predictions are not deleted with it.';

COMMENT ON COLUMN public.projection_outcomes.vehicle_id IS
'The vehicle the prediction is about. Unit: none (uuid, foreign key to vehicles.id, NOT VALID). Source: compute-vehicle-valuation, the vehicle it valued. Grain: one prediction. Clock: n/a (projected_at is the prediction time).';

COMMIT;
