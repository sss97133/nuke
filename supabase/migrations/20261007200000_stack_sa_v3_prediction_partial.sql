-- 20261007200000_stack_sa_v3_prediction_partial.sql
--
-- Stack registry (20261007014500): version 3 of SA, "The auction as an order book". Version 2 (20261007040000) recorded
-- the stack as a page with its prediction and outcome layers missing, named. Tonight two of its named gaps got readers:
--   * prediction: public.live_lot_temperature_at(lot, bid, bidders, at, ends_at, extensions) (20261007123000, PR #771),
--     the live-state reader behind GET api-v1-vehicle-auction/forecast (#773), `nuke lot` (nuke-cli #1-#3), the MCP tool
--     nuke_lot_forecast (nuke-cli #4) and the Forecast panel on /stacks/order-book (#780). Replay 2026-10-07: its 80% band
--     held the hammer on 257 of 311 lots two minutes before the scheduled close (82.6%, CI 78.0-86.4); 24 h 79.3%
--     (543/685), 6 h 80.8%, 1 h 78.4%. The band is pooled by price tier: a cohort-specific T-2 band needs 9 clocked lots
--     per cohort (1.1% / 11% / 19.7% / 33.5% of lots after 30 / 90 / 180 / 365 days). So the layer is PARTIAL, not real.
--   * outcome: hammer_predictions.auction_event_id (20261007170000, PR #774) keys every stored prediction to its lot and
--     the per-lot grader fills lot_outcome / actual_hammer / scored_at; prediction_accuracy counts lots (model 31: 591 of
--     751 sold lots inside its 80% band = 78.7%). 46,093 of 53,922 rows carry the key on 2026-10-07 (the rest have no lot
--     key), so the column need reads partial by fill, which is the truth of it.
-- The registry is append-only: version 3 carries the full need list (the 16 of v2 plus these 2), supersedes 2, keeps the
-- name, question, scoring and family, and stays `showable`. The abstract need "outcome ledger" stays undeclared: a
-- declaration would move S60 as well, and hammer_predictions is the hammer's ledger only.
-- SCHEMA_LAW: rows only, in the registry's tables, by the registry's writer (a migration). Idempotent (ON CONFLICT DO
-- NOTHING). Contract: supabase/sql/test_stack_registry.sql applies this file after v2 and checks the version.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.stacks
  (stack_id, version, name, question, family, path, external_dimensions, who_cares, scoring, status,
   thesis_vein_id, thesis_vein_version, source, supersedes_version, registered_by)
SELECT
  'SA', 3, s.name, s.question, s.family,
  ARRAY[
    s.path[1], s.path[2], s.path[3], s.path[4], s.path[5], s.path[6], s.path[7],
    'prediction: partial. live_lot_temperature_at grades the live bid and bidders against comparables the same time before their close and returns an 80% hammer band with n and denominator (pooled by price tier until a cohort holds 9 clocked lots); replay 2026-10-07: 257 of 311 lots at T-2 = 82.6%, 24 h 79.3%, 6 h 80.8%, 1 h 78.4%; served by GET api-v1-vehicle-auction/forecast, nuke lot, the MCP tool and the page panel. Missing still: a cohort-specific T-2 band, a stored forecast row per read',
    'outcome: real. Pending with the scheduled close while live; result, hammer, high bid and keyed winner once closed (auction_events); every stored prediction keyed to its lot and graded at the last prediction before the close (hammer_predictions.auction_event_id, lot_outcome, actual_hammer; prediction_accuracy counts lots)'
  ]::text[],
  s.external_dimensions, s.who_cares, s.scoring,
  'showable',
  NULL, NULL,
  'PRs #771 #773 #774 #780 and nuke-cli #1-#4 (2026-10-07): the live-state reader, its route, the CLI verb, the MCP tool, the page panel, and the per-lot grader. Version 2 source: ' || s.source,
  2,
  'claude-code (Fable 5.1), lead session skylar-64, for the owner'
FROM public.stacks s
WHERE s.stack_id = 'SA' AND s.version = 2
ON CONFLICT (stack_id, version) DO NOTHING;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within, note)
SELECT 'SA', 3, n.layer, n.kind, n.object, n.denominator, n.fresh_within, n.note
FROM public.stack_needs n
WHERE n.stack_id = 'SA' AND n.version = 2
  AND EXISTS (SELECT 1 FROM public.stacks s WHERE s.stack_id = 'SA' AND s.version = 3)
ON CONFLICT (stack_id, version, layer, object) DO NOTHING;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within, note)
SELECT 'SA', 3, v.layer, v.kind, v.object, v.denominator, v.fresh_within, v.note
FROM (VALUES
  ('prediction', 'function', 'live_lot_temperature_at',            NULL, NULL::interval, 'the live-state reader (20261007123000): 80% hammer band with n and denominator, position, cohort miss with denominators, coverage; replay 257/311 at T-2 (82.6%)'),
  ('outcome',    'column',   'hammer_predictions.auction_event_id', NULL, NULL,           'every stored prediction keyed to its lot (20261007170000) so its grade is a lot grade; fill below 1 is the share of rows with no lot key')
) AS v(layer, kind, object, denominator, fresh_within, note)
WHERE EXISTS (SELECT 1 FROM public.stacks s WHERE s.stack_id = 'SA' AND s.version = 3)
ON CONFLICT (stack_id, version, layer, object) DO NOTHING;

COMMIT;
