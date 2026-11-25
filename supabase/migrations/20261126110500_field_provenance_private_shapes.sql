-- get_field_provenance honours vehicle_observation_private_shapes (private_shape_rows_v1).
--
-- WHY. 20261126105000 adds vo_private_shape_read, a RESTRICTIVE read policy on vehicle_observations: a row whose
-- structured_data contains an active vehicle_observation_private_shapes.structured_match (seed: image_deep_byok, a
-- photo's deep reading copied onto the car) is read directly only by a viewer tied to the vehicle. get_field_provenance
-- is SECURITY DEFINER, so the policy does not apply inside it, and it serves those rows to anon by key: measured
-- 2026-11-25 as anon over REST (read-only), get_field_provenance(<public car>, 'text_regions') returned 932 deep-reading
-- observations, every one with its value (field_observations admits any row carrying the requested key;
-- readable_image_rows needs only a gallery-eligible photo). Cars with more than 1,000 such rows were refused by the
-- aggregate cap, not by a read rule.
--
-- ROWS.
--   get_field_provenance(uuid,text): field_observations gains one term, before its observation_is_public term:
--     (select privileged from viewer) OR NOT (coalesce(o.structured_data,'{}') @> ANY (active structured_match rows))
--   privileged is the service role, or a signed-in caller for whom vehicle_viewer_tied(p_vehicle_id) holds: the
--   policy's own tie (vehicle_viewer_tied(vehicle_id), and o.vehicle_id = p_vehicle_id here). The rule rows are read at
--   call time, so a new shape row closes this reader with no function change. Every CTE below field_observations
--   (image_observations, readable_observations, coverage) reads from it, so one term covers them. Cached image property
--   projections (cached_byok_property_projection_v1, analysis_kind image_property_projection) do not match the seed
--   shape and stay: they are the reading's sanitized children, gated on their source reading as before.
--   private_row_policy_copies (get_field_provenance, vehicle_observations): re-recorded at the post-105000 hash
--   f4734055d77f4339f1005e010450dc58 (11 SELECT/ALL policies). Computed 2026-11-25 on PG17 from the 10 live policy rows
--   (which give the recorded 16c9e48f... by the same method) plus vo_private_shape_read as 105000 deparses it. The
--   migration refuses any other live hash.
--
-- ORDER. After 20261126105000 (the guard below refuses without its table and policy). The body is anchored on the live
-- prosrc sha256 deb01cff... (read 2026-11-25; the fixture chain ending at 20261125211500 reproduces it).
--
-- CONTRACT: supabase/sql/test_field_provenance_private_shapes.sql.
-- REVERT: supabase/sql/revert_20261126110500_field_provenance_private_shapes.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regclass('public.vehicle_observation_private_shapes') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_observations'
                     AND policyname = 'vo_private_shape_read' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'vehicle_observation_private_shapes and vo_private_shape_read (20261126105000) are not live; apply it first';
  END IF;
END
$guard$;

DO $patch$
DECLARE
  d text;
  anchor text := $a$      and (public.observation_is_public(o.kind,o.structured_data)$a$;
  term text := $t$      -- private_shape_rows_v1 (20261126110500): vo_private_shape_read (RESTRICTIVE) hides a row whose structured_data
      -- contains an active vehicle_observation_private_shapes match from a caller not tied to the vehicle.
      and ((select privileged from viewer)
        or not (coalesce(o.structured_data,'{}'::jsonb) @> any (array(select s.structured_match
              from public.vehicle_observation_private_shapes s where s.active))))
$t$;
BEGIN
  d := pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
  IF position('private_shape_rows_v1' IN d) > 0 THEN RETURN; END IF;   -- applied
  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_proc p
       WHERE p.oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
       IS DISTINCT FROM 'deb01cff80782e411b1b0e22b7cde9209249f9e8aa1f25545b18c8dbd00900aa'
     OR (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'get_field_provenance changed since 2026-11-25 (prosrc deb01cff...); re-read it before adding the shape term';
  END IF;
  EXECUTE replace(d, anchor, term || anchor);
END
$patch$;

DO $copy$
DECLARE h text; n int;
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NULL THEN RETURN; END IF;
  SELECT x.policy_hash, x.policies INTO h, n
    FROM public.private_row_policy_hash('vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')') x;
  IF h IS DISTINCT FROM 'f4734055d77f4339f1005e010450dc58' AND current_database() NOT LIKE 'dm_%' THEN
    RAISE EXCEPTION 'vehicle_observations read policies are % (% policies), not the 105000 state f4734055...; re-read get_field_provenance before recording', h, n;
  END IF;
  UPDATE public.private_row_policy_copies
     SET recorded_hash = h, recorded_at = now(),
         note = '#3915 restates the vehicle_observations read policies (vo_authenticated_read and the restrictive ones) in the '
                || 'definer body; 20261126110500 adds vo_private_shape_read (vehicle_observation_private_shapes rows, read at call time)'
   WHERE reader = 'get_field_provenance(uuid,text)' AND relation = 'vehicle_observations'
     AND policy_filter = 'p.cmd IN (''SELECT'', ''ALL'')';
END
$copy$;
COMMIT;
