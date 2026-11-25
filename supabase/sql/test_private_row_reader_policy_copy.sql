-- Disposable PG17: 20261125204500 counts a definer reader's stale policy copy as exposed. Builds on the reader probe
-- contract (its fixture and both watch migrations). Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_private_row_reader_probes.sql
RESET ROLE;
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid);
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_sessions_author ON public.work_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_images_shown ON public.vehicle_images FOR SELECT USING (vehicle_id IS NOT NULL);

\ir ../migrations/20261125204500_private_row_policy_copy_drift.sql
\ir ../migrations/20261125204500_private_row_policy_copy_drift.sql
RESET lock_timeout; RESET statement_timeout;

DO $$
DECLARE r jsonb; x jsonb; d text; n int;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF (length(d) - length(replace(d, 'private_row_policy_copy_drift_v1', ''))) / length('private_row_policy_copy_drift_v1') <> 1 THEN
    RAISE EXCEPTION 'assay patched more or less than once'; END IF;
  IF (SELECT count(*) FROM public.private_row_policy_copies) <> 5 THEN RAISE EXCEPTION 'expected 5 copy rows'; END IF;

  -- record the fixture's own state, as a re-read would
  UPDATE public.private_row_policy_copies c
     SET recorded_hash = coalesce((SELECT h.policy_hash FROM public.private_row_policy_hash(c.relation, c.policy_filter) h), md5(''));
  r := public.assay_private_row_exposure();
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'relations') e WHERE e->>'kind' = 'policy_copy' AND (e->>'exposed')::boolean;
  -- relations with no policy at all hash to NULL; recorded as md5('') they read as drift, so only those count
  IF n <> (SELECT count(*) FROM public.private_row_policy_copies c, LATERAL public.private_row_policy_hash(c.relation, c.policy_filter) h
            WHERE h.policy_hash IS NULL AND to_regprocedure('public.' || c.reader) IS NOT NULL) THEN
    RAISE EXCEPTION 'unchanged copies read as drift: %', r->'relations'; END IF;

  -- the reader dropped by the base contract is reported missing, not exposed
  SELECT e INTO x FROM jsonb_array_elements(r->'relations') e WHERE e->>'relation' = 'get_image_deep_analysis(uuid) policy copy of vehicle_images';
  IF x IS NULL OR NOT coalesce((x->>'missing')::boolean, false) OR (x->>'exposed')::boolean THEN RAISE EXCEPTION 'missing reader: %', x; END IF;

  -- a new policy on vehicle_images makes intake_live_state's copy stale
  CREATE POLICY vehicle_images_new ON public.vehicle_images FOR SELECT TO anon USING (true);
  r := public.assay_private_row_exposure();
  IF NOT r->'exposed' ? 'intake_live_state(integer,integer) policy copy of vehicle_images' THEN
    RAISE EXCEPTION 'added policy not seen: %', r->'exposed'; END IF;
  DROP POLICY vehicle_images_new ON public.vehicle_images;
  r := public.assay_private_row_exposure();
  IF r->'exposed' ? 'intake_live_state(integer,integer) policy copy of vehicle_images' THEN RAISE EXCEPTION 'drop did not restore'; END IF;

  -- a change of roles alone (qual unchanged) is drift
  ALTER POLICY work_sessions_author ON public.work_sessions TO public;
  r := public.assay_private_row_exposure();
  IF NOT r->'exposed' ? 'intake_live_state(integer,integer) policy copy of work_sessions' THEN
    RAISE EXCEPTION 'roles change not seen: %', r->'exposed'; END IF;

  -- the watch names the function to re-read
  BEGIN
    PERFORM public.private_row_exposure_watch();
    RAISE EXCEPTION 'watch did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%intake_live_state(integer,integer) policy copy of work_sessions%' THEN RAISE; END IF;
  END;

  -- shape checks
  BEGIN
    INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
    VALUES ('x()', 'vehicles', 'true); select (1', md5('x'), 'test', 'injected filter');
    RAISE EXCEPTION 'filter CHECK admitted SQL';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
    VALUES ('x', 'vehicles', 'true', md5('x'), 'test', 'reader without a signature');
    RAISE EXCEPTION 'reader CHECK admitted a bare name';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

\ir revert_20261125204500_private_row_policy_copy_drift.sql
DO $$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN RAISE EXCEPTION 'revert left the table'; END IF;
  IF position('private_row_policy_copy_drift_v1' IN pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'revert left the assay section'; END IF;
  PERFORM public.assay_private_row_exposure();
END $$;
SELECT 'private_row_policy_copy_drift: ok';
