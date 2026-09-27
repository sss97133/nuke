-- gen_corrections.sql — per-VEHICLE correction rows for correct_vehicle_sale_provenance_batch.
--
-- A vehicles row is a vehicle, not a lot: it can carry several BaT listings (relistings, e.g.
-- d116b6fb: lot -21 sold 2025-10 $35,251, lot -26 sold 2026-02 $44,250 — prod's $44,250 is right).
-- extract-bat-core's own rule (listingIsLatestOrEqual): sale fields come from the LATEST SOLD
-- lot and survive a later reserve-not-met relisting; auction state comes from the latest lot.
--
-- Inputs (in work.duckdb): truth (per lot, catalog-wide), cat, pvrows = the prod vehicles rows to
-- correct with columns id, bat_auction_url, listing_url, discovery_url, vin, merged_into (NULL =
-- live), year, make, sale_price, sale_status, auction_outcome, reserve_status, high_bid, sale_date,
-- auction_end_date, bat_buyer. Output: corrections (vehicle_id, row_json, n_fields).

-- 1. vehicle ↔ lot links: the three URL columns, plus catalog lots sharing a usable VIN
CREATE OR REPLACE TABLE vlots AS
SELECT vehicle_id, slug, string_agg(DISTINCT via, '+') AS via FROM (
  -- one equijoin per URL column (an IN over three expressions is a nested loop over 264K x 188K rows)
  SELECT u.id AS vehicle_id, t.slug, 'url' AS via
  FROM (SELECT id, slug_of(bat_auction_url) AS s FROM pvrows WHERE merged_into IS NULL AND bat_auction_url IS NOT NULL
        UNION ALL SELECT id, slug_of(listing_url) FROM pvrows WHERE merged_into IS NULL AND listing_url IS NOT NULL
        UNION ALL SELECT id, slug_of(discovery_url) FROM pvrows WHERE merged_into IS NULL AND discovery_url IS NOT NULL) u
  JOIN truth t ON t.slug = u.s AND t.slug <> ''
  UNION ALL
  -- VIN links only when the lot's model year agrees with the vehicle's (a mistyped VIN on a page must not
  -- pull a different truck's sale onto this vehicle)
  SELECT p.id, t.slug, 'vin'
  FROM pvrows p JOIN truth t ON t.vin = upper(trim(p.vin))
  WHERE p.merged_into IS NULL AND p.vin IS NOT NULL AND length(trim(p.vin)) >= 11 AND t.vin_ok
    AND (p.year IS NULL OR t.year IS NULL OR abs(p.year - t.year) <= 1)
    AND (p.make IS NULL OR t.title IS NULL OR lower(t.title) LIKE '%' || lower(split_part(p.make, '-', 1)) || '%')
  UNION ALL
  -- sale-match links: the row already carries a sale that is exactly some OTHER catalog lot's sale (same price,
  -- same day, same buyer when known) → that lot is a relisting of this vehicle a writer found before us
  -- (e.g. 1976-porsche-914-41 → -95: "41-Years-Family-Owned" relisted as "44-Years-Family-Owned", VIN on -95 only).
  SELECT p.id, t.slug, 'sale_match'
  FROM pvrows p JOIN truth t ON t.sold AND t.price_paid = p.sale_price AND t.end_day = p.sale_date
  WHERE p.merged_into IS NULL AND p.sale_price > 0 AND p.sale_date IS NOT NULL AND t.slug <> '' AND coalesce(t.kind, 'car') = 'car'
    AND (p.bat_buyer IS NULL OR t.buyer IS NULL OR lower(p.bat_buyer) = lower(t.buyer))
    AND (p.year IS NULL OR t.year IS NULL OR abs(p.year - t.year) <= 1)
    AND (p.make IS NULL OR t.title IS NULL OR lower(t.title) LIKE '%' || lower(split_part(p.make, '-', 1)) || '%')
) GROUP BY vehicle_id, slug;

-- 2. per vehicle: latest lot, latest sold lot
CREATE OR REPLACE TABLE vtruth AS
WITH x AS (
  SELECT v.vehicle_id, t.*, v.via,
         row_number() OVER (PARTITION BY v.vehicle_id ORDER BY t.end_ts DESC) AS rn_latest,
         row_number() OVER (PARTITION BY v.vehicle_id ORDER BY t.sold DESC, t.end_ts DESC) AS rn_sold
  FROM vlots v JOIN truth t USING (slug)
), latest AS (SELECT * FROM x WHERE rn_latest = 1),
   lsold  AS (SELECT * FROM x WHERE rn_sold = 1 AND sold),
   agg    AS (SELECT vehicle_id, count(*) AS n_lots, list(slug ORDER BY end_ts) AS lots FROM x GROUP BY vehicle_id)
SELECT l.vehicle_id,
       l.slug AS latest_slug, l.canonical_url AS latest_url, l.end_ts AS latest_end_ts, l.end_day AS latest_end_day,
       l.final_bid AS latest_final_bid, l.auction_outcome AS latest_outcome, l.reserve_status AS latest_reserve_status,
       s.slug AS sold_slug, s.canonical_url AS sold_url, s.end_day AS sold_day, s.price_paid AS sold_price, s.buyer AS sold_buyer,
       s.has_detail AS sold_has_detail, s.price_method AS sold_price_method,
       a.n_lots, a.lots
FROM latest l LEFT JOIN lsold s USING (vehicle_id) JOIN agg a USING (vehicle_id);

-- 3. proposed projection vs what we hold; a field is proposed only when it differs
CREATE OR REPLACE TABLE corrections AS
WITH j AS (
  SELECT p.id AS vehicle_id, v.*,
         CASE WHEN v.sold_slug IS NOT NULL THEN 'sold' ELSE 'not_sold' END                    AS v_sale_status,     p.sale_status      AS e_sale_status,
         v.sold_price::VARCHAR                                                                 AS v_sale_price,      p.sale_price::VARCHAR AS e_sale_price,
         v.latest_final_bid::VARCHAR                                                           AS v_high_bid,        p.high_bid::VARCHAR AS e_high_bid,
         v.sold_day::VARCHAR                                                                   AS v_sale_date,       p.sale_date::VARCHAR AS e_sale_date,
         strftime(v.latest_end_day, '%Y-%m-%d')                                               AS v_auction_end_date, p.auction_end_date AS e_auction_end_date,
         v.sold_buyer                                                                          AS v_bat_buyer,       p.bat_buyer        AS e_bat_buyer,
         CASE WHEN v.sold_slug IS NOT NULL AND v.sold_slug = v.latest_slug THEN 'sold' ELSE v.latest_outcome END AS v_auction_outcome, p.auction_outcome AS e_auction_outcome,
         v.latest_reserve_status                                                               AS v_reserve_status,  p.reserve_status   AS e_reserve_status,
         -- secondary sale columns: cleared on an unsold vehicle, aligned to the price paid on a sold one, but only
         -- where a writer had put something (an empty column stays empty)
         p.winning_bid::VARCHAR AS e_winning_bid, p.bat_sold_price::VARCHAR AS e_bat_sold_price, p.sold_price::VARCHAR AS e_sold_price, p.bat_sale_date::VARCHAR AS e_bat_sale_date
  FROM pvrows p JOIN vtruth v ON v.vehicle_id = p.id
  WHERE p.merged_into IS NULL
    AND p.id <> '6442df03-9cac-43a8-b89e-e4fb4c08ee99'   -- Skylar's K10: owned by the k10-record investigation, never touched here
), f AS (
  SELECT *,
    CASE WHEN v_sale_status IS DISTINCT FROM e_sale_status THEN json_object('value', v_sale_status, 'expected', e_sale_status) END AS c_sale_status,
    CASE WHEN try_cast(v_sale_price AS DOUBLE) IS DISTINCT FROM try_cast(e_sale_price AS DOUBLE) THEN json_object('value', v_sale_price, 'expected', e_sale_price) END AS c_sale_price,
    CASE WHEN try_cast(v_high_bid AS DOUBLE) IS DISTINCT FROM try_cast(e_high_bid AS DOUBLE) THEN json_object('value', v_high_bid, 'expected', e_high_bid) END AS c_high_bid,
    CASE WHEN v_sale_date IS DISTINCT FROM e_sale_date THEN json_object('value', v_sale_date, 'expected', e_sale_date) END AS c_sale_date,
    CASE WHEN left(e_auction_end_date, 10) IS DISTINCT FROM v_auction_end_date THEN json_object('value', v_auction_end_date, 'expected', e_auction_end_date) END AS c_auction_end_date,
    -- buyer: asserted from a parsed sold page, or cleared when no lot of this vehicle sold
    CASE WHEN ((sold_slug IS NOT NULL AND sold_has_detail) OR sold_slug IS NULL) AND v_bat_buyer IS DISTINCT FROM e_bat_buyer
         THEN json_object('value', v_bat_buyer, 'expected', e_bat_buyer) END AS c_bat_buyer,
    CASE WHEN v_auction_outcome IS DISTINCT FROM e_auction_outcome THEN json_object('value', v_auction_outcome, 'expected', e_auction_outcome) END AS c_auction_outcome,
    CASE WHEN v_reserve_status IS DISTINCT FROM e_reserve_status THEN json_object('value', v_reserve_status, 'expected', e_reserve_status) END AS c_reserve_status,
    CASE WHEN e_winning_bid IS NOT NULL AND try_cast(e_winning_bid AS DOUBLE) IS DISTINCT FROM try_cast(v_sale_price AS DOUBLE) THEN json_object('value', v_sale_price, 'expected', e_winning_bid) END AS c_winning_bid,
    CASE WHEN e_bat_sold_price IS NOT NULL AND try_cast(e_bat_sold_price AS DOUBLE) IS DISTINCT FROM try_cast(v_sale_price AS DOUBLE) THEN json_object('value', v_sale_price, 'expected', e_bat_sold_price) END AS c_bat_sold_price,
    CASE WHEN e_sold_price IS NOT NULL AND try_cast(e_sold_price AS DOUBLE) IS DISTINCT FROM try_cast(v_sale_price AS DOUBLE) THEN json_object('value', v_sale_price, 'expected', e_sold_price) END AS c_sold_price,
    CASE WHEN e_bat_sale_date IS NOT NULL AND e_bat_sale_date IS DISTINCT FROM v_sale_date THEN json_object('value', v_sale_date, 'expected', e_bat_sale_date) END AS c_bat_sale_date
  FROM j
)
SELECT vehicle_id, latest_slug, sold_slug, n_lots,
       json_object(
         'vehicle_id', vehicle_id,
         'source', json_object(
            'type', 'bat',
            'ref', coalesce(sold_url, latest_url),
            'lots', lots,
            'latest_lot', latest_url,
            'method', 'BaT listings-filter catalog (sold_text, current_bid, timestamp_end) + lot page sale record; price: ' || coalesce(sold_price_method, 'no sale'),
            'observed_at', strftime(now(), '%Y-%m-%dT%H:%M:%SZ'),
            'latest_auction_end_at', strftime(latest_end_ts, '%Y-%m-%dT%H:%M:%SZ'),
            'detector', 'scripts/bat-archive.sql lot view via gen_corrections.sql (session cb179857)'),
         'corrections', json_object(
            'sale_status', c_sale_status, 'sale_price', c_sale_price, 'high_bid', c_high_bid, 'sale_date', c_sale_date,
            'auction_end_date', c_auction_end_date, 'bat_buyer', c_bat_buyer, 'auction_outcome', c_auction_outcome,
            'reserve_status', c_reserve_status, 'winning_bid', c_winning_bid, 'bat_sold_price', c_bat_sold_price,
            'sold_price', c_sold_price, 'bat_sale_date', c_bat_sale_date)
       ) AS row_json,
       (c_sale_status IS NOT NULL)::INT + (c_sale_price IS NOT NULL)::INT + (c_high_bid IS NOT NULL)::INT + (c_sale_date IS NOT NULL)::INT
         + (c_auction_end_date IS NOT NULL)::INT + (c_bat_buyer IS NOT NULL)::INT + (c_auction_outcome IS NOT NULL)::INT + (c_reserve_status IS NOT NULL)::INT
         + (c_winning_bid IS NOT NULL)::INT + (c_bat_sold_price IS NOT NULL)::INT + (c_sold_price IS NOT NULL)::INT + (c_bat_sale_date IS NOT NULL)::INT AS n_fields,
       c_sale_status IS NOT NULL AS f_sale_status, c_sale_price IS NOT NULL AS f_sale_price, c_high_bid IS NOT NULL AS f_high_bid,
       c_sale_date IS NOT NULL AS f_sale_date, c_auction_end_date IS NOT NULL AS f_auction_end_date, c_bat_buyer IS NOT NULL AS f_bat_buyer,
       c_auction_outcome IS NOT NULL AS f_auction_outcome, c_reserve_status IS NOT NULL AS f_reserve_status
FROM f
WHERE c_sale_status IS NOT NULL OR c_sale_price IS NOT NULL OR c_high_bid IS NOT NULL OR c_sale_date IS NOT NULL
   OR c_auction_end_date IS NOT NULL OR c_bat_buyer IS NOT NULL OR c_auction_outcome IS NOT NULL OR c_reserve_status IS NOT NULL
   OR c_winning_bid IS NOT NULL OR c_bat_sold_price IS NOT NULL OR c_sold_price IS NOT NULL OR c_bat_sale_date IS NOT NULL;
