-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_timeline_event_supersession -f this-file.sql
-- Contract for 20261016203000_supersede_timeline_events.sql (supersede_timeline_events, plan_bat_live_end_supersessions):
--   * the plan holds exactly the extract-bat-core auction_ended rows created before the end they name (the recorded
--     data-ends instant, else 00:00 UTC of event_date); never a row written after its end, a same-day row without a
--     recorded instant, a result row, another writer's row or a user's row; each with the listing's row read after
--     the close as its replacement (a result first), and its class; the window and the 500-row cap hold;
--   * the writer retires a planned row whole into superseded_rows (row_data = to_jsonb(row), citation, reason,
--     replacement) and removes it, so the live profile timeline fold stops counting it with no reader change; the
--     row re-inserts from row_data unchanged (restore);
--   * refused, writing nothing: an uncited or unargued row anywhere in the call, more than 500 rows, a caller
--     statement_timeout of 0 or over 60 s;
--   * no write, reported: stale plans, missing rows, user rows, image_upload rows, a replacement of another listing,
--     rows linked from another table (the cascade would take the link along); a second call answers 'already';
--   * lock_timeout is 3 s inside the call; EXECUTE is service-role only; re-applying the migration is a no-op.
-- Fixture tables carry the live columns (timeline_events: all 61, prod catalog 2026-10-15) and the inbound links the
-- writer probes. superseded_rows is as in 20260928203000. The timeline fold is vehicle_profile_read's, verbatim.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.timeline_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, uploaded_by uuid);
CREATE TABLE public.timeline_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid,
  event_type text NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  image_urls text[],
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  mileage_at_event integer,
  cost_amount numeric,
  cost_currency text DEFAULT 'USD'::text,
  duration_hours numeric,
  location_name text,
  location_address text,
  location_coordinates point,
  service_provider_name text,
  service_provider_type text,
  invoice_number text,
  warranty_info jsonb,
  parts_used jsonb[],
  verification_documents jsonb[],
  is_insurance_claim boolean DEFAULT false,
  insurance_claim_number text,
  next_service_due_date date,
  next_service_due_mileage integer,
  data_source text DEFAULT 'user_input'::text,
  confidence_score integer DEFAULT 50,
  source_type text NOT NULL DEFAULT 'user_input'::text,
  event_category text,
  activity_type text,
  automated_tags text[] DEFAULT '{}'::text[],
  manual_tags text[] DEFAULT '{}'::text[],
  photo_analysis jsonb DEFAULT '{}'::jsonb,
  receipt_data jsonb DEFAULT '{}'::jsonb,
  parts_mentioned text[] DEFAULT '{}'::text[],
  tools_mentioned text[] DEFAULT '{}'::text[],
  labor_hours numeric,
  cost_estimate numeric,
  organization_id uuid,
  client_id uuid,
  is_monetized boolean DEFAULT false,
  work_started timestamp with time zone,
  work_completed timestamp with time zone,
  contract_id uuid,
  applied_labor_rate numeric,
  applied_shop_rate numeric,
  rate_source text,
  contextual_analysis_status text DEFAULT 'pending'::text,
  documented_by uuid,
  primary_technician uuid,
  quality_rating integer,
  quality_justification text,
  value_impact numeric,
  ai_confidence_score numeric,
  concerns text[],
  industry_standard_comparison jsonb,
  search_vector tsvector,
  work_order_id uuid
);
CREATE INDEX idx_timeline_events_event_date ON public.timeline_events (event_date);
CREATE INDEX idx_timeline_events_vehicle_id ON public.timeline_events (vehicle_id);
-- Inbound links as on prod: ON DELETE CASCADE, ON DELETE SET NULL, and FK-less id columns.
CREATE TABLE public.timeline_event_comments (id serial PRIMARY KEY, event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.image_tags (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.work_order_parts (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.work_order_labor (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.device_attributions (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.generated_invoices (id serial PRIMARY KEY, event_id uuid UNIQUE REFERENCES public.timeline_events(id) ON DELETE CASCADE);
CREATE TABLE public.image_sets (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE SET NULL);
CREATE TABLE public.auction_listing_images (id serial PRIMARY KEY, timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE SET NULL);
CREATE TABLE public.receipts (id serial PRIMARY KEY, timeline_event_id uuid);
CREATE TABLE public.organization_images (id serial PRIMARY KEY, timeline_event_id uuid);
CREATE TABLE public.contribution_submissions (id serial PRIMARY KEY, timeline_event_id uuid);
CREATE TABLE public.work_organization_matches (id serial PRIMARY KEY, timeline_event_id uuid);
CREATE TABLE public.timeline_event_conflicts (id serial PRIMARY KEY, primary_event_id uuid, conflicting_event_id uuid);
CREATE TABLE public.vehicle_images (id serial PRIMARY KEY, vehicle_id uuid, timeline_event_id uuid);
CREATE TABLE public.superseded_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  text        NOT NULL,
  row_id        uuid        NOT NULL,
  row_data      jsonb       NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  asserted_by   text        NOT NULL,
  source        jsonb       NOT NULL,
  reason        text        NOT NULL,
  restored_at   timestamptz
);
CREATE INDEX superseded_rows_source_row_idx ON public.superseded_rows (source_table, row_id);
COMMENT ON TABLE public.superseded_rows IS 'Rows retired from a live table by a sanctioned writer (never a raw DELETE).';

\ir ../migrations/20261016203000_supersede_timeline_events.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.refuses(label text, call text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE call;
  RAISE EXCEPTION 'Contract failed: % (no error raised)', label;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'Contract failed:%' THEN RAISE; END IF;
  IF position(fragment IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Contract failed: % (wrong error: %)', label, SQLERRM; END IF;
  RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
END $$;
-- Synthetic ids: u('e001', 7) is 00000000-0000-0000-e001-000000000007.
CREATE FUNCTION pg_temp.u(grp text, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-' || grp || '-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- vehicle_profile_read's timeline fold (prod, 2026-10-15: timeline_days + timeline.total), for one vehicle.
CREATE FUNCTION pg_temp.profile_timeline(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH timeline_days AS (
  SELECT d.day, d.kinds, d.n
  FROM (
    SELECT k.event_date AS day, jsonb_object_agg(k.kind, k.n ORDER BY k.kind) AS kinds, sum(k.n) AS n
    FROM (SELECT event_date, coalesce(nullif(btrim(event_type), ''), 'event') AS kind, count(*) AS n
          FROM public.timeline_events
          WHERE vehicle_id = p_vehicle_id AND event_date IS NOT NULL
          GROUP BY 1, 2) k
    GROUP BY k.event_date
    ORDER BY k.event_date DESC
    LIMIT 1000) d
)
SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
  'days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'kinds', kinds) ORDER BY day DESC), '[]'::jsonb) FROM timeline_days)) $$;
CREATE FUNCTION pg_temp.writes() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT count(*) FROM public.superseded_rows $$;
CREATE FUNCTION pg_temp.ev(p_id uuid, p_vehicle uuid, p_type text, p_date date, p_created timestamptz, p_meta jsonb,
                           p_writer text DEFAULT 'extract-bat-core', p_source_type text DEFAULT 'system') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.timeline_events (id, vehicle_id, event_type, source, title, event_date, created_at, updated_at, metadata,
                                      data_source, source_type, cost_amount, location_coordinates, image_urls, search_vector)
  VALUES (p_id, p_vehicle, p_type, CASE WHEN p_writer = 'extract-bat-core' THEN 'bat' ELSE 'other' END, p_type || ' fixture',
          p_date, p_created, p_created, p_meta, p_writer, p_source_type, 109993, point(1.5, -2.25), ARRAY['https://x/a.jpg'],
          to_tsvector('simple', 'bat ended bid'))
$$;

-- Fixtures. D = today (UTC), the planner's still_running edge. Listing URLs l<n>.
--  v1 live lot: early end row a1 (data-ends ahead, created 8 days before)               → planned, still_running
--  v2 sold:     early end row a2 + sold row s2 read after the close, + a mileage row      → planned, replaced_by_auction_sold
--  v3 unsold:   early end row a3 + an end row c3 written after the close                  → planned, replaced_by_auction_ended
--  v4 ended, never re-read: early end row a4                                              → planned, no_closing_read
--  v5 legacy early row with no recorded instant, created the day before its end day       → planned (basis event_date)
--  v6 same-day row with no recorded instant (ambiguous) / v6 row written after its end   → not planned
--  v7 a user's row, v8 another writer's row, v9 an early sold row (results are never planned) → not planned
--  v10 early end row linked from a comment                                                → planned; the writer leaves it
--  v11 an image_upload system row                                                        → the writer refuses it
INSERT INTO public.vehicles (id) SELECT pg_temp.u('0001', n) FROM generate_series(1, 12) n;
SELECT pg_temp.ev(pg_temp.u('a001', 1), pg_temp.u('0001', 1), 'auction_ended', current_date + 3, now() - interval '8 days',
  jsonb_build_object('source_url', 'l1', 'occurred_at', to_char((current_date + 3)::timestamp + interval '17 hours 35 minutes', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'), 'occurred_at_source', 'data-ends'));
SELECT pg_temp.ev(pg_temp.u('a001', 2), pg_temp.u('0001', 2), 'auction_ended', DATE '2026-10-12', TIMESTAMPTZ '2026-10-05 10:00Z',
  '{"source_url":"l2","occurred_at":"2026-10-12T19:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('5001', 2), pg_temp.u('0001', 2), 'auction_sold', DATE '2026-10-12', TIMESTAMPTZ '2026-10-12 19:30Z',
  '{"source_url":"l2","occurred_at":"2026-10-12T19:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('b001', 2), pg_temp.u('0001', 2), 'mileage_reading', DATE '2026-10-12', TIMESTAMPTZ '2026-10-05 10:00Z',
  '{"source_url":"l2"}');
SELECT pg_temp.ev(pg_temp.u('a001', 3), pg_temp.u('0001', 3), 'auction_ended', DATE '2026-10-12', TIMESTAMPTZ '2026-10-12 08:00Z',
  '{"source_url":"l3","occurred_at":"2026-10-12T20:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('c001', 3), pg_temp.u('0001', 3), 'auction_ended', DATE '2026-10-12', TIMESTAMPTZ '2026-10-12 21:00Z',
  '{"source_url":"l3","occurred_at":"2026-10-12T20:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('a001', 4), pg_temp.u('0001', 4), 'auction_ended', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l4","occurred_at":"2026-10-11T18:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('a001', 5), pg_temp.u('0001', 5), 'auction_ended', DATE '2026-03-10', TIMESTAMPTZ '2026-03-09 22:00Z',
  '{"source_url":"l5"}');
SELECT pg_temp.ev(pg_temp.u('a001', 6), pg_temp.u('0001', 6), 'auction_ended', DATE '2026-03-10', TIMESTAMPTZ '2026-03-10 09:00Z',
  '{"source_url":"l6"}');
SELECT pg_temp.ev(pg_temp.u('a002', 6), pg_temp.u('0001', 6), 'auction_ended', DATE '2026-10-11', TIMESTAMPTZ '2026-10-11 19:00Z',
  '{"source_url":"l6b","occurred_at":"2026-10-11T18:00:00.000Z","occurred_at_source":"data-ends"}');
SELECT pg_temp.ev(pg_temp.u('a001', 7), pg_temp.u('0001', 7), 'auction_ended', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l7"}', 'user_input', 'user_input');
SELECT pg_temp.ev(pg_temp.u('a001', 8), pg_temp.u('0001', 8), 'auction_ended', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l8"}', 'score-live-auctions');
SELECT pg_temp.ev(pg_temp.u('a001', 9), pg_temp.u('0001', 9), 'auction_sold', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l9"}');
SELECT pg_temp.ev(pg_temp.u('a001', 10), pg_temp.u('0001', 10), 'auction_ended', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l10","occurred_at":"2026-10-11T18:00:00.000Z","occurred_at_source":"data-ends"}');
INSERT INTO public.timeline_event_comments (event_id) VALUES (pg_temp.u('a001', 10));
SELECT pg_temp.ev(pg_temp.u('a001', 11), pg_temp.u('0001', 11), 'image_upload', DATE '2026-10-11', TIMESTAMPTZ '2026-10-04 10:00Z',
  '{"source_url":"l11","image_id":"00000000-0000-0000-0000-000000000001"}');

-- ── The plan ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE plan AS
  SELECT p FROM jsonb_array_elements(public.plan_bat_live_end_supersessions(DATE '2026-01-01', current_date + 30, 500)) p;
SELECT pg_temp.ok('plan: exactly the early auction_ended rows of extract-bat-core',
  (SELECT array_agg((p ->> 'event_id')::uuid ORDER BY p ->> 'event_id') FROM plan)
  = ARRAY[pg_temp.u('a001', 1), pg_temp.u('a001', 2), pg_temp.u('a001', 3), pg_temp.u('a001', 4), pg_temp.u('a001', 5),
          pg_temp.u('a001', 10)]);
SELECT pg_temp.ok('plan: classes and replacements (a result first, else the end row read after the close)',
  (SELECT jsonb_object_agg(p ->> 'event_id', jsonb_build_array(p ->> 'class', p ->> 'replacement_event_id')) FROM plan)
  = jsonb_build_object(
      pg_temp.u('a001', 1), jsonb_build_array('still_running', NULL),
      pg_temp.u('a001', 2), jsonb_build_array('replaced_by_auction_sold', pg_temp.u('5001', 2)),
      pg_temp.u('a001', 3), jsonb_build_array('replaced_by_auction_ended', pg_temp.u('c001', 3)),
      pg_temp.u('a001', 4), jsonb_build_array('no_closing_read', NULL),
      pg_temp.u('a001', 5), jsonb_build_array('no_closing_read', NULL),
      pg_temp.u('a001', 10), jsonb_build_array('no_closing_read', NULL)));
SELECT pg_temp.ok('plan: each row is cited (listing, creation clock, the end it names and its basis) and argued',
  (SELECT bool_and(p -> 'source' ->> 'type' = 'timeline_row' AND p -> 'source' ->> 'ref' LIKE 'l%'
                   AND p -> 'source' ? 'created_at' AND p -> 'source' ? 'claimed_end'
                   AND length(p ->> 'reason') >= 10) FROM plan)
  AND (SELECT p -> 'source' ->> 'claimed_end_basis' FROM plan WHERE p ->> 'event_id' = pg_temp.u('a001', 5)::text) = 'event_date'
  AND (SELECT p -> 'source' ->> 'claimed_end_basis' FROM plan WHERE p ->> 'event_id' = pg_temp.u('a001', 2)::text) = 'data-ends');
SELECT pg_temp.ok('plan: the window is [from, to) on event_date',
  jsonb_array_length(public.plan_bat_live_end_supersessions(DATE '2026-10-11', DATE '2026-10-12', 500)) = 2
  AND jsonb_array_length(public.plan_bat_live_end_supersessions(DATE '2026-10-12', DATE '2026-10-13', 500)) = 2
  AND jsonb_array_length(public.plan_bat_live_end_supersessions(DATE '2026-10-13', DATE '2026-10-14', 500)) = 0);
INSERT INTO public.vehicles (id) VALUES (pg_temp.u('0002', 1));
INSERT INTO public.timeline_events (vehicle_id, event_type, source, title, event_date, created_at, metadata, data_source, source_type)
  SELECT pg_temp.u('0002', 1), 'auction_ended', 'bat', 'bulk', DATE '2025-06-01', TIMESTAMPTZ '2025-05-25 00:00Z',
         jsonb_build_object('source_url', 'bulk' || n), 'extract-bat-core', 'system' FROM generate_series(1, 501) n;
SELECT pg_temp.ok('plan: at most 500 rows per call, and the limit is honoured',
  jsonb_array_length(public.plan_bat_live_end_supersessions(DATE '2025-06-01', DATE '2025-06-02', 100000)) = 500
  AND jsonb_array_length(public.plan_bat_live_end_supersessions(DATE '2025-06-01', DATE '2025-06-02', 3)) = 3);
SELECT pg_temp.ok('plan: pages in id order after the cursor, each row once',
  (WITH p1 AS (SELECT public.plan_bat_live_end_supersessions(DATE '2025-06-01', DATE '2025-06-02', 300) j),
        p2 AS (SELECT public.plan_bat_live_end_supersessions(DATE '2025-06-01', DATE '2025-06-02', 300,
                 ((SELECT j FROM p1) -> -1 ->> 'event_id')::uuid) j),
        ids AS (SELECT (e ->> 'event_id')::uuid id FROM p1, jsonb_array_elements(p1.j) e
                UNION ALL SELECT (e ->> 'event_id')::uuid FROM p2, jsonb_array_elements(p2.j) e)
   SELECT count(*) = 501 AND count(DISTINCT id) = 501 FROM ids)
  AND (SELECT bool_and((a ->> 'event_id') < (b ->> 'event_id'))
       FROM (SELECT e AS a, lead(e) OVER (ORDER BY o) AS b
             FROM jsonb_array_elements(public.plan_bat_live_end_supersessions(DATE '2025-06-01', DATE '2025-06-02', 50))
                  WITH ORDINALITY x(e, o)) s WHERE b IS NOT NULL));

-- ── Refusals: nothing written ────────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.refuses('writer: an uncited row refuses the whole call',
  format($q$SELECT public.supersede_timeline_events(%L::jsonb)$q$, jsonb_build_array(
    (SELECT p FROM plan WHERE p ->> 'event_id' = pg_temp.u('a001', 4)::text),
    jsonb_build_object('event_id', pg_temp.u('a001', 5), 'expected_vehicle_id', pg_temp.u('0001', 5),
      'expected_event_type', 'auction_ended', 'source', jsonb_build_object('type', 'timeline_row'), 'reason', 'a reason long enough'))),
  'has no cited source');
SELECT pg_temp.refuses('writer: a short reason refuses the call',
  format($q$SELECT public.supersede_timeline_events(%L::jsonb)$q$, jsonb_build_array(
    (SELECT p || '{"reason":"wrong"}' FROM plan WHERE p ->> 'event_id' = pg_temp.u('a001', 4)::text))),
  'reason of 10+');
SELECT pg_temp.refuses('writer: more than 500 rows',
  format($q$SELECT public.supersede_timeline_events(%L::jsonb)$q$,
    (SELECT jsonb_agg(p) FROM plan, generate_series(1, 90))),
  'at most 500 rows');
SELECT pg_temp.refuses('writer: caller statement_timeout 0 (unbounded)',
  $q$SELECT set_config('statement_timeout', '0', true), public.supersede_timeline_events('[]'::jsonb)$q$,
  'statement_timeout between');
SELECT pg_temp.refuses('writer: caller statement_timeout over 60 s',
  $q$SELECT set_config('statement_timeout', '61s', true), public.supersede_timeline_events('[]'::jsonb)$q$,
  'statement_timeout between');
SET statement_timeout = '30s';
SELECT pg_temp.ok('refusals wrote nothing', pg_temp.writes() = 0 AND (SELECT count(*) FROM public.timeline_events) = 516);

-- ── Reported, not written ────────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE res AS SELECT public.supersede_timeline_events(jsonb_build_array(
  jsonb_build_object('event_id', pg_temp.u('a001', 4), 'expected_vehicle_id', pg_temp.u('0001', 9),
    'expected_event_type', 'auction_ended', 'source', jsonb_build_object('type', 't', 'ref', 'l4'), 'reason', 'stale plan: other vehicle'),
  jsonb_build_object('event_id', pg_temp.u('a001', 4), 'expected_vehicle_id', pg_temp.u('0001', 4),
    'expected_event_type', 'auction_sold', 'source', jsonb_build_object('type', 't', 'ref', 'l4'), 'reason', 'stale plan: other type'),
  jsonb_build_object('event_id', pg_temp.u('ffff', 1), 'expected_vehicle_id', pg_temp.u('0001', 4),
    'expected_event_type', 'auction_ended', 'source', jsonb_build_object('type', 't', 'ref', 'l4'), 'reason', 'no such row here'),
  jsonb_build_object('event_id', pg_temp.u('a001', 7), 'expected_vehicle_id', pg_temp.u('0001', 7),
    'expected_event_type', 'auction_ended', 'source', jsonb_build_object('type', 't', 'ref', 'l7'), 'reason', 'a user row, never'),
  jsonb_build_object('event_id', pg_temp.u('a001', 11), 'expected_vehicle_id', pg_temp.u('0001', 11),
    'expected_event_type', 'image_upload', 'source', jsonb_build_object('type', 't', 'ref', 'l11'), 'reason', 'a photo row, never'),
  jsonb_build_object('event_id', pg_temp.u('a001', 4), 'expected_vehicle_id', pg_temp.u('0001', 4),
    'expected_event_type', 'auction_ended', 'replacement_event_id', pg_temp.u('5001', 2),
    'source', jsonb_build_object('type', 't', 'ref', 'l4'), 'reason', 'replacement from another listing'),
  (SELECT p FROM plan WHERE p ->> 'event_id' = pg_temp.u('a001', 10)::text)), 'contract') AS r;
SELECT pg_temp.ok('reported: stale (vehicle, type), missing, user row, image_upload, foreign replacement, linked row',
  (SELECT jsonb_array_length(r -> 'stale') = 2 AND r -> 'missing' = jsonb_build_array(pg_temp.u('ffff', 1))
      AND jsonb_array_length(r -> 'refused') = 3 AND (r ->> 'retired')::int = 0
      AND r -> 'referenced' = jsonb_build_array(jsonb_build_object('event_id', pg_temp.u('a001', 10),
                                                                   'linked_from', jsonb_build_array('timeline_event_comments')))
   FROM res));
SELECT pg_temp.ok('reported rows are untouched, the linked comment stands',
  pg_temp.writes() = 0 AND (SELECT count(*) FROM public.timeline_events) = 516
  AND (SELECT count(*) FROM public.timeline_event_comments) = 1);

-- ── The plan applied ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE before AS SELECT id, to_jsonb(t) AS j FROM public.timeline_events t;
CREATE TEMP TABLE profile_before AS SELECT pg_temp.profile_timeline(pg_temp.u('0001', 2)) AS t;
BEGIN;
CREATE TEMP TABLE applied AS
  SELECT public.supersede_timeline_events((SELECT jsonb_agg(p - 'class' - 'event_date') FROM plan), 'contract') AS r;
SELECT pg_temp.ok('lock_timeout is 3 s inside the call', current_setting('lock_timeout') = '3s');
COMMIT;
SELECT pg_temp.ok('applied: five retired, the linked one reported',
  (SELECT (r ->> 'retired')::int = 5 AND jsonb_array_length(r -> 'referenced') = 1 AND r ->> 'asserted_by' = 'contract'
   FROM applied));
SELECT pg_temp.ok('retired rows are kept whole: row_data is the row as it was, with citation, reason and replacement',
  (SELECT count(*) FROM public.superseded_rows s JOIN before b ON b.id = s.row_id
   WHERE s.source_table = 'timeline_events' AND s.row_data = b.j AND s.asserted_by = 'contract'
     AND s.source ->> 'writer' = 'supersede_timeline_events' AND s.source ->> 'type' = 'timeline_row'
     AND s.reason LIKE 'BaT end event written while the auction was still running%') = 5
  AND (SELECT s.source ->> 'replacement_event_id' FROM public.superseded_rows s WHERE s.row_id = pg_temp.u('a001', 2))
      = pg_temp.u('5001', 2)::text
  AND (SELECT s.source -> 'replacement_event_id' FROM public.superseded_rows s WHERE s.row_id = pg_temp.u('a001', 1))
      = 'null'::jsonb);
SELECT pg_temp.ok('retired rows leave timeline_events; replacements, other rows and other writers stay',
  NOT EXISTS (SELECT 1 FROM public.timeline_events WHERE id IN (pg_temp.u('a001', 1), pg_temp.u('a001', 2), pg_temp.u('a001', 3),
                                                               pg_temp.u('a001', 4), pg_temp.u('a001', 5)))
  AND (SELECT count(*) FROM public.timeline_events WHERE id IN (pg_temp.u('5001', 2), pg_temp.u('c001', 3), pg_temp.u('b001', 2),
       pg_temp.u('a001', 6), pg_temp.u('a002', 6), pg_temp.u('a001', 7), pg_temp.u('a001', 8), pg_temp.u('a001', 9),
       pg_temp.u('a001', 10), pg_temp.u('a001', 11))) = 10);
SELECT pg_temp.ok('the profile timeline fold drops the early end row with no reader change',
  (SELECT t -> 'total' FROM profile_before) = '3'::jsonb
  AND (SELECT t -> 'days' -> 0 -> 'kinds' FROM profile_before) = '{"auction_ended": 1, "auction_sold": 1, "mileage_reading": 1}'::jsonb
  AND pg_temp.profile_timeline(pg_temp.u('0001', 2)) -> 'total' = '2'::jsonb
  AND pg_temp.profile_timeline(pg_temp.u('0001', 2)) -> 'days' -> 0 -> 'kinds' = '{"auction_sold": 1, "mileage_reading": 1}'::jsonb);
SELECT pg_temp.ok('a retired row is no longer planned',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.plan_bat_live_end_supersessions(DATE '2026-01-01', current_date + 30, 500)) p
              WHERE p ->> 'event_id' <> pg_temp.u('a001', 10)::text));
SELECT pg_temp.ok('a second call answers already and writes nothing',
  (SELECT r -> 'already' FROM (SELECT public.supersede_timeline_events((SELECT jsonb_agg(p ORDER BY p ->> 'event_id') FROM plan
     WHERE p ->> 'event_id' IN (pg_temp.u('a001', 1)::text, pg_temp.u('a001', 2)::text)), 'contract') AS r) x)
    = jsonb_build_array(pg_temp.u('a001', 1), pg_temp.u('a001', 2))
  AND pg_temp.writes() = 5);
-- Restore = re-insert row_data: the row comes back exactly as it was (every column type round-trips).
INSERT INTO public.timeline_events
  SELECT (jsonb_populate_record(NULL::public.timeline_events, s.row_data)).* FROM public.superseded_rows s
  WHERE s.row_id = pg_temp.u('a001', 2);
SELECT pg_temp.ok('restore from row_data gives the original row back',
  (SELECT to_jsonb(t) FROM public.timeline_events t WHERE t.id = pg_temp.u('a001', 2))
  = (SELECT j FROM before WHERE id = pg_temp.u('a001', 2)));

-- ── Access and re-apply ──────────────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.ok('EXECUTE is service-role only',
  NOT has_function_privilege('anon', 'public.supersede_timeline_events(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supersede_timeline_events(jsonb,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.supersede_timeline_events(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.plan_bat_live_end_supersessions(date,date,integer,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.plan_bat_live_end_supersessions(date,date,integer,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.plan_bat_live_end_supersessions(date,date,integer,uuid)', 'EXECUTE'));
CREATE TEMP TABLE defs AS SELECT md5(pg_get_functiondef('public.supersede_timeline_events(jsonb,text)'::regprocedure)) w,
  md5(pg_get_functiondef('public.plan_bat_live_end_supersessions(date,date,integer,uuid)'::regprocedure)) p,
  obj_description('public.superseded_rows'::regclass, 'pg_class') c;
\ir ../migrations/20261016203000_supersede_timeline_events.sql
SELECT pg_temp.ok('re-applying the migration is a no-op (same bodies, the table comment extended once)',
  (SELECT w = md5(pg_get_functiondef('public.supersede_timeline_events(jsonb,text)'::regprocedure))
      AND p = md5(pg_get_functiondef('public.plan_bat_live_end_supersessions(date,date,integer,uuid)'::regprocedure))
      AND c = obj_description('public.superseded_rows'::regclass, 'pg_class')
      AND (length(c) - length(replace(c, 'supersede_timeline_events', ''))) / length('supersede_timeline_events') = 1
   FROM defs));
