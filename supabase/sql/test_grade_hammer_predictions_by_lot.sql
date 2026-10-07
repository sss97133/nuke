-- Isolated PostgreSQL 17 contract for 20261007170000_grade_hammer_predictions_by_lot.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_grade_hammer_predictions_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_grade_hammer_predictions_ci -f supabase/sql/test_grade_hammer_predictions_by_lot.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07: hammer_predictions (all 31 columns, its indexes, the live
-- table comment), prediction_accuracy (the live view; the fixture's definition has the prod md5), auction_events (the
-- columns the grader reads, the natural-key unique index and the lot-slug expression index), vehicles,
-- vehicle_observations, monitored_auctions, write_receipts, pipeline_registry and schema_proposals (with its vocabulary).
-- Cases, by lot (a lot is a BaT listing slug):
--   * 1990-lot-a: sold, final close; six hourly predictions of model 24, one made after the close, one model 31 prior a week out;
--   * 1991-lot-b-ghost: sold; the predicted vehicle has no vehicles row, the lot is found through its observation URL;
--   * 1992-lot-c-rnm (reserve not met), 1993-lot-d-nosale: an outcome and no hammer grade; bat_listings is not in the
--     fixture, so a read of its sale_price would fail the walk;
--   * 1994-lot-e-live: waits; closes later in the test and is graded by the next pass only;
--   * 1995-lot-f-frames: live frames give the scheduled close, six minutes before the final one; a prediction between the two
--     is not written; the T-2 horizon is available;
--   * 1996-lot-g-nullend: no auction_end_date, the close is predicted_at + hours_remaining; 2005-lot-q: no close clock at all;
--   * a vehicle with two lots: the prediction goes to the one whose close fits; two lots that both fit leave it held; a lot
--     whose close is far from the prediction's own is held; two sold rows with different hammers are held;
--   * one lot under two vehicles with a stale live duplicate row: one lot, the sold row;
--   * legacy grades (score_closed_predictions): kept, keyed, a disagreement with the lot counted, never overwritten;
--   * no lot key, no lot row.
-- Then: the migration, the drift guard, grants, the declared writer, receipts, the block cursor, idempotence, the
-- per-lot views (lots as the unit, point in time, the hammer from auction_events), prediction_accuracy.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.hammer_predictions') IS NOT NULL
     OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
-- Prod's deploy role owns the tables and is not a superuser. The fixture is built, and the migration applied, as such a
-- role, so a statement only a superuser may run fails here as it failed on prod (#722: a function-level SET of
-- app.writer, "permission denied to set parameter").
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;
-- Supabase grants every new table and view in public to the three API roles by default; the migration must revoke.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes ------------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, listing_url text);
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, extraction_method text, structured_data jsonb);
CREATE INDEX idx_observations_vehicle ON public.vehicle_observations USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL);
CREATE TABLE public.auction_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  source text NOT NULL,
  source_url text,
  auction_end_date timestamptz,
  outcome text NOT NULL,
  winning_bid numeric,
  high_bid numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_events_outcome_check CHECK (outcome = ANY (ARRAY['sold', 'reserve_not_met', 'no_sale', 'bid_to',
    'cancelled', 'relisted', 'pending', 'live'])));
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events USING btree (vehicle_id, source_url);
CREATE INDEX idx_auction_events_vehicle ON public.auction_events USING btree (vehicle_id);
CREATE INDEX idx_auction_events_bat_lot_slug ON public.auction_events
  USING btree (lower("substring"(source_url, 'bringatrailer\.com/listing/([^/?#]+)'::text)));
CREATE TABLE public.monitored_auctions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_auction_id text, vehicle_id uuid, stream_state jsonb);
CREATE TABLE public.hammer_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid NOT NULL,
  external_listing_id uuid,
  current_bid numeric NOT NULL,
  bid_count integer, view_count integer, watcher_count integer, unique_bidders integer,
  hours_remaining numeric, time_window text, price_tier text,
  model_version integer NOT NULL DEFAULT 1,
  bid_velocity numeric, bid_to_watcher_ratio numeric, watcher_to_view_ratio numeric,
  comp_median numeric, comp_count integer,
  predicted_hammer numeric NOT NULL, predicted_low numeric, predicted_high numeric,
  multiplier_used numeric, confidence_score numeric, predicted_margin numeric, predicted_flip_margin numeric,
  buy_recommendation text,
  actual_hammer numeric, prediction_error_pct numeric, prediction_error_usd numeric, scored_at timestamptz,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  notes text);
-- Fixture only: padding stays inline (no compression, no TOAST), so a padded row needs a page of its own.
ALTER TABLE public.hammer_predictions ALTER COLUMN notes SET STORAGE PLAIN;
CREATE INDEX idx_hammer_predictions_vehicle ON public.hammer_predictions USING btree (vehicle_id);
CREATE INDEX idx_hammer_predictions_predicted_at ON public.hammer_predictions USING btree (predicted_at DESC);
COMMENT ON TABLE public.hammer_predictions IS
'Hammer-price predictions on live auctions: one row per prediction for a lot at a moment, with its inputs (bid, counts, hours remaining, comps), predicted range and recommendation, and later the actual result (grain: lot x prediction moment). Writer: score-live-auctions; SQL score_closed_predictions fills actual_hammer and prediction_error_pct. Event time = predicted_at (2026-02-19 .. 2026-10-06); scored_at when graded (608 graded). Created by 20260218100000_hammer_prediction_engine.';
-- The live prediction_accuracy, as read from prod 2026-10-07 (md5 of pg_get_viewdef(oid, true) df2da898...).
CREATE VIEW public.prediction_accuracy AS
 SELECT model_version,
    count(*) AS total_predictions,
    count(actual_hammer) AS scored,
    round(avg(abs(prediction_error_pct)), 2) AS avg_abs_error_pct,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (abs(prediction_error_pct)::double precision))::numeric, 2) AS median_abs_error_pct,
    round(avg(prediction_error_pct), 2) AS avg_bias_pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 5::numeric) AS within_5pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 10::numeric) AS within_10pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 20::numeric) AS within_20pct
   FROM hammer_predictions
  WHERE scored_at IS NOT NULL
  GROUP BY model_version;
-- As on prod (relacl anon=awdDxt, authenticated=awdDxt): the API roles cannot SELECT from it.
REVOKE SELECT ON public.prediction_accuracy FROM anon, authenticated;
SELECT pg_temp.ok('fixture fidelity: the fixture prediction_accuracy has the prod definition (md5 of pg_get_viewdef)',
  left(md5(pg_get_viewdef('public.prediction_accuracy'::regclass, true)), 16) = 'df2da8985aba061f');
CREATE TEMP TABLE accuracy_columns_before AS
  SELECT a.attnum, a.attname::text AS attname, format_type(a.atttypid, a.atttypmod) AS typ
  FROM pg_attribute a WHERE a.attrelid = 'public.prediction_accuracy'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, write_via)
VALUES ('hammer_predictions', NULL, 'scripts/market/live-bands.mjs', 'Prediction ledger for live auctions.',
        'scripts/market/live-bands.mjs (REST insert with the service key); score_closed_predictions (called by score-live-auctions) fills actual_hammer and prediction_error_pct.');
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL,
  app_name text, txid bigint NOT NULL);
