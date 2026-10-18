-- C25 follow-up: 20261001000500 landed v_residual and veins V010-V013 but its vein_runs insert failed on
-- n NOT NULL for V011 (the 0.6% archive sample's lot count was not kept on 2026-09-30; unknown is an answer, so
-- V011 gets no discovery run until it is rerun). The other three discovery runs, with their counts.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

INSERT INTO public.vein_runs (vein_id, version, sample, window_from, window_to, n, n_with, n_without, effect, verdict, counts, result, ran_by)
SELECT v.vein_id, 1, 'discovery', v.f, v.t, v.n, v.nw, v.nwo, v.eff, v.verdict, false, v.res, 'claude-code (Fable) for the owner, measured 2026-09-30'
FROM (VALUES
  ('V010', '2026-09-20'::date, '2026-09-30'::date, 400, 322, 78, 0.25::numeric, 'pass', '{"extended_pct": 80.5, "bids_in_chain_pct": 39, "price_made_median_pct": 25, "lots_closed_under_120s_after_last_bid": 0}'::jsonb),
  ('V012', '2026-09-30'::date, '2026-09-30'::date, 68957, 685, 68272, 0.14::numeric, 'inconclusive', '{"as_of": "2026-09-30", "top_1pct_share_of_lots_pct": 14.0, "note": "concentration measured over all settled lots as of the date; lift not yet measured, so the hypothesis is not graded"}'::jsonb),
  ('V013', '2026-09-30'::date, '2026-09-30'::date, 1, NULL, NULL, NULL, 'inconclusive', '{"lot": "SL500", "bid_pct": 25, "bids_pct": 81, "bidders_pct": 76, "note": "one lot; the comparables were keyed on a defective column (C5)"}'::jsonb)
) AS v(vein_id, f, t, n, nw, nwo, eff, verdict, res)
WHERE NOT EXISTS (SELECT 1 FROM public.vein_runs r WHERE r.vein_id = v.vein_id AND r.version = 1 AND r.sample = 'discovery');
-- Verify: select vein_id, n, verdict from vein_runs where vein_id in ('V010','V012','V013') and sample = 'discovery';  -- 3 rows
