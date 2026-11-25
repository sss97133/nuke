-- organization_vehicles.vehicle_readable: the link row carries whether the public may open its car (step 1 of 3).
--
-- WHY. Every organization-vehicle link is readable by anyone today ("Anyone views org-vehicle links",
-- "organization_vehicles_select": USING true), so a private or deleted car's id, status and notes are listed under its
-- organization. Gating the read policy on the car row costs one vehicles_pkey probe per link: measured on prod
-- 2026-11-25 (EXPLAIN, read-only) at 67 us warm per row, and the largest organization (~181k active links) times out
-- on cold heap reads. Option A (lead ruling, 2026-11-25): keep the car's public predicate on the link row itself.
--
-- WHAT (this migration; schema and triggers only, no row is written).
--   organization_vehicles.vehicle_readable boolean, nullable, no default: a catalog-only ALTER. Existing rows stay NULL
--   until step 2's self-unscheduling backfill job writes them 1,000 by primary-key range.
--   BEFORE INSERT OR UPDATE OF vehicle_id, vehicle_readable on organization_vehicles: the value is always computed,
--   vehicle_publicly_readable(is_public, deleted_at, merged_into_vehicle_id) of the car (false when there is no car).
--   A value a caller writes is overwritten: anon and authenticated hold table-level UPDATE, so step 3's policy must
--   not trust a caller's value.
--   AFTER UPDATE OF is_public, deleted_at, merged_into_vehicle_id on vehicles, when one of them changes: the car's link
--   rows whose value differs from the predicate's new answer are set to it (an index probe on idx_org_vehicles_vehicle
--   when the answer did not change). The WHEN clause compares the raw columns rather than calling the predicate: an
--   expression in WHEN runs with the updating role's EXECUTE rights, and the predicate is not granted to PUBLIC.
--   Both functions are SECURITY DEFINER (search_path ''), so a caller who cannot see the car still stamps the true
--   value; neither is executable by PUBLIC, anon or authenticated.
-- KNOWN. Writing vehicle_readable fires the live BEFORE UPDATE trigger update_days_on_lot, which refreshes days_on_lot
--   on rows with a lot listing_status (a derived count). stamp_organization_vehicle_linker leaves linked_by_user_id
--   alone (it restamps only when vehicle_id, organization_id, relationship_type, status or linked_by_user_id change).
--   A link inserted while another transaction is changing its car's visibility can keep the pre-change answer (each
--   side reads the other's committed state); taking a share lock on the car would close that and add deadlocks to the
--   per-image linking path, so step 2's gauge counts rows whose value differs from their car.
-- NEXT. Step 2: the backfill job and its gauge. Step 3, once a probe reads 0 NULLs: the read policy (vehicle_readable OR
--   a tie OR an active member through organization_vehicle_link_grants()), SET NOT NULL, the definer readers. When the
--   predicate takes merged_target_public as a 4th argument, both functions here take it in the same series.
-- Locks: ALTER TABLE takes ACCESS EXCLUSIVE on organization_vehicles and CREATE TRIGGER takes SHARE ROW EXCLUSIVE on
--   vehicles, both catalog-only; lock_timeout 3s. Deploy in a quiet window (no lots near close).
-- CONTRACT: supabase/sql/test_organization_vehicles_vehicle_readable.sql (PG17).
-- REVERSAL: supabase/sql/revert_20261126071500_organization_vehicles_vehicle_readable.sql.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF to_regprocedure('public.vehicle_publicly_readable(boolean,timestamp with time zone,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_publicly_readable(boolean, timestamptz, uuid) is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.organization_vehicles'::regclass
             AND attname = 'vehicle_readable' AND NOT attisdropped AND atttypid <> 'boolean'::regtype) THEN
    RAISE EXCEPTION 'organization_vehicles.vehicle_readable exists with another type; review';
  END IF;
END $guard$;

ALTER TABLE public.organization_vehicles ADD COLUMN IF NOT EXISTS vehicle_readable boolean;
COMMENT ON COLUMN public.organization_vehicles.vehicle_readable IS
  'vehicle_publicly_readable() of this link''s car, kept by triggers (20261126071500): computed on insert and on any '
  'write of vehicle_id or vehicle_readable, and relayed from vehicles when the car''s answer changes. NULL only until '
  'the backfill job reaches the row.';

CREATE OR REPLACE FUNCTION public.organization_vehicles_stamp_vehicle_readable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- organization_vehicles_vehicle_readable_v1: always computed from the car; a caller's value is never kept.
  NEW.vehicle_readable := coalesce(
    (SELECT public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id)
       FROM public.vehicles v WHERE v.id = NEW.vehicle_id),
    false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.organization_vehicles_stamp_vehicle_readable() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vehicles_relay_readable_to_org_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r boolean := public.vehicle_publicly_readable(NEW.is_public, NEW.deleted_at, NEW.merged_into_vehicle_id);
BEGIN
  -- organization_vehicles_vehicle_readable_v1: the car's answer changed; its links follow.
  UPDATE public.organization_vehicles ov SET vehicle_readable = r
   WHERE ov.vehicle_id = NEW.id AND ov.vehicle_readable IS DISTINCT FROM r;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.vehicles_relay_readable_to_org_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organization_vehicles_vehicle_readable ON public.organization_vehicles;
CREATE TRIGGER trg_organization_vehicles_vehicle_readable
  BEFORE INSERT OR UPDATE OF vehicle_id, vehicle_readable ON public.organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.organization_vehicles_stamp_vehicle_readable();

DROP TRIGGER IF EXISTS trg_vehicles_relay_readable_to_org_links ON public.vehicles;
CREATE TRIGGER trg_vehicles_relay_readable_to_org_links
  AFTER UPDATE OF is_public, deleted_at, merged_into_vehicle_id ON public.vehicles
  FOR EACH ROW
  WHEN ((OLD.is_public, OLD.deleted_at, OLD.merged_into_vehicle_id)
        IS DISTINCT FROM (NEW.is_public, NEW.deleted_at, NEW.merged_into_vehicle_id))
  EXECUTE FUNCTION public.vehicles_relay_readable_to_org_links();

DO $check$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.organization_vehicles'::regclass
                 AND a.attname = 'vehicle_readable' AND NOT a.attisdropped AND a.atttypid = 'boolean'::regtype
                 AND NOT a.attnotnull AND NOT a.atthasdef) THEN
    RAISE EXCEPTION 'vehicle_readable is not a nullable boolean without a default';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.organization_vehicles'::regclass AND t.tgname = 'trg_organization_vehicles_vehicle_readable'
           AND t.tgfoid = 'public.organization_vehicles_stamp_vehicle_readable()'::regprocedure)
       OR (t.tgrelid = 'public.vehicles'::regclass AND t.tgname = 'trg_vehicles_relay_readable_to_org_links'
           AND t.tgfoid = 'public.vehicles_relay_readable_to_org_links()'::regprocedure));
  IF n <> 2 THEN RAISE EXCEPTION 'expected both triggers enabled, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid IN ('public.organization_vehicles_stamp_vehicle_readable()'::regprocedure,
                   'public.vehicles_relay_readable_to_org_links()'::regprocedure)
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND position('organization_vehicles_vehicle_readable_v1' in p.prosrc) > 0;
  IF n <> 2 THEN RAISE EXCEPTION 'trigger functions not as intended (% of 2)', n; END IF;
END $check$;
COMMIT;