CREATE TABLE public.schema_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposed_at timestamptz NOT NULL DEFAULT now(),
  proposed_by_user_id uuid, proposed_by_agent_key text, proposal_type text NOT NULL,
  payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb, motivating_observation_ids uuid[],
  motivating_pending_claim_ids uuid[], estimated_scope jsonb, backward_compatibility jsonb,
  status text NOT NULL DEFAULT 'open', claimed_by_user_id uuid, claimed_at timestamptz,
  resolved_at timestamptz, decision_rationale text, promoted_to_id uuid,
  supersedes_proposal_id uuid REFERENCES public.schema_proposals(id), superseded_by uuid REFERENCES public.schema_proposals(id),
  CONSTRAINT proposer_present CHECK (proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
  CONSTRAINT schema_proposals_status_check CHECK (status = ANY (ARRAY['open', 'under_review', 'approved', 'rejected',
    'needs_changes', 'superseded', 'withdrawn'])),
  CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['add_property', 'fork_property',
    'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier', 'add_observation_kind',
    'add_source_category', 'add_image_attribute', 'add_column', 'add_table'])));

-- Probe: the writer a statement-level trigger (record_write_receipt reads the same setting) sees on each UPDATE.
CREATE TABLE public.probe_update_writers(writer text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.probe_update_writers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.probe_update_writers(writer) VALUES (current_setting('app.writer', true)); RETURN NULL; END $$;
CREATE TRIGGER zz_probe_update_writers AFTER UPDATE ON public.hammer_predictions
  FOR EACH STATEMENT EXECUTE FUNCTION public.probe_update_writers();

-- Rows -------------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE v(name text PRIMARY KEY, id uuid);
INSERT INTO v SELECT n, gen_random_uuid()
FROM unnest(ARRAY['va', 'vb', 'vc', 'vd', 've', 'vf', 'vg', 'vh', 'vi', 'vj', 'vk1', 'vk2', 'vl1', 'vl2', 'vm', 'vn',
                  'vo', 'vp', 'vq', 'vr', 'vs', 'vz']) n;
-- vb (a ghost: no vehicles row) and vn, vz carry no listing_url.
INSERT INTO public.vehicles (id, listing_url)
SELECT v.id, u.url FROM v JOIN (VALUES
  ('va',  'https://bringatrailer.com/listing/1990-lot-a/'),
  ('vc',  'https://bringatrailer.com/listing/1992-lot-c-rnm/'),
  ('vd',  'https://bringatrailer.com/listing/1993-lot-d-nosale/'),
  ('ve',  'https://bringatrailer.com/listing/1994-lot-e-live/'),
  ('vf',  'https://bringatrailer.com/listing/1995-lot-f-frames/'),
  ('vg',  'https://bringatrailer.com/listing/1996-lot-g-nullend/'),
  ('vh',  'https://bringatrailer.com/listing/1997-lot-h-2/'),
  ('vi',  NULL),
  ('vj',  'https://bringatrailer.com/listing/1999-lot-j/'),
  ('vk1', 'https://bringatrailer.com/listing/2000-lot-k/'),
  ('vk2', 'https://bringatrailer.com/listing/2000-lot-k/'),
  ('vl1', 'https://bringatrailer.com/listing/2001-lot-l/'),
  ('vl2', 'https://bringatrailer.com/listing/2001-lot-l/'),
  ('vm',  NULL),
  ('vn',  NULL),
  ('vo',  'https://bringatrailer.com/listing/2003-lot-o-2/'),
  ('vp',  'https://bringatrailer.com/listing/2004-lot-p/'),
  ('vq',  'https://bringatrailer.com/listing/2005-lot-q/'),
  ('vr',  NULL),
  ('vs',  'https://bringatrailer.com/listing/2007-lot-s/'),
  ('vz',  NULL)) u(name, url) ON u.name = v.name;
-- The lot rows (auction_events). Upper-case slug and query-string spellings of the URL name the same lot (the slug is lower-cased).
INSERT INTO public.auction_events (vehicle_id, source, source_url, auction_end_date, outcome, winning_bid, high_bid, updated_at)
SELECT v.id, 'bat', e.url, e.end_at::timestamptz, e.outcome, e.hammer, e.high, e.upd::timestamptz
FROM (VALUES
  ('va',  'https://bringatrailer.com/listing/1990-lot-a/',              '2026-10-01 18:00:00Z', 'sold',            20000, 20000, '2026-10-02'),
  ('vb',  'https://bringatrailer.com/listing/1991-lot-b-ghost',         '2026-10-02 12:00:00Z', 'sold',            50000, 50000, '2026-10-03'),
  ('vc',  'https://bringatrailer.com/listing/1992-lot-c-rnm/',          '2026-10-03 10:00:00Z', 'reserve_not_met', NULL,  30000, '2026-10-04'),
  ('vd',  'https://bringatrailer.com/listing/1993-lot-d-nosale/',       '2026-10-03 10:00:00Z', 'no_sale',         NULL,  NULL,  '2026-10-04'),
  ('ve',  'https://bringatrailer.com/listing/1994-lot-e-live/',         '2026-10-09 12:00:00Z', 'live',            NULL,  40000, '2026-10-07'),
  ('vf',  'https://bringatrailer.com/listing/1995-lot-f-frames/',       '2026-10-03 18:06:23Z', 'sold',            80000, 80000, '2026-10-04'),
  ('vg',  'https://bringatrailer.com/listing/1996-lot-g-nullend/',      NULL,                   'sold',            40000, 40000, '2026-10-06'),
  ('vh',  'https://bringatrailer.com/listing/1997-lot-h/',              '2026-09-10 18:00:00Z', 'sold',            10000, 10000, '2026-09-11'),
  ('vh',  'https://bringatrailer.com/listing/1997-lot-h-2/',            '2026-10-04 18:00:00Z', 'sold',            12000, 12000, '2026-10-05'),
  ('vi',  'https://bringatrailer.com/listing/1998-lot-i/',              NULL,                   'sold',            13000, 13000, '2026-10-05'),
  ('vi',  'https://bringatrailer.com/listing/1998-lot-i-2/',            NULL,                   'sold',            14000, 14000, '2026-10-05'),
  ('vj',  'https://bringatrailer.com/listing/1999-lot-j/',              '2026-10-05 18:00:00Z', 'sold',            33000, 33000, '2026-10-06'),
  ('vk1', 'https://bringatrailer.com/listing/2000-lot-k/',              '2026-10-05 14:00:00Z', 'sold',            25000, 25000, '2026-10-06'),
  ('vk2', 'https://bringatrailer.com/listing/2000-LOT-K/?utm=2',        '2026-10-05 14:00:00Z', 'sold',            26000, 26000, '2026-10-06'),
  ('vl1', 'https://bringatrailer.com/listing/2001-lot-l/',              '2026-10-06 18:00:00Z', 'sold',            15000, 15000, '2026-10-07'),
  ('vl2', 'https://bringatrailer.com/listing/2001-lot-l/?utm=1',        NULL,                   'live',            NULL,  9000,  '2026-10-01'),
  ('vo',  'https://bringatrailer.com/listing/2003-lot-o/',              '2026-09-01 18:00:00Z', 'reserve_not_met', NULL,  52000, '2026-09-02'),
  ('vo',  'https://bringatrailer.com/listing/2003-lot-o-2/',            '2026-10-02 12:00:00Z', 'sold',            60000, 60000, '2026-10-03'),
  ('vp',  'https://bringatrailer.com/listing/2004-lot-p/',              '2026-10-02 12:00:00Z', 'bid_to',          NULL,  6000,  '2026-10-03'),
  ('vq',  'https://bringatrailer.com/listing/2005-lot-q/',              NULL,                   'sold',            9000,  9000,  '2026-10-06'),
  ('vr',  'https://bringatrailer.com/listing/2006-lot-r/',              NULL,                   'reserve_not_met', NULL,  8200,  '2026-10-04'),
  ('vr',  'https://bringatrailer.com/listing/2006-lot-r-2/',            NULL,                   'sold',            6600,  6600,  '2026-10-06'),
  ('vs',  'https://bringatrailer.com/listing/2007-lot-s/',              NULL,                   'sold',            6600,  6600,  '2026-10-06')
) e(vname, url, end_at, outcome, hammer, high, upd) JOIN v ON v.name = e.vname;
-- Observations: the ghost's lot URL, a second lot of the relisted vehicle, vm's lot (no lot row), vn's non-BaT page, and
-- the live frames of the monitored lot (the earliest previous_scheduled_end is 18:02:00; a NULL one and a non-frame
-- observation carrying the same key must not count).
INSERT INTO public.vehicle_observations (vehicle_id, source_url, extraction_method, structured_data)
SELECT v.id, o.url, o.method, o.sd::jsonb
FROM (VALUES
  ('vb', 'https://bringatrailer.com/listing/1991-lot-b-ghost',        'extract-bat-core',   '{}'),
  ('vh', 'https://bringatrailer.com/listing/1997-lot-h',               'extract-bat-core',   '{}'),
  ('vm', 'https://bringatrailer.com/listing/2002-lot-m-missing',       'extract-bat-core',   '{}'),
  ('vn', 'https://www.carsandbids.com/auctions/abc/1990-something',    'extract-bat-core',   '{}'),
  ('vf', 'https://bringatrailer.com/listing/1995-lot-f-frames',        'bat_public_live_v1', '{"previous_scheduled_end": "2026-10-03T18:04:11+00:00"}'),
  ('vf', 'https://bringatrailer.com/listing/1995-lot-f-frames',        'bat_public_live_v1', '{"previous_scheduled_end": "2026-10-03T18:02:00+00:00"}'),
  ('vf', 'https://bringatrailer.com/listing/1995-lot-f-frames',        'bat_public_live_v1', '{"previous_scheduled_end": "2026-10-03T18:06:23+00:00"}'),
  ('vf', 'https://bringatrailer.com/listing/1995-lot-f-frames',        'bat_public_live_v1', '{"previous_scheduled_end": null}'),
  ('vf', 'https://bringatrailer.com/listing/1995-lot-f-frames',        'extract-bat-core',   '{"previous_scheduled_end": "2026-10-03T17:00:00+00:00"}')
) o(vname, url, method, sd) JOIN v ON v.name = o.vname;
INSERT INTO public.monitored_auctions (external_auction_id, vehicle_id, stream_state)
SELECT '1995-lot-f-frames', id, '{"last_frame_received_at": "2026-10-03T18:07:00+00:00"}'::jsonb FROM v WHERE name = 'vf';
-- A monitored lot with no frames yet must not give a scheduled close.
INSERT INTO public.monitored_auctions (external_auction_id, vehicle_id, stream_state)
SELECT '1996-lot-g-nullend', id, '{}'::jsonb FROM v WHERE name = 'vg';

-- Predictions. pred(model, vehicle, close, hours before it, low, mid, high [, hours_remaining the row recorded]).
CREATE FUNCTION pg_temp.pred(p_model int, p_vehicle text, p_close timestamptz, p_hbc numeric,
                             p_low numeric, p_mid numeric, p_high numeric, p_hours numeric DEFAULT NULL,
                             p_pad int DEFAULT 0) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.hammer_predictions (vehicle_id, current_bid, hours_remaining, model_version,
                                         predicted_hammer, predicted_low, predicted_high, predicted_at, notes)
  SELECT v.id, p_low, coalesce(p_hours, p_hbc), p_model, p_mid, p_low, p_high, p_close - p_hbc * interval '1 hour',
         CASE WHEN p_pad > 0 THEN repeat('y', p_pad) END
  FROM v WHERE v.name = p_vehicle;
$$;

-- First rows land in heap block 0.
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 30,   8000, 12000, 16000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 25,   9000, 13000, 18000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 10,  12000, 17000, 22000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 5,   14000, 19000, 24000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 1.5, 16000, 20000, 24000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 0.5, 17000, 21000, 25000);
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', -0.2, 20000, 20000, 20000, 0.1);   -- made 12 minutes after the close
SELECT pg_temp.pred(31, 'va', '2026-10-01 18:00:00Z', 160, 15000, 22000, 30000);          -- the prior, a week out
-- Filler: 600 rows of a vehicle that names no lot, over many heap blocks.
INSERT INTO public.hammer_predictions (vehicle_id, current_bid, hours_remaining, model_version, predicted_hammer,
                                       predicted_low, predicted_high, predicted_at, notes)
