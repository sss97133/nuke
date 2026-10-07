-- Prediction-outcome lane, 2026-10-07 (case ledger 13.8 point 2, "the outcome join is the trunk"): grade the stored hammer
-- predictions by LOT, so the number of graded lots exists on prod and every later model is measured against it.
--
-- WHY. hammer_predictions holds 53,922 rows (2026-10-07 07:20Z), made at scale; 608 of them were ever graded, by
-- score_closed_predictions(), which joins hammer_predictions.vehicle_id to external_listings (sold, final_price) and
-- reaches 10 vehicle ids. The join never lands because the key path is broken:
--   * vehicle_id has no foreign key and names no vehicles row for 3,932 of the 4,622 ids model 24 carries (model 24 carries
--     4.3 vehicle ids per lot, 1,081 lots); model 31 has one id per lot, all with a vehicles row;
--   * external_listing_id names no external_listings row: model 24 sets it on every row, 8 of its 4,654 distinct ids exist
--     there, 714 name a vehicle_events row, none an auction_events row; model 31 leaves it NULL on all 2,314 rows;
--   * the other table that prices lots is no path either: bat_listings is reached for 6 of the 1,081 model 24 lots through
--     vehicle_id (67 through the lot key), and its sale_price is not the hammer: it prices 1,017 model 31 lots where 749
--     sold in auction_events, because it also holds the high bid of lots that did not sell (the lead session's read of the
--     901 settled lots, 2026-10-07: vehicle_id NULL on 900, 260 of them a high bid, not a sale).
-- Keyed by the lot, the same predictions grade: auction_events holds the lot (the BaT listing slug in source_url, indexed by
-- idx_auction_events_bat_lot_slug) with its outcome and winning_bid. QUERY 3 and QUERY 4 of
-- scripts/market/replay-live-lot-reader.sql (PR #772) are the reading this migration turns into a writer.
-- "6,926 lots" counts vehicle ids: 3,380 distinct BaT lot slugs are known for the predicted vehicles (3,321 have an
-- auction_events row), and the 608 legacy grades do not survive the lot: see MEASURED.
--
-- WHAT THE ROW IS. A grade is a function of one prediction and one lot, so it lives on the prediction row (hammer_predictions
-- is the capability map's owner of "Hammer prediction": extend it, do not mint). The row gains the lot key and the facts the
-- grade is measured against; the lot as the unit is a selection over rows, made in a view (v_prediction_lot_grades), because
-- the latest prediction standing at a horizon depends on the lot's other rows. prediction_accuracy is a view over graded
-- rows, one row per model, not a table: it cannot take rows. It is redefined on the lot view (see 5).
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 07:15Z to 09:00Z; the rule below run as one SELECT over
-- every row, the way the function runs it per block range; nothing written):
--   Rows 53,922: model 24 45,798, 13 4,824, 31 2,314, 30 983, 6 2, 100 1.
--   Resolved to a lot with an outcome: 46,093 rows; of them 34,094 are sold-lot rows with no grade yet (1,480 lots), the rest
--   unsold outcomes and rows already graded. Distinct lots sold: 1,482 (any model); with an outcome: 2,289.
--     model 24: sold 31,954 rows / 747 lots (31,917 to grade, 37 already graded); reserve_not_met 10,082 rows / 240 lots;
--       no_sale 453 rows / 8 lots; held: ambiguous 861, lot does not fit 86, no outcome 2,362 (no lot row, or the lot open).
--     model 31: sold 751; reserve_not_met 591; no outcome 972 (lots still live, or not yet in auction_events).
--     model 30: sold 489; reserve_not_met 491. model 13: sold 1,041 rows / 10 lots, no lot key 3,439, ambiguous 104.
--   Held in all: no lot key 3,440, no outcome 3,337, ambiguous 966, does not fit 86; two sold rows with two hammers 0.
--   Close clocks: of the 740 sold model 24 lots with one candidate slug, auction_end_date is NULL on 496 (the sold row never
--   stored the end), so 503 of its 747 graded lots are measured against the row's own close (predicted) and 244 against the
--   final close. Live frames hold a scheduled close for 376 of 2,313 model 31 lots and 40 of 982 model 30 lots, for none of
--   model 24.
--   Where both clocks exist the row's own close (predicted_at + hours_remaining) agrees with the lot's: model 24 8,323 of 8,324
--   rows within 6 h; model 31 741 of 748 within 6 h and 748 within 24 h (2026-10-07 07:50Z). The rule accepts 48 h.
--   A bid cannot pass the hammer, so a row whose bid does is about another lot. Of the 34,283 sold-lot rows a time-only
--   rule resolved, 83 carried a bid more than 1% above their lot's hammer (82 rows of one relisted vehicle whose first lot is
--   not in auction_events: bid 8,200 against a 6,600 hammer; 1 row of another), and 3 more sat far from the lot's close. The
--   rule holds those 86 rows. A prediction made during an earlier lot of a relisted vehicle, whose slug is unknown and whose
--   bid is below the later hammer, is graded against the later lot: not measurable here, and rare (relisted vehicles are the
--   ambiguous 966 and the 86 above).
--   Duplicate lot rows: of the 3,321 slugs with a row, 15 have several (7 with different outcomes), none with two hammers.
--   The 608 legacy grades (10 vehicle ids): the rule resolves 340 of them to a lot. 141 sit on a sold lot whose hammer differs
--   from the stored price (the vehicle was relisted; the legacy join gave every row the later sale's price) and 199 on a lot
--   that ended unsold (a stored price on a lot that did not sell). The other 268 belong to vehicles with two lots that both
--   fit. None of the 608 equals its lot's hammer. The grader keeps them as they are and counts the disagreement; the lot view
--   does not read them.
--   Hold rate of the stored band at the last prediction before the close (dry run, lots sold, the band as each model states
--   it: 80% for 30 and 31, 50% for 24): model 31 591 of 751 (78.7%); model 30 365 of 489 (74.6%); model 24 193 of 747 (25.8%);
--   model 13 2 of 10. At the scheduled close minus 2 minutes (live frames): model 31 239 of 282 (84.8%).
--   Cost of the statement on prod: 1,000 to 3,500 rows (45 to 100 blocks) in 0.2 to 0.8 s read, 10,000 rows (300 blocks) in
--   1.5 to 2 s, warm, plus the write.
--
-- RULE (grade_hammer_predictions_by_lot). A prediction row with no lot key is resolved when all of this holds:
--   1. its vehicle has BaT lot slugs (lower-case slug of bringatrailer.com/listing/<slug>, the reader's normalization) from
--      vehicles.listing_url, its own auction_events rows, or the lot URL on its vehicle_observations; none = no_lot_key;
--   2. the slug has an auction_events row; the sold row with a hammer first, else the newest; none = no_outcome;
--   3. exactly one candidate lot fits the row: its close is within 48 h of the close the row itself recorded (predicted_at +
--      hours_remaining; a missing clock fits), and if the lot sold, the bid the row saw (current_bid) is not above the hammer
--      by more than 1% (a bid cannot pass the hammer, so that row is about another lot of the vehicle). None = lot_mismatch,
--      several = lot_ambiguous, held and counted;
--   4. the lot's sold rows do not carry two different hammers (lot_conflict);
--   5. outcome: sold with winning_bid > 0 = sold; reserve_not_met and bid_to = reserve_not_met; no_sale, cancelled and
--      relisted = no_sale; live, pending and the rest wait (no_outcome);
--   6. the close the row is measured against: the earliest previous_scheduled_end of the lot's bat_public_live_v1 frames
--      (scheduled), else auction_events.auction_end_date (final), else predicted_at + hours_remaining (predicted); none =
--      no_close_clock; a row made after that close is not written (after_close).
-- Resolved rows get auction_event_id, lot_outcome, lot_close_at and lot_close_basis. A sold row with no grade also gets
-- actual_hammer (auction_events.winning_bid, never bat_listings), prediction_error_pct, prediction_error_usd and scored_at.
-- reserve_not_met and no_sale rows get the outcome and no hammer. A grade already stored is kept; if it differs from the lot's
-- hammer, grade_conflicts counts it. v_prediction_lot_grades then picks, per model and lot, the last prediction made at or
-- before the close, and the one standing 24 h, 6 h, 1 h and (scheduled close only) 2 minutes before it.
--
-- WRITES (only these, only by the function, only where the key is NULL):
--   hammer_predictions: auction_event_id, lot_outcome, lot_close_at, lot_close_basis, and for sold rows with no grade
--   actual_hammer, prediction_error_pct, prediction_error_usd, scored_at. One write_receipts row per call that wrote (the
--   table has no receipt trigger). app.writer is set with set_config for the call and restored on return (a function-level SET
--   of a custom parameter is refused for prod's deploy role: #722). Idempotent: a keyed row is not visited again; unresolved
--   rows are counted again by every pass, so a lot that closes later is graded by the next one. EXECUTE: service_role only.
--
-- LOCK COST. ALTER TABLE takes ACCESS EXCLUSIVE on hammer_predictions (53,922 rows) until COMMIT: the columns are nullable with
-- no default (catalog only), the CHECKs and the index scan 54K rows (tens of ms). The foreign key is added last: it takes
-- SHARE ROW EXCLUSIVE on auction_events, which blocks that table's writers, for the time to check the 54K NULL keys (ms), and
-- is created validated. With lock_timeout 5 s, a session that holds a conflicting lock for 5 s makes the migration fail
-- before it changes anything. live-bands.mjs inserts into hammer_predictions at :40 each hour; an insert waits the few ms.
--
-- SCHEMA_LAW (lofficiel-concierge/supabase/SCHEMA_LAW.md), the seven questions:
--   1 search: candidates read in full, none fits: prediction_accuracy is a view; backtest_runs and backtest_run_details are
--     the 2026-02 simulator (one run, FK to vehicles, actual_hammer NOT NULL); projection_outcomes holds 1.16M nuke_estimate
--     spot rows with no actual; vein_ledger holds hypotheses. hammer_predictions is the capability map's owner.
--   2 a grade is derived from two rows (a prediction, a lot), not a fact about a vehicle: no observation row, no new table.
--   3 the key follows the house grammar (a foreign key named for what it keys, ON DELETE SET NULL); lot_outcome and
--     lot_close_basis are CHECKed vocabularies, listed in the column comments; the clocks are named (lot_close_at is the
--     event clock, scored_at the ingest clock).
--   4 could a view do this? The lot as the unit is a view. The key and the close facts cannot be: they come from the live
--     frames and from matching a vehicle's URLs to lots, a scan at read time; they are written once.
--   5 invariants: the vocabularies and "resolved together" are CHECK constraints; the key is a foreign key; the grader's
--     contract is supabase/sql/test_grade_hammer_predictions_by_lot.sql (PostgreSQL 17, job metric-fold-health-contract).
--   6 writer: this function only; registry rows below; the old writer (score_closed_predictions, cron paused) and the
--     inserters are unchanged.
--   7 this file; RLS on hammer_predictions is unchanged (anon reads nine columns of model 31 rows; the new columns have no
--     grant); the new view is service_role only.
-- schema_proposals has add_column (20261006213000); the change is recorded as one open row. No row of hammer_predictions
-- changes in this migration: rows change only when the function is called.
-- Applied by CI, never by hand. After the merge: run the hand batch, then the runner (~/nuke-logs/data-hygiene-20261005/
-- PG-run-grader.sh) and check PG-verify.sql; VACUUM (ANALYZE) public.hammer_predictions afterwards.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 0. Drift guard: this migration replaces the definition of prediction_accuracy. Refuse rather than overwrite a view someone
-- changed after the 2026-10-07 read (first 16 hex digits of the md5 of pg_get_viewdef(oid, true), 709 characters, PostgreSQL 17.6).
DO $guard$
BEGIN
  IF left(md5(pg_catalog.pg_get_viewdef('public.prediction_accuracy'::regclass, true)), 16) IS DISTINCT FROM 'df2da8985aba061f' THEN
    RAISE EXCEPTION 'prediction_accuracy differs from the 2026-10-07 read (md5 df2da898...); re-read it before replacing it';
  END IF;
END
$guard$;

-- 1. The proposal row for the four columns -----------------------------------------------------------------------------
INSERT INTO public.schema_proposals (
  proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility,
  status, decision_rationale)
VALUES (
  'claude-sonnet-5-5-prediction-outcome-lane',
  'add_column',
  jsonb_build_object(
    'table', 'hammer_predictions',
    'columns', jsonb_build_array(
      jsonb_build_object('column', 'auction_event_id', 'type', 'uuid',
        'references', 'auction_events(id) ON DELETE SET NULL, validated (every existing value is NULL)',
        'index', 'idx_hammer_predictions_auction_event (partial, IS NOT NULL)'),
      jsonb_build_object('column', 'lot_outcome', 'type', 'text',
        'check', 'sold, reserve_not_met, no_sale'),
      jsonb_build_object('column', 'lot_close_at', 'type', 'timestamptz'),
      jsonb_build_object('column', 'lot_close_basis', 'type', 'text',
        'check', 'scheduled, final, predicted')),
    'why', 'Every reference is a foreign key (data-machine.md). hammer_predictions had no key to the lot it predicts: vehicle_id has no foreign key and names no vehicles row for 3,932 of 4,622 model 24 ids, external_listing_id names no external_listings row for 4,646 of 4,654 distinct ids, so score_closed_predictions graded 608 rows of 10 vehicle ids, where 3,380 lots are known. The grade is a join of a prediction to its lot''s outcome, so the prediction row needs the lot key and the clock it is measured against.',
    'rule', 'grade_hammer_predictions_by_lot: the lot is the BaT listing slug known for the row''s vehicle (vehicles.listing_url, its auction_events rows, its observations); exactly one candidate lot whose close lies within 48 h of the close the row recorded and, if sold, whose hammer the row''s bid does not pass, else the row is held; the outcome and the hammer come from auction_events only; the close is the earliest previous_scheduled_end of the lot''s live frames, else auction_events.auction_end_date, else predicted_at + hours_remaining; a row made after its close is not written.',
    'writers', jsonb_build_array('grade_hammer_predictions_by_lot(p_batch, p_from_block)'),
    'readers', jsonb_build_array('v_prediction_lot_grades', 'prediction_accuracy'),
    'not_a_new_table', 'The capability map names hammer_predictions the canonical owner (extend it, do not mint). A grade is functionally dependent on the prediction row, so it lives on the row; the lot as the unit is a selection, made in a view.',
    'migration', '20261007170000_grade_hammer_predictions_by_lot.sql'),
  jsonb_build_array(
    jsonb_build_object('measure', 'hammer_predictions rows', 'value', 53922, 'at', '2026-10-07T07:20Z'),
    jsonb_build_object('measure', 'rows graded before this migration (score_closed_predictions)', 'value', 608, 'denominator', 53922, 'at', '2026-10-07T07:20Z'),
    jsonb_build_object('measure', 'model 24 vehicle ids with no vehicles row', 'value', 3932, 'denominator', 4622, 'at', '2026-10-07T07:30Z'),
    jsonb_build_object('measure', 'model 24 distinct external_listing_ids that name an external_listings row', 'value', 8, 'denominator', 4654, 'at', '2026-10-07T07:35Z'),
    jsonb_build_object('measure', 'distinct BaT lot slugs known for the predicted vehicles', 'value', 3380, 'at', '2026-10-07T07:45Z'),
    jsonb_build_object('measure', 'of those, slugs with an auction_events row', 'value', 3321, 'denominator', 3380, 'at', '2026-10-07T07:45Z'),
    jsonb_build_object('measure', 'model 24 sold lots reached by vehicle_id into auction_events', 'value', 396, 'denominator', 754, 'at', '2026-10-07T07:30Z'),
    jsonb_build_object('measure', 'model 24 sold lots with a NULL auction_end_date', 'value', 496, 'denominator', 740, 'at', '2026-10-07T07:50Z'),
    jsonb_build_object('measure', 'rule dry run, sold lots graded at the last prediction, model 31', 'value', 751, 'at', '2026-10-07T08:40Z'),
    jsonb_build_object('measure', 'rule dry run, sold lots graded at the last prediction, model 24', 'value', 747, 'at', '2026-10-07T08:40Z'),
    jsonb_build_object('measure', 'rule dry run, distinct sold lots, any model', 'value', 1482, 'denominator', 2289, 'at', '2026-10-07T08:50Z'),
    jsonb_build_object('measure', 'rule dry run, rows resolved to a lot with an outcome', 'value', 46093, 'denominator', 53922, 'at', '2026-10-07T08:50Z'),
    jsonb_build_object('measure', 'legacy grades (608 rows) whose price equals the hammer of their lot', 'value', 0, 'denominator', 608, 'at', '2026-10-07T08:50Z')),
  jsonb_build_object('rows_in_table', 53922, 'rows_to_write_estimate', 'see the PR body (dry run of the rule, read-only)', 'method', 'bounded block-range walk, service_role only'),
  jsonb_build_object('additive', true, 'nullable', true, 'table_rewrite', false, 'existing_writers_changed', false,
    'existing_readers_changed', 'prediction_accuracy counts lots from the last prediction before the close (it counted graded rows); no reader of it found in the repo or the database',
    'note', 'Every existing value is NULL when the columns are added. Existing grade columns are filled only where NULL.'),
  'open',
  'Proposed by the building agent under the lead session''s brief (skylar-64, 2026-10-07); merging the migration PR is the approval. The owner did not sign it. Supersede or reject it to retire the columns.');

-- 2. Owners of the written columns (upsert: a skipped registration would leave an older owner named) -------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('hammer_predictions', 'auction_event_id', 'grade_hammer_predictions_by_lot',
 'Lot key of the prediction: auction_events.id of the BaT lot (slug in source_url) the prediction is about. NULL = not resolved: no lot key, no lot row, lot open, several lots fit, or made after the close.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block): NULL keys only, by physical block range, from the lot slug known for the row''s vehicle.'),
('hammer_predictions', 'lot_outcome', 'grade_hammer_predictions_by_lot',
 'How the lot ended, from auction_events: sold, reserve_not_met (reserve_not_met, bid_to) or no_sale (no_sale, cancelled, relisted). Set with the key.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block), with auction_event_id.'),
('hammer_predictions', 'lot_close_at', 'grade_hammer_predictions_by_lot',
 'The close the prediction is measured against: earliest previous_scheduled_end of the lot''s bat_public_live_v1 frames, else auction_events.auction_end_date, else predicted_at + hours_remaining. Set with the key.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block), with auction_event_id.'),
('hammer_predictions', 'lot_close_basis', 'grade_hammer_predictions_by_lot',
 'Where lot_close_at came from: scheduled, final or predicted. Set with the key.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block), with auction_event_id.'),
('hammer_predictions', 'actual_hammer', 'grade_hammer_predictions_by_lot',
 'Hammer of the predicted lot: auction_events.winning_bid, sold lots only, filled where NULL. Never bat_listings.sale_price.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block). score_closed_predictions (cron hammer-score-predictions, paused) joins external_listings by vehicle_id and also fills NULLs; it reaches 10 vehicle ids.'),
('hammer_predictions', 'prediction_error_pct', 'grade_hammer_predictions_by_lot',
 'Signed error of predicted_hammer against actual_hammer, percent, 2 places; filled with actual_hammer.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block).'),
('hammer_predictions', 'prediction_error_usd', 'grade_hammer_predictions_by_lot',
 'Signed error of predicted_hammer against actual_hammer in USD; filled with actual_hammer.',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block).'),
('hammer_predictions', 'scored_at', 'grade_hammer_predictions_by_lot',
 'When the hammer grade was written. NULL = no hammer grade (unresolved, or the lot ended without a sale).',
 false,
 'grade_hammer_predictions_by_lot(p_batch, p_from_block).')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

-- The table-level row names the inserters; add the grader to what it says is writing the grade (once).
UPDATE public.pipeline_registry
SET write_via = write_via || ' Per-lot grades (2026-10-07): grade_hammer_predictions_by_lot(p_batch, p_from_block) keys each row to its lot and fills the grade columns for sold lots; the cron that called score_closed_predictions (hammer-score-predictions) is paused.',
    updated_at = now()
WHERE table_name = 'hammer_predictions' AND column_name IS NULL
  AND write_via IS NOT NULL AND write_via NOT LIKE '%grade_hammer_predictions_by_lot%';

-- 3. The writer ----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.grade_hammer_predictions_by_lot(
  p_batch integer DEFAULT 1000,
  p_from_block bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  c_writer constant text := 'grade-hammer-predictions-by-lot';
  v_prev_writer text := current_setting('app.writer', true);
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'statement_timeout');
  v_rows_per_page numeric;
  v_table_blocks bigint := pg_catalog.pg_relation_size('public.hammer_predictions') / current_setting('block_size')::bigint;
  v_blocks_after bigint;
  v_blocks bigint;
  v_next bigint;
  v_lo tid;
  v_hi tid;
  v_res record;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100000 THEN
    RAISE EXCEPTION 'grade_hammer_predictions_by_lot: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'grade_hammer_predictions_by_lot: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'grade_hammer_predictions_by_lot: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'graded', 0, 'held', 0, 'written', 0, 'keyed_legacy', 0, 'grade_conflicts', 0, 'lots', 0,
      'skipped_reserve_not_met', 0, 'skipped_no_sale', 0, 'skipped_no_lot_key', 0, 'skipped_no_outcome', 0,
      'skipped_lot_ambiguous', 0, 'skipped_lot_conflict', 0, 'skipped_lot_mismatch', 0, 'skipped_no_close_clock', 0,
      'skipped_after_close', 0, 'skipped_already_graded', 0,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'est_rows_remaining_to_scan', 0,
      'done', true);
  END IF;

  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 20 END
    INTO v_rows_per_page FROM pg_catalog.pg_class WHERE oid = 'public.hammer_predictions'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rows_per_page, 1)))::bigint;
  v_next := least(p_from_block + v_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_next)::tid;

  -- Declare the writer for this call only; the caller's value is restored before returning.
  PERFORM set_config('app.writer', c_writer, true);

  -- One statement. cand: the range's rows that carry no lot key. vslug: every BaT lot slug the row's vehicle is known to
  -- have (vehicles.listing_url, its own auction_events rows, the lot URL on its observations), lower-cased
  -- bringatrailer.com/listing/<slug>. lot: the one auction_events row per slug (a sold row with a hammer first, else the
  -- newest) and the number of different hammers the slug's sold rows carry. sched: the earliest previous_scheduled_end in
  -- the lot's bat_public_live_v1 frames. rowlots: each (row, candidate lot), with whether the lot fits the row: its close
  -- lies within 48 h of the close the row itself recorded (predicted_at + hours_remaining), and a sold lot's hammer is not
  -- passed by the row's bid. agg/judged: the lot a row belongs to and the rule's verdict. final: the close clock and the
  -- eligibility. upd: the write. Only the rows the rule resolves are written; every other row is counted by its reason and
  -- left as it was.
  EXECUTE $q$
    WITH cand AS MATERIALIZED (
      SELECT h.id, h.model_version, h.vehicle_id, h.predicted_at, h.hours_remaining, h.current_bid,
             h.predicted_low, h.predicted_hammer, h.predicted_high, h.scored_at, h.actual_hammer
      FROM public.hammer_predictions h
      WHERE h.ctid >= $1 AND h.ctid < $2 AND h.auction_event_id IS NULL
    ), veh AS MATERIALIZED (
      SELECT DISTINCT vehicle_id FROM cand
    ), vslug AS MATERIALIZED (
      SELECT v.vehicle_id, s.slug
      FROM veh v
      CROSS JOIN LATERAL (
        SELECT DISTINCT u.slug
        FROM (
          SELECT lower(substring(x.listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS slug
            FROM public.vehicles x WHERE x.id = v.vehicle_id
          UNION ALL
          SELECT lower(substring(e.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))
            FROM public.auction_events e WHERE e.vehicle_id = v.vehicle_id
          UNION ALL
          SELECT lower(substring(o.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))
            FROM public.vehicle_observations o
            WHERE o.vehicle_id = v.vehicle_id AND o.source_url ~ 'bringatrailer\.com/listing/'
        ) u
        WHERE u.slug IS NOT NULL
      ) s
    ), slugs AS MATERIALIZED (
      SELECT DISTINCT slug FROM vslug
    ), lotrows AS MATERIALIZED (
      SELECT s.slug, e.id AS ae_id, e.outcome, e.winning_bid, e.auction_end_date, e.updated_at
      FROM slugs s
      JOIN public.auction_events e
        ON lower(substring(e.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = s.slug
    ), hammers AS MATERIALIZED (
      SELECT slug, count(DISTINCT winning_bid) FILTER (WHERE outcome = 'sold' AND winning_bid > 0) AS n_hammers
      FROM lotrows GROUP BY slug
    ), lot AS MATERIALIZED (
      SELECT DISTINCT ON (r.slug) r.slug, r.ae_id, r.outcome, r.winning_bid, r.auction_end_date, hm.n_hammers
      FROM lotrows r JOIN hammers hm ON hm.slug = r.slug
      ORDER BY r.slug, (r.outcome = 'sold' AND r.winning_bid > 0) DESC, r.updated_at DESC, r.ae_id
    ), sched AS MATERIALIZED (
      SELECT ma.slug, min(fr.sched_close) AS sched_close
      FROM (SELECT lower(m.external_auction_id) AS slug, m.vehicle_id
            FROM public.monitored_auctions m WHERE m.stream_state ? 'last_frame_received_at') ma
      JOIN lot lt ON lt.slug = ma.slug
      CROSS JOIN LATERAL (
        SELECT min(CASE WHEN o.structured_data ->> 'previous_scheduled_end' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                        THEN (o.structured_data ->> 'previous_scheduled_end')::timestamptz END) AS sched_close
        FROM public.vehicle_observations o
        WHERE o.vehicle_id = ma.vehicle_id AND o.extraction_method = 'bat_public_live_v1'
      ) fr
      GROUP BY ma.slug
    ), rowlots AS MATERIALIZED (
      SELECT c.id, vs.slug, lt.ae_id, lt.outcome, lt.winning_bid, lt.auction_end_date, lt.n_hammers, sc.sched_close,
             -- fits: the lot's close is within 48 h of the close the row recorded, and, when the lot sold, the bid the row saw
             -- is not above the hammer by more than 1% (a bid cannot pass the hammer, so such a row is about another lot).
             -- Not applied to lots that ended unsold: auction_events.high_bid of an unsold lot is the last high bid read, which
             -- can be older than the end.
             ((coalesce(sc.sched_close, lt.auction_end_date) IS NULL OR c.hours_remaining IS NULL
               OR abs(extract(epoch FROM (coalesce(sc.sched_close, lt.auction_end_date)
                                          - (c.predicted_at + c.hours_remaining * interval '1 hour')))) <= 172800)
              AND (NOT (lt.outcome = 'sold' AND lt.winning_bid > 0) OR c.current_bid <= lt.winning_bid * 1.01)) AS fits
      FROM cand c
      JOIN vslug vs ON vs.vehicle_id = c.vehicle_id
      JOIN lot lt ON lt.slug = vs.slug
      LEFT JOIN sched sc ON sc.slug = lt.slug
    ), vcount AS MATERIALIZED (
      SELECT vehicle_id, count(*) AS n_slugs FROM vslug GROUP BY vehicle_id
    ), agg AS MATERIALIZED (
      SELECT c.id,
             coalesce(max(vc.n_slugs), 0) AS n_slugs,
             count(rl.ae_id) AS n_lots,
             count(rl.ae_id) FILTER (WHERE rl.fits) AS n_ok,
             (array_agg(rl.slug) FILTER (WHERE rl.fits))[1] AS pick_slug
      FROM cand c
      LEFT JOIN vcount vc ON vc.vehicle_id = c.vehicle_id
      LEFT JOIN rowlots rl ON rl.id = c.id
      GROUP BY c.id
    ), judged AS MATERIALIZED (
      SELECT c.*, rl.slug, rl.ae_id, rl.winning_bid,
             CASE
               WHEN a.n_slugs = 0 THEN 'no_lot_key'
               WHEN a.n_lots = 0 THEN 'no_outcome'
               WHEN a.n_ok = 0 THEN 'lot_mismatch'
               WHEN a.n_ok >= 2 THEN 'lot_ambiguous'
               WHEN rl.n_hammers > 1 THEN 'lot_conflict'
               WHEN rl.outcome = 'sold' AND rl.winning_bid > 0 THEN 'sold'
               WHEN rl.outcome IN ('reserve_not_met', 'bid_to') THEN 'reserve_not_met'
               WHEN rl.outcome IN ('no_sale', 'cancelled', 'relisted') THEN 'no_sale'
               ELSE 'no_outcome'
             END AS verdict,
             CASE WHEN rl.sched_close IS NOT NULL THEN 'scheduled'
                  WHEN rl.auction_end_date IS NOT NULL THEN 'final'
                  WHEN c.hours_remaining IS NOT NULL THEN 'predicted' END AS close_basis,
             coalesce(rl.sched_close, rl.auction_end_date, c.predicted_at + c.hours_remaining * interval '1 hour') AS close_at
      FROM cand c
      JOIN agg a ON a.id = c.id
      LEFT JOIN rowlots rl ON rl.id = c.id AND a.n_ok = 1 AND rl.slug = a.pick_slug
    ), final AS MATERIALIZED (
      SELECT j.*,
             CASE WHEN j.verdict IN ('sold', 'reserve_not_met', 'no_sale') AND j.close_at IS NULL THEN 'no_close_clock'
                  WHEN j.verdict IN ('sold', 'reserve_not_met', 'no_sale') AND j.predicted_at > j.close_at THEN 'after_close'
                  ELSE j.verdict END AS result,
             (j.verdict = 'sold' AND j.close_at IS NOT NULL AND j.predicted_at <= j.close_at
              AND j.scored_at IS NULL AND j.actual_hammer IS NULL) AS grade
      FROM judged j
    ), upd AS (
      UPDATE public.hammer_predictions h
      SET auction_event_id = f.ae_id,
          lot_outcome = f.result,
          lot_close_at = f.close_at,
          lot_close_basis = f.close_basis,
          actual_hammer = CASE WHEN f.grade THEN f.winning_bid ELSE h.actual_hammer END,
          prediction_error_pct = CASE WHEN f.grade
            THEN round(((h.predicted_hammer - f.winning_bid) / f.winning_bid * 100)::numeric, 2) ELSE h.prediction_error_pct END,
          prediction_error_usd = CASE WHEN f.grade
            THEN (h.predicted_hammer - f.winning_bid)::numeric ELSE h.prediction_error_usd END,
          scored_at = CASE WHEN f.grade THEN now() ELSE h.scored_at END
      FROM final f
      WHERE h.ctid >= $1 AND h.ctid < $2
        AND h.id = f.id
        AND f.result IN ('sold', 'reserve_not_met', 'no_sale')
        AND h.auction_event_id IS NULL
      RETURNING f.slug, f.result, f.grade,
                (f.result = 'sold' AND NOT f.grade AND h.actual_hammer IS DISTINCT FROM f.winning_bid) AS conflict,
                (f.result <> 'sold' AND NOT f.grade AND h.actual_hammer IS NOT NULL) AS conflict_unsold,
                (f.winning_bid BETWEEN f.predicted_low AND f.predicted_high) AS band_held
    )
    SELECT (SELECT count(*) FROM upd WHERE grade)::bigint AS graded,
           (SELECT count(*) FROM upd WHERE grade AND band_held)::bigint AS held,
           (SELECT count(*) FROM upd)::bigint AS written,
           (SELECT count(*) FROM upd WHERE result = 'sold' AND NOT grade)::bigint AS keyed_legacy,
           (SELECT count(*) FROM upd WHERE conflict OR conflict_unsold)::bigint AS grade_conflicts,
           (SELECT count(DISTINCT slug) FROM upd)::bigint AS lots,
           (SELECT count(*) FROM upd WHERE result = 'reserve_not_met')::bigint AS skipped_reserve_not_met,
           (SELECT count(*) FROM upd WHERE result = 'no_sale')::bigint AS skipped_no_sale,
           count(*) FILTER (WHERE f.result = 'no_lot_key')::bigint AS skipped_no_lot_key,
           count(*) FILTER (WHERE f.result = 'no_outcome')::bigint AS skipped_no_outcome,
           count(*) FILTER (WHERE f.result = 'lot_ambiguous')::bigint AS skipped_lot_ambiguous,
           count(*) FILTER (WHERE f.result = 'lot_conflict')::bigint AS skipped_lot_conflict,
           count(*) FILTER (WHERE f.result = 'lot_mismatch')::bigint AS skipped_lot_mismatch,
           count(*) FILTER (WHERE f.result = 'no_close_clock')::bigint AS skipped_no_close_clock,
           count(*) FILTER (WHERE f.result = 'after_close')::bigint AS skipped_after_close,
           (SELECT count(*) FROM public.hammer_predictions h
            WHERE h.ctid >= $1 AND h.ctid < $2 AND h.auction_event_id IS NOT NULL)::bigint AS skipped_already_graded
    FROM final f
  $q$ INTO v_res USING v_lo, v_hi;

  -- hammer_predictions has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_res.written > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('hammer_predictions', 'UPDATE', v_res.written::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  -- New tuple versions may have extended the heap; the walk is done only when it has passed the current end.
  v_blocks_after := pg_catalog.pg_relation_size('public.hammer_predictions') / current_setting('block_size')::bigint;

  -- Hand the caller's declared writer back for the rest of its transaction.
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object(
    'graded', v_res.graded,
    'held', v_res.held,
    'written', v_res.written,
    'keyed_legacy', v_res.keyed_legacy,
    'grade_conflicts', v_res.grade_conflicts,
    'lots', v_res.lots,
    'skipped_reserve_not_met', v_res.skipped_reserve_not_met,
    'skipped_no_sale', v_res.skipped_no_sale,
    'skipped_no_lot_key', v_res.skipped_no_lot_key,
    'skipped_no_outcome', v_res.skipped_no_outcome,
    'skipped_lot_ambiguous', v_res.skipped_lot_ambiguous,
    'skipped_lot_conflict', v_res.skipped_lot_conflict,
    'skipped_lot_mismatch', v_res.skipped_lot_mismatch,
    'skipped_no_close_clock', v_res.skipped_no_close_clock,
    'skipped_after_close', v_res.skipped_after_close,
    'skipped_already_graded', v_res.skipped_already_graded,
    'from_block', p_from_block,
    'next_block', v_next,
    'blocks_scanned', greatest(0, least(v_next, v_table_blocks) - p_from_block),
    'table_blocks', v_blocks_after,
    'remaining_blocks', greatest(0, v_blocks_after - v_next),
    'est_rows_remaining_to_scan', round(greatest(0, v_blocks_after - v_next) * v_rows_per_page),
    'done', v_next >= v_blocks_after OR v_next >= c_max_block
  );
END
$fn$;

COMMENT ON FUNCTION public.grade_hammer_predictions_by_lot(integer, bigint) IS
'Sanctioned per-lot grader of hammer_predictions (2026-10-07). Scans about p_batch rows by physical block range starting at p_from_block. For each row that carries no lot key it finds the BaT lot its vehicle was predicted for (the slug of bringatrailer.com/listing/<slug>, lower-cased, from vehicles.listing_url, the vehicle''s own auction_events rows and the lot URL on its observations; exactly one candidate lot that fits: its close lies within 48 h of the close the row recorded and, if it sold, its hammer is not passed by the bid the row saw; else the row is held), reads how that lot ended from auction_events only (a sold row with a hammer; reserve_not_met and bid_to; no_sale, cancelled and relisted; live and pending wait), and writes auction_event_id, lot_outcome, lot_close_at and lot_close_basis. For a sold lot it also fills actual_hammer, prediction_error_pct, prediction_error_usd and scored_at when the row has no grade; a grade already there is kept and a disagreement with the lot is counted (grade_conflicts). The close is the earliest previous_scheduled_end in the lot''s bat_public_live_v1 frames (scheduled), else auction_events.auction_end_date (final), else predicted_at + hours_remaining (predicted); a row made after its close is not written. Never reads bat_listings. Idempotent: a keyed row is not visited again. One write_receipts row per call that wrote. Returns graded, held (graded rows whose stored band held the hammer), written, keyed_legacy, grade_conflicts, lots, skipped_* by reason (reserve_not_met and no_sale rows get an outcome and no hammer grade), next_block, remaining_blocks and done. The caller must set statement_timeout between 1 ms and 60 s. EXECUTE: service_role only.';

REVOKE ALL ON FUNCTION public.grade_hammer_predictions_by_lot(integer, bigint) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.grade_hammer_predictions_by_lot(integer, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.grade_hammer_predictions_by_lot(integer, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.grade_hammer_predictions_by_lot(integer, bigint) TO service_role;
  END IF;
END $grants$;

-- 4. Shape: from here the transaction holds ACCESS EXCLUSIVE on hammer_predictions ---------------------------------------
ALTER TABLE public.hammer_predictions
  ADD COLUMN auction_event_id uuid,
  ADD COLUMN lot_outcome text,
  ADD COLUMN lot_close_at timestamptz,
  ADD COLUMN lot_close_basis text,
  ADD CONSTRAINT hammer_predictions_lot_outcome_check
    CHECK (lot_outcome IN ('sold', 'reserve_not_met', 'no_sale')),
  ADD CONSTRAINT hammer_predictions_lot_close_basis_check
    CHECK (lot_close_basis IN ('scheduled', 'final', 'predicted')),
  -- A row is unresolved (all four NULL) or resolved (outcome, close and basis set, with or without the key: deleting a
  -- lot row sets the key NULL and leaves what was read from it).
  ADD CONSTRAINT hammer_predictions_lot_resolved_check
    CHECK ((lot_outcome IS NULL) = (lot_close_at IS NULL) AND (lot_outcome IS NULL) = (lot_close_basis IS NULL)
           AND (auction_event_id IS NULL OR lot_outcome IS NOT NULL));

-- Partial: an unresolved row has no entry. Serves the foreign key's delete check and the readers of one lot's predictions.
CREATE INDEX idx_hammer_predictions_auction_event
  ON public.hammer_predictions (auction_event_id)
  WHERE auction_event_id IS NOT NULL;
COMMENT ON INDEX public.idx_hammer_predictions_auction_event IS
'Partial btree on the lot key (rows with a key). Serves the foreign key''s delete check and readers of one lot''s predictions. 2026-10-07.';

COMMENT ON COLUMN public.hammer_predictions.auction_event_id IS
'The lot this prediction is about, as a key: FK to auction_events.id (ON DELETE SET NULL). One lot row of the BaT listing slug, the sold row when there is one, else the newest; the lot''s identity is the slug in its source_url. NULL = not resolved yet: no lot key, no lot row, lot still open, several lots fit, or the prediction was made after the close. Written only by grade_hammer_predictions_by_lot (2026-10-07). Unit: none. Grain: one prediction. Clock: n/a. external_listing_id is not this key: model 24 sets it on every row, and 8 of its 4,654 distinct ids name an external_listings row (2026-10-07).';
COMMENT ON COLUMN public.hammer_predictions.lot_outcome IS
'How the lot ended, read from auction_events when the row was resolved (CHECK): sold (auction_events.outcome sold with a winning_bid), reserve_not_met (reserve_not_met or bid_to: a high bid and no sale), no_sale (no_sale, cancelled or relisted). NULL = not resolved. A sold row carries a hammer grade in actual_hammer; the other two carry none by design. Unit: none. Source: auction_events.outcome. Grain: one prediction. Clock: state of the lot row at resolution (set with scored_at).';
COMMENT ON COLUMN public.hammer_predictions.lot_close_at IS
'The close this prediction is measured against, UTC; lot_close_basis says where it came from. A prediction counts only if predicted_at is at or before it. Unit: timestamptz. Source: bat_public_live_v1 frames, auction_events.auction_end_date, or predicted_at + hours_remaining. Grain: one prediction. Clock: event (source close). NULL = not resolved.';
COMMENT ON COLUMN public.hammer_predictions.lot_close_basis IS
'Where lot_close_at came from (CHECK): scheduled = the earliest previous_scheduled_end in the lot''s bat_public_live_v1 live frames, the close before soft-close extensions (live collector lots only); final = auction_events.auction_end_date, the close after extensions (NULL on 496 of 740 sold model 24 lots, 2026-10-07); predicted = predicted_at + hours_remaining, the close the predictor believed at that moment. Unit: none. Grain: one prediction. NULL = not resolved.';

-- Describe the columns the grader reads and fills (0 of 31 had a description; written once, a newer description is extended).
DO $describe$
DECLARE
  r record;
  cur text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('vehicle_id', 'Vehicle the prediction was made for. No foreign key: 3,932 of the 4,622 model 24 ids name no vehicles row (2026-10-07), so it does not identify the lot; auction_event_id does. Unit: none. Source: the predictor (score-live-auctions, live-bands.mjs). Grain: one prediction. Clock: n/a.'),
    ('model_version', 'Which model made the prediction. 24: current bid times a median multiplier by price tier and hours to close, band p25 to p75 of the multiplier, hourly rows per lot (supabase/functions/_shared/predictionEngine.ts). 30 and 31: title-only comparable-sales band, one row per lot when it is first seen live (scripts/market/live-bands.mjs; 31 weights toward the lot''s variant). Rows by version, 2026-10-07: 6: 2, 13: 4,824, 24: 45,798, 30: 983, 31: 2,314, 100: 1. Count lots per model_version, not rows. Unit: none. Grain: one prediction.'),
    ('external_listing_id', 'Listing row the predictor meant, uuid, no foreign key. Model 24 sets it on every row but 8 of its 4,654 distinct ids name an external_listings row, 714 name a vehicle_events row and none an auction_events row (2026-10-07); models 30 and 31 leave it NULL. Not the lot key: see auction_event_id. Unit: none. Grain: one prediction.'),
    ('hours_remaining', 'Hours from predicted_at to the close the predictor knew at that moment (the schedule then, not the close after soft-close extensions). Unit: hours. Source: the predictor. Grain: one prediction. Clock: derived (as of predicted_at). Used for lot_close_at when no better close exists, and to tell a vehicle''s lots apart (auction_event_id).'),
    ('predicted_low', 'Lower bound of the stated band. Model 31 (and 30): p10 of the variant-weighted comparable sales, an 80% band with predicted_high as p90 (scripts/market/live-bands.mjs). Model 24: bid times the p25 multiplier (a 50% band with p75; supabase/functions/_shared/predictionEngine.ts). Unit: USD. Grain: one prediction. Clock: as of predicted_at.'),
    ('predicted_hammer', 'The prediction: the middle of the band, the price the lot is expected to close at. Model 31: p50 of the weighted comparable sales. Model 24: current_bid times the median multiplier and adjustments. Unit: USD. Grain: one prediction. Clock: as of predicted_at. Graded against the lot''s hammer (actual_hammer).'),
    ('predicted_high', 'Upper bound of the stated band. Model 31 (and 30): p90 of the weighted comparable sales (80% band). Model 24: bid times the p75 multiplier (50% band). Unit: USD. Grain: one prediction. Clock: as of predicted_at.'),
    ('predicted_at', 'When the prediction was made; the event time of the row. Unit: timestamptz. Source: the predictor. Grain: one prediction. A prediction counts toward a grade only if it is at or before lot_close_at.'),
    ('actual_hammer', 'Hammer price of the lot the prediction is about, in USD, buyer fee excluded: auction_events.winning_bid of the lot named by auction_event_id. Filled by grade_hammer_predictions_by_lot for sold lots (2026-10-07), never from bat_listings.sale_price (which also holds the high bid of reserve-not-met lots). Rows graded before that by score_closed_predictions joined external_listings by vehicle_id and can name another lot of a relisted vehicle; the grader keeps them and counts the disagreement. Unit: USD. Grain: one prediction. Clock: event (value at sale).'),
    ('prediction_error_pct', 'Signed error of predicted_hammer against actual_hammer: (predicted_hammer - actual_hammer) / actual_hammer * 100, rounded to 2 places. Unit: percent. Filled with actual_hammer by grade_hammer_predictions_by_lot. Grain: one prediction.'),
    ('prediction_error_usd', 'Signed error of predicted_hammer against actual_hammer in USD (predicted_hammer - actual_hammer). Filled with actual_hammer by grade_hammer_predictions_by_lot. Unit: USD. Grain: one prediction.'),
    ('scored_at', 'When the grade was written (ingest clock; the hammer''s event time is lot_close_at). NULL = no hammer grade: unresolved, or the lot ended without a sale (lot_outcome reserve_not_met or no_sale). Unit: timestamptz. Source: grade_hammer_predictions_by_lot, or score_closed_predictions before 2026-10-07 (608 rows). Grain: one prediction.')
  ) t(col, txt)
  LOOP
    cur := col_description('public.hammer_predictions'::regclass,
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.hammer_predictions'::regclass AND attname = r.col));
    IF cur IS NULL THEN
      EXECUTE format('COMMENT ON COLUMN public.hammer_predictions.%I IS %L', r.col, r.txt);
    ELSIF cur NOT LIKE '%grade_hammer_predictions_by_lot%' AND cur NOT LIKE '%auction_event_id%' THEN
      EXECUTE format('COMMENT ON COLUMN public.hammer_predictions.%I IS %L', r.col, cur || ' ' || r.txt);
    END IF;
  END LOOP;

  cur := obj_description('public.hammer_predictions'::regclass, 'pg_class');
  IF cur IS NOT NULL AND cur NOT LIKE '%grade_hammer_predictions_by_lot%' THEN
    EXECUTE format('COMMENT ON TABLE public.hammer_predictions IS %L', cur
      || ' Per-lot grades (2026-10-07): grade_hammer_predictions_by_lot(p_batch, p_from_block) keys each prediction to its lot (auction_event_id), records how the lot ended (lot_outcome) and the close it is measured against (lot_close_at, lot_close_basis), and fills the grade columns for sold lots. v_prediction_lot_grades picks, for each model and lot, the last prediction before the close and the one standing at 24 h, 6 h, 1 h and T-2 before it; prediction_accuracy counts lots, not rows. score_closed_predictions joins external_listings, which does not hold these lots; its cron (hammer-score-predictions) is paused.');
  END IF;
END
$describe$;

-- 5. Readers -------------------------------------------------------------------------------------------------------------
-- One row per (model, lot, horizon): the lot is the unit. last = the latest prediction made before the close; 24h, 6h, 1h and
-- t2 (two minutes) = the latest one made at least that long before it, i.e. the prediction standing at that moment (point in
-- time: nothing later is read). t2 needs a scheduled close from live frames. The hammer is read from the lot row the key
-- names, so a grade stored before the key existed cannot reach the unit. One lot predicted under several vehicle ids is one
-- lot: the lot's identity is the slug in its URL. hours_before_close is the age of the standing prediction: a prior made a
-- week out is the 24h row too, and says so.
CREATE VIEW public.v_prediction_lot_grades AS
WITH g AS (
  SELECT p.model_version,
         lower(substring(ae.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS lot,
         p.auction_event_id,
         p.id AS prediction_id,
         p.vehicle_id,
         p.predicted_at,
         p.lot_close_at AS close_at,
         p.lot_close_basis AS close_basis,
         p.lot_outcome AS outcome,
         extract(epoch FROM (p.lot_close_at - p.predicted_at)) / 3600.0 AS hours_before_close,
         p.predicted_low, p.predicted_hammer, p.predicted_high,
         CASE WHEN p.lot_outcome = 'sold' AND ae.winning_bid > 0 THEN ae.winning_bid END AS actual_hammer
  FROM public.hammer_predictions p
  JOIN public.auction_events ae ON ae.id = p.auction_event_id
  WHERE p.lot_outcome IS NOT NULL
    AND p.predicted_at <= p.lot_close_at
    AND ae.source_url ~ 'bringatrailer\.com/listing/'
), h AS (
  SELECT g.*, hz.horizon,
         row_number() OVER (PARTITION BY g.model_version, g.lot, hz.horizon ORDER BY g.predicted_at DESC, g.prediction_id) AS rn
  FROM g
  JOIN (VALUES ('last', 0.0), ('24h', 24.0), ('6h', 6.0), ('1h', 1.0), ('t2', 2.0 / 60.0)) hz(horizon, min_hours)
    ON g.hours_before_close >= hz.min_hours
   AND (hz.horizon <> 't2' OR g.close_basis = 'scheduled')
)
SELECT h.model_version,
       h.lot,
       h.auction_event_id,
       h.horizon,
       h.prediction_id,
       h.vehicle_id,
       h.predicted_at,
       round(h.hours_before_close::numeric, 2) AS hours_before_close,
       h.close_at,
       h.close_basis,
       h.outcome,
       h.predicted_low,
       h.predicted_hammer,
       h.predicted_high,
       h.actual_hammer,
       round(((h.predicted_hammer - h.actual_hammer) / h.actual_hammer * 100)::numeric, 2) AS error_pct,
       round((abs(h.predicted_hammer - h.actual_hammer) / h.actual_hammer * 100)::numeric, 2) AS abs_error_pct,
       (h.actual_hammer BETWEEN h.predicted_low AND h.predicted_high) AS band_held
FROM h
WHERE h.rn = 1;

COMMENT ON VIEW public.v_prediction_lot_grades IS
'One row per model_version, BaT lot and horizon: the lot is the unit (2026-10-07). Horizons: last = the latest prediction made before the lot''s close; 24h, 6h, 1h and t2 = the latest one made at least 24 h, 6 h, 1 h or 2 minutes before it (the prediction standing then; t2 only where lot_close_basis is scheduled). hours_before_close is that prediction''s age. outcome is sold, reserve_not_met or no_sale; actual_hammer, error_pct (signed, predicted minus actual over actual), abs_error_pct and band_held are set for sold lots only, from auction_events.winning_bid through hammer_predictions.auction_event_id. Count lots with count(*) (a lot appears once per model and horizon); say the denominator with it: lots with an outcome, lots sold, rows by close_basis. Rows come from grade_hammer_predictions_by_lot, so lots it has not reached, or holds (no lot key, no lot row, lot open, ambiguous, after close), are absent: compare with hammer_predictions. service_role only.';

REVOKE ALL ON public.v_prediction_lot_grades FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.v_prediction_lot_grades FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.v_prediction_lot_grades FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.v_prediction_lot_grades TO service_role;
  END IF;
END $grants$;

-- prediction_accuracy keeps its nine columns (names, types, order) and counts lots now: the last prediction before the
-- close, one row per lot, where it counted every graded row (hourly rows, 399 'scored' for 7 lots of model 24). Four columns
-- are appended. Nothing in the repo or the database reads it (searched views, functions and code 2026-10-07).
CREATE OR REPLACE VIEW public.prediction_accuracy AS
SELECT model_version,
       count(*) AS total_predictions,
       count(actual_hammer) AS scored,
       round(avg(abs_error_pct), 2) AS avg_abs_error_pct,
       round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (abs_error_pct::double precision))::numeric, 2) AS median_abs_error_pct,
       round(avg(error_pct), 2) AS avg_bias_pct,
       count(*) FILTER (WHERE abs_error_pct < 5::numeric) AS within_5pct,
       count(*) FILTER (WHERE abs_error_pct < 10::numeric) AS within_10pct,
       count(*) FILTER (WHERE abs_error_pct < 20::numeric) AS within_20pct,
       count(*) FILTER (WHERE outcome <> 'sold') AS lots_without_hammer,
       count(band_held) AS bands_scored,
       count(*) FILTER (WHERE band_held) AS bands_held,
       round(100.0 * count(*) FILTER (WHERE band_held) / nullif(count(band_held), 0), 1) AS band_hold_pct
FROM public.v_prediction_lot_grades
WHERE horizon = 'last'
GROUP BY model_version;

COMMENT ON VIEW public.prediction_accuracy IS
'Accuracy of the stored hammer predictions, one row per model_version, counted in LOTS at the last prediction before the close (from 2026-10-07; before, it counted every graded hourly row: 399 scored for 7 lots of model 24). total_predictions = lots that ended with an outcome (sold, reserve_not_met, no_sale); scored = lots sold, with a hammer to grade against; avg_abs_error_pct, median_abs_error_pct, avg_bias_pct (signed) and within_5/10/20pct are over the sold lots; lots_without_hammer = total minus sold; bands_scored = sold lots with a stated band; bands_held = those whose band contained the hammer; band_hold_pct = held over scored. Model 31 and 30 state an 80% band (p10 to p90), model 24 a 50% band (p25 to p75): compare band_hold_pct with that. Other horizons and the denominators: v_prediction_lot_grades. The lots it has not reached are not in it: compare with hammer_predictions.';

-- 6. The foreign key last: adding it takes SHARE ROW EXCLUSIVE on auction_events until COMMIT -----------------------------
ALTER TABLE public.hammer_predictions
  ADD CONSTRAINT hammer_predictions_auction_event_id_fkey
  FOREIGN KEY (auction_event_id) REFERENCES public.auction_events(id) ON DELETE SET NULL;

COMMIT;
