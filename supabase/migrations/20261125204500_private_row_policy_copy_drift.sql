-- private_row_policy_copy_drift_v1: the exposure watch notices when a definer reader's copy of a table's read policies
-- goes stale.
--
-- WHY. A SECURITY DEFINER reader runs as postgres, so a table's row policies do not apply inside it; tonight's fixes
-- (20261125160500 get_image_deep_analysis / intake_live_state, #3915 get_field_provenance) restate those policies in
-- the function body. A later migration that adds or changes a policy on the table does not touch the function, so the
-- copy goes stale and nothing notices. A one-time guard in the migration checks one instant (lead ruling 2026-11-25);
-- this checks every hour.
--
-- ROWS. public.private_row_policy_copies: one row per (reader, relation, policy filter) with the hash of the policies
-- the copy was written against. The hash is md5 over the selected pg_policies rows of public.<relation>, ordered by
-- policyname: policyname, permissive, cmd, roles and qual joined by ':' and rows by '|'. (cmd and roles are included:
-- a policy widened from TO authenticated to TO public changes nothing else.) policy_filter is a predicate on
-- pg_policies (alias p) choosing which policies the copy restates.
--
-- ASSAY. assay_private_row_exposure() gets one more section (edited in place at its RETURN, anchor checked once): for
-- each active row it recomputes the live hash. A mismatch is counted as exposed, labelled
-- '<reader> policy copy of <relation>', so the hourly private-row-exposure-watch fails and names the function to
-- re-read. A reader that no longer exists is reported missing, not exposed. After re-reading, record the new hash in a
-- migration (UPDATE of the row) together with any change to the copy.
--
-- RECORDED. Measured live 2026-11-25 ~01:50 PT; the migration refuses to apply if any live hash differs, so the watch
-- starts from the state each copy was checked against:
--   get_field_provenance(uuid,text)   field_evidence        SELECT/ALL    2 policies  (skeptic2 checked #3915's copy
--                                     vehicle_observations  SELECT/ALL   10 policies   against these on 2026-11-25;
--                                     vehicle_field_sources SELECT/ALL    1 policy     every read rule the body restates,
--                                     observation_witnesses SELECT/ALL    1 policy     permissive and restrictive)
--   get_image_deep_analysis(uuid)     vehicle_images        SELECT/ALL    5 policies  (20261125160500's shown test)
--   intake_live_state(integer,integer) vehicle_images       SELECT/ALL    5 policies
--   intake_live_state(integer,integer) work_sessions        SELECT/ALL    3 policies
--
-- REVERT. supabase/sql/revert_20261125204500_private_row_policy_copy_drift.sql
-- TEST. supabase/sql/test_private_row_reader_policy_copy.sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.private_row_policy_copies (
  reader        text NOT NULL CHECK (reader ~ '^[a-z_][a-z0-9_]*\([a-z0-9_, ]*\)$'),
  relation      text NOT NULL CHECK (relation ~ '^[a-z_][a-z0-9_]*$'),
  policy_filter text NOT NULL CHECK (policy_filter <> '' AND position(';' IN policy_filter) = 0),
  recorded_hash text NOT NULL CHECK (recorded_hash ~ '^[0-9a-f]{32}$'),
  owner_lane    text NOT NULL,
  note          text NOT NULL CHECK (note <> ''),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  active        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (reader, relation, policy_filter)
);
ALTER TABLE public.private_row_policy_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_row_policy_copies FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.private_row_policy_copies IS
'private_row_policy_copy_drift_v1: a SECURITY DEFINER reader that restates a table''s read policies, with the hash of the policies its copy was written against; assay_private_row_exposure() counts a changed live hash as exposed. Migration 20261125204500.';

CREATE OR REPLACE FUNCTION public.private_row_policy_hash(p_relation text, p_policy_filter text)
RETURNS TABLE (policy_hash text, policies int) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $f$
BEGIN
  IF p_relation !~ '^[a-z_][a-z0-9_]*$' OR position(';' IN p_policy_filter) > 0 THEN
    RAISE EXCEPTION 'private_row_policy_hash: bad relation or filter';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT md5(string_agg(p.policyname || '':'' || p.permissive || '':'' || p.cmd || '':'' || p.roles::text || '':'' || coalesce(p.qual, ''''),
                           ''|'' ORDER BY p.policyname)), count(*)::int
       FROM pg_catalog.pg_policies p WHERE p.schemaname = ''public'' AND p.tablename = %L AND (%s)', p_relation, p_policy_filter);
END $f$;
REVOKE ALL ON FUNCTION public.private_row_policy_hash(text, text) FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note) VALUES
  ('get_field_provenance(uuid,text)', 'field_evidence', 'p.cmd IN (''SELECT'', ''ALL'')', '15d0adf6157e9a117db0acf9eb2f6a28',
   'ta-readers', '#3915 restates the field_evidence read policies in the definer body'),
  ('get_field_provenance(uuid,text)', 'vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')', '16c9e48fc1fbfbe5dc4ae10fe8947c7c',
   'ta-readers', '#3915 restates the vehicle_observations read policies (vo_authenticated_read and the restrictive ones) in the definer body'),
  ('get_field_provenance(uuid,text)', 'vehicle_field_sources', 'p.cmd IN (''SELECT'', ''ALL'')', 'f94521f7a825c2a01002b19d262b7353',
   'ta-readers', '#3915 restates vehicle_field_sources_read (public car or tied) in the definer body'),
  ('get_field_provenance(uuid,text)', 'observation_witnesses', 'p.cmd IN (''SELECT'', ''ALL'')', 'e6a01484953741fc9bb29becee17d4e2',
   'ta-readers', '#3915 restates public_derived_image_witness_read (gallery-eligible cited photo) in the definer body'),
  ('get_image_deep_analysis(uuid)', 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')', '3af9ebbc1bebf423e3bd1e0b7c45a194',
   'ta-pipeline', '20261125160500 restates the vehicle_images read policy (shown, is_sensitive, uploader, tied)'),
  ('intake_live_state(integer,integer)', 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')', '3af9ebbc1bebf423e3bd1e0b7c45a194',
   'ta-pipeline', '20261125160500 restates the vehicle_images read policy for the feed'),
  ('intake_live_state(integer,integer)', 'work_sessions', 'p.cmd IN (''SELECT'', ''ALL'')', '942389cb05d6ec9f220bd0c8bfbada50',
   'ta-pipeline', '20261125160500 restates the work_sessions read policies (author or tied) for sessions_today')
ON CONFLICT (reader, relation, policy_filter) DO NOTHING;

DO $g$ DECLARE c record; h text; n int; bad text := '';
BEGIN
  FOR c IN SELECT * FROM public.private_row_policy_copies LOOP
    SELECT policy_hash, policies INTO h, n FROM public.private_row_policy_hash(c.relation, c.policy_filter);
    IF h IS DISTINCT FROM c.recorded_hash THEN bad := bad || format(' %s/%s live %s (%s policies);', c.reader, c.relation, h, n); END IF;
  END LOOP;
  IF bad <> '' AND current_database() NOT LIKE 'dm_%' THEN
    RAISE EXCEPTION 'policy copies differ from the recorded state, re-read before recording:%', bad;
  END IF;
END $g$;

-- the assay section, inserted before its RETURN (anchor must occur exactly once; idempotent by marker)
DO $p$
DECLARE d text; anchor text := E'  RETURN jsonb_build_object(''exposed_relations''';
        section text := $s$
  -- private_row_policy_copy_drift_v1
  DECLARE c record; h text; n int;
  BEGIN
    FOR c IN SELECT * FROM public.private_row_policy_copies WHERE active ORDER BY reader, relation LOOP
      label := c.reader || ' policy copy of ' || c.relation;
      IF to_regprocedure('public.' || c.reader) IS NULL THEN
        per := per || jsonb_build_object('relation', label, 'kind', 'policy_copy', 'owner', c.owner_lane, 'missing', true, 'exposed', false);
        CONTINUE;
      END IF;
      SELECT policy_hash, policies INTO h, n FROM public.private_row_policy_hash(c.relation, c.policy_filter);
      hit := h IS DISTINCT FROM c.recorded_hash;
      per := per || jsonb_build_object('relation', label, 'kind', 'policy_copy', 'owner', c.owner_lane, 'exposed', hit,
                                       'recorded', c.recorded_hash, 'live', h, 'policies', n, 'recorded_at', c.recorded_at);
      IF hit THEN exposed := exposed || label; END IF;
    END LOOP;
  END;
$s$;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF position('private_row_policy_copy_drift_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'assay_private_row_exposure anchor drifted: found % times', (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  END IF;
  EXECUTE replace(d, anchor, section || anchor);
END $p$;
REVOKE ALL ON FUNCTION public.assay_private_row_exposure() FROM PUBLIC, anon, authenticated, service_role;
