-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_market_source_landing_window -f this-file.sql
-- Contract for 20261021001000_market_source_landing_live_held_archived_window.sql, on top of the Sources board contract's
-- synthetic sources and readers (test_market_sources_board.sql). Synthetic rows only; never production.
--   * the drill-down's held count is the fold's count with its clock, and held_since counts the events landed after that
--     clock (eBay Motors read "3,575 held" beside "+17,583 in 24 hours" on 2026-10-20);
--   * `window` counts every event landed in the window (24 hours, or the selected hour), not the 40 rows shown: sold,
--     ended, live, archived, and the median of sold prices;
--   * an archived capture (metadata.page.archive.archive_timestamp) is marked archived, carries its capture time, and
--     with no clock of its own takes that time as its record date; a malformed capture time fails nothing;
--   * a listing that is not an archive page is never marked archived and gets no invented date;
--   * the reader with no source names no window;
--   * eBay Motors' species evidence is re-dated and keeps its species, set and listing rule (when the column exists).
\ir test_market_sources_board.sql

-- the columns the reader reads beyond the board contract's landing log, with their live types (2026-10-20)
ALTER TABLE public.vehicle_events
  ADD COLUMN event_type text, ADD COLUMN event_status text, ADD COLUMN started_at timestamptz, ADD COLUMN ended_at timestamptz,
  ADD COLUMN sold_at timestamptz, ADD COLUMN reserve_price numeric, ADD COLUMN final_price numeric, ADD COLUMN current_price numeric,
  ADD COLUMN starting_price numeric, ADD COLUMN bid_count integer, ADD COLUMN metadata jsonb, ADD COLUMN source_listing_id text,
  ADD COLUMN vehicle_id uuid, ADD COLUMN source_url text;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text, trim text,
  vin text, mileage integer);
ALTER TABLE public.observation_sources ADD COLUMN species text, ADD COLUMN species_set text[], ADD COLUMN species_evidence jsonb;
INSERT INTO public.observation_sources (slug, display_name, category, created_at, species, species_set, species_evidence)
VALUES ('ebay_motors', 'eBay Motors', 'marketplace', '2025-01-01', 'auth_walled_marketplace', '{auth_walled_marketplace}',
  '{"seen": "Direct fetches are refused (403).", "examined": ["browseApi.ts"], "examined_at": "2026-10-18", "extractor": "extract-ebay-motors",
    "listing_rule": "metadata.buying_options contains CLASSIFIED_AD -> classifieds; other rows take the primary"}');
-- the daily fold counted three lots 19 hours ago
INSERT INTO public.market_source_days (day, source_slug, display_name, landed_lots, landed_at)
VALUES (current_date, 'ebay_motors', 'eBay Motors', 3, now() - interval '19 hours');
INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1973, 'Pontiac', 'Trans Am'),
  ('00000000-0000-0000-0000-0000000000a2', 1939, 'Chevrolet', 'Other'),
  ('00000000-0000-0000-0000-0000000000a3', 1973, 'BMW', '2002'),
  ('00000000-0000-0000-0000-0000000000a4', 1969, 'Ford', 'Mustang');
-- three before the fold, five after it
INSERT INTO public.vehicle_events (source_platform, created_at, event_type, event_status, source_listing_id)
SELECT 'ebay_motors', now() - interval '30 hours' - n * interval '1 minute', 'listing', 'ended', 'old-' || n
FROM generate_series(1, 3) n;
INSERT INTO public.vehicle_events (source_platform, created_at, event_type, event_status, source_listing_id, vehicle_id,
                                   final_price, current_price, sold_at, ended_at, metadata) VALUES
  ('ebay_motors', now() - interval '10 minutes', 'listing', 'sold', 'sold-1', '00000000-0000-0000-0000-0000000000a1',
   14999, 14999, '2011-12-03 18:00Z', '2011-12-03 18:00Z',
   '{"archive_timestamp": "20111204101010", "page": {"archive": {"archive_timestamp": "20111204101010"}}}'),
  ('ebay_motors', now() - interval '9 minutes', 'listing', 'ended', 'ended-1', '00000000-0000-0000-0000-0000000000a2',
   NULL, 100, NULL, '2013-03-19 00:41:05Z', '{"page": {"archive": {"archive_timestamp": "20130526205956"}}}'),
  ('ebay_motors', now() - interval '8 minutes', 'listing', 'active', 'active-1', '00000000-0000-0000-0000-0000000000a3',
   NULL, 2102, NULL, NULL, '{"page": {"archive": {"archive_timestamp": "20120119220009"}}}'),
  ('ebay_motors', now() - interval '7 minutes', 'listing', 'active', 'live-1', '00000000-0000-0000-0000-0000000000a4',
   NULL, 31000, NULL, NULL, '{}'),
  ('ebay_motors', now() - interval '3 hours', 'listing', 'ended', 'bad-ts', '00000000-0000-0000-0000-0000000000a4',
   NULL, 500, NULL, NULL, '{"page": {"archive": {"archive_timestamp": "not-a-time"}}}');
