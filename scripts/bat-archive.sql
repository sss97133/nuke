-- bat-archive.sql — the local BaT archive as queryable tables + the metric views the library defines.
--
-- Run from the repo root (re-run to refresh as the pulls grow):
--   npm run bat:archive        # = duckdb scripts/data/bat-archive.duckdb < scripts/bat-archive.sql
--
-- Inputs (gitignored, under scripts/data/):
--   bat-catalog/{y*,feed-*,cat-*}/p*.json   BaT listings-filter pages — prices, dates, sold/unsold (bat-keep-fresh.mjs;
--                                     y* = model-year slices, feed-* = the daily unfiltered feed, cat-* = category slices,
--                                     which are the only way to reach lots with no model year: parts, wheels, signs)
--   bat-lots/lots.jsonl               lot pages parsed by the production parsers (bat-lots-local.ts)
--   bat-lots/comments.jsonl           every comment, bid and sale record on those pages
--   bat-lots/taxonomy.jsonl           BaT Make/Model/Era/Category links, backfilled from saved html
--
-- Definitions come from the library, not from this file. Read the source before changing one:
--   serious bidder (max bid >= 70% of the lot's high), CBT = 4, Tests 2/3
--       docs/library/intellectual/theoreticals/auction-price-formation-theory.md
--   a person = an identity accumulating observations; bidding strategies; persona tiers; staleness
--       docs/library/intellectual/papers/user-simulation-methodology.md · scripts/bat-compute-profiles.mjs
--   trajectory categories (90d vs prior 90d)
--       docs/library/intellectual/theoreticals/signal-calculation.md §VII
--   cohort = BaT's own generation-scoped model page ("ford/mustang-1964-1966"), distributions not averages
--       docs/features/ask-nuke/THEORY.md
-- Prices, dates and sold status are BaT's (catalog). Page parsing supplies everything else.

SET TimeZone = 'UTC';

-- ── sales: one row per BaT lot, from BaT's own listings-filter data ─────────────────────────
CREATE OR REPLACE TABLE sales AS
WITH raw AS (
  SELECT fetched_at, unnest(items) AS it
  FROM read_json(['scripts/data/bat-catalog/y*/p*.json', 'scripts/data/bat-catalog/feed-*/p*.json',
                  'scripts/data/bat-catalog/cat-*/p*.json'],
                 format = 'auto', union_by_name = true, maximum_object_size = 67108864)
), d AS (
  SELECT DISTINCT ON (it.url) * FROM raw ORDER BY it.url, fetched_at DESC
)
SELECT regexp_extract(it.url, '/listing/([^/]+)', 1)       AS slug,
       it.url                                               AS url,
       it.id                                                AS bat_id,
       it.title::VARCHAR                                    AS title,
       try_cast(it.current_bid AS BIGINT)                   AS final_bid,
       it.sold_text LIKE 'Sold for%'                        AS sold,
       to_timestamp(coalesce(try_cast(it.sold_text_timestamp AS BIGINT),
                             try_cast(it.timestamp_end AS BIGINT))) AS end_ts,
       it.noreserve                                         AS no_reserve,
       it.premium                                           AS premium,
       it.country_code                                      AS country
FROM d;

-- ── lots: parsed lot pages + BaT taxonomy ───────────────────────────────────────────────────
CREATE OR REPLACE MACRO vin_checkdigit_ok(v) AS (
  length(v) = 17 AND regexp_matches(upper(v), '^[A-HJ-NPR-Z0-9]{17}$') AND
  list_sum(list_transform(range(17), lambda i:
    (CASE WHEN substr(upper(v), i + 1, 1) BETWEEN '0' AND '9' THEN substr(upper(v), i + 1, 1)::INT
          ELSE [1,2,3,4,5,6,7,8,0,1,2,3,4,5,0,7,0,9,2,3,4,5,6,7,8,9][ascii(substr(upper(v), i + 1, 1)) - 64] END)
    * [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2][i + 1])) % 11
  = CASE WHEN substr(upper(v), 9, 1) = 'X' THEN 10 ELSE try_cast(substr(upper(v), 9, 1) AS INT) END
);

CREATE OR REPLACE TABLE lots AS
WITH l AS (
  SELECT DISTINCT ON (slug) *
  FROM read_json('scripts/data/bat-lots/lots.jsonl', format = 'newline_delimited', maximum_object_size = 67108864,
    columns = {url: 'VARCHAR', slug: 'VARCHAR', title: 'VARCHAR', year: 'BIGINT', make: 'VARCHAR', model: 'VARCHAR',
               bat_make: 'VARCHAR', bat_model: 'VARCHAR', bat_model_path: 'VARCHAR', bat_era: 'VARCHAR',
               bat_origin: 'VARCHAR', bat_categories: 'VARCHAR[]', seller: 'VARCHAR', location: 'VARCHAR',
               location_state: 'VARCHAR', vin: 'VARCHAR', mileage: 'BIGINT', mileage_unit: 'VARCHAR',
               engine: 'VARCHAR', transmission: 'VARCHAR', drivetrain: 'VARCHAR', exterior_color: 'VARCHAR',
               interior_color: 'VARCHAR', no_reserve: 'BOOLEAN', description: 'VARCHAR', page_views: 'BIGINT',
               page_watchers: 'BIGINT', page_comment_count: 'BIGINT', n_images: 'BIGINT', parsed_at: 'TIMESTAMP'})
  ORDER BY slug, parsed_at DESC
), t AS (
  SELECT * FROM read_json('scripts/data/bat-lots/taxonomy.jsonl', format = 'newline_delimited',
    columns = {slug: 'VARCHAR', bat_make: 'VARCHAR', bat_model: 'VARCHAR', bat_model_path: 'VARCHAR',
               bat_era: 'VARCHAR', bat_origin: 'VARCHAR', bat_categories: 'VARCHAR[]'})
)
SELECT l.slug, l.title, l.year, l.make, l.model,
       coalesce(l.bat_make, t.bat_make)             AS bat_make,
       coalesce(l.bat_model, t.bat_model)           AS bat_model,
       coalesce(l.bat_model_path, t.bat_model_path) AS cohort,
       coalesce(l.bat_era, t.bat_era)               AS era,
       coalesce(l.bat_origin, t.bat_origin)         AS origin,
       coalesce(l.bat_categories, t.bat_categories) AS categories,
       CASE WHEN list_has_any(coalesce(l.bat_categories, t.bat_categories), ['Parts', 'Wheels']) THEN 'parts'
            WHEN list_has_any(coalesce(l.bat_categories, t.bat_categories), ['Motorcycles', 'Minibikes & Scooters']) THEN 'motorcycle'
            WHEN list_has_any(coalesce(l.bat_categories, t.bat_categories), ['Go-Karts', 'Boats', 'Aircraft', 'Trains',
                 'Tractors', 'All-Terrain Vehicles', 'Side-by-Sides']) THEN 'other'
            ELSE 'car' END                           AS kind,
       l.seller, l.location, l.location_state,
       upper(trim(l.vin))                            AS vin,
       vin_checkdigit_ok(trim(l.vin))                AS vin_checkdigit_ok,
       l.mileage, l.mileage_unit, l.engine, l.transmission, l.drivetrain, l.exterior_color, l.interior_color,
       l.no_reserve, l.page_views, l.page_watchers, l.page_comment_count, l.n_images, l.description, l.parsed_at
FROM l LEFT JOIN t USING (slug);

-- ── events: every comment, bid and sale record ──────────────────────────────────────────────
CREATE OR REPLACE TABLE events AS
SELECT DISTINCT ON (slug, comment_id) *
FROM (
  SELECT regexp_extract(url, '/listing/([^/]+)', 1) AS slug,
         comment_id, author, author_id, is_seller,
         CASE type WHEN 'comment' THEN 'comment'
                   WHEN 'bat-bid' THEN 'bid'
                   WHEN 'bat-bid-reserve' THEN CASE WHEN text LIKE 'Sold%' THEN 'sold' ELSE 'no_sale' END
                   WHEN 'bat-rnm-accepted' THEN 'sold_after'   -- reserve not met, seller accepted afterwards
                   WHEN 'bat-bid-canceled' THEN 'withdrawn'    -- BaT pulled the auction as unfair
                   ELSE type END AS kind,
         bid_amount,
         CASE WHEN type IN ('bat-bid-reserve', 'bat-rnm-accepted')
              THEN try_cast(replace(regexp_extract(text, '\$([0-9,]+)', 1), ',', '') AS BIGINT) END AS record_amount,
         posted_at::TIMESTAMPTZ AS posted_at,
         likes, author_likes, has_media,
         strpos(text, '?') > 0 AS has_question,
         length(text) AS chars,
         text
  FROM read_json('scripts/data/bat-lots/comments.jsonl', format = 'newline_delimited', maximum_object_size = 16777216,
    columns = {url: 'VARCHAR', comment_id: 'BIGINT', author: 'VARCHAR', author_id: 'BIGINT', is_seller: 'BOOLEAN',
               type: 'VARCHAR', bid_amount: 'BIGINT', posted_at: 'TIMESTAMP', likes: 'BIGINT',
               author_likes: 'BIGINT', has_media: 'BOOLEAN', text: 'VARCHAR'})
)
ORDER BY slug, comment_id;

-- ── bids: each bid with its distance to BaT's close ─────────────────────────────────────────
CREATE OR REPLACE VIEW bids AS
SELECT e.slug, e.author, e.bid_amount, e.posted_at, s.end_ts,
       epoch(s.end_ts) - epoch(e.posted_at) AS secs_to_close
FROM events e JOIN sales s USING (slug)
WHERE e.kind = 'bid' AND e.bid_amount > 0;

-- ── lot_stats: per-lot bidding + engagement (shape of mv_bid_vehicle_summary, plus CBT) ─────
CREATE OR REPLACE TABLE lot_stats AS
WITH per_bidder AS (
  SELECT slug, author, count(*) AS n, max(bid_amount) AS mx FROM bids GROUP BY ALL
), hi AS (
  SELECT slug, max(mx) AS high_bid FROM per_bidder GROUP BY ALL
), b AS (
  SELECT p.slug, sum(p.n) AS n_bids, count(*) AS unique_bidders,
         count(*) FILTER (WHERE p.mx >= 0.7 * hi.high_bid) AS serious_bidders,
         any_value(hi.high_bid) AS high_bid
  FROM per_bidder p JOIN hi USING (slug) GROUP BY ALL
), t AS (
  SELECT slug,
         arg_min(bid_amount, posted_at) AS opening_bid,
         min(posted_at) AS first_bid_at, max(posted_at) AS last_bid_at,
         count(*) FILTER (WHERE secs_to_close < 7200) AS bids_last_2h,
         count(*) FILTER (WHERE secs_to_close < 86400) AS bids_last_24h
  FROM bids GROUP BY ALL
), c AS (
  SELECT slug,
         count(*) FILTER (WHERE kind = 'comment') AS n_comments,
         count(DISTINCT author) FILTER (WHERE kind = 'comment' AND NOT is_seller) AS unique_commenters,
         count(*) FILTER (WHERE kind = 'comment' AND is_seller) AS seller_comments,
         count(*) FILTER (WHERE kind = 'comment' AND has_question) AS questions,
         sum(likes) FILTER (WHERE kind = 'comment') AS comment_likes,
         any_value(author) FILTER (WHERE kind IN ('sold', 'sold_after')) AS buyer,
         any_value(record_amount) FILTER (WHERE kind IN ('sold', 'sold_after')) AS sale_record_amount,
         bool_or(kind = 'sold_after') AS sold_after_reserve_not_met,
         bool_or(kind = 'withdrawn') AS withdrawn
  FROM events GROUP BY ALL
)
SELECT c.*, b.n_bids, b.unique_bidders, b.serious_bidders, b.high_bid,
       t.opening_bid, t.first_bid_at, t.last_bid_at, t.bids_last_2h, t.bids_last_24h,
       round(100.0 * (b.high_bid - t.opening_bid) / nullif(t.opening_bid, 0), 1) AS appreciation_pct
FROM c LEFT JOIN b USING (slug) LEFT JOIN t USING (slug);

-- ── lot: the joined per-lot record everything else reads ────────────────────────────────────
CREATE OR REPLACE VIEW lot AS
SELECT s.slug, s.url, s.title, s.sold, s.final_bid, s.end_ts, s.end_ts::DATE AS end_day, s.no_reserve,
       l.cohort, l.bat_model, l.bat_make, l.kind, l.year, l.seller, l.location_state, l.vin, l.vin_checkdigit_ok,
       l.mileage, l.page_views, l.page_watchers, l.page_comment_count, l.n_images,
       ls.* EXCLUDE (slug),
       ls.slug IS NOT NULL AS has_detail
FROM sales s LEFT JOIN lots l USING (slug) LEFT JOIN lot_stats ls USING (slug);

-- ── v_integrity: invariants between BaT's catalog and the parsed pages (all should be ~0) ────
CREATE OR REPLACE VIEW v_integrity AS
SELECT count(*) FILTER (WHERE has_detail)                                                 AS lots_with_detail,
       count(*) FILTER (WHERE has_detail AND sold AND buyer IS NULL)                      AS sold_no_sale_record,
       count(*) FILTER (WHERE has_detail AND NOT sold AND buyer IS NOT NULL
                          AND NOT sold_after_reserve_not_met)                             AS unsold_with_sale_record,
       count(*) FILTER (WHERE has_detail AND sold AND sale_record_amount <> final_bid)    AS sale_record_price_mismatch,
       count(*) FILTER (WHERE has_detail AND high_bid IS NOT NULL AND high_bid <> final_bid
                          AND NOT sold_after_reserve_not_met)                             AS high_bid_mismatch,
       count(*) FILTER (WHERE has_detail AND n_bids IS NULL AND final_bid > 0)            AS priced_but_no_bids_parsed,
       count(*) FILTER (WHERE has_detail AND page_comment_count > n_comments + 5)         AS comments_short
FROM lot;

-- ── v_daily_pulse: the market's day, every day on record ────────────────────────────────────
CREATE OR REPLACE VIEW v_daily_pulse AS
SELECT end_day AS day,
       count(*)                                              AS closed,
       count(*) FILTER (WHERE sold)                          AS sold,
       round(count(*) FILTER (WHERE sold) / count(*), 3)     AS sell_through,
       sum(final_bid) FILTER (WHERE sold)                    AS gross_usd,
       quantile_disc(final_bid, [0.1, 0.25, 0.5, 0.75, 0.9]) FILTER (WHERE sold) AS price_p10_p25_p50_p75_p90,
       round(count(*) FILTER (WHERE has_detail) / count(*), 3) AS detail_coverage,
       median(n_comments)                                    AS med_comments,
       median(n_bids)                                        AS med_bids,
       median(unique_bidders)                                AS med_bidders,
       median(serious_bidders)                               AS med_serious_bidders,
       round(avg((serious_bidders >= 4)::INT) FILTER (WHERE sold), 3)  AS sold_share_cbt_met,      -- >= 4 serious: priced at market
       round(avg((serious_bidders = 2)::INT)  FILTER (WHERE sold), 3)  AS sold_share_duopoly,      -- 2 serious: widest overpay risk
       round(avg((serious_bidders <= 1)::INT) FILTER (WHERE sold), 3)  AS sold_share_uncontested,  -- 1 serious: the deal zone
       median(page_watchers)                                 AS med_watchers,
       median(page_views)                                    AS med_views
FROM lot
GROUP BY ALL;

-- ── v_cohort_month: the pulse one level down — BaT model page × month ───────────────────────
CREATE OR REPLACE VIEW v_cohort_month AS
SELECT cohort, any_value(bat_model) AS bat_model, date_trunc('month', end_ts)::DATE AS month,
       count(*) AS closed, count(*) FILTER (WHERE sold) AS sold,
       round(count(*) FILTER (WHERE sold) / count(*), 3) AS sell_through,
       quantile_disc(final_bid, [0.25, 0.5, 0.75]) FILTER (WHERE sold) AS price_p25_p50_p75,
       median(serious_bidders) AS med_serious_bidders, median(n_comments) AS med_comments,
       median(page_watchers) AS med_watchers
FROM lot WHERE cohort IS NOT NULL
GROUP BY ALL;

-- ── users: every participant, mapped from what they did (shape of bat_user_profiles, plus) ───
CREATE OR REPLACE TABLE users AS
WITH snap AS (SELECT max(end_ts) AS t FROM sales),
per_lot AS (
  SELECT b.author, b.slug, count(*) AS n, max(b.bid_amount) AS mx
  FROM bids b GROUP BY ALL
), bid_stats AS (
  SELECT b.author,
         count(*) AS total_bids,
         count(*) FILTER (WHERE b.secs_to_close < 7200)  AS bids_last_2h,
         count(*) FILTER (WHERE b.secs_to_close < 86400) AS bids_last_24h,
         avg(b.bid_amount) AS avg_bid_amount, max(b.bid_amount) AS max_bid_amount, min(b.bid_amount) AS min_bid_amount
  FROM bids b GROUP BY ALL
), entry AS (
  SELECT p.author,
         count(*) AS auctions_bid,
         count(*) FILTER (WHERE p.n = 1) AS one_bid_auctions,
         count(*) FILTER (WHERE p.mx >= 0.7 * ls.high_bid) AS serious_entries,
         quantile_disc(p.mx, [0.25, 0.5, 0.75]) AS price_band_p25_p50_p75
  FROM per_lot p JOIN lot_stats ls USING (slug) GROUP BY ALL
), talk AS (
  SELECT author,
         count(*) FILTER (WHERE kind = 'comment') AS total_comments,
         count(*) FILTER (WHERE kind = 'comment' AND has_question) AS total_questions,
         count(*) FILTER (WHERE kind = 'comment' AND is_seller) AS total_seller_replies,
         avg(likes) FILTER (WHERE kind = 'comment') AS avg_likes_received,
         max(author_likes) AS bat_author_likes,
         min(posted_at) AS first_seen, max(posted_at) AS last_seen,
         count(*) FILTER (WHERE posted_at > (SELECT t FROM snap) - INTERVAL 90 DAY) AS acts_90d,
         count(*) FILTER (WHERE posted_at <= (SELECT t FROM snap) - INTERVAL 90 DAY
                            AND posted_at > (SELECT t FROM snap) - INTERVAL 180 DAY) AS acts_prev_90d
  FROM events WHERE author IS NOT NULL AND author <> 'Anonymous' AND kind IN ('comment', 'bid')
  GROUP BY ALL
), wins AS (
  SELECT buyer AS author, count(*) AS total_wins, sum(sale_record_amount) AS bought_usd
  FROM lot_stats WHERE buyer IS NOT NULL GROUP BY ALL
), selling AS (
  SELECT seller AS author, count(*) AS lots_listed, count(*) FILTER (WHERE sold) AS lots_sold,
         sum(final_bid) FILTER (WHERE sold) AS sold_usd
  FROM lot WHERE seller IS NOT NULL GROUP BY ALL
), makes AS (
  SELECT author, list(bat_make ORDER BY n DESC)[1:5] AS preferred_makes
  FROM (SELECT e.author, l.bat_make, count(*) AS n
        FROM events e JOIN lots l USING (slug)
        WHERE e.kind IN ('comment', 'bid') AND l.bat_make IS NOT NULL GROUP BY ALL)
  GROUP BY ALL
)
SELECT t.author AS username,
       t.total_comments, coalesce(bs.total_bids, 0) AS total_bids, coalesce(w.total_wins, 0) AS total_wins,
       t.total_questions, t.total_seller_replies,
       coalesce(e.auctions_bid, 0) AS auctions_bid, coalesce(e.serious_entries, 0) AS serious_entries,
       round(e.serious_entries / nullif(e.auctions_bid, 0), 3) AS serious_rate,
       round(coalesce(w.total_wins, 0) / nullif(e.auctions_bid, 0), 3) AS win_rate,
       bs.avg_bid_amount, bs.max_bid_amount, bs.min_bid_amount, e.price_band_p25_p50_p75,
       w.bought_usd, coalesce(s.lots_listed, 0) AS lots_listed, coalesce(s.lots_sold, 0) AS lots_sold, s.sold_usd,
       -- same rules as scripts/bat-compute-profiles.mjs
       CASE WHEN coalesce(bs.total_bids, 0) = 0 THEN 'observer'
            WHEN e.one_bid_auctions / e.auctions_bid > 0.7 THEN 'one_and_done'
            WHEN bs.bids_last_2h / bs.total_bids > 0.5 THEN 'sniper'
            WHEN bs.bids_last_2h / bs.total_bids < 0.15 AND bs.bids_last_24h / bs.total_bids < 0.4 THEN 'early_aggressive'
            ELSE 'steady' END AS bidding_strategy,
       m.preferred_makes,
       t.avg_likes_received, t.bat_author_likes,
       t.first_seen, t.last_seen,
       -- user-simulation-methodology §VII.C
       CASE WHEN t.last_seen > (SELECT t FROM snap) - INTERVAL 3 MONTH THEN 'fresh'
            WHEN t.last_seen > (SELECT t FROM snap) - INTERVAL 12 MONTH THEN 'aging'
            WHEN t.last_seen > (SELECT t FROM snap) - INTERVAL 3 YEAR THEN 'stale'
            ELSE 'archaeological' END AS staleness,
       -- user-simulation-methodology §I.B: 100+ comments = profilable, 1,000+ = rich
       CASE WHEN t.total_comments >= 1000 THEN 'rich' WHEN t.total_comments >= 100 THEN 'profilable' ELSE 'thin' END AS persona_tier,
       -- signal-calculation §VII.2, on activity counts
       t.acts_90d, t.acts_prev_90d,
       CASE WHEN t.acts_90d = 0 AND t.acts_prev_90d = 0 THEN 'dormant'
            WHEN t.acts_prev_90d = 0 THEN 'new_or_returning'
            WHEN (t.acts_90d - t.acts_prev_90d) / t.acts_prev_90d > 0.5 THEN 'accelerating'
            WHEN (t.acts_90d - t.acts_prev_90d) / t.acts_prev_90d > 0.15 THEN 'rising'
            WHEN (t.acts_90d - t.acts_prev_90d) / t.acts_prev_90d >= -0.15 THEN 'stable'
            WHEN (t.acts_90d - t.acts_prev_90d) / t.acts_prev_90d >= -0.5 THEN 'declining'
            ELSE 'fading' END AS trajectory
FROM talk t
LEFT JOIN bid_stats bs USING (author) LEFT JOIN entry e USING (author) LEFT JOIN wins w USING (author)
LEFT JOIN selling s USING (author) LEFT JOIN makes m USING (author);

-- ── v_resales: the same car sold on BaT more than once — flips and the turn ─────────────────
CREATE OR REPLACE VIEW v_resales AS
WITH s AS (
  SELECT slug, vin, bat_make, cohort, end_ts, final_bid, seller, buyer
  FROM lot
  WHERE sold AND final_bid > 0 AND kind = 'car' AND vin IS NOT NULL
    AND (length(vin) = 17 OR (length(vin) >= 8 AND regexp_matches(vin, '[0-9]{4}')))
), seq AS (
  SELECT *, lag(slug) OVER w AS prev_slug, lag(end_ts) OVER w AS prev_end, lag(final_bid) OVER w AS prev_price,
         lag(buyer) OVER w AS prev_buyer, lag(seller) OVER w AS prev_seller
  FROM s WINDOW w AS (PARTITION BY vin, bat_make ORDER BY end_ts)
)
SELECT vin, bat_make, cohort, prev_slug, slug, prev_end::DATE AS bought_day, end_ts::DATE AS resold_day,
       date_diff('day', prev_end, end_ts) AS turn_days,
       prev_price, final_bid AS resale_price,
       round(100.0 * (final_bid - prev_price) / prev_price, 1) AS change_pct,
       prev_buyer, seller AS resold_by,
       lower(prev_buyer) = lower(seller) AS flip          -- the buyer of the first sale listed it again
FROM seq WHERE prev_slug IS NOT NULL;

-- ── Harness: the library's own tests, re-run on the archive ─────────────────────────────────
-- Test 3 (revised): serious bidders vs price deviation from cohort median (cohorts with 20+ sales).
CREATE OR REPLACE VIEW v_test_cbt AS
WITH sold AS (
  SELECT cohort, final_bid AS price, serious_bidders, n_comments
  FROM lot WHERE sold AND final_bid > 0 AND kind = 'car' AND cohort IS NOT NULL AND serious_bidders IS NOT NULL
), cm AS (
  SELECT cohort, median(price) AS med FROM sold GROUP BY ALL HAVING count(*) >= 20
), d AS (
  SELECT sold.*, (price - cm.med) / cm.med AS dev FROM sold JOIN cm USING (cohort)
)
SELECT CASE WHEN serious_bidders >= 11 THEN '11+' WHEN serious_bidders >= 8 THEN '8-10'
            WHEN serious_bidders >= 6 THEN '6-7' ELSE serious_bidders::VARCHAR END AS serious_bidders,
       count(*) AS n, round(100 * avg(dev), 1) AS avg_dev_pct, round(100 * median(dev), 1) AS median_dev_pct,
       round(stddev(dev), 3) AS stddev
FROM d GROUP BY ALL ORDER BY min(d.serious_bidders);

-- Test 2: comment count vs price deviation from cohort median. Pass: 100+ comments deviate > +20%.
CREATE OR REPLACE VIEW v_test_comments AS
WITH sold AS (
  SELECT cohort, final_bid AS price, n_comments
  FROM lot WHERE sold AND final_bid > 0 AND kind = 'car' AND cohort IS NOT NULL AND n_comments IS NOT NULL
), cm AS (
  SELECT cohort, median(price) AS med FROM sold GROUP BY ALL HAVING count(*) >= 20
), d AS (
  SELECT sold.*, (price - cm.med) / cm.med AS dev FROM sold JOIN cm USING (cohort)
)
SELECT CASE WHEN n_comments <= 20 THEN '0-20' WHEN n_comments <= 50 THEN '21-50' WHEN n_comments <= 100 THEN '51-100'
            WHEN n_comments <= 200 THEN '101-200' ELSE '200+' END AS comments,
       count(*) AS n, round(100 * avg(dev), 1) AS avg_dev_pct, round(100 * median(dev), 1) AS median_dev_pct,
       round(stddev(dev), 3) AS stddev
FROM d GROUP BY ALL ORDER BY min(d.n_comments);

-- ── The comp band (CompBase) ────────────────────────────────────────────────────────────────
-- docs/library/intellectual/theoreticals/valuation-methodology.md §2.2–2.5, scored per
-- docs/features/ask-nuke/THEORY.md (interval coverage + width, backtest register kept separate).
-- Identity: same BaT model page + same 2WD/4WD. Every comp is a real sale carrying a weight:
-- recency (3-year half-life) × similarity on features known BEFORE the auction (model year, mileage
-- bracket, transmission, build wording, reserve, photo count, description length).
-- Each similarity factor was kept because the backtest improved with it (2026-09-26, sales since
-- 2025-09 priced from earlier sales: median miss 29.0% → 25.5%, 80% band catches 74.7% → 76.0%,
-- width 1.11 → 1.01). Serious-bidder reliability weighting was tested and dropped (no gain).
-- Re-tune only against v_band_calibration.
CREATE OR REPLACE MACRO mbracket(m) AS CASE WHEN m < 25000 THEN 0 WHEN m < 50000 THEN 1 WHEN m < 100000 THEN 2 ELSE 3 END;

CREATE OR REPLACE TABLE comp_base AS
SELECT l.slug, l.cohort, s.end_ts,
       coalesce(ls.sale_record_amount, s.final_bid)::DOUBLE AS price,   -- price paid: the page's sale record beats the catalog
       l.year,
       CASE WHEN regexp_matches(lower(l.title), '4x4|4×4|\b4wd\b|\bawd\b|four-wheel|\bk[0-9]{1,4}\b|\bv[0-9]{2}\b')
                 OR l.drivetrain IN ('4WD', 'AWD') THEN '4wd'
            WHEN regexp_matches(lower(l.title), '\bc[0-9]{2,4}\b|\br[0-9]{2}\b|\b2wd\b|\brwd\b')
                 OR l.drivetrain IN ('RWD', 'FWD') THEN '2wd' END AS drive,
       CASE WHEN l.transmission ILIKE '%manual%' THEN 'manual' WHEN l.transmission ILIKE '%automatic%' THEN 'auto' END AS trans,
       CASE WHEN l.mileage_unit = 'kilometers' THEN l.mileage * 0.621371 WHEN l.mileage_unit = 'miles' THEN l.mileage END AS miles,
       CASE WHEN regexp_matches(lower(l.description), '\b(project|non-running|not running|does not run|parts car)\b') THEN 'project'
            WHEN regexp_matches(lower(l.description), '\b(restomod|resto-mod|ls[1-9]|swap|swapped|lifted|lift kit|custom)\b') THEN 'modified'
            WHEN regexp_matches(lower(l.description), '\b(restored|restoration|frame-off|rotisserie)\b') THEN 'restored'
            WHEN regexp_matches(lower(l.description), '\b(original paint|unrestored|survivor|factory paint)\b') THEN 'original'
            ELSE 'none' END AS build,
       s.no_reserve,
       greatest(l.n_images, 1) AS photos,
       greatest(length(l.description), 100) AS desc_len,
       ls.serious_bidders
FROM lots l JOIN sales s USING (slug) LEFT JOIN lot_stats ls USING (slug)
WHERE s.sold AND l.kind = 'car' AND l.cohort IS NOT NULL AND coalesce(ls.sale_record_amount, s.final_bid) > 0;

CREATE OR REPLACE MACRO comp_weight(age_s, t_drive, c_drive, t_year, c_year, t_miles, c_miles, t_trans, c_trans,
                                    t_build, c_build, t_res, c_res, t_photos, c_photos, t_desc, c_desc) AS
  exp(-ln(2) * age_s / (3 * 365.25 * 86400))
  * (CASE WHEN t_drive IS NULL OR c_drive IS NULL THEN 0.5 ELSE 1.0 END)
  * (CASE WHEN t_year IS NULL OR c_year IS NULL THEN 0.7 WHEN t_year = c_year THEN 1.0 WHEN abs(t_year - c_year) = 1 THEN 0.8
          WHEN abs(t_year - c_year) = 2 THEN 0.5 WHEN abs(t_year - c_year) <= 5 THEN 0.2 ELSE 0.1 END)
  * (CASE WHEN t_miles IS NULL OR c_miles IS NULL THEN 0.7
          ELSE CASE abs(mbracket(t_miles) - mbracket(c_miles)) WHEN 0 THEN 1.0 WHEN 1 THEN 0.5 ELSE 0.25 END END)
  * (CASE WHEN t_trans IS NULL OR c_trans IS NULL THEN 0.7 WHEN t_trans = c_trans THEN 1.0 ELSE 0.4 END)
  * (CASE WHEN t_build IS NULL OR c_build IS NULL THEN 1.0 WHEN t_build = c_build THEN 1.0 ELSE 0.4 END)
  * (CASE WHEN t_res IS NULL OR c_res IS NULL THEN 0.7 WHEN t_res = c_res THEN 1.0 ELSE 0.5 END)
  * (CASE WHEN t_photos IS NULL THEN 1.0 ELSE exp(-abs(ln(t_photos / c_photos))) END)
  * (CASE WHEN t_desc IS NULL THEN 1.0 ELSE exp(-abs(ln(t_desc / c_desc))) END);

-- The comps for one vehicle as of a date (NULL = unknown/not decided; that factor drops out).
-- Summarize with weighted quantiles, e.g. v_band_calibration's query shape; block below 5 effective comps.
CREATE OR REPLACE MACRO band_comps(p_cohort, p_as_of, p_drive, p_year, p_miles, p_trans, p_build, p_no_reserve, p_photos, p_desc_len) AS TABLE
SELECT c.*, comp_weight(epoch(p_as_of) - epoch(c.end_ts), p_drive, c.drive, p_year, c.year, p_miles, c.miles, p_trans, c.trans,
                        p_build, c.build, p_no_reserve, c.no_reserve, p_photos, c.photos, p_desc_len, c.desc_len) AS w
FROM comp_base c
WHERE c.cohort = p_cohort AND c.end_ts < p_as_of AND c.end_ts >= p_as_of - INTERVAL 10 YEAR
  AND (p_drive IS NULL OR c.drive IS NULL OR c.drive = p_drive);

-- Backtest register: every sold car lot since 2024-09 priced only from sales that closed before it.
CREATE OR REPLACE TABLE band_backtest AS
WITH pairs AS (
  SELECT t.slug, t.cohort, t.end_ts, t.price AS actual, c.price,
         comp_weight(epoch(t.end_ts) - epoch(c.end_ts), t.drive, c.drive, t.year, c.year, t.miles, c.miles, t.trans, c.trans,
                     t.build, c.build, t.no_reserve, c.no_reserve, t.photos, c.photos, t.desc_len, c.desc_len) AS w
  FROM comp_base t
  JOIN comp_base c ON c.cohort = t.cohort AND c.end_ts < t.end_ts AND c.end_ts >= t.end_ts - INTERVAL 10 YEAR
                   AND (t.drive IS NULL OR c.drive IS NULL OR t.drive = c.drive)
  WHERE t.end_ts >= TIMESTAMPTZ '2024-09-01'
), cum AS (
  SELECT *, sum(w) OVER (PARTITION BY slug ORDER BY price ROWS UNBOUNDED PRECEDING) / sum(w) OVER (PARTITION BY slug) AS cf
  FROM pairs WHERE w > 0
)
SELECT slug, any_value(cohort) AS cohort, any_value(end_ts) AS end_ts, any_value(actual) AS actual,
       count(*) AS n_comps, power(sum(w), 2) / sum(w * w) AS n_eff,
       min(price) FILTER (WHERE cf >= 0.10) AS p10, min(price) FILTER (WHERE cf >= 0.25) AS p25,
       min(price) FILTER (WHERE cf >= 0.50) AS p50, min(price) FILTER (WHERE cf >= 0.75) AS p75,
       min(price) FILTER (WHERE cf >= 0.90) AS p90
FROM cum GROUP BY slug;

-- How good the band is, in the terms THEORY.md requires: coverage + width, never a point error alone.
-- Targets: p10–p90 should catch 80%, p25–p75 50%. "blocked" = under 5 effective comps → "not priced yet".
CREATE OR REPLACE VIEW v_band_calibration AS
WITH b AS (
  SELECT *, n_eff >= 5 AS priced,
         CASE WHEN p50 < 25000 THEN 'a <$25k' WHEN p50 < 50000 THEN 'b $25-50k' WHEN p50 < 100000 THEN 'c $50-100k' ELSE 'd $100k+' END AS tier,
         CASE WHEN n_eff < 5 THEN 'blocked' WHEN n_eff < 15 THEN 'a 5-15' WHEN n_eff < 50 THEN 'b 15-50' ELSE 'c 50+' END AS depth
  FROM band_backtest
), s AS (
  SELECT 'all' AS cut, 'all' AS level, * FROM b
  UNION ALL SELECT 'price tier', tier, * FROM b
  UNION ALL SELECT 'comp depth', depth, * FROM b
)
SELECT cut, level, count(*) AS sales, round(avg(priced::INT), 3) AS priced_share,
       round(avg((actual BETWEEN p10 AND p90)::INT) FILTER (WHERE priced), 3) AS in_p10_p90,
       round(avg((actual BETWEEN p25 AND p75)::INT) FILTER (WHERE priced), 3) AS in_p25_p75,
       round(median((p90 - p10) / p50) FILTER (WHERE priced), 2) AS width_80,
       round(100 * median(abs(p50 - actual) / actual) FILTER (WHERE priced), 1) AS median_miss_pct
FROM s GROUP BY ALL ORDER BY cut, level;
