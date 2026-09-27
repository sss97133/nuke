-- Lock 2 of the data locks (P3.4 of the approved lock-down plan, 2026-09-27):
-- testimony and history tables no longer die with their vehicle. ON DELETE CASCADE → ON DELETE RESTRICT
-- on every FK to vehicles(id) from a testimony or history table.
--
-- Binds every non-owner role, service_role included (it owns no table, so it cannot drop a constraint).
-- The owner (postgres) can; the DDL tripwire (lock 4) records that.
--
-- MEASURED (prod, read-only, 2026-09-27 ~17:10Z, session cb179857): 285 FKs reference vehicles(id);
-- 244 cascade. The ten on testimony / history tables, with estimated rows:
--   auction_comments 14,801,815 · auction_events 294,297 · bat_listings 157,088 ·
--   comment_discoveries 133,445 · description_discoveries 116,740 · external_listings 139,309 ·
--   ownership_transfers 100,035 · vehicle_events 410,583 · vehicle_images 43,037,656 · vehicle_timeline 56
-- The other 234 cascading FKs are derived / queue / parts tables and keep cascading (out of scope).
-- merge_proposals (vehicle_a_id / vehicle_b_id) already has NO ACTION.
-- vehicle_observations (10,092,557 rows) has NO FK to vehicles at all: nothing stops a vehicle delete
-- from orphaning it silently. Adding one (NOT VALID) is a follow-up; its orphan count exceeded the 55 s
-- read budget today and is unmeasured.
--
-- HOW: PostgreSQL 17 cannot change an FK's delete action in place, so each constraint is dropped and
-- re-added ON DELETE RESTRICT NOT VALID under the same name. NOT VALID skips the existing-row scan;
-- enforcement (the RI triggers on both tables, including the delete-side RESTRICT, and the check on
-- every new or updated child row) is identical with or without validation. The constraints are NOT
-- validated afterwards, on purpose: the rolled-back rehearsal of this file on 2026-09-27 ran
-- ALTER TABLE vehicle_events VALIDATE CONSTRAINT and it FAILED — vehicle_events holds 16,026 rows whose
-- vehicle_id (e.g. 0000c8ce-b8a7-481f-a849-45daecb16b60) is not in vehicles (measured the same day:
-- SELECT count(*) FROM vehicle_events e WHERE NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = e.vehicle_id)).
-- The old CASCADE constraint was marked valid, so those rows arrived with RI triggers off (bulk imports
-- ran with triggers disabled; the sold-rule file records the same). That is the disease this lock stops:
-- testimony already orphaned, 16,026 times, in one table.
-- A validation would need the orphans re-attached first (a ghost vehicle per orphaned id — rule 4 of
-- agent-trust-invariants: stub, never delete); that is a follow-up, not a precondition. NOT VALID FKs
-- protect every row from here on.
-- Locks: DROP CONSTRAINT takes ACCESS EXCLUSIVE on the child table and SHARE ROW EXCLUSIVE on vehicles
-- for milliseconds. lock_timeout turns "queued behind a long writer" into a clean failure (the rehearsal
-- hit exactly that once, while a REFRESH MATERIALIZED VIEW was running); every step is idempotent (a
-- constraint already ON DELETE RESTRICT is skipped), so the file can simply be re-run.
--
-- LIVE PATHS THAT DELETE vehicles — each now fails loudly when testimony remains (intended):
--   frontend Vehicles.tsx:1029 (a user deletes a vehicle) and vehicleDeduplicationService.ts:246 (hard
--   delete of a merged duplicate), both as authenticated;
--   SQL functions auto_merge_duplicates_with_notification, cleanup_bonhams_junk, delete_bonhams_junk_batch
--   (DELETE FROM vehicles): on no cron, called by no deployed function or frontend page;
--   no deployed edge function deletes vehicles. dedup-vehicles calls merge_into_primary(), which
--   UPDATEs the duplicate (merged_into_vehicle_id) and never deletes the vehicle row: unaffected.
--   The sanctioned path is vehicles.deleted_at (soft delete).
--
-- SCHEMA_LAW: §1 the constraints exist, only their action changes; §4 nothing is overwritten (same names);
-- §5 invariant at the data layer; §7 CI-applied; undo = the same blocks with CASCADE (not recommended).

SET statement_timeout = '120s';
SET lock_timeout = '10s';

-- One block per table so a lock timeout on one leaves the others done; re-run to finish.
CREATE OR REPLACE FUNCTION pg_temp.switch_vehicle_fk_to_restrict(p_table text, p_constraint text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_action "char";
BEGIN
  SELECT c.confdeltype INTO v_action
  FROM pg_constraint c
  WHERE c.conname = p_constraint
    AND c.conrelid = ('public.' || quote_ident(p_table))::regclass
    AND c.contype = 'f';
  IF v_action IS NULL THEN
    RETURN p_table || ': constraint ' || p_constraint || ' not found — nothing done';
  ELSIF v_action = 'r' THEN
    RETURN p_table || ': already ON DELETE RESTRICT';
  END IF;
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, p_constraint);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT NOT VALID',
                 p_table, p_constraint);
  RETURN p_table || ': switched to ON DELETE RESTRICT (NOT VALID)';
END;
$fn$;

SELECT pg_temp.switch_vehicle_fk_to_restrict('vehicle_timeline',        'vehicle_timeline_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('ownership_transfers',     'ownership_transfers_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('description_discoveries', 'description_discoveries_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('comment_discoveries',     'comment_discoveries_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('external_listings',       'external_listings_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('bat_listings',            'bat_listings_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('auction_events',          'auction_events_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('vehicle_events',          'vehicle_events_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('auction_comments',        'auction_comments_vehicle_id_fkey');
SELECT pg_temp.switch_vehicle_fk_to_restrict('vehicle_images',          'vehicle_images_vehicle_id_fkey');

-- No VALIDATE CONSTRAINT here (see HOW above: vehicle_events already has orphans, the scan would fail).
-- After the orphans are re-attached to ghost vehicles, off-hours, per table:
--   ALTER TABLE public.<t> VALIDATE CONSTRAINT <t>_vehicle_id_fkey;   -- SHARE UPDATE EXCLUSIVE, no DML blocked

DROP FUNCTION pg_temp.switch_vehicle_fk_to_restrict(text, text);

-- ─── Live verification (run after apply) ─────────────────────────────────────────────────────────
-- SELECT conrelid::regclass, conname, confdeltype, convalidated FROM pg_constraint
--  WHERE contype = 'f' AND confrelid = 'public.vehicles'::regclass
--    AND conrelid::regclass::text IN ('auction_comments','auction_events','bat_listings','comment_discoveries',
--        'description_discoveries','external_listings','ownership_transfers','vehicle_events','vehicle_images','vehicle_timeline')
--  ORDER BY 1;
--   -> 10 rows, confdeltype = 'r', convalidated = false (NOT VALID by design, see HOW).
-- Attack test (rolled back): BEGIN; DELETE FROM vehicles WHERE id = <a vehicle with vehicle_events>; ROLLBACK;
--   -> ERROR 23503 "update or delete on table "vehicles" violates foreign key constraint ... on table "vehicle_events""
