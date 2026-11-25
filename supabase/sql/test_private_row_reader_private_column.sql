-- Contract: 20261126014900 private_row_private_column_v1, on the reader-probe fixture after the budget watch and the policy-copy section (whose assay
-- body is production's, prosrc md5 checked). A private_column probe samples rows holding a value and counts the values
-- each audience reads: exposed while anon or authenticated can select the column, 0 once the column grant narrows
-- (42501 read as denied), 0 for an audience the policies hide the rows from; a column with no value samples nothing;
-- an absent column reads missing and the assay still returns; three columns of one table are three readings; every
-- other probe reads as before; the kind takes no reader; the patch applies once and refuses an unknown body.
-- Synthetic rows. Disposable PG17 only.
\ir test_private_row_reader_watch_budget.sql
\ir ../migrations/20261125204500_private_row_policy_copy_drift.sql
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.assay_private_row_exposure()'::regprocedure)
     <> '146b7575e2794b8892d083ac86e125f8' THEN
    RAISE EXCEPTION 'FAIL: fixture assay is not production''s body';
  END IF;
END $$;
CREATE TABLE public._before_pc AS SELECT public.assay_private_row_exposure() AS r;

CREATE TABLE public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  notes text, trust_factors jsonb, species_evidence text);
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY obs_read ON public.observation_sources FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.observation_sources TO anon, authenticated;
INSERT INTO public.observation_sources (name, notes, trust_factors)
SELECT 'source ' || g, CASE WHEN g <= 40 THEN 'internal note ' || g END, CASE WHEN g <= 30 THEN '{"w": 1}'::jsonb END
  FROM generate_series(1, 60) g;

\ir ../migrations/20261126014900_private_row_private_column.sql
\ir ../migrations/20261126014900_private_row_private_column.sql

INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, owner_lane, note, audiences, sample_size)
VALUES (30, 'observation_sources', 'id', 'private_column', 'notes', 'test', 'internal notes: no value to anon or authenticated', '{anon,authenticated}', 50),
       (30, 'observation_sources', 'id', 'private_column', 'trust_factors', 'test', 'internal weights: no value to anon or authenticated', '{anon,authenticated}', 50),
       (30, 'observation_sources', 'id', 'private_column', 'species_evidence', 'test', 'internal evidence: no value to anon or authenticated', '{anon,authenticated}', 50);

DO $$
DECLARE r jsonb; b jsonb; e jsonb; d text; msg text;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF (length(d) - length(replace(d, 'private_row_private_column_v1', ''))) / length('private_row_private_column_v1') <> 1 THEN
    RAISE EXCEPTION 'FAIL: patch not applied exactly once';
  END IF;

  -- the kind takes no reader
  BEGIN
    INSERT INTO public.private_row_probes (rank, relation, row_key, subject_kind, subject_column, reader, owner_lane, note)
    VALUES (31, 'observation_sources', 'id', 'private_column', 'notes', 'slow_feed', 'test', 'a reader on a column probe');
    RAISE EXCEPTION 'FAIL: private_column accepted a reader';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- before the narrowing: every value exposed, per column, per audience
  r := public.assay_private_row_exposure();
  SELECT x INTO e FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' = 'observation_sources.notes';
  IF e IS NULL OR (e->>'private_sampled')::int <> 40 OR (e->'visible'->>'anon')::int <> 40
     OR (e->'visible'->>'authenticated')::int <> 40 OR NOT (e->>'exposed')::boolean THEN
    RAISE EXCEPTION 'FAIL: notes before narrowing %', e;
  END IF;
  SELECT x INTO e FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' = 'observation_sources.trust_factors';
  IF e IS NULL OR (e->>'private_sampled')::int <> 30 OR (e->'visible'->>'authenticated')::int <> 30 THEN
    RAISE EXCEPTION 'FAIL: trust_factors before narrowing %', e;
  END IF;
  SELECT x INTO e FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' = 'observation_sources.species_evidence';
  IF e IS NULL OR (e->>'private_sampled')::int <> 0 OR (e->>'exposed')::boolean THEN
    RAISE EXCEPTION 'FAIL: a column with no value %', e;
  END IF;
  IF NOT r->'exposed' @> '["observation_sources.notes", "observation_sources.trust_factors"]'::jsonb
     OR r->'exposed' @> '["observation_sources.species_evidence"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: exposed list %', r->'exposed';
  END IF;

  -- every other probe reads as before the patch (ms aside)
  SELECT x.r INTO b FROM public._before_pc x;
  IF (SELECT jsonb_agg(x - 'ms' ORDER BY (x - 'ms')::text) FROM jsonb_array_elements(r->'relations') x
       WHERE x->>'relation' NOT LIKE 'observation_sources.%')
     <> (SELECT jsonb_agg(x - 'ms' ORDER BY (x - 'ms')::text) FROM jsonb_array_elements(b->'relations') x) THEN
    RAISE EXCEPTION 'FAIL: other readings changed by the patch';
  END IF;

  -- the policies hide every row from anon: anon 0, authenticated still exposed
  DROP POLICY obs_read ON public.observation_sources;
  CREATE POLICY obs_read ON public.observation_sources FOR SELECT TO authenticated USING (true);
  r := public.assay_private_row_exposure();
  SELECT x INTO e FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' = 'observation_sources.notes';
  IF (e->'visible'->>'anon')::int <> 0 OR (e->'visible'->>'authenticated')::int <> 40 OR NOT (e->>'exposed')::boolean THEN
    RAISE EXCEPTION 'FAIL: policy-hidden rows %', e;
  END IF;

  -- the narrowing: the row stays readable, the internal columns do not; every reading 0, nothing exposed
  REVOKE SELECT ON public.observation_sources FROM anon, authenticated;
  GRANT SELECT (id, name) ON public.observation_sources TO anon, authenticated;
  r := public.assay_private_row_exposure();
  FOR e IN SELECT x FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' LIKE 'observation_sources.%' LOOP
    IF (e->'visible'->>'anon')::int <> 0 OR (e->'visible'->>'authenticated')::int <> 0 OR (e->>'exposed')::boolean THEN
      RAISE EXCEPTION 'FAIL: after narrowing %', e;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' LIKE 'observation_sources.%') <> 3 THEN
    RAISE EXCEPTION 'FAIL: three columns are not three readings';
  END IF;

  -- an absent column reads missing; the assay still returns
  ALTER TABLE public.observation_sources DROP COLUMN species_evidence;
  r := public.assay_private_row_exposure();
  SELECT x INTO e FROM jsonb_array_elements(r->'relations') x WHERE x->>'relation' = 'observation_sources.species_evidence';
  IF e IS NULL OR NOT coalesce((e->>'missing')::boolean, false) THEN
    RAISE EXCEPTION 'FAIL: absent column %', e;
  END IF;
END $$;

-- the patch refuses an assay body it does not know
CREATE OR REPLACE FUNCTION public.assay_private_row_exposure() RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126014900_private_row_private_column.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF public.assay_private_row_exposure() <> '{}'::jsonb THEN RAISE EXCEPTION 'FAIL: assay patched over an unknown body'; END IF;
END $$;
SELECT 'private_row_private_column: ok';
