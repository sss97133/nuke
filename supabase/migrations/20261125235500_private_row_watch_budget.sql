-- private_row_watch_budget_v1: the hourly private-row exposure watch always returns a reading, inside a bounded job.
--
-- WHY. The cron job private-row-exposure-watch runs as postgres, whose role statement_timeout is 10 s. Its run time
-- went 2.3 -> 3.4 -> 3.8 s as probes were added on 2026-11-25, and the 10:41Z run was cancelled at 10.005 s inside
-- get_image_deep_analysis (the 19th probe): no reading at all. A by-hand run of the same probes one by one at 10:52Z
-- summed to about 7 s warm; the key samples are what grew under the :41 IO load (3-5 s cold against about 50 ms warm).
--
-- WHAT (lead ruling 2026-11-25: "30 s on the job plus the budget"):
--   1. The job: cron command 'SET client_min_messages = error; SET statement_timeout = '30s'; SELECT ...watch()'.
--      PG13+ applies a SET in a simple-query string to the statements after it (pg_cron sends the command that way):
--      under a 1 s default, 'SET statement_timeout = 3s; SELECT pg_sleep(2)' completes and pg_sleep(4) is cancelled at
--      3 s (PG17, 2026-11-25).
--   2. The budget: platform_config 'private_row_watch' {"budget_ms": 20000}. Before each probe, if the assay has run
--      longer than budget_ms, the probe is not run and is listed not_assessed. 20 s is about 3x the 7 s warm sum and 2x the
--      10 s run that was cancelled; it leaves 10 s of the 30 s cap for the last probe started.
--   3. The probe guard: each probe runs in a block that catches query_canceled. When the job's 30 s cap fires inside a
--      probe, that probe is recorded timed_out, every later probe not_assessed, and the assay still returns. A
--      shorter per-probe timeout is not possible: statement_timeout is armed once per top-level statement, and a
--      set_config of it inside a function does not bound the statements after it (PG17: 500 ms set, pg_sleep(2) ran
--      2.00 s). After a caught cancel nothing bounds the rest, so the assay stops probing.
--   4. Rotation: probes run in (rank order + hour of day) modulo their count, so the probes left past the budget change
--      every hour instead of always being the same tail.
--   5. private_row_exposure_watch raises 'private rows: exposed N of M probed, not assessed K: ...' when N or K is above
--      0, naming them: an unread probe is not a green reading. The result carries the same line.
-- Anchor patches on the live assay body, marker-guarded. The policy-copy section of 20261125204500 anchors on the RETURN
-- line, which this patch leaves in place, so the two apply in either order.
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
  timed_out text[] := '{}'; stop boolean := false;
  budget_ms int := coalesce((SELECT CASE WHEN c.config_value->>'budget_ms' ~ '^\d{1,6}$' THEN (c.config_value->>'budget_ms')::int END
                               FROM public.platform_config c WHERE c.config_key = 'private_row_watch'), 20000);$r$;
  a2 text := $a$  FOR p IN SELECT * FROM public.private_row_probes WHERE active ORDER BY rank, relation, reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;$a$;
  r2 text := $r$  FOR p IN SELECT q.* FROM (SELECT x.*, row_number() OVER (ORDER BY x.rank, x.relation, x.reader) AS rot_n,
                                     count(*) OVER () AS rot_count
                                FROM public.private_row_probes x WHERE x.active) q
            ORDER BY (q.rot_n + extract(hour FROM now())::int) % q.rot_count, q.rank, q.relation, q.reader LOOP
    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;
    IF stop OR clock_timestamp() - t0 > make_interval(secs => budget_ms / 1000.0) THEN
      IF NOT label = ANY (skipped) THEN skipped := skipped || label; END IF;
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane, 'not_assessed', true);
      CONTINUE;
    END IF;$r$;
  a3 text := $a$                            'probes', jsonb_array_length(per), 'relations', per,$a$;
  r3 text := $r$                            'probes', jsonb_array_length(per), 'relations', per, 'not_assessed', to_jsonb(skipped),
                            'timed_out', to_jsonb(timed_out), 'budget_ms', budget_ms,$r$;
  a4 text := $a$    keys := NULL;
    IF p.reader_args IS NULL THEN$a$;
  r4 text := $r$    BEGIN  -- probe guard: the job's statement_timeout firing here ends this probe and the probing
    keys := NULL;
    IF p.reader_args IS NULL THEN$r$;
  a5 text := $a$    END LOOP;
    IF hit AND NOT label = ANY (exposed) THEN$a$;
  r5 text := $r$    END LOOP;
    EXCEPTION WHEN query_canceled THEN
      stop := true;
      IF NOT label = ANY (timed_out) THEN timed_out := timed_out || label; END IF;
      IF NOT label = ANY (skipped) THEN skipped := skipped || label; END IF;
      per := per || jsonb_build_object('relation', label, 'kind', p.subject_kind, 'owner', p.owner_lane,
                                       'not_assessed', true, 'timed_out', true);
      CONTINUE;
    END;
    IF hit AND NOT label = ANY (exposed) THEN$r$;
  pair record;