SELECT v.id, 1000, 5, 24, 1500, 1000, 2000, '2026-09-01 00:00:00Z'::timestamptz + g * interval '1 minute', repeat('x', 300)
FROM v, generate_series(1, 600) g WHERE v.name = 'vz';
-- Sold, ghost vehicle.
SELECT pg_temp.pred(24, 'vb', '2026-10-02 12:00:00Z', 3, 40000, 45000, 52000);
SELECT pg_temp.pred(24, 'vb', '2026-10-02 12:00:00Z', 1, 30000, 35000, 45000);
-- Reserve not met, no sale, live.
SELECT pg_temp.pred(24, 'vc', '2026-10-03 10:00:00Z', 6, 20000, 25000, 30000);
SELECT pg_temp.pred(24, 'vc', '2026-10-03 10:00:00Z', 1, 24000, 28000, 33000);
SELECT pg_temp.pred(31, 'vc', '2026-10-03 10:00:00Z', 150, 15000, 25000, 40000);
SELECT pg_temp.pred(24, 'vd', '2026-10-03 10:00:00Z', 2, 5000, 6000, 7000);
SELECT pg_temp.pred(24, 've', '2026-10-09 12:00:00Z', 53, 50000, 60000, 70000);
-- Scheduled close 18:02:00 (frames), final close 18:06:23.
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', 26, 60000, 70000, 90000);
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', 5, 60000, 70000, 90000);
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', 0.5, 60000, 70000, 90000);
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', 0.05, 60000, 70000, 90000);          -- three minutes before
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', 0.016667, 60000, 70000, 90000);      -- one minute before
SELECT pg_temp.pred(24, 'vf', '2026-10-03 18:02:00Z', -0.05, 60000, 70000, 90000);         -- three minutes after the scheduled close
-- No auction_end_date: the close is what each row recorded.
SELECT pg_temp.pred(24, 'vg', '2026-10-05 18:00:00Z', 30, 30000, 35000, 38000);
SELECT pg_temp.pred(24, 'vg', '2026-10-05 18:00:00Z', 6, 35000, 39000, 45000);
SELECT pg_temp.pred(24, 'vg', '2026-10-05 18:00:00Z', 0.5, 38000, 40000, 42000);
-- A vehicle with two lots: each prediction goes to the lot its close fits.
SELECT pg_temp.pred(24, 'vh', '2026-10-04 18:00:00Z', 2, 10000, 12000, 14000);
SELECT pg_temp.pred(24, 'vh', '2026-09-10 18:00:00Z', 2, 8000, 9000, 9500);
-- Two lots without a close that both fit: held. A far close: held. Two sold rows, two hammers: held.
SELECT pg_temp.pred(24, 'vi', '2026-10-04 15:00:00Z', 5, 12000, 13500, 15000);
SELECT pg_temp.pred(24, 'vj', '2026-09-20 20:00:00Z', 10, 30000, 32000, 35000);
SELECT pg_temp.pred(24, 'vk1', '2026-10-05 14:00:00Z', 4, 24000, 25000, 26000);
SELECT pg_temp.pred(24, 'vk2', '2026-10-05 14:00:00Z', 3, 24000, 25500, 27000);
-- One lot under two vehicles, one of them a stale live duplicate.
SELECT pg_temp.pred(24, 'vl1', '2026-10-06 18:00:00Z', 4, 10000, 14000, 18000);
SELECT pg_temp.pred(24, 'vl2', '2026-10-06 18:00:00Z', 3, 11000, 15000, 19000);
SELECT pg_temp.pred(24, 'vl2', '2026-10-06 18:00:00Z', 0.5, 14000, 15500, 17000);
-- The bid the row saw tells the lots of one vehicle apart: 8,200 is above the 6,600 hammer of the second lot, so the row is
-- about the first (which ended unsold at 8,200); 5,000 fits both, held. A bid above the only lot's hammer is another lot.
SELECT pg_temp.pred(24, 'vr', '2026-10-02 12:00:00Z', 20, 8200, 9000, 10000);
SELECT pg_temp.pred(24, 'vr', '2026-10-02 12:00:00Z', 10, 5000, 6000, 7000);
SELECT pg_temp.pred(24, 'vs', '2026-10-03 12:00:00Z', 5, 8200, 9000, 10000);
-- No lot row, no lot key.
SELECT pg_temp.pred(24, 'vm', '2026-10-05 12:00:00Z', 3, 1000, 2000, 3000);
SELECT pg_temp.pred(24, 'vn', '2026-10-05 12:00:00Z', 3, 1000, 2000, 3000);
-- Legacy grades from score_closed_predictions (joined by vehicle_id): one names another lot's price, one agrees, one is
-- not graded yet; and a legacy price on a lot that ended without a sale. Inserted graded (no UPDATE: a dead tuple would
-- let the last insert fall into an early block).
INSERT INTO public.hammer_predictions (vehicle_id, current_bid, hours_remaining, model_version, predicted_hammer, predicted_low,
  predicted_high, predicted_at, actual_hammer, prediction_error_pct, prediction_error_usd, scored_at)
