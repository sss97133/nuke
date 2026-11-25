-- vehicle_image_scan_metadata_many(uuid[]): a page's photo readings through vehicle_images_public, one redaction per
-- photo returned; and vehicle_image_scan_metadata(uuid) keeps the gallery test's plan across calls.
--
-- The defect (measured 2026-11-25 on prod, anon, car 83f6f033): an ordered read of ai_scan_metadata through
-- vehicle_images_public (select id, ai_scan_metadata ... order by id limit 10) took 3.8-5.8 s. The view computes the
-- column in a LATERAL (... OFFSET 0) (20261125200000), so every photo of the car is redacted below the Sort, not just the
-- rows the Limit keeps. Dropping the lateral and raising the reader's COST postpones the call past the Sort, but then
-- every reference to the column is its own call: PG17, one public car of 2,400 photos (2,160 shown), anon, a 1,000-row
-- ImageGallery page (13 ai_scan_metadata-> projections) went from 2,160 calls / 545 ms to 13,000 / 3,284 ms, its second
-- page to 26,000 / 6,249 ms. So the view stays as it is, and a page reads its rows first, then the readings of exactly
-- those rows here.
--
-- 1. vehicle_image_scan_metadata_many(p_image_ids uuid[]) RETURNS TABLE (image_id uuid, ai_scan_metadata jsonb):
--    SECURITY INVOKER, a read of vehicle_images_public by id, so its rows and values are by construction those of
--    select id, ai_scan_metadata from vehicle_images_public where id = any(p_image_ids) for the same caller (the
--    vehicle_images read policies decide the rows, vehicle_image_scan_metadata the value). It restates no policy and
--    takes no document, so it registers no policy copy. A caller projects keys with PostgREST select= on the result
--    (?select=image_id,x:ai_scan_metadata->k); the function runs once, so a projection costs no further redaction.
--    The array length is capped by platform_config 'vehicle_image_scan_metadata_many'.max_ids (1,000: the page size of
--    fetchVehicleImages, which is PostgREST's row cap on this project, probed 2026-10-14: limit=1500 returns 1000); a
--    longer array raises 54000. No row for that key raises too.
-- 2. vehicle_image_scan_metadata(uuid): the live body (prosrc md5 1930b342..., 20261125200000) with the car's public test
--    read in its own statement before the shown-photo test. The test then holds no sub-select and plpgsql evaluates it as
--    a simple expression, whose state lives for the transaction, so vehicle_image_privacy_withheld (a SQL function) keeps
--    its plan from call to call instead of being planned again on every call. PG17, same car, anon, 2,400 calls: 513 ms
--    -> 186 ms; privacy_withheld 0.146 ms -> 0.012 ms a call. Same answers, same COST 1, same grants; the shown-photo
--    test is the one registered at the vehicle_images policy hash d00a311f... (re-checked below).
--
-- Not changed: vehicle_images_public, the gallery overloads, vehicle_image_findings (it names the column twice, but
-- through the lateral that is one call a frame). No lock on vehicle_images.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Replace only the body this migration was written from (2026-11-25 live text), or its own (a second apply).
DO $guard$
DECLARE v_live text;
BEGIN
  SELECT md5(prosrc) INTO v_live FROM pg_proc WHERE oid = to_regprocedure('public.vehicle_image_scan_metadata(uuid)');
  IF v_live IS DISTINCT FROM '1930b342245ec8baa829ddee4ab34111' AND v_live IS DISTINCT FROM 'd92ac4bd51e37ba3165029559618fad4' THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata live body (prosrc md5 %) is not the one this migration replaces (1930b342...)', v_live;
  END IF;
  IF position('vehicle_image_scan_metadata(vi.id)' IN pg_get_viewdef('public.vehicle_images_public'::regclass)) = 0 THEN
    RAISE EXCEPTION 'vehicle_images_public does not read ai_scan_metadata through vehicle_image_scan_metadata';
  END IF;
  -- the shown-photo test below restates the vehicle_images read policies as registered (d00a311f..., since #3971)
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL
     AND (SELECT h.policy_hash FROM public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') h)
         IS DISTINCT FROM 'd00a311fd7235bb19240f3fd812493c4' THEN
    RAISE EXCEPTION 'vehicle_images read policies changed since d00a311f...: re-read them before applying';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.vehicle_image_scan_metadata(p_image_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER COST 1
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  vi public.vehicle_images;
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_rules public.image_scan_rule[];
  v_car_shown boolean;
BEGIN
  SELECT * INTO vi FROM public.vehicle_images i WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_role = 'service_role' OR (v_role IS NULL AND session_user <> 'authenticator') THEN
    RETURN vi.ai_scan_metadata;
  END IF;
  -- the car is public and not deleted: its own statement, so the test below holds no sub-select and runs as a plpgsql
  -- simple expression (vehicle_image_privacy_withheld keeps its plan across calls; 20261126162500)
  v_car_shown := EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL);
  -- definer_readers_visibility_v1 (scan_metadata_withheld_paths): the uploader, or shown on a public non-deleted car
  -- and gallery-eligible, or tied; every term COALESCEd so a NULL never admits
  IF NOT (COALESCE(v_uid IS NOT NULL AND vi.user_id = v_uid, false)
          OR COALESCE(COALESCE(vi.is_sensitive, false) = false
                      AND v_car_shown
                      AND public.vehicle_image_gallery_eligible(vi), false)
          OR COALESCE(public.vehicle_viewer_tied(vi.vehicle_id), false)) THEN
    RETURN NULL;
  END IF;
  SELECT c.rules INTO v_rules FROM public.image_scan_rules_compiled c WHERE c.surface = 'vehicle_images.ai_scan_metadata';
  IF v_rules IS NULL THEN
    v_rules := public.image_scan_rules('vehicle_images.ai_scan_metadata');
  END IF;
  RETURN public.image_scan_metadata_for_viewer(vi.ai_scan_metadata, vi.user_id, vi.vehicle_id, v_rules);
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_scan_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_scan_metadata(uuid) TO anon, authenticated, service_role;

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('vehicle_image_scan_metadata_many',
        '{"max_ids": 1000, "max_ids_basis": "the page size of fetchVehicleImages (nuke_frontend/src/lib/fetchVehicleImages.ts PAGE_SIZE), which is PostgREST''s row cap on this project: limit=1500 returned 1000 rows, probed 2026-10-14"}'::jsonb,
        'vehicle_image_scan_metadata_many(uuid[]): max_ids = the most photo ids one call reads (a longer array raises 54000). Migration 20261126162500.')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vehicle_image_scan_metadata_many(p_image_ids uuid[])
RETURNS TABLE (image_id uuid, ai_scan_metadata jsonb)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_max integer;
BEGIN
  SELECT (c.config_value ->> 'max_ids')::integer INTO v_max
    FROM public.platform_config c WHERE c.config_key = 'vehicle_image_scan_metadata_many';
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'platform_config vehicle_image_scan_metadata_many.max_ids is not set' USING ERRCODE = '54000';
  END IF;
  IF cardinality(p_image_ids) > v_max THEN
    RAISE EXCEPTION '% photo ids: at most % a call (platform_config vehicle_image_scan_metadata_many.max_ids)',
      cardinality(p_image_ids), v_max USING ERRCODE = '54000';
  END IF;
  -- SECURITY INVOKER over the view: the caller's vehicle_images read policies pick the rows, the view's
  -- vehicle_image_scan_metadata(id) the value, once per row returned
  RETURN QUERY
    SELECT v.id, v.ai_scan_metadata FROM public.vehicle_images_public v WHERE v.id = ANY (p_image_ids);
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_image_scan_metadata_many(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_scan_metadata_many(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_scan_metadata_many(uuid[]) IS
  'The readings of the given photos as select id, ai_scan_metadata from vehicle_images_public where id = any(p_image_ids) returns them to the caller (SECURITY INVOKER: same rows, same redaction), one redaction per row returned. For a page that has already ordered and limited its photos without ai_scan_metadata; project keys with PostgREST select= on the result. At most platform_config vehicle_image_scan_metadata_many.max_ids ids a call (54000 beyond). Migration 20261126162500.';

DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
     IS DISTINCT FROM 'd92ac4bd51e37ba3165029559618fad4' THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata body is not this migration''s';
  END IF;
  IF NOT (SELECT prosecdef AND procost = 1 AND provolatile = 's' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata(uuid)'::regprocedure)
     OR NOT has_function_privilege('anon', 'public.vehicle_image_scan_metadata(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata is not SECURITY DEFINER, STABLE, COST 1, anon-executable';
  END IF;
  IF (SELECT prosecdef OR provolatile <> 's' FROM pg_proc WHERE oid = 'public.vehicle_image_scan_metadata_many(uuid[])'::regprocedure)
     OR NOT has_function_privilege('anon', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE')
     OR has_function_privilege('public', 'public.vehicle_image_scan_metadata_many(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'vehicle_image_scan_metadata_many is not SECURITY INVOKER, STABLE, granted to anon and authenticated only by name';
  END IF;
  IF (SELECT (config_value ->> 'max_ids')::integer FROM public.platform_config WHERE config_key = 'vehicle_image_scan_metadata_many') IS NULL THEN
    RAISE EXCEPTION 'platform_config vehicle_image_scan_metadata_many.max_ids missing';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), anon, counts only: rpc vehicle_image_scan_metadata_many with the ids of the first
-- 10 photos of public car 83f6f033 by id: 10 rows, place_hint / agent_notes / narrative_one_line present on 0;
-- the same ids through vehicle_images_public give the same 10 documents (md5 of the ordered aggregate).