BEGIN
  d := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  IF position('private_row_watch_budget_v1' IN d) > 0 THEN RETURN; END IF;
  FOR pair IN SELECT * FROM (VALUES (a1, r1), (a2, r2), (a3, r3), (a4, r4), (a5, r5)) v(a, r) LOOP
    IF (length(d) - length(replace(d, pair.a, ''))) / length(pair.a) <> 1 THEN
      RAISE EXCEPTION 'private_row_watch_budget: anchor drifted (% matches): %', (length(d) - length(replace(d, pair.a, ''))) / length(pair.a), left(pair.a, 60);
    END IF;
    d := replace(d, pair.a, pair.r);
  END LOOP;
  EXECUTE d;
END
$patch$;

REVOKE ALL ON FUNCTION public.assay_private_row_exposure() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('private_row_watch', '{"budget_ms": 20000}'::jsonb,
        'private_row_watch_budget_v1: assay_private_row_exposure() starts no probe after budget_ms; the job private-row-exposure-watch is capped at 30 s (statement_timeout in its command). 20000 = about 3x the 7 s warm sum and 2x the 10 s run cancelled at 10:41Z 2026-11-25. Migration 20261125235500.')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.private_row_exposure_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb; n int; m int; k int; line text; detail text;
BEGIN
  r := public.assay_private_row_exposure();
  -- per relation label: not assessed when any of its probes was skipped or timed out; probed otherwise (missing readers aside)
  SELECT count(*) FILTER (WHERE NOT unread AND NOT missing), count(*) FILTER (WHERE unread)
    INTO m, k
    FROM (SELECT e->>'relation' AS lbl,
                 bool_or(coalesce((e->>'not_assessed')::boolean, false)) AS unread,
                 bool_and(coalesce((e->>'missing')::boolean, false)) AS missing
            FROM jsonb_array_elements(r->'relations') e GROUP BY 1) s;
  n := (r->>'exposed_relations')::int;
  line := format('exposed %s of %s probed, not assessed %s', n, m, k);
  r := r || jsonb_build_object('line', line);
  IF n > 0 OR k > 0 THEN
    SELECT string_agg(format('%s [%s] anon %s, stranger %s of %s', x->>'relation', x->>'owner',
                             coalesce(x#>>'{visible,anon}', '-'), coalesce(x#>>'{visible,authenticated}', '-'),
                             coalesce(x->>'private_sampled', '-')), '; ')
      INTO detail FROM jsonb_array_elements(r->'relations') x WHERE coalesce((x->>'exposed')::boolean, false);
    detail := concat_ws('; ', detail,
      CASE WHEN k > 0 THEN 'not assessed (budget ' || (r->>'budget_ms') || ' ms, ran ' || (r->>'ms') || ' ms): '
                           || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(r->'not_assessed') x) END,
      CASE WHEN jsonb_array_length(coalesce(r->'timed_out', '[]')) > 0
           THEN 'timed out: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(r->'timed_out') x) END);
    RAISE EXCEPTION 'private rows: %: %', line, detail;
  END IF;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.private_row_exposure_watch() FROM PUBLIC, anon, authenticated;

-- the job carries its own bound: 30 s, above the 20 s budget plus the slowest probe measured cold (5 s)
SELECT cron.schedule('private-row-exposure-watch', '41 * * * *',
  $c$SET client_min_messages = error; SET statement_timeout = '30s'; SELECT public.private_row_exposure_watch()$c$);