SELECT v.id, x.low, x.hbc, 24, x.mid, x.low, x.high, '2026-10-02 12:00:00Z'::timestamptz - x.hbc * interval '1 hour',
       x.actual, x.err_pct, x.err_usd, '2026-10-03 06:00:00Z'
FROM (VALUES ('vo', 4.0, 50000, 58000, 70000, 99999, -41.99, -41999),
             ('vo', 3.9, 55000, 59000, 65000, 60000, -1.67, -1000),
             ('vp', 3.0, 4000, 5000, 6000, 5000, 0, 0)) x(vname, hbc, low, mid, high, actual, err_pct, err_usd)
JOIN v ON v.name = x.vname;
SELECT pg_temp.pred(24, 'vo', '2026-10-02 12:00:00Z', 2, 50000, 61000, 70000);
-- A lot with no close clock at all: sold, no end date, and the row recorded no hours_remaining.
INSERT INTO public.hammer_predictions (vehicle_id, current_bid, hours_remaining, model_version, predicted_hammer, predicted_low,
  predicted_high, predicted_at)
SELECT id, 8000, NULL, 24, 9000, 8000, 10000, '2026-10-05 15:00:00Z' FROM v WHERE name = 'vq';
-- Last row lands in the last heap block (padded so that no earlier page has room for it).
SELECT pg_temp.pred(24, 'va', '2026-10-01 18:00:00Z', 12, 10000, 15000, 20000, NULL, 3000);

SELECT pg_temp.ok('fixture: 644 predictions, 3 of them graded before the migration, none keyed',
  (SELECT count(*) FROM public.hammer_predictions) = 644
  AND (SELECT count(*) FROM public.hammer_predictions WHERE scored_at IS NOT NULL) = 3);
ANALYZE public.hammer_predictions;
CREATE TEMP TABLE straddle_blocks AS
  SELECT p.id, ((p.ctid::text)::point)[0]::bigint AS blk
  FROM public.hammer_predictions p JOIN v ON v.id = p.vehicle_id AND v.name = 'va'
  WHERE p.hours_remaining IN (30, 12);
SELECT pg_temp.ok('the first and the last prediction sit in different heap blocks, the first in block 0',
  (SELECT count(DISTINCT blk) FROM straddle_blocks) = 2 AND (SELECT min(blk) FROM straddle_blocks) = 0
  AND (SELECT max(blk) FROM straddle_blocks) >= 20);

-- The drift guard --------------------------------------------------------------------------------------------------------
-- A prediction_accuracy that changed since it was read is refused, the whole migration with it.
CREATE OR REPLACE VIEW public.prediction_accuracy AS
 SELECT model_version, count(*) AS total_predictions, count(actual_hammer) AS scored,
    round(avg(abs(prediction_error_pct)), 3) AS avg_abs_error_pct,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (abs(prediction_error_pct)::double precision))::numeric, 2) AS median_abs_error_pct,
    round(avg(prediction_error_pct), 2) AS avg_bias_pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 5::numeric) AS within_5pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 10::numeric) AS within_10pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 20::numeric) AS within_20pct
   FROM hammer_predictions WHERE scored_at IS NOT NULL GROUP BY model_version;
SELECT md5(pg_get_viewdef('public.prediction_accuracy'::regclass, true)) AS drifted_fp \gset
\echo The ERRORs below are the drift guard of the migration refusing a changed prediction_accuracy: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261007170000_grade_hammer_predictions_by_lot.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted view: the migration refused it whole and left everything untouched',
  md5(pg_get_viewdef('public.prediction_accuracy'::regclass, true)) = :'drifted_fp'
  AND to_regprocedure('public.grade_hammer_predictions_by_lot(integer, bigint)') IS NULL
  AND to_regclass('public.v_prediction_lot_grades') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.hammer_predictions'::regclass AND attname = 'auction_event_id' AND NOT attisdropped)
  AND (SELECT count(*) FROM public.schema_proposals) = 0
  AND (SELECT count(*) FROM public.pipeline_registry) = 1);
-- Put the live definition back.
CREATE OR REPLACE VIEW public.prediction_accuracy AS
 SELECT model_version,
    count(*) AS total_predictions,
    count(actual_hammer) AS scored,
    round(avg(abs(prediction_error_pct)), 2) AS avg_abs_error_pct,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (abs(prediction_error_pct)::double precision))::numeric, 2) AS median_abs_error_pct,
    round(avg(prediction_error_pct), 2) AS avg_bias_pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 5::numeric) AS within_5pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 10::numeric) AS within_10pct,
    count(*) FILTER (WHERE abs(prediction_error_pct) < 20::numeric) AS within_20pct
   FROM hammer_predictions
  WHERE scored_at IS NOT NULL
  GROUP BY model_version;
SELECT pg_temp.ok('the live definition is back (prod md5)',
  left(md5(pg_get_viewdef('public.prediction_accuracy'::regclass, true)), 16) = 'df2da8985aba061f');

-- The migration itself -----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE hp_before AS SELECT * FROM public.hammer_predictions;
\ir ../migrations/20261007170000_grade_hammer_predictions_by_lot.sql

SELECT pg_temp.ok('migration writes no row of hammer_predictions',
  NOT EXISTS (SELECT 1 FROM public.hammer_predictions p JOIN hp_before b USING (id)
              WHERE to_jsonb(p) - ARRAY['auction_event_id', 'lot_outcome', 'lot_close_at', 'lot_close_basis'] IS DISTINCT FROM to_jsonb(b))
  AND NOT EXISTS (SELECT 1 FROM public.hammer_predictions WHERE auction_event_id IS NOT NULL OR lot_outcome IS NOT NULL
                  OR lot_close_at IS NOT NULL OR lot_close_basis IS NOT NULL));
SELECT pg_temp.ok('four nullable columns with the declared types',
  (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
   FROM pg_attribute a WHERE a.attrelid = 'public.hammer_predictions'::regclass AND NOT a.attisdropped
     AND a.attname IN ('auction_event_id', 'lot_outcome', 'lot_close_at', 'lot_close_basis'))
  = 'auction_event_id:uuid:false,lot_close_at:timestamp with time zone:false,lot_close_basis:text:false,lot_outcome:text:false');
