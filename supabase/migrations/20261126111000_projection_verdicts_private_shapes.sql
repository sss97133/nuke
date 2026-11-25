-- retained_projection_verdicts_for honours vehicle_observation_private_shapes (private_shape_rows_v1).
--
-- WHY. retained_projection_verdicts_for (20261126063500, SECURITY DEFINER, anon EXECUTE) returns a stored verdict only
-- when anon could read the projection's source observation p; it restates that read in its body and registers the
-- copy in private_row_policy_copies (vehicle_observations, hash 16c9e48f...). 20261126105000 adds a RESTRICTIVE read
-- policy, vo_private_shape_read: a row matching an active vehicle_observation_private_shapes row is read only by a
-- viewer tied to the vehicle, so never by anon. Without this the copy is stale (the exposure watch reads it red) and a
-- shape row that matches a source listing would leave the direct call an oracle on it. The seed shape (image_deep_byok)
-- matches no source a verdict has: p is a retained listing (kind listing, html_match). The term reads the rule rows at
-- call time, so a later shape row closes the read with no function change.
--
-- ROWS.
--   retained_projection_verdicts_for(uuid[]): two terms before the private-method term, on the source p and on the
--   projection o (whose id is the input, so a shape row matching projections closes the direct call on them too):
--     AND NOT (coalesce(p.structured_data,'{}') @> ANY (active structured_match rows)), and the same on o
--   (anon is never tied, so there is no tied branch; the reader vehicle_facet_items already checks the caller's own
--   read of the source observation under RLS, which the policy now covers.)
--   private_row_policy_copies (retained_projection_verdicts_for, vehicle_observations): re-recorded at the post-105000
--   hash f4734055d77f4339f1005e010450dc58, the same state 20261126110500 records for get_field_provenance; any other
--   live hash is refused.
--
-- ORDER. After 20261126063500 (anchored on its verdicts_for prosrc sha256 734adc8a...) and 20261126105000 (guarded).
-- CONTRACT: supabase/sql/test_retained_projection_verdicts_private_shapes.sql.
-- REVERT: supabase/sql/revert_20261126111000_projection_verdicts_private_shapes.sql.
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
  IF to_regprocedure('public.retained_projection_verdicts_for(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'retained_projection_verdicts_for (20261126063500) is not live; apply it first';
  END IF;
END
$guard$;

DO $patch$
DECLARE
  d text;
  anchor text := $a$     AND coalesce(p.extraction_method, '') <> ALL (ARRAY['garage_owner_correction_v1', 'owner_statement_v1',$a$;
  term text := $t$     -- private_shape_rows_v1 (20261126111000): vo_private_shape_read hides a row matching an active
     -- vehicle_observation_private_shapes row from anon: neither the source p nor the projection o may match one
     AND NOT (coalesce(p.structured_data, '{}'::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))
     AND NOT (coalesce(o.structured_data, '{}'::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))
$t$;
BEGIN
  d := pg_get_functiondef('public.retained_projection_verdicts_for(uuid[])'::regprocedure);
  IF position('private_shape_rows_v1' IN d) > 0 THEN RETURN; END IF;   -- applied
  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_proc p
       WHERE p.oid = 'public.retained_projection_verdicts_for(uuid[])'::regprocedure)
       IS DISTINCT FROM '734adc8a68acff3a9af32aaa73bf6bd1365765e1509e4b684faece75542bf62d'
     OR (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'retained_projection_verdicts_for changed since 20261126063500 (prosrc 734adc8a...); re-read it before adding the shape term';
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
    RAISE EXCEPTION 'vehicle_observations read policies are % (% policies), not the 105000 state f4734055...; re-read retained_projection_verdicts_for before recording', h, n;
  END IF;
  UPDATE public.private_row_policy_copies
     SET recorded_hash = h, recorded_at = now(),
         note = '20261126063500 restates the anon read of the source observation (vo_authenticated_read public term, '
                || 'vo_public_broadcast_read, the four restrictive private-method policies); 20261126111000 adds '
                || 'vo_private_shape_read (vehicle_observation_private_shapes rows, read at call time) on the source p and the projection o'
   WHERE reader = 'retained_projection_verdicts_for(uuid[])' AND relation = 'vehicle_observations'
     AND policy_filter = 'p.cmd IN (''SELECT'', ''ALL'')';
END
$copy$;
COMMIT;
