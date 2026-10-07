-- 20261007040000_stack_sa_v2_showable.sql
--
-- Stack registry (20261007014500, PR #721): version 2 of SA, "The auction as an order book", now that the stack is a page.
-- PR #724 (merged eeecbc994, 2026-10-07 01:45Z) rendered Stack A on one BaT lot from live public rows: /stacks lists the
-- stack with its layers and coverage, /stacks/order-book/:vehicleId is the page, STACKS is a header tab. Coverage comes
-- first on every page; the nine layers follow as a path; every number shows its denominator and the clock it is as of;
-- layers without a reader say so and show no number. No database object was added for it.
--
-- The registry is append-only (vein_append_only): a change of status or definition is a new version with
-- supersedes_version, and readers cite (stack_id, version). Version 1 (status measured, 5 needs, coverage 0.6 on
-- 2026-10-07 02:08Z: 3 present, 1 partial, 1 missing) stays as it is. Version 2 is the stack as built: status showable,
-- the path rewritten to say what each layer reads today and what it lacks, and the full need list that the page's
-- coverage block and its "named missing" layers imply.
--
-- NEEDS (16, across all nine layers). A new version carries its full list (stack_needs table comment).
--   log        auction_comments (table); bat_bids.bid_timestamp (intake, 2 days); vehicle_observations (table: the public
--              live frames, extraction_method bat_public_live_v1, that the page counts per minute)
--   key        auction_comments.external_identity_id, auction_comments.auction_event_id,
--              auction_events.seller_external_identity_id, auction_events.winning_bidder_external_identity_id (columns)
--   dimension  auction_comments.comment_type (column, the kinds as written); comment stance dimension (abstract, missing)
--   fold       order book fold per lot per minute (abstract, NEW substrate: the page computes the book per read, stores none)
--   baseline   live_lot_temperature (function, one point); cohort demand curve by minutes to close (abstract, NEW substrate)
--   residual   residual snapshots (abstract, existing substrate)
--   feature    order book fold per lot per minute (the same substrate: slope, depth and top-two gap per minute, replayed)
--   prediction outcome ledger (abstract, existing substrate: a graded prediction row)
--   outcome    auction_events (table: result, hammer, high bid, keyed winner)
-- Coverage will read below version 1's 0.6: the page made the missing layers explicit, and the registry now counts them.
-- That lower number is the point (case ledger 13.1: every stack shows how much it does not know).
--
-- Two substrates are registered with no declared table. Declaring a table for either later moves every stack that names
-- it, with no new stack version (13.1 point 4, sources are pluggable).
--
-- SCHEMA_LAW: no table, column, kind, vocabulary value or function. Rows only, in the registry's own tables, by the
-- registry's own writer (a migration file, per the pipeline_registry rows of 20261007014500). Every insert is idempotent
-- (ON CONFLICT DO NOTHING), so a replay adds nothing. The demonstration lot's receipt is kept in `source` by id, the
-- selection rule beside it. No owner words are quoted.
-- Contract: supabase/sql/test_stack_registry.sql (PostgreSQL 17, CI job metric-fold-health-contract), extended to apply
-- this file after the registry and check the version, its needs, its substrates, the reader and the replay.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.stack_substrates (substrate, note, source, registered_by)
VALUES
  ('order book fold per lot per minute',
   'The implied order book of one lot per minute (price path, revealed demand curve, book ladder; depth at P = identities at or above P), point-in-time over the bids posted at or before that minute, with its per-minute features (slope, depth, top-two gap). The Stack A page computes it per read from the lot''s log (PR #724) and stores nothing; a table here is the fold and feature layers of stack SA.',
   'PR #724 (eeecbc994, 2026-10-07), case ledger 13.2 stack A',
   'claude-code (Fable 5.1), lead session skylar-64, for the owner'),
  ('cohort demand curve by minutes to close',
   'The cohort''s demand-curve shape at each minutes-to-close, the baseline of stack SA. On 2026-10-07 no relation holds it: valuation_by_ymm, get_comps_scored and market_index_values hold outcomes or daily index values, not curves; live_lot_temperature gives one point (PRICE and ACTIVITY strips at the lot''s hours to close, live lots only).',
   'PR #724 (eeecbc994, 2026-10-07), case ledger 13.2 stack A',
   'claude-code (Fable 5.1), lead session skylar-64, for the owner')
ON CONFLICT (substrate) DO NOTHING;

INSERT INTO public.stacks
  (stack_id, version, name, question, family, path, external_dimensions, who_cares, scoring, status,
   thesis_vein_id, thesis_vein_version, source, supersedes_version, registered_by)
SELECT
  'SA', 2, s.name, s.question, s.family,
  ARRAY[
    'log: real. The lot''s life with a tick per bid: posted time (BaT clock, to the second), time to close, amount, identity, landing time and BaT anchor; the live frames held, by kind. Readers: auction_comments keyed to the lot; vehicle_observations frames (bat_public_live_v1)',
    'key: real. Bid to identity, bid to lot; the lot''s seller and winner keys. A row keyed to the lot but posted more than 14 days before its scheduled close is a key conflict: shown in the log, counted in coverage, never folded (read-only measurement 2026-10-07, 400 BaT lots closed 10-04 to 10-07: first comment 6 to 8 days before close on 389, 8 to 12 on 10, 5 to 6 on 1). Readers: auction_comments.external_identity_id, auction_comments.auction_event_id, auction_events.seller_external_identity_id, auction_events.winning_bidder_external_identity_id',
    'dimension: partial. Comment kinds as the comment builder writes them (auction_comments.comment_type); stance (reservation price, refusal) needs the text fold and shows no number',
    'fold: real, computed per read. The as-of control, the price path, the revealed demand curve and the book ladder; depth at P counts identities at or above P; point-in-time over bids posted at or before the as-of bid; unkeyed bids are never unified by handle; a bid is a lower bound on willingness to pay. Nothing stored',
    'baseline: partial. One point, the PRICE and ACTIVITY strips (live_lot_temperature) at the lot''s hours to close, live lots only; the cohort''s curve shape per minutes to close is missing',
    'residual: missing, named. This lot''s curve against its cohort; needs the baseline curve',
    'feature: missing, named. Slope, depth and top-two gap as of each minute are not stored per lot and minute, or replayed over past lots',
    'prediction: missing, named. Hammer distribution and P(reserve met): no model, backtest or calibration; the six blanks unfilled',
    'outcome: real. Pending with the scheduled close while live; result, hammer, high bid and keyed winner once closed, clocked by auction_events.updated_at (the result clock is later than the page-read clock)'
  ]::text[],
  s.external_dimensions, s.who_cares, s.scoring,
  'showable',
  NULL, NULL,
  'PR #724 (eeecbc994, 2026-10-07 01:45Z): nuke_frontend/src/pages/stacks (stackDefinitions.ts, orderBookReader.ts, OrderBookStack.tsx, StacksIndex.tsx); routes /stacks and /stacks/order-book/:vehicleId; header tab STACKS. Reads live public rows as anon through PostgREST. Demonstration lot, chosen by rule 2026-10-07 01:22:47Z (the live BaT lot with the most bid comments keyed to an identity, counting only comments posted inside its own window, of 1,300 live lots): auction_events 88a000fd-fc51-4d02-a93a-84b159deea7e on vehicle 781ac7c0-d279-43b9-b456-4e9432fb175d, 31 keyed bids, 3 identities. Definition: data-machine-cases.md 13.2 stack A.',
  1,
  'claude-code (Fable 5.1), lead session skylar-64, for the owner'
FROM public.stacks s
WHERE s.stack_id = 'SA' AND s.version = 1
ON CONFLICT (stack_id, version) DO NOTHING;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within, note)
SELECT 'SA', 2, v.layer, v.kind, v.object, v.denominator, v.fresh_within, v.note
FROM (VALUES
  ('log',        'table',    'auction_comments',                                   NULL, NULL,                 'every bid comment is a timed quote; the page''s log layer: one tick per bid with its BaT clock, amount, identity, landing time and anchor'),
  ('log',        'intake',   'bat_bids.bid_timestamp',                             NULL, '2 days'::interval,   'bid frames at second precision (the bat_bids copy); the copy stopped 2026-10-05, owner ruling pending (case ledger 12)'),
  ('log',        'table',    'vehicle_observations',                               NULL, NULL,                 'public live frames (extraction_method bat_public_live_v1), the minutes with a frame the page counts; the collector subscribes from 15 minutes before close'),
  ('key',        'column',   'auction_comments.external_identity_id',              NULL, NULL,                 'bid to identity; the page''s first coverage line, bids keyed to identities over bids held'),
  ('key',        'column',   'auction_comments.auction_event_id',                  NULL, NULL,                 'bid to lot; comments keyed to the lot over comments held on the lot''s URL; rows posted more than 14 days before the scheduled close are key conflicts, shown and counted, never folded'),
  ('key',        'column',   'auction_events.seller_external_identity_id',         NULL, NULL,                 'the lot''s seller key (PR #705; LK backfill walking 2026-10-07)'),
  ('key',        'column',   'auction_events.winning_bidder_external_identity_id', NULL, NULL,                 'the lot''s winner key (PR #705; LK backfill walking 2026-10-07)'),
  ('dimension',  'column',   'auction_comments.comment_type',                      NULL, NULL,                 'comment kinds as the comment builder writes them, each expandable to its rows on the page'),
  ('dimension',  'abstract', 'comment stance dimension',                           NULL, NULL,                 'stance (reservation price, refusal, question) from the text fold; the page names it and shows no number'),
  ('fold',       'abstract', 'order book fold per lot per minute',                 NULL, NULL,                 'the page computes the price path, demand curve and book ladder per read from this lot''s log only, point-in-time; nothing is stored'),
  ('baseline',   'function', 'live_lot_temperature',                               NULL, NULL,                 'one point: the PRICE and ACTIVITY strips at the lot''s hours to close, live current lots only'),
  ('baseline',   'abstract', 'cohort demand curve by minutes to close',            NULL, NULL,                 'the cohort''s curve shape per minutes to close; no relation holds curves on 2026-10-07'),
  ('residual',   'abstract', 'residual snapshots',                                 NULL, NULL,                 'this lot''s curve against its cohort, per minute; needs the baseline curve'),
  ('feature',    'abstract', 'order book fold per lot per minute',                 NULL, NULL,                 'slope, depth and top-two gap as of each minute, stored per lot and minute and replayed over past lots'),
  ('prediction', 'abstract', 'outcome ledger',                                     NULL, NULL,                 'hammer distribution and P(reserve met) as a graded prediction row with its backtest and calibration; the six blanks unfilled'),
  ('outcome',    'table',    'auction_events',                                     NULL, NULL,                 'result, hammer, high bid and keyed winner once closed, clocked by the lot row''s last write; pending with the scheduled close while live')
) AS v(layer, kind, object, denominator, fresh_within, note)
WHERE EXISTS (SELECT 1 FROM public.stacks s WHERE s.stack_id = 'SA' AND s.version = 2)
ON CONFLICT (stack_id, version, layer, object) DO NOTHING;

COMMIT;