SELECT pg_temp.ok('the key is a validated foreign key to auction_events, ON DELETE SET NULL, with a partial index',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hammer_predictions'::regclass AND contype = 'f'
          AND confrelid = 'public.auction_events'::regclass AND convalidated AND confdeltype = 'n'
          AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.hammer_predictions'::regclass AND attname = 'auction_event_id')])
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_hammer_predictions_auction_event'
              AND indexdef LIKE '%(auction_event_id)%WHERE (auction_event_id IS NOT NULL)'));
SELECT pg_temp.ok('vocabularies and the resolved-together rule are CHECK constraints',
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.hammer_predictions'::regclass AND contype = 'c'
     AND conname IN ('hammer_predictions_lot_outcome_check', 'hammer_predictions_lot_close_basis_check', 'hammer_predictions_lot_resolved_check')) = 3);
DO $$ BEGIN
  INSERT INTO public.hammer_predictions (vehicle_id, current_bid, predicted_hammer, lot_outcome)
  SELECT id, 1, 1, 'sold' FROM v WHERE name = 'vz';
  RAISE EXCEPTION 'an outcome without its close was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.hammer_predictions (vehicle_id, current_bid, predicted_hammer, lot_outcome, lot_close_at, lot_close_basis)
  SELECT id, 1, 1, 'won', now(), 'final' FROM v WHERE name = 'vz';
  RAISE EXCEPTION 'an outcome outside the vocabulary was accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
DO $$ BEGIN
  INSERT INTO public.hammer_predictions (vehicle_id, current_bid, predicted_hammer, auction_event_id)
  SELECT id, 1, 1, gen_random_uuid() FROM v WHERE name = 'vz';
  RAISE EXCEPTION 'a lot key that names no lot row was accepted';
EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
END $$;
SELECT pg_temp.ok('refused inserts left no row', (SELECT count(*) FROM public.hammer_predictions) = 644);
SELECT pg_temp.ok('the grader is callable by service_role only',
  NOT has_function_privilege('anon', 'public.grade_hammer_predictions_by_lot(integer, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.grade_hammer_predictions_by_lot(integer, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.grade_hammer_predictions_by_lot(integer, bigint)', 'EXECUTE'));
SELECT pg_temp.ok('the grader runs as its owner with a fixed search_path and its own lock_timeout',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp', 'lock_timeout=5s']
   FROM pg_proc WHERE oid = 'public.grade_hammer_predictions_by_lot(integer, bigint)'::regprocedure));
SELECT pg_temp.ok('no function-level SET names a custom parameter (prod''s deploy role may not set one)',
  NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
              WHERE p.oid = 'public.grade_hammer_predictions_by_lot(integer, bigint)'::regprocedure
                AND split_part(c, '=', 1) LIKE '%.%'));
SELECT pg_temp.ok('the outcome is read from auction_events and never from bat_listings',
  (SELECT prosrc LIKE '%public.auction_events%' AND prosrc NOT LIKE '%bat_listings%' AND prosrc NOT LIKE '%external_listings%'
   FROM pg_proc WHERE oid = 'public.grade_hammer_predictions_by_lot(integer, bigint)'::regprocedure));
SELECT pg_temp.ok('the per-lot view is not readable by the API roles; service_role reads it',
  NOT has_table_privilege('anon', 'public.v_prediction_lot_grades', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.v_prediction_lot_grades', 'SELECT')
  AND has_table_privilege('service_role', 'public.v_prediction_lot_grades', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.prediction_accuracy', 'SELECT')
  AND has_table_privilege('service_role', 'public.prediction_accuracy', 'SELECT'));
SELECT pg_temp.ok('prediction_accuracy keeps its nine columns (names, types, order) and gains four at the end',
  (SELECT count(*) FROM accuracy_columns_before) = 9
  AND NOT EXISTS (SELECT 1 FROM accuracy_columns_before b
                  LEFT JOIN pg_attribute a ON a.attrelid = 'public.prediction_accuracy'::regclass AND a.attnum = b.attnum AND NOT a.attisdropped
                  WHERE a.attname::text IS DISTINCT FROM b.attname OR format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM b.typ)
  AND (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
       WHERE a.attrelid = 'public.prediction_accuracy'::regclass AND a.attnum > 9 AND NOT a.attisdropped)
      = 'lots_without_hammer,bands_scored,bands_held,band_hold_pct');
SELECT pg_temp.ok('one proposal row records the columns, with evidence and its rule',
  (SELECT count(*) FROM public.schema_proposals) = 1
  AND EXISTS (SELECT 1 FROM public.schema_proposals WHERE proposal_type = 'add_column' AND status = 'open'
              AND payload->>'table' = 'hammer_predictions' AND jsonb_array_length(payload->'columns') = 4
              AND jsonb_array_length(evidence) >= 8 AND payload ? 'rule' AND payload ? 'writers'));
SELECT pg_temp.ok('registry: the eight columns name the grader as owner; the table-level row names it once',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'hammer_predictions' AND owned_by = 'grade_hammer_predictions_by_lot') = 8
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'hammer_predictions') = 9
  AND (SELECT write_via LIKE 'scripts/market/live-bands.mjs (REST insert%Per-lot grades (2026-10-07): grade_hammer_predictions_by_lot%'
              AND (SELECT count(*) FROM regexp_matches(write_via, 'grade_hammer_predictions_by_lot', 'g')) = 1
       FROM public.pipeline_registry WHERE table_name = 'hammer_predictions' AND column_name IS NULL));
SELECT pg_temp.ok('the new columns, the grade columns and the table are described; the table comment keeps its live text and names the grader once',
  (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.hammer_predictions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND col_description(a.attrelid, a.attnum) IS NOT NULL) = 16
  AND obj_description('public.hammer_predictions'::regclass, 'pg_class') LIKE 'Hammer-price predictions on live auctions:%Created by 20260218100000_hammer_prediction_engine. Per-lot grades (2026-10-07)%'
  AND (SELECT count(*) FROM regexp_matches(obj_description('public.hammer_predictions'::regclass, 'pg_class'), 'grade_hammer_predictions_by_lot', 'g')) = 1
  AND obj_description('public.v_prediction_lot_grades'::regclass, 'pg_class') IS NOT NULL
  AND obj_description('public.prediction_accuracy'::regclass, 'pg_class') IS NOT NULL);

-- Guards ---------------------------------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.grade_hammer_predictions_by_lot(100, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.grade_hammer_predictions_by_lot(100, 0);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  PERFORM public.grade_hammer_predictions_by_lot(0, 0);
  RAISE EXCEPTION 'p_batch 0 was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_batch must be%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.grade_hammer_predictions_by_lot(100, -1);
  RAISE EXCEPTION 'a negative start block was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_from_block must be%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('refused calls changed nothing',
  NOT EXISTS (SELECT 1 FROM public.hammer_predictions WHERE auction_event_id IS NOT NULL OR lot_outcome IS NOT NULL)
  AND (SELECT count(*) FROM public.write_receipts) = 0);
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'written')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.grade_hammer_predictions_by_lot(200, b) r
         FROM unnest(ARRAY[pg_relation_size('public.hammer_predictions') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s));

-- Walk the whole heap, one block per call ---------------------------------------------------------------------------------
SELECT pg_temp.ok('the two straddling rows sit in different heap blocks before the walk',
  (SELECT count(DISTINCT blk) FROM straddle_blocks) = 2 AND (SELECT min(blk) FROM straddle_blocks) = 0);
