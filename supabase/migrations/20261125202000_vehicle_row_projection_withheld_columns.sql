-- vehicle_row_public_projection: null every vehicles column the caller cannot SELECT.
--
-- WHY. vehicle_row_read(uuid) and get_vehicle_profile_data(uuid) are SECURITY DEFINER and anon may execute both. For a
-- caller who is not an insider they return vehicle_row_public_projection(to_jsonb(v.*)), the whole vehicles row with
-- only five keys masked (purchase_price, purchase_date, purchase_location, owner_name, owner_contact). The other 25
-- columns denied to anon by column grants pass through, license_plate among them (revoked from anon in
-- 20261125152500). Measured live 2026-11-25 01:58 PT as anon over PostgREST: vehicle_row_read returned license_plate
-- non-null on 3 of 3 public cars that carry one.
--
-- WHAT. The projection keeps its five fixed masks, its origin_metadata and description contact redaction, and now also
-- sets to null every top-level key that is a vehicles column the request role may not SELECT
-- (has_column_privilege(role, 'public.vehicles', attnum, 'SELECT'), read at call time). The request role is mapped from
-- auth.role() by whitelist: 'authenticated' stays, anything else is anon (current_user is the definer inside both
-- readers, so it is never tested). Only non-insiders reach the projection; insiders and the service role still read the
-- whole row in both readers. A future REVOKE on a vehicles column closes both readers with no code change; the planned
-- REVOKE of license_plate from authenticated then covers signed-in strangers here too.
-- Cost: the role is read once per call (an initplan; calling auth.role() once per column cost about 46 ms a call),
-- and only non-null keys are tested against the grants. Measured read-only on prod 2026-11-25 with anon claims on one
-- public car (a 15 KB row, 50 calls per run, two runs): the added mask takes 0.36 ms a call. The whole projection,
-- before and after, takes 90-125 ms a call on that row; the recursive jsonb_mask_keys walk accounts for that, and
-- this migration leaves it as it was.
-- Volatility goes IMMUTABLE -> STABLE (it reads auth.role() and the catalog). Nothing depends on the projection in
-- pg_depend (no index or generated column); its two callers are plpgsql. Signature, return type, PARALLEL SAFE,
-- search_path '' and the ACL are unchanged (CREATE OR REPLACE).
-- CONTRACT: supabase/sql/test_vehicle_row_projection_withheld_columns.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125202000_vehicle_row_projection_withheld_columns.sql (the prior live body).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO s
  FROM pg_proc p WHERE p.oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
  -- The live body read 2026-11-25 02:05 PT (sha256 of prosrc), or this migration's own body on a re-run.
  IF s IS DISTINCT FROM 'a7a24cb218d880a3879505453e90114a58d52eaeeb09bbddf9c08bf6be7de1ca'
     AND position('vehicle_row_projection_withheld_columns_v1' in
       pg_get_functiondef('public.vehicle_row_public_projection(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_row_public_projection changed after it was read for 20261125202000 (sha256 %); review it', s;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- vehicle_row_projection_withheld_columns_v1: a vehicles column the request role cannot SELECT is null here.
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'])
                || coalesce((
                  SELECT pg_catalog.jsonb_object_agg(a.attname::text, 'null'::jsonb)
                  FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                    AND jsonb_typeof(p_row) = 'object' AND jsonb_typeof(p_row -> a.attname::text) <> 'null'
                    AND NOT pg_catalog.has_column_privilege(
                      (SELECT CASE auth.role() WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END),
                      a.attrelid, a.attnum, 'SELECT')), '{}'::jsonb) AS j) r) m
$function$;

DO $check$
DECLARE f record;
BEGIN
  SELECT p.provolatile, p.proparallel, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         position('vehicle_row_projection_withheld_columns_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
  IF NOT (f.provolatile = 's' AND f.proparallel = 's' AND f.proconfig = ARRAY['search_path=""'] AND f.res = 'jsonb'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'vehicle_row_public_projection not as intended';
  END IF;
END $check$;
COMMIT;
