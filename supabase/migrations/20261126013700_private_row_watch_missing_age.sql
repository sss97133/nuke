-- private_row_watch_missing_age_v1: a probe or a recorded policy copy whose reader or relation never deploys fails the
-- hourly exposure watch by name once it has read 'missing' longer than a configured age.
--
-- WHY. assay_private_row_exposure() reads a probe whose relation, key column or reader is absent as 'missing', and the
-- policy-copy section (20261125204500) reads a copy whose reader is absent the same way; neither is exposed, and the
-- watch (20261125235500) neither counts nor raises on them. A row registered ahead of its reader is right (it is
-- watched from the minute the reader lands), but a reader that never lands leaves that row silent forever
-- (ta-skeptic2 on #3925, 2026-11-25; lead: an age limit as a config row).
--
-- WHAT.
--   1. platform_config 'private_row_watch' gains missing_after_hours = 72 when absent (the row 20261125235500 wrote).
--      72 h: a reader registered ahead of its PR has three days to deploy; longer is a dropped PR, not a queue.
--   2. private_row_exposure_watch() also lists, by name, every active probe added and every active copy recorded more
--      than missing_after_hours ago that reads missing now (same tests as the assay: relation or key column absent, or
--      reader absent; a copy's reader by to_regprocedure). Any such row fails the watch:
--      'private rows: exposed N of M probed, not assessed K, missing too long J: ...'. The result carries
--      missing_too_long (labels) and missing_after_hours.
--   3. private_row_policy_copies gains first_recorded_at (set once, backfilled from recorded_at): the age clock. A
--      re-record step (#3911, #3955 and any later policy migration) moves recorded_at on every copy current at that
--      moment, including one whose reader is absent, which would restart its 72 h each time (ta-skeptic2 on #3962).
-- The watch is replaced whole, guarded: only over the body 20261125235500 left (md5 7feabcc0..., computed on PG17 from
-- that migration's text, the text production executes) or this one.
--
-- ORDER. After 20261125204500 (private_row_policy_copies) and 20261125235500 (the budget watch); refuses otherwise.
-- TEST. supabase/sql/test_private_row_reader_watch_missing_age.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $o$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NULL OR to_regclass('public.platform_config') IS NULL THEN
    RAISE EXCEPTION 'private_row_watch_missing_age: deploy after 20261125204500 and 20261125235500';
  END IF;
END $o$;

ALTER TABLE public.private_row_policy_copies ADD COLUMN IF NOT EXISTS first_recorded_at timestamptz;
UPDATE public.private_row_policy_copies SET first_recorded_at = recorded_at WHERE first_recorded_at IS NULL;
ALTER TABLE public.private_row_policy_copies ALTER COLUMN first_recorded_at SET DEFAULT now(),
  ALTER COLUMN first_recorded_at SET NOT NULL;
COMMENT ON COLUMN public.private_row_policy_copies.first_recorded_at IS
  'When the copy was first registered; never moved by a re-record. The watch ages a copy whose reader is absent from it (20261126013700).';

UPDATE public.platform_config
   SET config_value = config_value || '{"missing_after_hours": 72}'::jsonb,
       description = coalesce(description, '') || ' missing_after_hours (20261126013700): an active probe or policy copy reading missing longer than this fails the watch by name; 72 h = three days for a reader registered ahead of its PR to deploy.',
       updated_at = now()
 WHERE config_key = 'private_row_watch' AND NOT config_value ? 'missing_after_hours';

DO $w$
DECLARE src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.private_row_exposure_watch()'::regprocedure);
BEGIN
  IF md5(src) <> '7feabcc070af1894cce8df83c69782c8' AND position('private_row_watch_missing_age_v1' IN src) = 0 THEN
    RAISE EXCEPTION 'private_row_exposure_watch body drifted (md5 %), re-read before replacing', md5(src);
  END IF;
  EXECUTE $body$
CREATE OR REPLACE FUNCTION public.private_row_exposure_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb; n int; m int; k int; j int; line text; detail text; stale text; missing_h int;
BEGIN
  -- private_row_watch_budget_v1
  -- private_row_watch_missing_age_v1
  r := public.assay_private_row_exposure();
  -- per relation label: not assessed when any of its probes was skipped or timed out; probed otherwise (missing readers aside)
  SELECT count(*) FILTER (WHERE NOT unread AND NOT missing), count(*) FILTER (WHERE unread)
    INTO m, k
    FROM (SELECT e->>'relation' AS lbl,
                 bool_or(coalesce((e->>'not_assessed')::boolean, false)) AS unread,
                 bool_and(coalesce((e->>'missing')::boolean, false)) AS missing
            FROM jsonb_array_elements(r->'relations') e GROUP BY 1) s;
  -- rows reading missing longer than the configured age (the assay's own tests, read from the catalog)
  missing_h := coalesce((SELECT CASE WHEN c.config_value->>'missing_after_hours' ~ '^\d{1,5}$'
                                     THEN (c.config_value->>'missing_after_hours')::int END
                           FROM public.platform_config c WHERE c.config_key = 'private_row_watch'), 72);
  SELECT string_agg(lbl, ', ' ORDER BY lbl), count(*) INTO stale, j FROM (
    SELECT DISTINCT CASE WHEN p.subject_kind = 'private_column' THEN p.relation || '.' || p.subject_column
                         WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END AS lbl
      FROM public.private_row_probes p
     WHERE p.active AND p.added_at < now() - make_interval(hours => missing_h)
       AND (NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                         WHERE a.attrelid = to_regclass(format('public.%I', p.relation)) AND a.attname = p.row_key
                           AND NOT a.attisdropped)
            -- a private_column probe (20261126014900) whose column is gone, renamed for instance, as the assay reads it
            OR (p.subject_kind = 'private_column' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                         WHERE a.attrelid = to_regclass(format('public.%I', p.relation)) AND a.attname = p.subject_column
                           AND NOT a.attisdropped))
            OR (p.reader <> '' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
                                                WHERE f.pronamespace = 'public'::regnamespace AND f.proname = p.reader)))
    UNION
    SELECT c.reader || ' policy copy of ' || c.relation
      FROM public.private_row_policy_copies c
     WHERE c.active AND c.first_recorded_at < now() - make_interval(hours => missing_h)
       AND to_regprocedure('public.' || c.reader) IS NULL) s;
  n := (r->>'exposed_relations')::int;
  line := format('exposed %s of %s probed, not assessed %s', n, m, k)
          || CASE WHEN j > 0 THEN format(', missing too long %s', j) ELSE '' END;
  r := r || jsonb_build_object('line', line, 'assessed_relations', m, 'not_assessed_relations', k,
                               'missing_too_long', coalesce(to_jsonb(string_to_array(stale, ', ')), '[]'::jsonb),
                               'missing_after_hours', missing_h);
  IF n > 0 OR k > 0 OR j > 0 THEN
    SELECT string_agg(format('%s [%s] anon %s, stranger %s of %s', x->>'relation', x->>'owner',
                             coalesce(x#>>'{visible,anon}', '-'), coalesce(x#>>'{visible,authenticated}', '-'),
                             coalesce(x->>'private_sampled', '-')), '; ')
      INTO detail FROM jsonb_array_elements(r->'relations') x WHERE coalesce((x->>'exposed')::boolean, false);
    detail := concat_ws('; ', detail,
      CASE WHEN k > 0 THEN 'not assessed (budget ' || (r->>'budget_ms') || ' ms, ran ' || (r->>'ms') || ' ms): '
                           || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(r->'not_assessed') x) END,
      CASE WHEN jsonb_array_length(coalesce(r->'timed_out', '[]')) > 0
           THEN 'timed out: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(r->'timed_out') x) END,
      CASE WHEN j > 0 THEN format('missing over %s h: %s', missing_h, stale) END);
    RAISE EXCEPTION 'private rows: %: %', line, detail;
  END IF;
  RETURN r;
END $function$
$body$;
END $w$;
REVOKE ALL ON FUNCTION public.private_row_exposure_watch() FROM PUBLIC, anon, authenticated;
COMMIT;