CREATE TEMP TABLE legacy_ids AS SELECT id FROM public.hammer_predictions WHERE scored_at IS NOT NULL;
CREATE TEMP TABLE hp_walk_before AS SELECT * FROM public.hammer_predictions;
SET app.writer = 'caller-writer';
CREATE TEMP TABLE walk(run text, step int, result jsonb, writer_after text);
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.grade_hammer_predictions_by_lot(1, b);
    i := i + 1;
    INSERT INTO walk VALUES ('first', i, r, current_setting('app.writer', true));
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('cursor: starts at block 0; each call starts where the last ended; one block per call; one done',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 'first' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 'first' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'first' AND (result->>'next_block')::bigint - (result->>'from_block')::bigint <> 1)
  AND (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'done')::boolean) = 1
  AND (SELECT count(*) FROM walk WHERE run = 'first') >= (SELECT max(blk) FROM straddle_blocks) + 1);
SELECT pg_temp.ok('triggers on the walk''s UPDATE statements see the declared writer grade-hammer-predictions-by-lot',
  (SELECT count(*) FROM public.probe_update_writers) = (SELECT count(*) FROM walk WHERE run = 'first')
  AND NOT EXISTS (SELECT 1 FROM public.probe_update_writers WHERE writer IS DISTINCT FROM 'grade-hammer-predictions-by-lot'));
SELECT pg_temp.ok('the caller''s app.writer and lock_timeout are restored after every call',
  NOT EXISTS (SELECT 1 FROM walk WHERE writer_after IS DISTINCT FROM 'caller-writer')
  AND current_setting('app.writer') = 'caller-writer'
  AND current_setting('lock_timeout') = '3s');
RESET app.writer;

-- Counts per reason, summed over the walk (every row is counted once: 32 written + 612 held = 644).
CREATE TEMP TABLE first_totals AS
  SELECT k AS key, sum((result->>k)::bigint) AS n
  FROM walk, unnest(ARRAY['graded', 'held', 'written', 'keyed_legacy', 'grade_conflicts', 'skipped_reserve_not_met',
                          'skipped_no_sale', 'skipped_no_lot_key', 'skipped_no_outcome', 'skipped_lot_ambiguous',
                          'skipped_lot_conflict', 'skipped_lot_mismatch', 'skipped_no_close_clock', 'skipped_after_close',
                          'skipped_already_graded']) k
  WHERE run = 'first' GROUP BY k;
SELECT pg_temp.ok('graded 24 rows of 8 lots-with-a-hammer; the stored band held the hammer on 19',
  (SELECT n FROM first_totals WHERE key = 'graded') = 24 AND (SELECT n FROM first_totals WHERE key = 'held') = 19);
SELECT pg_temp.ok('written 32: 24 graded, 2 legacy grades keyed and kept, 5 reserve-not-met and 1 no-sale outcome rows with no hammer grade',
  (SELECT n FROM first_totals WHERE key = 'written') = 32
  AND (SELECT n FROM first_totals WHERE key = 'keyed_legacy') = 2
  AND (SELECT n FROM first_totals WHERE key = 'skipped_reserve_not_met') = 5
  AND (SELECT n FROM first_totals WHERE key = 'skipped_no_sale') = 1);
SELECT pg_temp.ok('held back, each counted by its reason: no lot key 601, no outcome 2, ambiguous 2, conflicting hammers 2, a lot that does not fit 2, no close clock 1, after the close 2',
  (SELECT n FROM first_totals WHERE key = 'skipped_no_lot_key') = 601
  AND (SELECT n FROM first_totals WHERE key = 'skipped_no_outcome') = 2
  AND (SELECT n FROM first_totals WHERE key = 'skipped_lot_ambiguous') = 2
  AND (SELECT n FROM first_totals WHERE key = 'skipped_lot_conflict') = 2
  AND (SELECT n FROM first_totals WHERE key = 'skipped_lot_mismatch') = 2
  AND (SELECT n FROM first_totals WHERE key = 'skipped_no_close_clock') = 1
  AND (SELECT n FROM first_totals WHERE key = 'skipped_after_close') = 2);
SELECT pg_temp.ok('two legacy grades disagree with their lot (one names another lot''s price, one a price on an unsold lot) and are counted, not changed',
  (SELECT n FROM first_totals WHERE key = 'grade_conflicts') = 2);
SELECT pg_temp.ok('rows in the table: 32 resolved, 612 not',
  (SELECT count(*) FROM public.hammer_predictions WHERE lot_outcome IS NOT NULL) = 32
  AND (SELECT count(*) FROM public.hammer_predictions WHERE auction_event_id IS NOT NULL) = 32
  AND (SELECT count(*) FROM public.hammer_predictions WHERE lot_outcome IS NULL AND lot_close_at IS NULL AND lot_close_basis IS NULL AND auction_event_id IS NULL) = 612);
SELECT pg_temp.ok('only the declared columns change, and no unresolved row changes at all',
  NOT EXISTS (SELECT 1 FROM public.hammer_predictions p JOIN hp_walk_before b USING (id)
              WHERE (to_jsonb(p) - ARRAY['auction_event_id', 'lot_outcome', 'lot_close_at', 'lot_close_basis', 'actual_hammer',
                                         'prediction_error_pct', 'prediction_error_usd', 'scored_at'])
                    IS DISTINCT FROM (to_jsonb(b) - ARRAY['auction_event_id', 'lot_outcome', 'lot_close_at', 'lot_close_basis', 'actual_hammer',
                                         'prediction_error_pct', 'prediction_error_usd', 'scored_at']))
  AND NOT EXISTS (SELECT 1 FROM public.hammer_predictions p JOIN hp_walk_before b USING (id)
                  WHERE p.lot_outcome IS NULL AND to_jsonb(p) IS DISTINCT FROM to_jsonb(b)));
SELECT pg_temp.ok('receipts: one declared UPDATE row per call that wrote, summing to the 32 rows written',
  (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'hammer_predictions' AND op = 'UPDATE'
     AND writer = 'grade-hammer-predictions-by-lot') = 32
  AND (SELECT count(*) FROM public.write_receipts) = (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'written')::int > 0)
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE db_role IS NULL OR txid IS NULL));