\ir ../migrations/20261021001000_market_source_landing_live_held_archived_window.sql
\ir ../migrations/20261021001000_market_source_landing_live_held_archived_window.sql

SET ROLE anon;
DO $$
DECLARE d jsonb := public.market_source_landing_read('ebay_motors');
  r jsonb;
  h jsonb := public.market_source_landing_read('ebay_motors', date_trunc('hour', now() - interval '3 hours'));
BEGIN
  PERFORM pg_temp.ok('held is the fold''s count with its clock; held_since counts what landed after that clock',
    (d->'stats'->>'held_lots')::int = 3 AND (d->'stats'->>'held_since')::int = 5 AND d->'stats'->>'held_at' IS NOT NULL);
  PERFORM pg_temp.ok('the window counts every event landed in 24 hours: one sold, two ended, two active, four archived',
    (d->'window'->>'events')::int = 5 AND (d->'window'->>'sold')::int = 1 AND (d->'window'->>'ended')::int = 2
    AND (d->'window'->>'live')::int = 2 AND (d->'window'->>'archived')::int = 4 AND (d->'window'->>'capped')::boolean IS FALSE);
  PERFORM pg_temp.ok('the median sold price is over sold rows with a price, not the rows shown',
    (d->'window'->>'sold_priced')::int = 1 AND (d->'window'->>'median_sold_price')::numeric = 14999);
  SELECT x INTO r FROM jsonb_array_elements(d->'recent') x WHERE x->>'lot' = 'active-1';
  PERFORM pg_temp.ok('an archived capture that never ended is dated by its capture and marked archived',
    r->>'record_date' = '2012-01-19T22:00:09Z' AND r->>'captured_at' = '2012-01-19T22:00:09Z' AND (r->>'archived')::boolean);
  SELECT x INTO r FROM jsonb_array_elements(d->'recent') x WHERE x->>'lot' = 'sold-1';
  PERFORM pg_temp.ok('an event with its own clock keeps it as the record date; the capture time rides beside it',
    (r->>'record_date')::timestamptz = '2011-12-03 18:00Z' AND r->>'captured_at' = '2011-12-04T10:10:10Z');
  SELECT x INTO r FROM jsonb_array_elements(d->'recent') x WHERE x->>'lot' = 'live-1';
  PERFORM pg_temp.ok('a listing that is not an archive page is not marked archived and gets no invented date',
    NOT (r->>'archived')::boolean AND r->'record_date' = 'null'::jsonb AND r->'captured_at' = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(d->'recent') x WHERE x->>'lot' = 'bad-ts';
  PERFORM pg_temp.ok('a malformed capture time is carried as archived, with no date, and does not fail the read',
    (r->>'archived')::boolean AND r->'captured_at' = 'null'::jsonb AND r->'record_date' = 'null'::jsonb);
  PERFORM pg_temp.ok('a selected hour measures that hour only',
    (h->'window'->>'events')::int = 1 AND (h->'window'->>'ended')::int = 1 AND (h->'window'->>'sold')::int = 0
    AND h->'window'->'median_sold_price' = 'null'::jsonb);
  PERFORM pg_temp.ok('all sources at once: no window',
    public.market_source_landing_read()->'window' = 'null'::jsonb);
END $$;
RESET ROLE;

SELECT pg_temp.ok('eBay Motors'' evidence is re-dated, names the archive intake, and keeps its species, set and listing rule',
  (SELECT species_evidence ->> 'examined_at' = '2026-10-20'
          AND species_evidence ->> 'seen' LIKE '%Internet Archive''s captures%18,194 rows from archived pages%'
          AND species_evidence ->> 'extractor' = 'extract-ebay-motors'
          AND species_evidence ->> 'listing_rule' LIKE '%CLASSIFIED_AD%'
          AND jsonb_array_length(species_evidence -> 'examined') = 4
          AND species = 'auth_walled_marketplace'
   FROM public.observation_sources WHERE slug = 'ebay_motors'));
