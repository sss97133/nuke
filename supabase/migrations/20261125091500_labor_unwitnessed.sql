-- labor_unwitnessed_v1: the total that is not witnessed is named for what it holds, and a part answered not fitted adds
-- no hours.
--
-- WHY. (1) labor_evidence_grade_policy.counts_in 'unwitnessed_purchase' now holds a photo-read stage
-- (photo_key_reading, 20261124223000) as well as bought parts, so the name is wrong (lead ruling 2026-11-24).
-- (2) Review case (2026-11-24): a stage-priced segment whose only evidence parts were all answered not fitted still
-- priced its stage range into with_unwitnessed_purchases, while its witnessed hours were a measured 0; a part seen not
-- installed is not unwitnessed work.
--
-- WHAT CHANGES.
--   labor_evidence_grade_policy  counts_in value 'unwitnessed_purchase' -> 'unwitnessed' (CHECK replaced; rows
--                                parts_bought and photo_key_reading updated, photo_key_reading's meaning reworded).
--   vehicle_labor_appraisal      every 'unwitnessed_purchase' literal -> 'unwitnessed' (13, counted), so
--                                segments[].counts_in reads 'unwitnessed'; totals gain with_unwitnessed and
--                                unwitnessed_segments; with_unwitnessed_purchases and unwitnessed_purchase_segments stay,
--                                equal, for one release.
--                                A piece-graded segment (no paper, no rule-set grade) whose evidence parts are all
--                                answered not fitted is not priced: hours null, status 'no evidence', graded_pieces
--                                carries not_fitted and unpriced = 'every evidence part answered not fitted'.
--                                graded_pieces gains not_fitted on every piece-graded segment.
-- Dry run against live 2026-11-24 (pg_temp copy): see the PR.
-- Test: supabase/sql/test_vehicle_labor_appraisal_unwitnessed.sql (PG17).
--
-- REVERT. Swap each anchor and replacement below and EXECUTE the body; set counts_in back and restore the CHECK.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.labor_evidence_grade_policy DROP CONSTRAINT IF EXISTS labor_evidence_grade_policy_counts_in_check;
UPDATE public.labor_evidence_grade_policy SET counts_in = 'unwitnessed' WHERE counts_in = 'unwitnessed_purchase';
ALTER TABLE public.labor_evidence_grade_policy ADD CONSTRAINT labor_evidence_grade_policy_counts_in_check
  CHECK (counts_in IN ('witnessed', 'unwitnessed', 'none'));
UPDATE public.labor_evidence_grade_policy
   SET meaning = replace(meaning, 'counted with unwitnessed purchases, not witnessed', 'counted as work not witnessed')
 WHERE grade = 'photo_key_reading';

DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  lit_old text := $l$'unwitnessed_purchase'$l$;
  lit_new text := $l$'unwitnessed'$l$;
  a_ver text := $a$  version text := 'vehicle_labor_appraisal/20261125073000.1';$a$;
  r_ver text := $r$  version text := 'vehicle_labor_appraisal/20261125091500.1';$r$;
  a_decl text := $a$  pf_n int; pu_n int; grade_fit text; grade_unw text; graded_j jsonb; /* labor_grade_rows_v1 */$a$;
  r_decl text := $r$  pf_n int; pu_n int; grade_fit text; grade_unw text; graded_j jsonb; /* labor_grade_rows_v1 */
  pn_n int; /* labor_unwitnessed_v1 */$r$;
  a_pp text := $a$          pf_n := coalesce(fit_n, 0);
          pu_n := coalesce(unw_n, 0);$a$;
  r_pp text := $r$          pf_n := coalesce(fit_n, 0);
          pu_n := coalesce(unw_n, 0);
          pn_n := coalesce(nofit_n, 0);$r$;
  a_cnt text := $a$          SELECT count(*) FILTER (WHERE q.yes), count(*) FILTER (WHERE NOT q.yes AND NOT q.no)
            INTO pf_n, pu_n$a$;
  r_cnt text := $r$          SELECT count(*) FILTER (WHERE q.yes), count(*) FILTER (WHERE NOT q.yes AND NOT q.no),
                 count(*) FILTER (WHERE q.no AND NOT q.yes)
            INTO pf_n, pu_n, pn_n$r$;
  a_gj text := $a$        graded_j := jsonb_build_object('fitted', pf_n, 'unwitnessed', pu_n)$a$;
  r_gj text := $r$        graded_j := jsonb_build_object('fitted', pf_n, 'unwitnessed', pu_n, 'not_fitted', pn_n)$r$;
  a_unp text := $a$    IF status = 'no evidence' THEN evid_grade := NULL; END IF; /* labor_grade_no_evidence_v1 */$a$;
  r_unp text := $r$    -- labor_unwitnessed_v1: every evidence part answered not fitted is no work, not unwitnessed work
    IF graded_j IS NOT NULL AND pf_n = 0 AND pu_n = 0 AND pn_n > 0 AND hours_min IS NOT NULL THEN
      hours_min := NULL;
      hours_typ := NULL;
      hours_max := NULL;
      status := 'no evidence';
      graded_j := graded_j || jsonb_build_object('unpriced', 'every evidence part answered not fitted');
    END IF;
    IF status = 'no evidence' THEN evid_grade := NULL; END IF; /* labor_grade_no_evidence_v1 */$r$;
  a_with text := $a$        'with_unwitnessed_purchases', CASE WHEN count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed')) > 0 THEN jsonb_build_object(
            'hours_min', sum((s ->> 'hours_min')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_typical', sum((s ->> 'hours_typical')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_max', sum((s ->> 'hours_max')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed'))) END,$a$;
  r_with text := $r$        'with_unwitnessed', CASE WHEN count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed')) > 0 THEN jsonb_build_object(
            'hours_min', sum((s ->> 'hours_min')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_typical', sum((s ->> 'hours_typical')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_max', sum((s ->> 'hours_max')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed'))) END,
        -- labor_unwitnessed_v1: the old name, equal, for one release
        'with_unwitnessed_purchases', CASE WHEN count(*) FILTER (WHERE c IN ('witnessed', 'unwitnessed')) > 0 THEN jsonb_build_object(
            'hours_min', sum((s ->> 'hours_min')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_typical', sum((s ->> 'hours_typical')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed')),
            'hours_max', sum((s ->> 'hours_max')::numeric) FILTER (WHERE c IN ('witnessed', 'unwitnessed'))) END,$r$;
  a_seg text := $a$        'unwitnessed_purchase_segments', count(*) FILTER (WHERE c = 'unwitnessed'),$a$;
  r_seg text := $r$        'unwitnessed_segments', count(*) FILTER (WHERE c = 'unwitnessed'),
        'unwitnessed_purchase_segments', count(*) FILTER (WHERE c = 'unwitnessed'),$r$;
  anchors text[];
  repls text[];
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  IF position('labor_unwitnessed_v1' IN d) > 0 THEN RETURN; END IF;
  IF position('labor_names_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'vehicle_labor_appraisal is not at 20261125073000; rebase this migration';
  END IF;
  n := (length(d) - length(replace(d, lit_old, ''))) / length(lit_old);
  IF n <> 13 THEN RAISE EXCEPTION 'labor unwitnessed: % unwitnessed_purchase literals, expected 13', n; END IF;
  d := replace(d, lit_old, lit_new);
  anchors := ARRAY[a_ver, a_decl, a_pp, a_cnt, a_gj, a_unp, a_with, a_seg];
  repls := ARRAY[r_ver, r_decl, r_pp, r_cnt, r_gj, r_unp, r_with, r_seg];
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF n <> 1 THEN RAISE EXCEPTION 'labor unwitnessed anchor % drifted: % matches', i, n; END IF;
    d := replace(d, anchors[i], repls[i]);
  END LOOP;
  EXECUTE d;
END $patch$;
