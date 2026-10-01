-- C25 (docs/ledger/theory/data-machine-cases.md §5): the residual view, and the four veins struck on 2026-09-30
-- registered in the vein ledger the C25/C26 commit opened (vein_ledger, vein_runs; 20261001120000).
--
-- The residual is the Prospector's input: tables with mass and no keys, no descriptions and no reader, still being
-- written (or idle). Read from v_schema_atlas, so it moves as keys and comments land.
-- MEASURED 2026-10-01 08:30Z: 236 non-empty tables with no key in or out, 221 of them with 0 described columns.
-- Fold freshness against cadence (the other half of §5's input) is unknown: pipeline_registry has no cadence column.
--
-- The four veins are the measurements of 2026-09-30 written as hypotheses with a pass rule, each with its discovery
-- run recorded (counts = false, as the ledger's convention: a hypothesis read from a sample is not confirmed by it).

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE VIEW public.v_residual AS
SELECT a.table_name,
       a.est_rows,
       a.heap_toast_bytes,
       a.n_cols,
       a.n_cols_described,
       a.writes_since_stats_reset,
       a.reads_since_stats_reset,
       a.last_write,
       a.writers_30d,
       a.crons_mentioning,
       CASE WHEN coalesce(a.writes_since_stats_reset, 0) > 0 THEN 'island_written' ELSE 'island_idle' END AS residual_kind
FROM public.v_schema_atlas a
WHERE coalesce(a.est_rows, 0) > 0
  AND coalesce(a.fk_in, 0) = 0
  AND coalesce(a.fk_out, 0) = 0
  AND coalesce(a.n_cols_described, 0) = 0
ORDER BY a.est_rows DESC;

COMMENT ON VIEW public.v_residual IS
  'C25 residual (Prospector input): non-empty tables with no foreign key in or out and no described column, from v_schema_atlas. residual_kind: island_written (writes since stats reset) or island_idle. Shrinks as keys and COMMENT ON land. Fold freshness against cadence is not here: pipeline_registry has no cadence column (2026-10-01).';

INSERT INTO public.vein_ledger (vein_id, version, family, hypothesis, intent, population, outcome, test, pass_rule, baseline, parameters, case_ref, registered_by)
VALUES
('V010', 1, 'bat_soft_close',
 'The soft-close chain is where BaT price is made: most lots extend, and the price made inside the chain is a material share of the final price.',
 'The owner, 2026-09-30: "final minutes is where all the action is ... it''s where the market is made."',
 'BaT lots settled (closed 12 h to 10 days before the run), with their bids in auction_comments.',
 'Extension rate; share of bids inside chains; price made in the chain as a share of the final price (median).',
 'Read-only chain function over each lot''s bid times: chain = maximal run of bids with gaps <= 2 min ending at the close.',
 'pass: extension rate >= 50% and median price made in chain >= 10% on a held-out sample of >= 200 lots. refuted: median price made < 5%.',
 'A lot with no chain: price made in the last 2 minutes = 0.',
 '{"extension_min": 2, "discovery": {"lots": 400, "extended": 322, "bids_in_chain": 5471, "bids": 14026, "price_made_median_pct": 25, "price_made_p90_pct": 78, "chain_median_bids": 14, "chain_median_minutes": 7}}'::jsonb,
 'C4', 'claude-code (Fable) for the owner, from the session of 2026-09-30'),
('V011', 1, 'bat_soft_close',
 'The extension rate is structural (stable by quarter) while chain size and price made in the chain swing between quarters: the chain carries the market signal, the rate does not.',
 'Separate the platform rule from the market: what moves is the signal.',
 'A 0.6% sample of the BaT archive, 2022 to 2026, by quarter.',
 'Per quarter: extension rate; median chain bids; median price made in chain.',
 'The chain function per lot, grouped by close quarter.',
 'pass: extension rate within 70-100% every quarter and max/min of median price made across quarters >= 1.5. refuted: price made varies less than 1.2x.',
 'Constant chain: the all-quarter median.',
 '{"discovery": {"sample_share": 0.006, "extension_rate_range_pct": [77, 100], "chain_bids_range": [6, 12], "price_made_range_pct": [15, 34]}}'::jsonb,
 'C4', 'claude-code (Fable) for the owner, from the session of 2026-09-30'),
('V012', 1, 'consequential_bidder',
 'Winning is concentrated: a small set of buyers takes a large share of lots, so a bidder''s record as of a date is a feature with lift on the outcome of the lots they enter.',
 'The owner, 2026-09-30: "when he shows up he''s never lost an auction ... we''ve got to know their behaviors."',
 'bat_listings.buyer_username over all settled lots; later, bidders keyed to external_identities.',
 'Share of lots won by the top 1% of buyers; entry lift on "closes above its cohort p75", shrunk toward 1.',
 'Level 1 record as of date; level 2 entry lift with shrinkage; backtest by replay.',
 'pass: top 1% share >= 5% of lots and, on held-out lots, lift of known closers > 1 with an 80% interval excluding 1. refuted: interval includes 1 on >= 500 entries.',
 'Lots entered by a bidder with no record: lift 1.',
 '{"discovery": {"distinct_buyers": 68957, "won_10_or_more": 685, "won_50_or_more": 39, "max_won": 703, "top_1pct_share_of_lots_pct": 14.0}}'::jsonb,
 'C6', 'claude-code (Fable) for the owner, from the session of 2026-09-30'),
('V013', 1, 'live_lot_temperature',
 'Activity at h hours to close (bids, bidders) placed against the cohort predicts the final price percentile beyond the bid percentile at h: price cold with activity hot ends warmer than its bid says.',
 'The live card: "running hot should show the metrics ... a spectrum calibrated by the entire group."',
 'Live BaT lots with >= 8 same-model comparables at h, read by bat-live-pull; comparables keyed on event time (C5).',
 'Rank correlation of activity percentile at h = 2 with final price percentile in the cohort, bid percentile held.',
 'live_lot_temperature(vehicle_id) replayed over closed lots at h = 2 from auction_comments and auction_events.',
 'pass: partial Spearman >= 0.2 on >= 300 held-out lots. refuted: <= 0.05.',
 'Bid percentile at h alone.',
 '{"h": 2, "discovery": {"lot": "SL500 2026-09-30", "bid": 10000, "bid_above_n": 68, "sold_comparables": 273, "bids": 38, "bidders": 15, "note": "comparables were keyed on hours_until_close, wrong on 54% of rows read; re-keyed in 20261001000200"}}'::jsonb,
 'C5', 'claude-code (Fable) for the owner, from the session of 2026-09-30')
ON CONFLICT (vein_id, version) DO NOTHING;

INSERT INTO public.vein_runs (vein_id, version, sample, window_from, window_to, n, n_with, n_without, effect, multiplier, welch_t, verdict, counts, result, ran_by)
SELECT v.vein_id, 1, 'discovery', v.f, v.t, v.n, v.nw, v.nwo, v.eff, NULL, NULL, v.verdict, false, v.res, 'claude-code (Fable) for the owner, measured 2026-09-30'
FROM (VALUES
  ('V010', '2026-09-20'::date, '2026-09-30'::date, 400, 322, 78, 0.25::numeric, 'pass', '{"extended_pct": 80.5, "bids_in_chain_pct": 39, "price_made_median_pct": 25, "lots_closed_under_120s_after_last_bid": 0}'::jsonb),
  ('V011', '2022-01-01'::date, '2026-09-30'::date, NULL, NULL, NULL, NULL, 'pass', '{"extension_rate_range_pct": [77, 100], "price_made_range_pct": [15, 34], "chain_bids_range": [6, 12], "note": "n per quarter not kept; the sample was 0.6% of the archive"}'::jsonb),
  ('V012', NULL, '2026-09-30'::date, 68957, 685, 68272, 0.14::numeric, 'inconclusive', '{"top_1pct_share_of_lots_pct": 14.0, "note": "concentration measured; lift not yet measured, so the hypothesis is not graded"}'::jsonb),
  ('V013', '2026-09-30'::date, '2026-09-30'::date, 1, NULL, NULL, NULL, 'inconclusive', '{"lot": "SL500", "bid_pct": 25, "bids_pct": 81, "bidders_pct": 76, "note": "one lot; the comparables were keyed on a defective column (C5)"}'::jsonb)
) AS v(vein_id, f, t, n, nw, nwo, eff, verdict, res)
WHERE NOT EXISTS (SELECT 1 FROM public.vein_runs r WHERE r.vein_id = v.vein_id AND r.version = 1 AND r.sample = 'discovery');

-- Verify (read-only):
--   select count(*), count(*) filter (where residual_kind = 'island_written') from v_residual;
--   select vein_id, family, case_ref from vein_ledger where vein_id in ('V010','V011','V012','V013');
--   select vein_id, sample, verdict, counts from vein_runs where vein_id in ('V010','V011','V012','V013');
