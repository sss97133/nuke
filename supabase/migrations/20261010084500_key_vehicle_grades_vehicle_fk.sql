-- Key vehicle_grades.vehicle_id to vehicles: a NOT VALID foreign key, ON DELETE CASCADE.
-- Key stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md "every reference
-- is a foreign key"). v_residual ranks vehicle_grades by its key gap (no foreign key in or out; gaps describe + key,
-- 330,038 estimated rows, read 2026-10-10 08:39Z through the same predicates on v_schema_atlas, because v_residual
-- itself exceeded the 55 s read budget).
--
-- EVIDENCE (read 2026-10-10 08:40-08:42Z UTC):
--   vehicle_grades holds one row per vehicle (PRIMARY KEY vehicle_id) and has no other constraint, so nothing ties the
--   id to vehicles. A 2% TABLESAMPLE SYSTEM read found 245 of 6,675 rows (3.7%) whose vehicle_id is in no vehicles row,
--   and none NULL.
--   The only writer is persist_vehicle_grade(uuid) (SECURITY INVOKER; its body is on prod, in no migration file). It
--   upserts the grade for whatever id it is given, then updates vehicles, which matches nothing for a missing vehicle.
--   That leaves an orphan grade, and nothing removes a grade when its vehicle is deleted.
--   Its callers, all on prod: the row trigger function trigger_regrade_vehicle (timeline_events, service_records and
--   ownership_transfers), the statement trigger function trigger_regrade_vehicle_stmt (vehicle_images) and
--   batch_grade_vehicles(integer), which walks existing vehicles only. Each catches every error per vehicle
--   (EXCEPTION WHEN OTHERS), so a refused grade never blocks the insert that triggered it.
--
-- THE CHANGE:
--   A foreign key vehicle_id -> vehicles(id), NOT VALID, ON DELETE CASCADE.
--   NOT VALID: the existing orphan rows stay as they are (never deleted here). Every new insert, and every update that
--   changes vehicle_id, must name an existing vehicle.
--   The regrade path for a missing vehicle now fails inside persist_vehicle_grade, and its caller's handler swallows the
--   failure. The vehicle's insert proceeds; only the orphan grade is not written.
--   An ON CONFLICT update of an existing orphan row leaves vehicle_id unchanged, so the key is not re-checked and the
--   upsert still succeeds.
--   ON DELETE CASCADE: a grade is current derived state for its vehicle, recomputed from evidence, not testimony. When
--   a vehicle row is deleted, its grade goes with it, through the primary-key index. A restrictive key would instead
--   make vehicle deletion fail on any graded vehicle.
--   VALIDATE CONSTRAINT is not run here: it would fail on the existing orphans, and removing them is a separate,
--   owner-visible decision.
--
-- LOCKS: ADD FOREIGN KEY takes SHARE ROW EXCLUSIVE on vehicle_grades and vehicles for the catalog change only, with no
-- scan under NOT VALID. lock_timeout 5 s bounds the wait. If a long transaction holds vehicles, the deploy fails and
-- rolls back whole, and the migration can be re-run.
--
-- CONTRACT: supabase/sql/test_vehicle_grades_vehicle_fk.sql (PostgreSQL 17, synthetic rows) runs in CI. No local
-- Postgres ran in the session that wrote this file.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.vehicle_grades
  ADD CONSTRAINT vehicle_grades_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE NOT VALID;

COMMENT ON CONSTRAINT vehicle_grades_vehicle_id_fkey ON public.vehicle_grades IS
'The graded vehicle. NOT VALID since 2026-10-10: rows written before then may name a vehicle that no longer exists (about 3.7% in a 2% sample of 330,038 estimated rows, 2026-10-10); new and re-keyed rows must name an existing vehicle. ON DELETE CASCADE: the grade is derived current state and goes with its vehicle. Writer: persist_vehicle_grade(uuid).';

COMMIT;
