-- The graded lots' vision backlog as a view: every BaT lot the hammer model has been graded on, its residual, its
-- photos, how many of them vision has read, and what reading the rest costs. Data-machine cases C17 (photo pipeline
-- operating coverage) and the stack "cohort-relative condition from photos" (data-machine-cases.md section 13, row 6).
--
-- WHY. The 2026-10-13 intake diagnosis: the processing layer is off (vision_analyzed_at set on 0.00% of the photos of
-- the last 500 sold BaT lots; README "Intake and processing rates" block shows vision at 0 sampled a day for 7 days), and
-- the one spend decision in front of the owner is a paid vision pass over the graded lots, scored against the error
-- table (v_prediction_lot_grades). The decision needs one row per graded lot: how wrong the model was, how many photos
-- the lot has, and the cost of reading them, so the pass can start at the worst residuals. That ranking existed only as
-- a session query. This view is that query, in the database, read-only.
--
-- WHAT. public.v_graded_lot_vision_backlog, one row per graded BaT lot: the newest model's grade at horizon 'last' (the
-- last prediction before close) with a hammer (outcome sold and winning bid > 0, as v_prediction_lot_grades defines
-- actual_hammer), joined to the lot's photos in vehicle_images (rows keyed to the lot's vehicle_id that are not video,
-- not superseded and not duplicates) and to the count of those with vision_analyzed_at set. No ORDER BY and no LIMIT
-- (the C28 ruling): readers order by abs_error_pct DESC and limit; a lot with no photos stays in with photos = 0 so the
-- denominator is the view's own row count.
--
-- SCHEMA_LAW pre-mint checklist (2026-10-13, read-only):
--  1. Search: no view or table names graded lots with photos or a vision cost. v_prediction_lot_grades is one row per
--     model, lot and horizon (no photos); prediction_accuracy is per-model aggregates; v_residual (C28) is one row per
--     table. This view derives from the first and from vehicle_images; it replaces none.
--  2. Not a fact class: a derived read model over the grade view and the image table.
--  3. No testimony, no DNA columns.  4. View: zero storage.  5. Read-only; no invariants.  6. No writers.
--  7. CI-applied migration; operator data, SELECT for service_role only.
--
-- COST CONSTANTS (platform.claude.com/docs/en/build-with-claude/vision and claude.com/pricing, both read 2026-10-13):
--  - An image costs ceil(width/28) x ceil(height/28) visual tokens. Models before Claude 4.7 (Claude Haiku 4.5 among
--    them) are the standard tier: long edge capped at 1,568 px and 1,568 visual tokens, so any photo over 1,568 px on
--    its long edge, which BaT photos are, costs the cap. 1,568 input tokens per image is therefore the per-image
--    ceiling; a 1000x1000 photo would be 1,296.
--  - Claude Haiku 4.5: $1 per million input tokens, $5 per million output tokens; batch processing saves 50%.
--  - Output per image: 150 tokens, an assumption for a short structured condition claim, not a measurement.
--  - Per image at list: 1,568 x $1/1e6 + 150 x $5/1e6 = $0.002318; through the Batch API: $0.001159.
--
-- MEASURED 2026-10-13T15:57Z (this file's SELECT body, run read-only through scripts/data/q.sh; nothing written):
-- 1,482 lots from 1,997 'last'-horizon grades across model versions 13 to 31; 482 lots with no photos keyed to their
-- vehicle_id; 191,574 photos, 109 vision-analyzed, 191,465 to analyze; median 119 photos per lot, max 2,848; median
-- abs_error_pct 24.8. At the constants: $443.82 at list, $221.91 through Batch. The five worst residuals were all model
-- 31 over-predictions on cheap, odd lots (a fire truck hammered at $2,600 against a $31,000 prediction). The whole body
-- took 32 s through the management API, 3.4 s of it the grade view alone: the photo counts over about 1,000 vehicles are
-- the cost, so read it with a statement_timeout of 55 s or more.
--
-- CONTRACT TEST: supabase/sql/test_graded_lot_vision_backlog.sql (PostgreSQL 17 in CI) applies this file over stub
-- grade and image tables and checks the grain, the newest-model rule, the photo filters, the cost arithmetic, every
-- comment, the ACL and that the migration applies twice.
--
-- LIMITS (also in the comments below). photos counts vehicle_images rows keyed to the graded lot's vehicle_id; a lot
-- whose photos were never captured, or were captured under another vehicle id, shows 0. The cost is a ceiling per
-- image (every photo at the token cap) and an assumption per output; it is not a quote. abs_error_pct is the newest
-- model's, so a lot's row changes when a newer model grades it. Nothing here says which photos vision should read first.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE VIEW public.v_graded_lot_vision_backlog AS
WITH g AS (
  SELECT DISTINCT ON (p.lot)
         p.lot, p.vehicle_id, p.auction_event_id, p.model_version, p.prediction_id, p.predicted_at, p.close_at,
         p.outcome, p.predicted_hammer, p.actual_hammer, p.error_pct, p.abs_error_pct, p.band_held
  FROM public.v_prediction_lot_grades p
  WHERE p.horizon = 'last'
    AND p.actual_hammer IS NOT NULL
  ORDER BY p.lot, p.model_version DESC, p.predicted_at DESC
), i AS (
  SELECT vi.vehicle_id,
         count(*)::integer AS photos,
         count(vi.vision_analyzed_at)::integer AS photos_vision_analyzed
  FROM public.vehicle_images vi
  WHERE vi.vehicle_id IN (SELECT g1.vehicle_id FROM g g1)
    AND NOT coalesce(vi.is_video, false)
    AND NOT coalesce(vi.is_superseded, false)
    AND NOT coalesce(vi.is_duplicate, false)
  GROUP BY vi.vehicle_id
)
SELECT g.lot,
       g.vehicle_id,
       g.auction_event_id,
       g.model_version,
       g.prediction_id,
       g.predicted_at,
       g.close_at,
       g.outcome,
       g.predicted_hammer,
       g.actual_hammer,
       g.error_pct,
       g.abs_error_pct,
       g.band_held,
       coalesce(i.photos, 0) AS photos,
       coalesce(i.photos_vision_analyzed, 0) AS photos_vision_analyzed,
       coalesce(i.photos, 0) - coalesce(i.photos_vision_analyzed, 0) AS photos_to_analyze,
       (coalesce(i.photos, 0) - coalesce(i.photos_vision_analyzed, 0))::bigint * 1568 AS est_input_tokens,
       round((coalesce(i.photos, 0) - coalesce(i.photos_vision_analyzed, 0)) * 0.002318, 6) AS est_cost_usd,
       round((coalesce(i.photos, 0) - coalesce(i.photos_vision_analyzed, 0)) * 0.001159, 6) AS est_cost_batch_usd
FROM g
LEFT JOIN i ON i.vehicle_id = g.vehicle_id;

COMMENT ON VIEW public.v_graded_lot_vision_backlog IS
  'Graded lots'' vision backlog (data-machine cases C17 and section 13 row 6): one row per BaT lot the hammer model has been graded on, with the newest model''s residual, the lot''s photos, how many vision has read, and the cost of reading the rest. Grain: one lot (BaT listing slug) from v_prediction_lot_grades at horizon last with a hammer; of several models grading the same lot the highest model_version is kept (then the latest predicted_at). Photos are vehicle_images rows keyed to the lot''s vehicle_id that are not video, not superseded and not duplicates; photos_vision_analyzed are those with vision_analyzed_at set. Cost constants (platform.claude.com vision doc and claude.com/pricing, read 2026-10-13): 1,568 input tokens per image, the standard-tier cap for models before Claude 4.7 and so for Claude Haiku 4.5, reached by any photo over 1,568 px on its long edge; 150 output tokens per image, an assumption; $1 per million input and $5 per million output tokens; Batch API 50% off. Per image $0.002318 at list, $0.001159 through Batch. No ORDER BY and no LIMIT: read with ORDER BY abs_error_pct DESC LIMIT n, and with a statement_timeout of 55 s or more (32 s on 2026-10-13 through the management API, 3.4 s of it the grade view). Measured 2026-10-13T15:57Z: 1,482 lots, 482 with no photos, 191,574 photos, 109 analyzed, 191,465 to analyze, $443.82 at list, $221.91 through Batch. Limits: a lot whose photos were never captured, or were captured under another vehicle id, shows photos = 0; the cost is a per-image ceiling plus an output assumption, not a quote; a lot''s row changes when a newer model grades it; nothing here orders the photos within a lot.';

COMMENT ON COLUMN public.v_graded_lot_vision_backlog.lot IS
  'BaT listing slug, the part of the auction_events source_url after bringatrailer.com/listing/, lower-cased. Grain key: one row per lot. Source: v_prediction_lot_grades.lot.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.vehicle_id IS
  'Vehicle the graded prediction was made for; the key the photo counts join on. Source: v_prediction_lot_grades.vehicle_id, from hammer_predictions.vehicle_id.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.auction_event_id IS
  'The auction_events row that settled the lot and supplied the hammer. Source: v_prediction_lot_grades.auction_event_id.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.model_version IS
  'The hammer model whose grade this row carries: the highest model_version among the models that graded the lot at horizon last. Source: v_prediction_lot_grades.model_version, from hammer_predictions.model_version.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.prediction_id IS
  'The hammer_predictions row graded here (the last prediction before close by the newest model). Source: v_prediction_lot_grades.prediction_id.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.predicted_at IS
  'When that prediction was made (database clock at the prediction write). Source: v_prediction_lot_grades.predicted_at.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.close_at IS
  'The lot close the grade is measured against (hammer_predictions.lot_close_at). Source: v_prediction_lot_grades.close_at.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.outcome IS
  'Lot outcome recorded on the prediction (sold for every row here, since a hammer is required). Source: v_prediction_lot_grades.outcome.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.predicted_hammer IS
  'The model''s point prediction of the hammer, in US dollars. Source: v_prediction_lot_grades.predicted_hammer.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.actual_hammer IS
  'The settled hammer, in US dollars: auction_events.winning_bid for a sold lot. Source: v_prediction_lot_grades.actual_hammer.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.error_pct IS
  'Signed residual in percent of the hammer: (predicted_hammer - actual_hammer) / actual_hammer x 100, two decimals; positive is an over-prediction. Source: v_prediction_lot_grades.error_pct.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.abs_error_pct IS
  'Absolute residual in percent of the hammer, two decimals; the ranking key for the vision pass (ORDER BY abs_error_pct DESC). Source: v_prediction_lot_grades.abs_error_pct.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.band_held IS
  'Whether the hammer fell inside the model''s predicted_low to predicted_high band. Source: v_prediction_lot_grades.band_held.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.photos IS
  'Photos of the lot, in images: vehicle_images rows with this vehicle_id whose is_video, is_superseded and is_duplicate are not true (NULL counts as false). 0 when no row is keyed to the vehicle_id, which was 482 of 1,482 lots on 2026-10-13. Source: vehicle_images.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.photos_vision_analyzed IS
  'Of photos, those with vision_analyzed_at set, in images; the denominator is photos. Source: vehicle_images.vision_analyzed_at.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.photos_to_analyze IS
  'photos minus photos_vision_analyzed, in images: the lot''s vision backlog. Source: computed here.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.est_input_tokens IS
  'photos_to_analyze x 1,568 input tokens: the standard-tier cap per image (ceil(width/28) x ceil(height/28) visual tokens, long edge capped at 1,568 px for models before Claude 4.7, so for Claude Haiku 4.5), a ceiling that every photo over 1,568 px on its long edge reaches. Source: platform.claude.com/docs/en/build-with-claude/vision, read 2026-10-13.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.est_cost_usd IS
  'photos_to_analyze x $0.002318, in US dollars at Claude Haiku 4.5 list prices: 1,568 input tokens at $1 per million plus 150 output tokens (an assumption, not a measurement) at $5 per million, per image. A ceiling, not a quote. Source: claude.com/pricing and the vision doc, read 2026-10-13.';
COMMENT ON COLUMN public.v_graded_lot_vision_backlog.est_cost_batch_usd IS
  'photos_to_analyze x $0.001159, in US dollars: est_cost_usd at the Batch API''s 50% discount. Source: claude.com/pricing, read 2026-10-13.';

-- Operator data, as v_schema_atlas, v_job_health and v_residual: Supabase default privileges would give anon and
-- authenticated every table privilege on a new view, and a view runs with its owner's rights.
REVOKE ALL ON public.v_graded_lot_vision_backlog FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_graded_lot_vision_backlog TO service_role;
