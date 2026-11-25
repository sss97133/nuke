-- labor_witnessed_max_v1: a segment's witnessed_hours_max is the witnessed work only. When nothing in the segment is
-- witnessed it is null (unknown), never the stage max, and totals.witnessed.hours_max folds the known values only.
--
-- WHY. Review criterion C5 (2026-11-24), benched logged out after 20261124223000: totals.witnessed.hours_max equals
-- totals.with_unwitnessed_purchases.hours_max on every priced bench car (20d21fb0 247 = 247, e08bf694 24 = 24,
-- 83f6f033 48 = 48), because a segment whose pieces are bought but unanswered, or whose grade counts with unwitnessed
-- purchases, carried the stage max as its witnessed max. The ceiling (every bought part fitted) already prints as
-- with_unwitnessed_purchases.hours_max; copying it into the witnessed band made 0 witnessed pieces read as up to 40 h
-- witnessed.
--
-- WHAT CHANGES (anchored patch of the live body; nothing else in the read moves):
--   fitted share, nothing fitted / fitted with no book hours   witnessed max null (was the stage max)
--   fitted share, some fitted with book hours                  witnessed max = their book hours, and null when another
--                                                              fitted piece has no book hours (was greatest(stage max, them))
--   per piece, nothing fitted, pieces unanswered               witnessed max null (was the stage max)
--   no witnessed step, grade counts_in unwitnessed_purchase    witnessed max null (was the segment max)
--   totals.witnessed.hours_max   sum of the known values, null when none is known (was coalesce(sum, 0));
--   totals.witnessed.unknown_max_segments   new: priced segments whose witnessed max is unknown.
-- Witnessed min and typical, with_unwitnessed_purchases, grades and counts_in are unchanged.
-- Dry run against live 2026-11-24 (pg_temp copy): see the PR.
-- Test: supabase/sql/test_vehicle_labor_appraisal_witnessed_max.sql (PG17).
--
-- REVERT. Swap each anchor and replacement below and EXECUTE the body.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261125030000.1';$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261125033000.1';$r$;
  a_share text := $a$              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'not witnessed')
            WHEN (share_j->>'fitted_with_operation')::int = 0
              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'fitted, no book hours')
            ELSE jsonb_build_object('hours_min', wit_h, 'hours_typical', wit_h, 'hours_max', greatest(hours_max, wit_h)) END);$a$;
  r_share text := $r$              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', NULL, 'reason', 'not witnessed')
            WHEN (share_j->>'fitted_with_operation')::int = 0
              THEN jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', NULL, 'reason', 'fitted, no book hours')
            -- labor_witnessed_max_v1: the fitted pieces' book hours; unknown when a fitted piece has none
            ELSE jsonb_build_object('hours_min', wit_h, 'hours_typical', wit_h,
                   'hours_max', CASE WHEN (share_j->>'fitted_without_operation')::int = 0 THEN wit_h END) END);$r$;
  a_piece text := $a$          jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', hours_max, 'reason', 'not witnessed'));$a$;
  r_piece text := $r$          jsonb_build_object('hours_min', NULL, 'hours_typical', NULL, 'hours_max', NULL, 'reason', 'not witnessed'));$r$;
  a_seg text := $a$                                         ELSE (t.s ->> 'hours_max')::numeric END)$a$;
  r_seg text := $r$                                         WHEN coalesce(gp.counts_in, 'witnessed') = 'witnessed' THEN (t.s ->> 'hours_max')::numeric
                                         END)$r$;
  a_tot text := $a$            'hours_max', coalesce(sum((s ->> 'witnessed_hours_max')::numeric), 0),$a$;
  r_tot text := $r$            'hours_max', sum((s ->> 'witnessed_hours_max')::numeric),
            'unknown_max_segments', count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed_purchase')
                                                       AND coalesce(s -> 'witnessed_hours_max', 'null'::jsonb) = 'null'::jsonb),$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_witnessed_max_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_line_edges_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261125030000; rebase this migration';
  END IF;
  anchors := ARRAY[a_ver, a_share, a_piece, a_seg, a_tot];
  repls := ARRAY[r_ver, r_share, r_piece, r_seg, r_tot];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor witnessed max anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