-- The rows, lot by lot ---------------------------------------------------------------------------------------------------
CREATE TEMP VIEW lotrow AS
  SELECT p.*, v.name AS vname, ae.source_url, ae.outcome AS ae_outcome, ae.winning_bid AS ae_hammer,
         lower(substring(ae.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) AS lot
  FROM public.hammer_predictions p JOIN v ON v.id = p.vehicle_id LEFT JOIN public.auction_events ae ON ae.id = p.auction_event_id;
SELECT pg_temp.ok('sold lot, final close: seven model 24 rows and the model 31 prior graded against 20,000, the row after the close left alone',
  (SELECT count(*) FROM lotrow WHERE vname = 'va' AND lot = '1990-lot-a' AND lot_outcome = 'sold' AND lot_close_basis = 'final'
     AND lot_close_at = '2026-10-01 18:00:00Z' AND actual_hammer = 20000 AND scored_at IS NOT NULL) = 8
  AND (SELECT prediction_error_pct FROM lotrow WHERE vname = 'va' AND model_version = 24 AND hours_remaining = 0.5) = 5.00
  AND (SELECT prediction_error_usd FROM lotrow WHERE vname = 'va' AND model_version = 24 AND hours_remaining = 0.5) = 1000
  AND (SELECT prediction_error_pct FROM lotrow WHERE vname = 'va' AND model_version = 31) = 10.00
  AND (SELECT auction_event_id IS NULL AND lot_outcome IS NULL AND scored_at IS NULL FROM lotrow WHERE vname = 'va' AND hours_remaining = 0.1));
SELECT pg_temp.ok('a prediction about a vehicle with no vehicles row is graded by the lot key',
  NOT EXISTS (SELECT 1 FROM public.vehicles x JOIN v ON v.id = x.id AND v.name = 'vb')
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vb' AND lot = '1991-lot-b-ghost' AND actual_hammer = 50000 AND lot_outcome = 'sold') = 2);
SELECT pg_temp.ok('reserve not met and no sale: an outcome row, no hammer, no grade; the lot''s high bid is never a sale',
  (SELECT count(*) FROM lotrow WHERE vname = 'vc' AND lot_outcome = 'reserve_not_met' AND actual_hammer IS NULL AND scored_at IS NULL
     AND prediction_error_pct IS NULL AND lot_close_basis = 'final') = 3
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vd' AND lot_outcome = 'no_sale' AND actual_hammer IS NULL AND scored_at IS NULL) = 1
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vp' AND lot_outcome = 'reserve_not_met') = 1);
SELECT pg_temp.ok('a live lot is not written',
  (SELECT count(*) FROM lotrow WHERE vname = 've' AND auction_event_id IS NULL AND lot_outcome IS NULL AND scored_at IS NULL) = 1);
SELECT pg_temp.ok('live frames give the scheduled close (the earliest previous_scheduled_end of a bat_public_live_v1 frame); the row between the scheduled and the final close is left alone',
  (SELECT count(*) FROM lotrow WHERE vname = 'vf' AND lot_close_basis = 'scheduled' AND lot_close_at = '2026-10-03 18:02:00Z'
     AND actual_hammer = 80000 AND lot_outcome = 'sold') = 5
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vf' AND auction_event_id IS NULL AND hours_remaining < 0) = 1);
SELECT pg_temp.ok('a monitored lot with no frames, and a lot with no end date, use the row''s own close, named predicted',
  (SELECT count(*) FROM lotrow WHERE vname = 'vg' AND lot_close_basis = 'predicted' AND lot_close_at = '2026-10-05 18:00:00Z'
     AND actual_hammer = 40000) = 3);
SELECT pg_temp.ok('a vehicle with two lots: each prediction goes to the lot whose close fits',
  (SELECT count(*) FROM lotrow WHERE vname = 'vh' AND hours_remaining = 2 AND predicted_at = '2026-10-04 16:00:00Z'
     AND lot = '1997-lot-h-2' AND actual_hammer = 12000) = 1
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vh' AND predicted_at = '2026-09-10 16:00:00Z'
     AND lot = '1997-lot-h' AND actual_hammer = 10000) = 1);
SELECT pg_temp.ok('held, not guessed: two lots that both fit, a lot whose close is far from the row''s own, a bid above the lot''s hammer, two sold rows with two hammers, no close clock',
  (SELECT count(*) FROM lotrow WHERE vname IN ('vi', 'vj', 'vk1', 'vk2', 'vq', 'vs') AND auction_event_id IS NULL AND lot_outcome IS NULL AND scored_at IS NULL) = 6);
SELECT pg_temp.ok('the bid the row saw tells a vehicle''s lots apart: 8,200 is about the lot that ended unsold at 8,200, 5,000 fits both and is held',
  (SELECT count(*) FROM lotrow WHERE vname = 'vr' AND lot = '2006-lot-r' AND lot_outcome = 'reserve_not_met' AND actual_hammer IS NULL AND current_bid = 8200) = 1
  AND (SELECT count(*) FROM lotrow WHERE vname = 'vr' AND auction_event_id IS NULL AND current_bid = 5000) = 1);
SELECT pg_temp.ok('no lot key and no lot row: left as they were',
  (SELECT count(*) FROM lotrow WHERE vname IN ('vm', 'vn', 'vz') AND auction_event_id IS NULL AND lot_outcome IS NULL) = 602);
SELECT pg_temp.ok('one lot under two vehicles and a stale live duplicate row: the sold row, one key, one hammer',
  (SELECT count(*) FROM lotrow WHERE vname IN ('vl1', 'vl2') AND lot = '2001-lot-l' AND actual_hammer = 15000 AND lot_outcome = 'sold') = 3
  AND (SELECT count(DISTINCT auction_event_id) FROM lotrow WHERE vname IN ('vl1', 'vl2') AND auction_event_id IS NOT NULL) = 1
  AND (SELECT ae_outcome FROM lotrow WHERE vname = 'vl1' AND auction_event_id IS NOT NULL LIMIT 1) = 'sold');
SELECT pg_temp.ok('legacy grades are kept as they were, keyed to the lot, a disagreement counted',
  (SELECT actual_hammer = 99999 AND prediction_error_pct = -41.99 AND scored_at = '2026-10-03 06:00:00Z' AND lot = '2003-lot-o-2' AND lot_outcome = 'sold'
   FROM lotrow WHERE vname = 'vo' AND hours_remaining = 4)
  AND (SELECT actual_hammer = 60000 AND prediction_error_pct = -1.67 AND scored_at = '2026-10-03 06:00:00Z' AND lot = '2003-lot-o-2' AND lot_outcome = 'sold'
       FROM lotrow WHERE vname = 'vo' AND hours_remaining = 3.9)
  AND (SELECT actual_hammer = 60000 AND scored_at > '2026-10-03 06:00:00Z' AND prediction_error_pct = 1.67 AND lot = '2003-lot-o-2'
       FROM lotrow WHERE vname = 'vo' AND hours_remaining = 2)
  AND (SELECT actual_hammer = 5000 AND scored_at = '2026-10-03 06:00:00Z' AND lot_outcome = 'reserve_not_met' FROM lotrow WHERE vname = 'vp'));
SELECT pg_temp.ok('every grade the grader wrote equals the hammer of the lot its key names',
  NOT EXISTS (SELECT 1 FROM lotrow WHERE id NOT IN (SELECT id FROM legacy_ids) AND scored_at IS NOT NULL
              AND (lot_outcome <> 'sold' OR actual_hammer IS DISTINCT FROM ae_hammer
                   OR prediction_error_pct IS DISTINCT FROM round((predicted_hammer - ae_hammer) / ae_hammer * 100, 2)
                   OR prediction_error_usd IS DISTINCT FROM (predicted_hammer - ae_hammer)))
  AND (SELECT count(*) FROM lotrow WHERE id NOT IN (SELECT id FROM legacy_ids) AND scored_at IS NOT NULL) = 24);

-- Lots as the unit -------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the view has one row per model, lot and horizon',
  NOT EXISTS (SELECT 1 FROM public.v_prediction_lot_grades GROUP BY model_version, lot, horizon HAVING count(*) > 1)
  AND (SELECT count(DISTINCT lot) FROM public.v_prediction_lot_grades) = 12
  AND (SELECT count(DISTINCT lot) FROM public.v_prediction_lot_grades WHERE outcome = 'sold') = 8);
SELECT pg_temp.ok('horizons, point in time: last is the latest row before the close; 24h, 6h and 1h are the rows standing then; no T-2 without live frames',
  (SELECT string_agg(horizon || '=' || hours_before_close, ',' ORDER BY horizon)
   FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '1990-lot-a')
  = '1h=1.50,24h=25.00,6h=10.00,last=0.50');
SELECT pg_temp.ok('the scheduled lot has every horizon, measured from the scheduled close; the row after it is absent',
  (SELECT string_agg(horizon || '=' || hours_before_close || '/' || close_basis, ',' ORDER BY horizon)
   FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '1995-lot-f-frames')
  = '1h=5.00/scheduled,24h=26.00/scheduled,6h=26.00/scheduled,last=0.02/scheduled,t2=0.05/scheduled');
SELECT pg_temp.ok('a prior made a week out is the standing prediction at every horizon, and says how old it is',
  (SELECT count(DISTINCT prediction_id) = 1 AND count(*) = 4 AND min(hours_before_close) = 160 AND max(hours_before_close) = 160
   FROM public.v_prediction_lot_grades WHERE model_version = 31 AND lot = '1990-lot-a'));
SELECT pg_temp.ok('one lot under two vehicles is one lot: the last row is the later vehicle''s',
  (SELECT count(*) FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '2001-lot-l' AND horizon = 'last') = 1
  AND (SELECT hours_before_close FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '2001-lot-l' AND horizon = 'last') = 0.50
  AND (SELECT vehicle_id FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '2001-lot-l' AND horizon = 'last')
      = (SELECT id FROM v WHERE name = 'vl2')
  AND (SELECT hours_before_close FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '2001-lot-l' AND horizon = '1h') = 3.00);
SELECT pg_temp.ok('an unsold lot is a row with an outcome and no hammer, error or band result',
  (SELECT count(*) FROM public.v_prediction_lot_grades WHERE lot = '1992-lot-c-rnm' AND outcome = 'reserve_not_met'
     AND actual_hammer IS NULL AND error_pct IS NULL AND abs_error_pct IS NULL AND band_held IS NULL) >= 5);
-- An independent second computation of the last row per model and lot, with DISTINCT ON.
SELECT pg_temp.ok('the view''s last row equals an independent DISTINCT ON of the resolved rows made at or before the close',
  (SELECT count(*) FROM public.v_prediction_lot_grades WHERE horizon = 'last')
  = (SELECT count(*) FROM (SELECT DISTINCT ON (l.model_version, l.lot) l.id FROM lotrow l
        WHERE l.lot_outcome IS NOT NULL AND l.predicted_at <= l.lot_close_at
        ORDER BY l.model_version, l.lot, l.predicted_at DESC, l.id) d)
  AND NOT EXISTS (SELECT 1 FROM public.v_prediction_lot_grades g WHERE g.horizon = 'last' AND g.prediction_id <> (
        SELECT l.id FROM lotrow l WHERE l.model_version = g.model_version AND l.lot = g.lot AND l.lot_outcome IS NOT NULL
          AND l.predicted_at <= l.lot_close_at ORDER BY l.predicted_at DESC, l.id LIMIT 1)));
-- The view reads the hammer from the lot row, not from the stored grade.
UPDATE public.hammer_predictions SET actual_hammer = 1 WHERE id = (SELECT id FROM lotrow WHERE vname = 'va' AND model_version = 24 AND hours_remaining = 0.5);
SELECT pg_temp.ok('the hammer in the view is the lot row''s winning_bid even when the stored grade is wrong',
  (SELECT actual_hammer FROM public.v_prediction_lot_grades WHERE model_version = 24 AND lot = '1990-lot-a' AND horizon = 'last') = 20000);
UPDATE public.hammer_predictions SET actual_hammer = 20000 WHERE id = (SELECT id FROM lotrow WHERE vname = 'va' AND model_version = 24 AND hours_remaining = 0.5);
SELECT pg_temp.ok('prediction_accuracy counts lots of model 24: 12 with an outcome, 8 sold, 4 without a hammer, errors and bands over the sold lots',
  (SELECT total_predictions = 12 AND scored = 8 AND lots_without_hammer = 4 AND within_5pct = 4 AND within_10pct = 5 AND within_20pct = 7
          AND avg_abs_error_pct = 7.81 AND avg_bias_pct = -5.31 AND bands_scored = 8 AND bands_held = 6 AND band_hold_pct = 75.0
   FROM public.prediction_accuracy WHERE model_version = 24));
SELECT pg_temp.ok('prediction_accuracy counts lots of model 31: 2 with an outcome, 1 sold, its band held the hammer',
  (SELECT total_predictions = 2 AND scored = 1 AND lots_without_hammer = 1 AND within_10pct = 0 AND within_20pct = 1
          AND bands_scored = 1 AND bands_held = 1 AND band_hold_pct = 100.0
   FROM public.prediction_accuracy WHERE model_version = 31)
  AND (SELECT count(*) FROM public.prediction_accuracy) = 2);

-- Idempotent: a second walk writes nothing, counts the same holds, and every resolved row as already graded -----------------
CREATE TEMP TABLE hp_second_before AS SELECT * FROM public.hammer_predictions;
INSERT INTO walk SELECT 'again', 1, public.grade_hammer_predictions_by_lot(100000, 0), NULL;
SELECT pg_temp.ok('second walk: nothing written, no receipt, the same holds, the 32 resolved rows seen as already graded',
  (SELECT (result->>'written')::int = 0 AND (result->>'graded')::int = 0 AND (result->>'skipped_already_graded')::int = 32
          AND (result->>'skipped_no_lot_key')::int = 601 AND (result->>'skipped_no_outcome')::int = 2
          AND (result->>'skipped_lot_ambiguous')::int = 2 AND (result->>'skipped_lot_conflict')::int = 2
          AND (result->>'skipped_lot_mismatch')::int = 2 AND (result->>'skipped_no_close_clock')::int = 1
          AND (result->>'skipped_after_close')::int = 2 AND (result->>'done')::boolean
   FROM walk WHERE run = 'again')
  AND (SELECT sum(rows) FROM public.write_receipts WHERE writer = 'grade-hammer-predictions-by-lot') = 32
  AND NOT EXISTS (SELECT 1 FROM public.hammer_predictions p JOIN hp_second_before b USING (id) WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(b)));

-- A lot that closes later is graded by the next pass, and only it -------------------------------------------------------------
UPDATE public.auction_events SET outcome = 'sold', winning_bid = 70000, updated_at = now()
 WHERE source_url = 'https://bringatrailer.com/listing/1994-lot-e-live/';
INSERT INTO walk SELECT 'later', 1, public.grade_hammer_predictions_by_lot(100000, 0), NULL;
SELECT pg_temp.ok('a lot that closed after the first pass is graded on the next: one row, band held at its upper bound, one more receipt',
  (SELECT (result->>'graded')::int = 1 AND (result->>'held')::int = 1 AND (result->>'written')::int = 1
          AND (result->>'skipped_no_outcome')::int = 1 AND (result->>'skipped_already_graded')::int = 32
   FROM walk WHERE run = 'later')
  AND (SELECT actual_hammer = 70000 AND lot_outcome = 'sold' AND lot_close_basis = 'final' AND lot_close_at = '2026-10-09 12:00:00Z'
      FROM lotrow WHERE vname = 've')
  AND (SELECT sum(rows) FROM public.write_receipts WHERE writer = 'grade-hammer-predictions-by-lot') = 33
  AND (SELECT count(*) FROM public.write_receipts) = (SELECT count(*) FROM walk WHERE run IN ('first', 'later') AND (result->>'written')::int > 0));

-- Deleting a lot row keeps what was read from it and drops the key --------------------------------------------------------------
DELETE FROM public.auction_events WHERE source_url = 'https://bringatrailer.com/listing/2004-lot-p/';
SELECT pg_temp.ok('deleting a lot row sets the key NULL (ON DELETE SET NULL) and leaves the outcome and the close; the row leaves the lot view',
  (SELECT auction_event_id IS NULL AND lot_outcome = 'reserve_not_met' AND lot_close_basis = 'final' FROM lotrow WHERE vname = 'vp')
  AND NOT EXISTS (SELECT 1 FROM public.v_prediction_lot_grades WHERE lot = '2004-lot-p'));

-- Re-applying the migration is refused whole (its drift guard), and changes nothing -------------------------------------------
\echo The ERRORs below are the drift guard refusing a second run, because prediction_accuracy is already replaced: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261007170000_grade_hammer_predictions_by_lot.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a second run is refused: one proposal row, nine registry rows, one function, the columns once',
  (SELECT count(*) FROM public.schema_proposals) = 1
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'hammer_predictions') = 9
  AND (SELECT count(*) FROM pg_proc WHERE proname = 'grade_hammer_predictions_by_lot') = 1
  AND (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.hammer_predictions'::regclass AND attname = 'auction_event_id' AND NOT attisdropped) = 1);

DO $$ BEGIN RAISE NOTICE 'ALL PASS test_grade_hammer_predictions_by_lot'; END $$;
