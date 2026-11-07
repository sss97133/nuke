-- Retire capture_sets_score_evidence: the second capture-set scorer that nothing called.
--
-- Why (owner, 2026-11-07): two scorers existed for the same question. capture_sets_score_evidence (20261108140000 / #3005,
-- 5 args) carried the lettering legs (badge, make, model family) and identity-filed anchors; capture_sets_score (v3, 6 args,
-- 20261109000200) is what the landing pipeline calls (capture_landing_plan_step). Measured live: no function, cron job,
-- view or repo caller references the evidence scorer (pg_proc prosrc, cron.job, pg_views, pg_depend: 0; repo: only the
-- migrations that created or mentioned it). Its CTEs are a subset of v3's once 20261111120000 (lettering legs) and
-- 20261111130000 (gate-passed filings as anchors) landed: g, seg, roster, anc, vsim, vveh, vis, plate, hist, sess, cell,
-- recent, vin, lines, badge, makeocr, cls, cand, sc, tot, tm; v3 adds work-session and continuity priors.
-- One scorer remains: capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb).
-- Revert: supabase/sql/revert_20261111150000_drop_capture_sets_score_evidence.sql (the body as read live).

SET lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.capture_sets_score_evidence(uuid, timestamptz, timestamptz, text, uuid[]);

DO $$
BEGIN
  IF to_regprocedure('public.capture_sets_score_evidence(uuid, timestamptz, timestamptz, text, uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'capture_sets_score_evidence still present';
  END IF;
  IF to_regprocedure('public.capture_sets_score(uuid, timestamptz, timestamptz, text, uuid[], jsonb)') IS NULL THEN
    RAISE EXCEPTION 'capture_sets_score v3 (the one scorer) is not live';
  END IF;
END $$;
