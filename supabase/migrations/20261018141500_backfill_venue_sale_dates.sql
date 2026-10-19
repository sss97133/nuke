-- Backfill missing sale_date on confirmed-sold vehicles from authoritative house target & episode records (2026-10-18)
--
-- Scope (strictly cited, zero write-clock contamination, skipping any day previously retracted as an importer write-clock):
--   1. Mecum: confirmed sold vehicles in mv_treemap_outcomes with v.sale_date IS NULL that match a Mecum row in
--      public.source_targets via public.source_target_key(url) carrying a non-null Algolia run_date (st.sale_at <= current_date).
--      Source cited: `source_targets/<id>`, type `mecum_algolia_run_date`, listing_url.
--   2. Barrett-Jackson: confirmed sold vehicles in mv_treemap_outcomes with v.sale_date IS NULL that have a Barrett-Jackson
--      episode in public.vehicle_events carrying a non-null sold_at whose UTC year matches the auction event year in the
--      Barrett-Jackson docket URL slug (e.g. `scottsdale-2024` -> 2024).
--      Source cited: `vehicle_events/<id>`, type `barrett_jackson_episode_sold_at`, source_url.
--   3. Other venues (PCarMarket, Cars & Bids, Gooding & Co, RM Sotheby's, Bring a Trailer, Collecting Cars, SBX Cars):
--      confirmed sold vehicles in mv_treemap_outcomes with v.sale_date IS NULL that have an episode in public.vehicle_events
--      carrying a non-null auction `ended_at` (never `sold_at` write-clocks!) with `ended_at::date <= current_date` and
--      distinct from any previously retracted day.
--      Source cited: `vehicle_events/<id>`, type `vehicle_event_ended_at`, source_url.
--
-- All writes execute through `public.correct_vehicle_sale_provenance_batch(p_rows, p_asserted_by, p_reason)` in chunks of
-- 2,000 rows so every row carries its full provenance audit entry in `provenance_metadata.sale_provenance_corrections`.

BEGIN;
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '30s';

CREATE TEMP TABLE _sale_date_backfill_queue (
  seq serial PRIMARY KEY,
  lane text NOT NULL,
  payload jsonb NOT NULL
) ON COMMIT DROP;

-- 1. Mecum from source_targets.sale_at (mecum_algolia_run_date)
INSERT INTO _sale_date_backfill_queue (lane, payload)
WITH undated_mecum AS MATERIALIZED (
  SELECT o.id, v.listing_url, v.discovery_url, v.platform_url, v.provenance_metadata
  FROM public.mv_treemap_outcomes o
  LEFT JOIN public.mv_family_sales s ON s.vehicle_id = o.id
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.sold_amount > 0 AND s.vehicle_id IS NULL AND o.source_name = 'Mecum'
    AND v.sale_date IS NULL
),
urls AS (
  SELECT u.id,
         public.source_target_key(coalesce(
           (SELECT e -> 'source' ->> 'ref'
            FROM jsonb_array_elements(coalesce(u.provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb)) e
            WHERE (e -> 'source' ->> 'ref') LIKE '%mecum.com/lots/%' LIMIT 1),
           u.listing_url,
           u.discovery_url,
           u.platform_url
         )) AS st_key,
         (SELECT max(t.e ->> 'original')::date
          FROM jsonb_array_elements(coalesce(u.provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb)) t(e)
          WHERE t.e ->> 'field' = 'sale_date'
            AND t.e -> 'corrected' = 'null'::jsonb) AS retracted_day
  FROM undated_mecum u
),
matched AS (
  SELECT DISTINCT ON (u.id)
         u.id AS vehicle_id,
         st.id AS st_id,
         st.listing_url,
         (st.sale_at AT TIME ZONE 'UTC')::date AS sale_date,
         coalesce(st.sale_at_source, 'mecum_algolia_run_date') AS sale_at_source
  FROM urls u
  JOIN public.source_targets st
    ON st.source_slug = 'mecum'
   AND public.source_target_key(st.listing_url) = u.st_key
  WHERE st.sale_at IS NOT NULL
    AND (st.sale_at AT TIME ZONE 'UTC')::date <= current_date
    AND (st.sale_at AT TIME ZONE 'UTC')::date IS DISTINCT FROM u.retracted_day
  ORDER BY u.id, st.sale_at DESC
)
SELECT 'mecum_source_targets',
       jsonb_build_object(
         'vehicle_id', m.vehicle_id,
         'source', jsonb_build_object(
           'ref', 'source_targets/' || m.st_id,
           'type', m.sale_at_source,
           'listing_url', m.listing_url,
           'method', 'Reconciled vehicles.sale_date from source_targets.sale_at via source_target_key(url)'
         ),
         'corrections', jsonb_build_object(
           'sale_date', jsonb_build_object(
             'expected', null,
             'value', to_char(m.sale_date, 'YYYY-MM-DD')
           )
         )
       )
FROM matched m;

-- 2. Barrett-Jackson from vehicle_events.sold_at verified against URL auction slug year
INSERT INTO _sale_date_backfill_queue (lane, payload)
WITH undated_bj AS MATERIALIZED (
  SELECT o.id, coalesce(v.discovery_url, v.listing_url, v.platform_url) AS url, v.provenance_metadata
  FROM public.mv_treemap_outcomes o
  LEFT JOIN public.mv_family_sales s ON s.vehicle_id = o.id
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.sold_amount > 0 AND s.vehicle_id IS NULL AND o.source_name = 'Barrett-Jackson'
    AND v.sale_date IS NULL
),
bj_ev AS (
  SELECT u.id AS vehicle_id,
         u.url,
         (regexp_match((regexp_match(u.url, '^https?://[^/]+/([^/?#]+)'))[1], '((?:19|20)\d\d)'))[1]::int AS url_year,
         ev.id AS event_id,
         ev.source_url,
         (ev.sold_at AT TIME ZONE 'UTC')::date AS sale_date,
         (SELECT max(t.e ->> 'original')::date
          FROM jsonb_array_elements(coalesce(u.provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb)) t(e)
          WHERE t.e ->> 'field' = 'sale_date'
            AND t.e -> 'corrected' = 'null'::jsonb) AS retracted_day
  FROM undated_bj u
  JOIN LATERAL (
    SELECT e.id, e.source_url, e.sold_at
    FROM public.vehicle_events e
    WHERE e.vehicle_id = u.id
      AND e.source_url LIKE '%barrett-jackson.com%'
      AND e.sold_at IS NOT NULL
    ORDER BY e.sold_at DESC LIMIT 1
  ) ev ON true
)
SELECT 'barrett_jackson_events',
       jsonb_build_object(
         'vehicle_id', b.vehicle_id,
         'source', jsonb_build_object(
           'ref', 'vehicle_events/' || b.event_id,
           'type', 'barrett_jackson_episode_sold_at',
           'source_url', b.source_url,
           'url_event_year', b.url_year,
           'method', 'Reconciled vehicles.sale_date from Barrett-Jackson vehicle_events.sold_at matching URL auction event year'
         ),
         'corrections', jsonb_build_object(
           'sale_date', jsonb_build_object(
             'expected', null,
             'value', to_char(b.sale_date, 'YYYY-MM-DD')
           )
         )
       )
FROM bj_ev b
WHERE extract(year FROM b.sale_date)::int = b.url_year
  AND b.sale_date <= current_date
  AND b.sale_date IS DISTINCT FROM b.retracted_day;

-- 3. Other venues from vehicle_events.ended_at (strictly ended_at, never sold_at write-clocks)
INSERT INTO _sale_date_backfill_queue (lane, payload)
WITH undated_other AS MATERIALIZED (
  SELECT o.id, o.source_name, v.provenance_metadata
  FROM public.mv_treemap_outcomes o
  LEFT JOIN public.mv_family_sales s ON s.vehicle_id = o.id
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.sold_amount > 0 AND s.vehicle_id IS NULL
    AND o.source_name NOT IN ('Mecum', 'Barrett-Jackson')
    AND v.sale_date IS NULL
),
ev_ended AS (
  SELECT u.id AS vehicle_id,
         u.source_name,
         ev.id AS event_id,
         ev.source_url,
         (ev.ended_at AT TIME ZONE 'UTC')::date AS sale_date,
         (SELECT max(t.e ->> 'original')::date
          FROM jsonb_array_elements(coalesce(u.provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb)) t(e)
          WHERE t.e ->> 'field' = 'sale_date'
            AND t.e -> 'corrected' = 'null'::jsonb) AS retracted_day
  FROM undated_other u
  JOIN LATERAL (
    SELECT e.id, e.source_url, e.ended_at
    FROM public.vehicle_events e
    WHERE e.vehicle_id = u.id
      AND e.ended_at IS NOT NULL
    ORDER BY e.ended_at DESC LIMIT 1
  ) ev ON true
)
SELECT 'other_venue_ended_at',
       jsonb_build_object(
         'vehicle_id', e.vehicle_id,
         'source', jsonb_build_object(
           'ref', 'vehicle_events/' || e.event_id,
           'type', 'vehicle_event_ended_at',
           'venue', e.source_name,
           'source_url', e.source_url,
           'method', 'Reconciled vehicles.sale_date from auction episode vehicle_events.ended_at'
         ),
         'corrections', jsonb_build_object(
           'sale_date', jsonb_build_object(
             'expected', null,
             'value', to_char(e.sale_date, 'YYYY-MM-DD')
           )
         )
       )
FROM ev_ended e
WHERE e.sale_date <= current_date
  AND e.sale_date IS DISTINCT FROM e.retracted_day;

DO $apply$
DECLARE
  v_min int;
  v_max int;
  v_lo  int;
  v_hi  int;
  v_batch jsonb;
  v_res jsonb;
  v_total_corrected int := 0;
BEGIN
  SELECT min(seq), max(seq) INTO v_min, v_max FROM _sale_date_backfill_queue;
  IF v_min IS NULL THEN
    RAISE NOTICE 'No undated vehicles queued for sale_date backfill.';
    RETURN;
  END IF;

  v_lo := v_min;
  WHILE v_lo <= v_max LOOP
    v_hi := v_lo + 1999;
    SELECT jsonb_agg(payload ORDER BY seq)
      INTO v_batch
      FROM _sale_date_backfill_queue
     WHERE seq BETWEEN v_lo AND v_hi;

    IF v_batch IS NOT NULL THEN
      v_res := public.correct_vehicle_sale_provenance_batch(
        v_batch,
        'market-sale-date-backfill-2026-10-18',
        'Backfill missing vehicles.sale_date on confirmed-sold vehicles from authoritative source_targets.sale_at and vehicle_events dates'
      );
      v_total_corrected := v_total_corrected + coalesce((v_res ->> 'vehicles_corrected')::int, 0);
      RAISE NOTICE 'Batch %..%: corrected=% (running total=%)', v_lo, v_hi, v_res ->> 'vehicles_corrected', v_total_corrected;
    END IF;

    v_lo := v_hi + 1;
  END LOOP;
END $apply$;

COMMIT;
