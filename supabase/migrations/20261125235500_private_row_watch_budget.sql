-- private_row_watch_budget_v1: the hourly private-row exposure watch gets a time budget, so it always returns a reading.
--
-- WHY. The cron job private-row-exposure-watch runs as postgres, whose role statement_timeout is 10 s. Its run time
-- went 2.3 -> 3.4 -> 3.8 s as probes were added on 2026-11-25, and the 10:41Z run was cancelled at 10.005 s inside
-- get_image_deep_analysis (the 19th probe): no reading at all, while a by-hand run of the same probes one by one at
-- 10:52Z summed to about 7 s warm (get_field_provenance's key sample 1.3 s, image_spatial_metadata as a stranger 1.1 s).
-- Under the :41 IO load the whole loop sits at the cap.
--
-- WHAT (anchor patches on the live assay body, marker-guarded; the policy-copy section of 20261125204500 keeps its
-- anchor, the RETURN line, untouched):
--   1. Budget: before each probe, if the assay has run longer than private_row.budget_ms (session setting; default 5000)
--      the probe is not run and is listed in not_assessed. A probe started inside the budget has the remaining ~5 s
--      of the 10 s cap; the slowest warm probe measured is 1.7 s.
--   2. Rotation: probes run in (rank order + hour of day) modulo their count, so the probes left past the budget change
--      every hour instead of always being the same tail.
--   3. The result carries not_assessed (labels). private_row_exposure_watch raises when any relation is exposed or any
--      is not assessed, naming them: an unread probe is not a green reading.
-- The budget is a setting so the contract can force it to 0; production never sets it.
--
-- TEST. supabase/sql/test_private_row_reader_watch_budget.sql (runs test_private_row_reader_probes.sql first).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $patch$
DECLARE
  d text;
  a1 text := $a$  priv text; sub text; t0 timestamptz := clock_timestamp(); err text; aud_out jsonb; label text; ids jsonb; returned int;$a$;
  r1 text := $r$  priv text; sub text; t0 timestamptz := clock_timestamp(); err text; aud_out jsonb; label text; ids jsonb; returned int;
  -- private_row_watch_budget_v1
  skipped text[] := '{}';
  budget interval := make_interval(secs => coalesce(CASE WHEN current_setting('private_row.budget_ms', true) ~ '^\d{1,6}$'
                                                         THEN current_setting('private_row.budget_ms', true)::int END, 5000) / 1000.0);$r$;
  a2 text := $a$  FOR p IN SELECT * FROM public.private_row_probes WHERE active ORDER BY rank, relation, reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;$a$;
  r2 text := $r$  FOR p IN SELECT q.* FROM (SELECT x.*, row_number() OVER (ORDER BY x.rank, x.relation, x.reader) AS rot_n,
                                     count(*) OVER () AS rot_count
                                FROM public.private_row_probes x WHERE x.active) q
            ORDER BY (q.rot_n + extract(hour FROM now())::int) % q.rot_count, q.rank, q.relation, q.reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;
    IF clock_timestamp() - t0 > budget THEN
      IF NOT label = ANY (skipped) THEN skipped := skipped || label; END IF;
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane, 'not_assessed', true);
      CONTINUE;
    END IF;$r$;
  a3 text := $a$                            'probes', jsonb_array_length(per), 'relations', per,$a$;
  r3 text := $r$                            'probes', jsonb_array_length(per), 'relations', per, 'not_assessed', to_jsonb(skipped),$r$;
  pair record;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF position('private_row_watch_budget_v1' IN d) > 0 THEN RETURN; END IF;
  FOR pair IN SELECT * FROM (VALUES (a1, r1), (a2, r2), (a3, r3)) v(a, r) LOOP
    IF (length(d) - length(replace(d, pair.a, ''))) / length(pair.a) <> 1 THEN
      RAISE EXCEPTION 'private_row_watch_budget: anchor drifted (% matches): %', (length(d) - length(replace(d, pair.a, ''))) / length(pair.a), left(pair.a, 60);
    END IF;
    d := replace(d, pair.a, pair.r);
  END LOOP;
  EXECUTE d;
END
$patch$;

CREATE OR REPLACE FUNCTION public.private_row_exposure_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb; msg text; unread text;
BEGIN
  r := public.assay_private_row_exposure();
  SELECT string_agg(x, ', ') INTO unread FROM jsonb_array_elements_text(coalesce(r->'not_assessed', '[]'::jsonb)) x;
  IF (r->>'exposed_relations')::int > 0 THEN
    SELECT string_agg(format('%s [%s] anon %s, stranger %s of %s', x->>'relation', x->>'owner',
                             coalesce(x#>>'{visible,anon}', '-'), coalesce(x#>>'{visible,authenticated}', '-'), x->>'private_sampled'), '; ')
      INTO msg FROM jsonb_array_elements(r->'relations') x WHERE (x->>'exposed')::boolean;
    msg := msg || CASE WHEN unread IS NULL THEN '' ELSE '; not assessed (time budget): ' || unread END;
    RAISE EXCEPTION 'private rows readable in % of % relations: %', r->>'exposed_relations', r->>'probed_relations', msg;
  END IF;
  IF unread IS NOT NULL THEN
    RAISE EXCEPTION 'private rows: % relations not assessed within the time budget (% ms): %', jsonb_array_length(r->'not_assessed'),
      r->>'ms', unread;
  END IF;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.private_row_exposure_watch() FROM PUBLIC, anon, authenticated;
