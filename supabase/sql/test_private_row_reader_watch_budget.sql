-- Contract: 20261125235500 private_row_watch_budget_v1. On the reader-probe fixture: with the default budget every probe
-- is assessed and the readings equal the unpatched assay's; with the budget at 0 no probe runs, every one is listed
-- not assessed, and the watch raises naming them; the patch applies once; the rotation visits every probe. Synthetic rows.
\ir test_private_row_reader_probes.sql
CREATE TABLE public._before AS SELECT public.assay_private_row_exposure() AS r;
\ir ../migrations/20261125235500_private_row_watch_budget.sql
\ir ../migrations/20261125235500_private_row_watch_budget.sql

DO $$
DECLARE r jsonb; b jsonb; d text; n int; msg text;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF (length(d) - length(replace(d, 'private_row_watch_budget_v1', ''))) / length('private_row_watch_budget_v1') <> 1 THEN
    RAISE EXCEPTION 'FAIL: patch not applied exactly once';
  END IF;

  -- default budget: every probe assessed, the same readings as before the patch (order aside)
  r := public.assay_private_row_exposure();
  SELECT x.r INTO b FROM public._before x;
  IF jsonb_array_length(r->'not_assessed') <> 0 THEN RAISE EXCEPTION 'FAIL: default budget skipped %', r->'not_assessed'; END IF;
  IF r->'exposed_relations' <> b->'exposed_relations' OR r->'probes' <> b->'probes'
     OR (SELECT jsonb_agg(e ORDER BY e::text) FROM jsonb_array_elements(r->'relations') e)
        <> (SELECT jsonb_agg(e ORDER BY e::text) FROM jsonb_array_elements(b->'relations') e) THEN
    RAISE EXCEPTION 'FAIL: readings changed by the patch';
  END IF;
  -- the loop visits probes in the rotated order: the first reading is the probe the hour of day puts first
  IF r->'relations'->0->>'relation' IS DISTINCT FROM (
       SELECT CASE WHEN x.reader = '' THEN x.relation ELSE x.reader || '()' END
         FROM (SELECT p.*, row_number() OVER (ORDER BY p.rank, p.relation, p.reader) rot_n, count(*) OVER () rot_count
                 FROM public.private_row_probes p WHERE p.active) x
        ORDER BY (x.rot_n + extract(hour FROM now())::int) % x.rot_count, x.rank, x.relation, x.reader LIMIT 1) THEN
    RAISE EXCEPTION 'FAIL: first probe % is not the rotated first', r->'relations'->0->>'relation';
  END IF;

  -- budget 0: nothing runs, every probe listed, none counted exposed
  PERFORM set_config('private_row.budget_ms', '0', true);
  r := public.assay_private_row_exposure();
  SELECT count(*) INTO n FROM public.private_row_probes WHERE active;
  IF jsonb_array_length(r->'relations') <> n OR (r->>'exposed_relations')::int <> 0
     OR jsonb_array_length(r->'not_assessed') <> (SELECT count(DISTINCT CASE WHEN reader = '' THEN relation ELSE reader || '()' END)
                                                    FROM public.private_row_probes WHERE active)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'relations') e WHERE NOT coalesce((e->>'not_assessed')::boolean, false)) THEN
    RAISE EXCEPTION 'FAIL: budget 0 still ran probes: %', r;
  END IF;
  BEGIN
    PERFORM public.private_row_exposure_watch();
    RAISE EXCEPTION 'FAIL: watch green with nothing assessed';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%not assessed within the time budget%' OR msg LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  PERFORM set_config('private_row.budget_ms', '', true);
END $$;

-- rotation: across 24 hours every probe is first at least once when there are at most 24 active probes
DO $$
DECLARE firsts int;
BEGIN
  SELECT count(DISTINCT first) INTO firsts FROM (
    SELECT h, (SELECT concat_ws('|', x.rank, x.relation, x.reader, x.subject_kind, x.subject_column) FROM (SELECT p.*, row_number() OVER (ORDER BY p.rank, p.relation, p.reader) rot_n,
                       count(*) OVER () rot_count FROM public.private_row_probes p WHERE p.active) x
               ORDER BY (x.rot_n + h) % x.rot_count, x.rank, x.relation, x.reader LIMIT 1) first
    FROM generate_series(0, 23) h) s;
  IF firsts <> least(24, (SELECT count(*) FROM public.private_row_probes WHERE active)) THEN
    RAISE EXCEPTION 'FAIL: rotation leads with only % distinct probes', firsts;
  END IF;
END $$;
SELECT 'private_row_watch_budget: ok';
