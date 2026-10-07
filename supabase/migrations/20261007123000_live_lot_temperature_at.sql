-- Prediction lane, 2026-10-07 (case ledger 13.7, step 1 of the CLI auction coach; stack A, the auction as an order book):
-- live_lot_temperature_at, the reader that takes a lot's LIVE state (the bid and bidders the lot page shows, the time of the
-- read, the clock the page shows), grades it against comparables the same time before THEIR close, and returns an 80% band for
-- the hammer. live_lot_temperature(uuid) reads a stored vehicle's stored state, which can be hours old.
--
-- WHAT IT REUSES (read 2026-10-07, prod). live_lot_temperature: the cohort (exact make and model text), the comparables' state at
-- the same time to close from auction_comments.posted_at, the position counts. hammer_predictions model 31: returned as `prior`,
-- as it stood at p_at; it does not use the live bid. market_pulse_live(): its curve is the median of the same hammer / bid ratio,
-- hard-coded, with no spread and in-sample for any replay before 2026-09-26; the reader takes the spread from the cohort's own
-- lots. auction_events: outcome, hammer, close. vehicle_observations (bat_public_live_v1) and monitored_auctions.stream_state:
-- which lots have a recorded clock.
--
-- WHAT IT FOUND, and what each finding changes.
--   1. auction_events.auction_end_date is the FINAL close. BaT's soft close moves the close to bid time + 120 s, so of 360 sold
--      lots the collector followed on 2026-10-04..06, 314 (87.2%) were extended (scheduled to final close: median 7.0 min, p90
--      16.2, max 35.6; bids inside the last 120 s: median 10, p90 22, max 77). A replay at 120 s before the stored close sees
--      the hammer: the bid already equals it on 311 of 311 lots. T-2 needs the SCHEDULED close, the one before any extension.
--   2. The scheduled close is recorded from 2026-10-04: the live frames carry previous_scheduled_end and the collector followed all
--      486 lots that ended 10-04..06 (63, 218, 205 a day). Older lots keep no clock. For a lot with bid rows, the close its
--      hours_until_close values count to gives it back (355 of 369 right against the frames, 96.2%): rows written by a later
--      read count to the final close and are left out, and at least 3 rows must agree.
--   3. From the scheduled T-2 the hammer is a median 18% over the bid (p10 0%, p80 39%, p90 57%; 12.8% of lots end at the bid).
--      The final close is a fair clock for comparables from 1 h out (median hammer/bid at 1 h: 1.396 against the scheduled close,
--      1.400 against the final) and not under 15 min (1.228 against 1.305; at 2 min 1.000 against 1.180). So the hours regime
--      reads comparables against their final close and the minutes regime reads lots with a recorded clock, in the lot's own state.
--   4. bat_bids is not the bid log: 0 rows for the 486 lots of 10-04..06, 14 of 142 sold lots of 09-15. auction_comments (bid rows,
--      posted_at to the second) is keyed to the lot for 98.6% (2025-10), 97.5% (2025-11) and 89.4% (2025-12) of sold lots.
--   5. The hammer is never below the standing bid and 12.8% of lots end at it, so an equal-tailed 10/90 interval wastes its lower
--      half: held 91.0% at an 80% claim on the exact clocks. The band runs from the bid to the k-th smallest ratio.
--   6. model 31 is not scored: score_closed_predictions joins external_listings, BaT outcomes are in auction_events, 2,314
--      predictions, 0 scored, and prediction_accuracy has no row for it. The replay reads outcomes from auction_events.
--   7. The late-bid share of the price drifts up year on year (Mercedes-Benz SL500, median hammer/bid 24 h before the close: 1.51
--      in 2019, 1.79 in 2022, 1.86 in 2026), so a cohort of old lots under-covers. Comparables older than 365 days are left out:
--      on 2025-10..2026-03 (483 lots read at 24 h) no window held 76.6% with a band for 364, 365 days 79.4% with a band for 311,
--      180 days 82.6% with a band for 265. 365 days was kept.
--
-- THE BAND. Comparables are BaT lots that sold and closed between 365 days and 1 h before p_at (hours regime), whose bid rows
-- reproduce the hammer; ratio = hammer / the max bid posted the same time before their close. Band = from the bid to
-- bid * r(k), r(k) the k-th smallest of n ratios, k = ceil(0.8 (n + 1)): at least 80% coverage when the lot is exchangeable
-- with its comparables (an order statistic, nothing fitted, n >= 9). Hours regime (at least 1 h left): the exact make and model text, else the model family
-- (vehicles.normalized_model), the 150 newest sold lots, read through the lots newest first when the cohort has over 6,000 vehicles
-- (then the denominator is a floor); position = the bid and bidders against the same lots. Minutes regime: sold lots the collector
-- followed (300 newest), in the lot's own state, i extensions in: i = 0, the same time before the scheduled close with no bid yet
-- inside its last 120 s; i >= 1, the same time after the i-th bid inside the last 120 s with no later bid; the lot's price tier
-- (bid under 25,000, 50,000, 100,000, as market_pulse_live) when it holds 30 lots, else every tier. p_extensions, when the page
-- shows it, replaces the count read from the lot's own rows. No band, with the reason, when fewer than 9 comparables remain.
--
-- REPLAY (read-only, scripts/market/replay-live-lot-reader.sql; the numbers are in the PR). Acceptance, 80% +/- 5%:
--   T-2 min before the scheduled close, 360 sold followed lots with a bid at T-2 and a log that reproduces the hammer: band for 311
--   (the 49 earliest had fewer than 9 lots with a clock), held 257 = 82.6% (95% CI 78.0-86.4), by day 81.7% and 83.7%, every miss
--   above. The stored model-31 band, same lots with a row (271): 84.5% at 1.34 times the bid wide; this band 0.44 times.
--   The one-sided shape was chosen after seeing the 91.0% of finding 5 on these lots, so they are not out-of-sample for it: the
--   hold-out is QUERY 1 of the replay script on lots that close after this change (closing from 2026-10-07 07:00Z).
--   Hours regime, 1,200 BaT sold lots drawn by md5(id), 100 a month 2025-10..2026-09, read 24 h, 6 h and 1 h before the final
--   close (1,057, 1,058, 1,058 have a bid log that reproduces the hammer; a band for 685, 684, 684, the rest have no cohort of 9
--   sold lots in the last 365 days at either level): held 79.3% (543 of 685), 80.8% (553 of 684), 78.4% (536 of 684). At 24 h by half: 79.4% on
--   2025-10..2026-03, where the 365-day window was chosen, and 79.1% on 2026-04..09, not looked at until it was fixed.
--   By price tier the hold is uneven (bid under 25,000: 72%, 74%, 72%; over: 84% to 97%).
--   Inside the extension chain (i = 1, 2, 3, 5, 8 at 30 s after the bid): 561 states of 256 lots, 83.1% pooled, 73.8% to 93.6% by i.
-- COST (EXPLAIN ANALYZE of this body on prod, 2026-10-07; execution only, add about 25 ms of planning; first call / warm):
--   minutes regime 2.6 s / 65 to 77 ms (no extension, and 2 extensions in); hours regime: SL500 exact text (1,931 vehicles)
--   2.8 s / 62 ms, 911 Turbo 0.8 s / 24 ms, 356 model family 3.5 s / 76 ms, Corvette family (37,000 vehicles, read through its
--   newest lots) 4.8 s / 143 ms, Chevrolet Corvette exact text (11,870 vehicles) 7.3 s / 263 ms. The function allows 15 s.
--
-- SCHEMA_LAW: no table, column or index; one function, STABLE, SECURITY INVOKER, no custom GUC in its header. EXECUTE for
-- service_role only (REVOKE from PUBLIC, anon, authenticated; the api-v1 route is granted by its own change).
-- Contract: supabase/sql/test_live_lot_reader.sql (PostgreSQL 17, CI job metric-fold-health-contract). Applied by CI, never by hand.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_lot_temperature_at(
  p_auction_event_id uuid,
  p_bid numeric,
  p_bidders integer,
  p_at timestamptz,
  p_ends_at timestamptz DEFAULT NULL,
  p_extensions integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '15s'
SET lock_timeout = '2s'
AS $fn$
  WITH cfg AS (
    SELECT 9 AS min_n,                        -- fewest comparables for which an 80% order-statistic interval exists
           150 AS cohort_cap,                 -- most recent sold lots read from one cohort
           300 AS pool_cap,                   -- most recent clocked lots read for the minutes regime
           3600 AS hours_from_s,              -- from this many seconds left, a lot's final close is a fair clock for comparables
           120 AS window_s,                   -- BaT soft close: a bid in the last 120 s moves the close to bid time + 120 s
           3 AS min_clock_votes,              -- bid rows that must agree on a lot's scheduled close before it is used
           30 AS min_tier_n,                  -- lots a price tier needs before it stands alone
           interval '1 hour' AS settle,       -- a comparable counts only when it closed this long before p_at
           365 AS cohort_days                 -- and no longer than this many days before it: the late-bid share of the price drifts up year on year
  ),
  lot AS (
    SELECT e.id AS event_id, e.vehicle_id, e.outcome,
           v.make, v.model, v.year, lower(v.normalized_model) AS family,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug,
           COALESCE(p_ends_at, e.auction_end_date) AS ends_at,
           CASE WHEN p_ends_at IS NOT NULL THEN 'argument' ELSE 'auction_events.auction_end_date' END AS ends_at_source
    FROM auction_events e
    JOIN vehicles v ON v.id = e.vehicle_id
    WHERE e.id = p_auction_event_id
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
  ),
  st AS (    -- the lot, its clock at p_at, and which comparables clock applies
    SELECT l.*,
           extract(epoch FROM (l.ends_at - p_at)) AS secs,
           CASE WHEN p_at IS NULL THEN 'no_time'
                WHEN l.ends_at IS NULL THEN 'no_close'
                WHEN l.ends_at <= p_at THEN 'ended'
                WHEN p_bid IS NULL OR p_bid <= 0 THEN 'no_bid'
                WHEN extract(epoch FROM (l.ends_at - p_at)) >= (SELECT hours_from_s FROM cfg) THEN 'hours'
                ELSE 'minutes' END AS regime
    FROM lot l
  ),
  own_rows AS (   -- the lot's own bid rows posted at or before p_at (event clock); nothing later is read
    SELECT a.posted_at, a.bid_amount, a.author_username,
           date_trunc('second', a.posted_at + a.hours_until_close * interval '1 hour') AS implied_end
    FROM auction_comments a
    WHERE a.auction_event_id = (SELECT event_id FROM st)
      AND a.comment_type = 'bid' AND a.bid_amount > 0
      AND a.posted_at IS NOT NULL AND a.posted_at <= p_at
  ),
  own AS (
    SELECT count(*) AS n, max(bid_amount) AS bid, count(DISTINCT author_username) AS bidders,
           min(posted_at) AS first_at, max(posted_at) AS last_at,
           count(*) FILTER (WHERE posted_at > p_at - interval '15 minutes') AS n_15,
           mode() WITHIN GROUP (ORDER BY implied_end) AS sched_end
    FROM own_rows
  ),
  own_end AS (   -- the scheduled close the lot's own rows agree on, and how many rows say so
    SELECT o.sched_end, (SELECT count(*) FROM own_rows r WHERE r.implied_end = o.sched_end) AS votes
    FROM own o
  ),
  ext AS (       -- soft-close extensions seen so far: the caller's count, else 0 until the last 120 s, else read from the rows
    SELECT CASE
             WHEN p_extensions IS NOT NULL THEN p_extensions
             WHEN (SELECT secs FROM st) >= (SELECT window_s FROM cfg) THEN 0
             WHEN (SELECT votes FROM own_end) >= (SELECT min_clock_votes FROM cfg) THEN
               CASE WHEN (SELECT ends_at FROM st) > (SELECT sched_end FROM own_end) + interval '3 seconds'
                    THEN greatest(1, (SELECT count(*) FROM own_rows r
                                      WHERE r.posted_at > (SELECT sched_end FROM own_end) - (SELECT window_s FROM cfg) * interval '1 second'))
                    ELSE 0 END
           END AS n,
           CASE WHEN p_extensions IS NOT NULL THEN 'argument'
                WHEN (SELECT secs FROM st) >= (SELECT window_s FROM cfg) THEN '120 s or more left: the close cannot have moved'
                WHEN (SELECT votes FROM own_end) >= (SELECT min_clock_votes FROM cfg) THEN 'the lot''s bid rows (scheduled close from hours_until_close) against the clock given'
                ELSE 'unknown: fewer than 3 bid rows agree on a scheduled close and no count was given' END AS basis
  ),
  frames AS (    -- public live frames held for the lot at p_at (ingested and observed at or before it), last 3 hours
    SELECT count(*) AS n,
           count(*) FILTER (WHERE o.observed_at > p_at - interval '15 minutes') AS n_15,
           count(DISTINCT date_trunc('minute', o.observed_at)) FILTER (WHERE o.observed_at > p_at - interval '15 minutes') AS minutes_15,
           min(o.observed_at) AS first_at, max(o.observed_at) AS last_at
    FROM vehicle_observations o
    WHERE o.vehicle_id = (SELECT vehicle_id FROM st)
      AND o.extraction_method = 'bat_public_live_v1'
      AND o.observed_at <= p_at AND o.observed_at > p_at - interval '3 hours'
      AND o.ingested_at <= p_at
  ),
  prior AS (     -- the stored title-only band (model 31), as it stood at p_at
    SELECT h.predicted_low, h.predicted_hammer, h.predicted_high, h.price_tier, h.comp_count, h.predicted_at
    FROM hammer_predictions h
    WHERE h.vehicle_id = (SELECT vehicle_id FROM st) AND h.model_version = 31 AND h.predicted_at <= p_at
    ORDER BY h.predicted_at DESC
    LIMIT 1
  ),
  -- ---------------------------------------------------------------- hours regime: the lot's own cohort, final close as the clock
  -- Level 1 is the vehicles with this exact make and model text; level 2, used only when level 1 holds fewer than 9 sold lots, is the
  -- vehicles with this make and the same model family (vehicles.normalized_model, "Corvette", "911"). A cohort of up to 6,000
  -- vehicles is read through its vehicles (every lot of theirs, exact counts). A bigger one is read through the lots, newest sold
  -- first, until 170 belong to it (a floor for the denominator): reading 37,000 Corvettes to keep the 150 newest lots took 16 s cold and 0.47 s warm; the lots-first read takes 0.13 s warm.
  l1_veh AS (
    SELECT v.id FROM vehicles v
    WHERE (SELECT regime FROM st) = 'hours'
      AND v.make = (SELECT make FROM st) AND v.model = (SELECT model FROM st)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    LIMIT 6001
  ),
  l1_big AS (SELECT (SELECT count(*) FROM l1_veh) > 6000 AS big),
  l1_small AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer,
           (e.outcome = 'sold' AND e.winning_bid > 0) AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM l1_veh fv
    JOIN auction_events e ON e.vehicle_id = fv.id
    WHERE NOT (SELECT big FROM l1_big)
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
      AND e.id <> p_auction_event_id
  ),
  l1_recent AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer, true AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM (SELECT e0.id, e0.vehicle_id, e0.auction_end_date, e0.winning_bid, e0.updated_at, e0.source_url
          FROM auction_events e0
          WHERE (SELECT big FROM l1_big)
            AND e0.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
            AND e0.outcome = 'sold' AND e0.winning_bid > 0
            AND e0.auction_end_date <= p_at - (SELECT settle FROM cfg)
            AND e0.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
          ORDER BY e0.auction_end_date DESC
          LIMIT 12000) e
    -- the vehicle is found by its key; "|| ''" keeps the planner off the make-and-model index, which it cannot size for a parameter
    CROSS JOIN LATERAL (SELECT 1 FROM vehicles v
                        WHERE v.id = e.vehicle_id AND (v.make || '') = (SELECT make FROM st) AND (v.model || '') = (SELECT model FROM st)
                          AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL LIMIT 1) ok
    WHERE e.id <> p_auction_event_id
    LIMIT 170
  ),
  l1 AS (        -- one row per listing slug
    SELECT DISTINCT ON (r.slug) r.*
    FROM (SELECT * FROM l1_small UNION ALL SELECT * FROM l1_recent) r
    WHERE r.slug IS DISTINCT FROM (SELECT slug FROM st)
    ORDER BY r.slug, r.sold DESC, r.updated_at DESC NULLS LAST
  ),
  l1_n AS (SELECT count(*) AS closed, count(*) FILTER (WHERE sold) AS sold, (SELECT big FROM l1_big) AS floor FROM l1),
  l2_veh AS (
    SELECT v.id FROM vehicles v
    WHERE (SELECT regime FROM st) = 'hours'
      AND (SELECT sold FROM l1_n) < (SELECT min_n FROM cfg)
      AND (SELECT family FROM st) IS NOT NULL
      AND lower(v.make) = lower((SELECT make FROM st))
      AND lower(v.normalized_model) = (SELECT family FROM st)
      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    LIMIT 6001
  ),
  l2_big AS (SELECT (SELECT count(*) FROM l2_veh) > 6000 AS big),
  l2_small AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer,
           (e.outcome = 'sold' AND e.winning_bid > 0) AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM l2_veh fv
    JOIN auction_events e ON e.vehicle_id = fv.id
    WHERE NOT (SELECT big FROM l2_big)
      AND e.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
      AND e.id <> p_auction_event_id
  ),
  l2_recent AS (
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer, true AS sold, e.updated_at,
           substring(e.source_url FROM '/listing/([^/?#]+)') AS slug
    FROM (SELECT e0.id, e0.vehicle_id, e0.auction_end_date, e0.winning_bid, e0.updated_at, e0.source_url
          FROM auction_events e0
          WHERE (SELECT big FROM l2_big)
            AND e0.source_url ~ 'bringatrailer\.com/listing/[^/?#]+'
            AND e0.outcome = 'sold' AND e0.winning_bid > 0
            AND e0.auction_end_date <= p_at - (SELECT settle FROM cfg)
            AND e0.auction_end_date > p_at - (SELECT cohort_days FROM cfg) * interval '1 day'
          ORDER BY e0.auction_end_date DESC
          LIMIT 12000) e
    CROSS JOIN LATERAL (SELECT 1 FROM vehicles v
                        WHERE v.id = e.vehicle_id AND (lower(v.make) || '') = lower((SELECT make FROM st))
                          AND (lower(v.normalized_model) || '') = (SELECT family FROM st)
                          AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL LIMIT 1) ok
    WHERE e.id <> p_auction_event_id
    LIMIT 170
  ),
  l2 AS (
    SELECT DISTINCT ON (r.slug) r.*
    FROM (SELECT * FROM l2_small UNION ALL SELECT * FROM l2_recent) r
    WHERE r.slug IS DISTINCT FROM (SELECT slug FROM st)
    ORDER BY r.slug, r.sold DESC, r.updated_at DESC NULLS LAST
  ),
  l2_n AS (SELECT count(*) AS closed, count(*) FILTER (WHERE sold) AS sold, (SELECT big FROM l2_big) AS floor FROM l2),
  lvl AS (
    SELECT CASE WHEN (SELECT sold FROM l1_n) >= (SELECT min_n FROM cfg) THEN 1
                WHEN (SELECT sold FROM l2_n) >= (SELECT min_n FROM cfg) THEN 2 END AS level
  ),
  cohort_sel AS (   -- the most recent sold lots of the level in use
    SELECT * FROM (
      SELECT * FROM l1 WHERE (SELECT level FROM lvl) = 1
      UNION ALL
      SELECT * FROM l2 WHERE (SELECT level FROM lvl) = 2
    ) c
    WHERE c.sold
    ORDER BY c.f DESC
    LIMIT (SELECT cohort_cap FROM cfg)
  ),
  cohort_state AS ( -- each comparable as it stood the same time before its own close: max bid and bidders posted by then
    SELECT s.ae_id, s.f, s.hammer, x.log_max, x.bid_h, x.bidders_h
    FROM cohort_sel s
    CROSS JOIN LATERAL (
      SELECT max(a.bid_amount) AS log_max,
             max(a.bid_amount) FILTER (WHERE a.posted_at <= s.f - make_interval(secs => (SELECT secs FROM st)::double precision)) AS bid_h,
             count(DISTINCT a.author_username) FILTER (WHERE a.posted_at <= s.f - make_interval(secs => (SELECT secs FROM st)::double precision)) AS bidders_h
      FROM auction_comments a
      WHERE a.auction_event_id = s.ae_id AND a.comment_type = 'bid' AND a.bid_amount > 0 AND a.posted_at IS NOT NULL
    ) x
  ),
  cohort_ok AS (    -- a comparable counts when its bid log reproduces its hammer (no missing last bid, no post-auction sale)
    SELECT * FROM cohort_state WHERE log_max = hammer
  ),
  cohort_n AS (
    SELECT (SELECT count(*) FROM cohort_sel) AS read,
           count(*) AS log_ok,
           count(*) FILTER (WHERE bid_h IS NULL) AS no_bid_yet,
           count(*) FILTER (WHERE bid_h IS NOT NULL) AS n
    FROM cohort_ok
  ),
  cohort_ranked AS (
    SELECT hammer / bid_h AS ratio, bid_h, bidders_h,
           row_number() OVER (ORDER BY hammer / bid_h, ae_id) AS rk
    FROM cohort_ok WHERE bid_h IS NOT NULL
  ),
  cohort_pos AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE bid_h < p_bid) AS below, count(*) FILTER (WHERE bid_h = p_bid) AS same,
           count(*) FILTER (WHERE bidders_h IS NOT NULL AND p_bidders IS NOT NULL AND bidders_h < p_bidders) AS bidders_below,
           count(*) FILTER (WHERE bidders_h IS NOT NULL AND p_bidders IS NOT NULL AND bidders_h = p_bidders) AS bidders_same
    FROM cohort_ranked
  ),
  -- ---------------------------------------------------------------- minutes regime: lots with a recorded clock, scheduled close as the clock
  pool_lots AS (    -- sold lots the public live collector followed, closed before p_at, most recent first
    SELECT e.id AS ae_id, e.auction_end_date AS f, e.winning_bid AS hammer
    FROM monitored_auctions ma
    JOIN auction_events e ON e.vehicle_id = ma.vehicle_id
                         AND substring(e.source_url FROM '/listing/([^/?#]+)') = ma.external_auction_id
    WHERE (SELECT regime FROM st) = 'minutes'
      AND (SELECT n FROM ext) IS NOT NULL
      AND ma.stream_state ? 'last_frame_received_at'
      AND e.outcome = 'sold' AND e.winning_bid > 0
      AND e.auction_end_date <= p_at - (SELECT settle FROM cfg)
      AND e.id <> p_auction_event_id
    ORDER BY e.auction_end_date DESC
    LIMIT (SELECT pool_cap FROM cfg)
  ),
  pool_state AS (   -- each one in the lot's own state: before any extension, the same time before its SCHEDULED close;
                    -- after i extensions, the same time since its i-th bid inside the last 120 s; in both, no later bid yet
    SELECT j.ae_id, j.f, j.hammer, y.sched_end, y.log_max, y.bid_t, y.in_window
    FROM pool_lots j
    CROSS JOIN LATERAL (
      WITH b AS (
        SELECT a.posted_at, a.bid_amount,
               date_trunc('second', a.posted_at + a.hours_until_close * interval '1 hour') AS implied_end
        FROM auction_comments a
        WHERE a.auction_event_id = j.ae_id AND a.comment_type = 'bid' AND a.bid_amount > 0 AND a.posted_at IS NOT NULL
      ), z AS (
        SELECT max(posted_at) AS last_at, max(bid_amount) AS log_max FROM b
      ), o AS (
        -- The scheduled close is the close before any soft-close extension; auction_events keeps only the final one.
        -- Not extended (the last bid is more than 123 s before the stored close): the stored close is it.
        -- Extended: the close that at least 3 bid rows count their hours_until_close to, among values after the row's own
        -- posting and before the stored close (rows written by a later read count to the final close and are left out),
        -- the one most rows agree on.
        SELECT CASE WHEN extract(epoch FROM (j.f - z.last_at)) > 123 THEN j.f
                    ELSE (SELECT c.implied_end
                          FROM (SELECT implied_end, count(*) AS votes
                                FROM b
                                WHERE implied_end IS NOT NULL AND implied_end >= posted_at AND implied_end < j.f - interval '3 seconds'
                                GROUP BY implied_end
                                HAVING count(*) >= (SELECT min_clock_votes FROM cfg)) c
                          ORDER BY c.votes DESC, c.implied_end
                          LIMIT 1) END AS sched_end,
               z.log_max
        FROM z
      ), ch AS (   -- the bids inside the last 120 s of the scheduled close, which is every bid of the extension chain, in order
        SELECT b.posted_at, row_number() OVER (ORDER BY b.posted_at, b.bid_amount) AS rn
        FROM b, o
        WHERE b.posted_at > o.sched_end - (SELECT window_s FROM cfg) * interval '1 second'
      ), an AS (   -- where the state starts: the opening of the last 120 s, or the i-th chain bid
        SELECT CASE WHEN (SELECT n FROM ext) = 0 THEN o.sched_end - (SELECT window_s FROM cfg) * interval '1 second'
                    ELSE (SELECT ch.posted_at FROM ch WHERE ch.rn = (SELECT n FROM ext)) END AS a_at,
               o.sched_end
        FROM o
      ), tt AS (   -- the moment read: i = 0, secs before the scheduled close; i >= 1, 120 - secs after the i-th chain bid
        SELECT an.a_at,
               CASE WHEN (SELECT n FROM ext) = 0 THEN an.sched_end - make_interval(secs => (SELECT secs FROM st)::double precision)
                    ELSE an.a_at + make_interval(secs => greatest(0, (SELECT window_s FROM cfg) - (SELECT secs FROM st))::double precision) END AS t_at
        FROM an
      )
      SELECT o.sched_end, o.log_max,
             (SELECT max(b.bid_amount) FROM b WHERE b.posted_at <= tt.t_at) AS bid_t,
             (SELECT count(*) FROM b WHERE b.posted_at > tt.a_at AND b.posted_at <= tt.t_at) AS in_window
      FROM o, tt
    ) y
  ),
  pool_ok AS (
    SELECT ae_id, hammer, bid_t, hammer / bid_t AS ratio,
           CASE WHEN bid_t < 25000 THEN 'a' WHEN bid_t < 50000 THEN 'b' WHEN bid_t < 100000 THEN 'c' ELSE 'd' END AS tier
    FROM pool_state
    WHERE sched_end IS NOT NULL AND log_max = hammer AND bid_t IS NOT NULL AND in_window = 0
  ),
  pool_tier AS (
    SELECT CASE WHEN p_bid < 25000 THEN 'a' WHEN p_bid < 50000 THEN 'b' WHEN p_bid < 100000 THEN 'c' ELSE 'd' END AS tier
  ),
  pool_use AS (     -- the lot's price tier when it holds enough lots, else every tier
    SELECT p.*,
           (SELECT count(*) FROM pool_ok q WHERE q.tier = (SELECT tier FROM pool_tier)) >= (SELECT min_tier_n FROM cfg) AS tier_alone
    FROM pool_ok p
  ),
  pool_ranked AS (
    SELECT ratio, tier_alone,
           row_number() OVER (ORDER BY ratio, ae_id) AS rk
    FROM pool_use
    WHERE NOT tier_alone OR tier = (SELECT tier FROM pool_tier)
  ),
  pool_n AS (
    SELECT (SELECT count(*) FROM pool_lots) AS read,
           (SELECT count(*) FROM pool_state) AS state_n,
           (SELECT count(*) FROM pool_state WHERE sched_end IS NOT NULL) AS clock_ok,
           (SELECT count(*) FROM pool_state WHERE sched_end IS NOT NULL AND log_max = hammer) AS log_ok,
           (SELECT count(*) FROM pool_ok) AS in_state,
           (SELECT count(*) FROM pool_ranked) AS n,
           COALESCE((SELECT bool_or(tier_alone) FROM pool_ranked), false) AS tier_alone
  ),
  -- ---------------------------------------------------------------- the 80% interval: order statistics of the comparables' hammer / bid ratios
  pick AS (          -- which sample feeds the band
    SELECT CASE (SELECT regime FROM st)
             WHEN 'hours' THEN (SELECT n FROM cohort_n)
             WHEN 'minutes' THEN (SELECT n FROM pool_n) END AS n
  ),
  ords AS (          -- the hammer is never below the standing bid (ratio 1), so only the top needs a rank: the k-th smallest of n,
                     -- k = ceil(0.8 (n + 1)); the new lot's ratio is at or below it with probability k/(n + 1) >= 0.8 when exchangeable
    SELECT n, CASE WHEN n >= (SELECT min_n FROM cfg) THEN ceil((n + 1) * 0.8)::int END AS k
    FROM pick
  ),
  ratios AS (
    SELECT (SELECT ratio FROM (SELECT ratio, rk FROM cohort_ranked UNION ALL SELECT ratio, rk FROM pool_ranked) r WHERE r.rk = (SELECT k FROM ords)) AS hi,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)::numeric FROM (SELECT ratio FROM cohort_ranked UNION ALL SELECT ratio FROM pool_ranked) r) AS mid
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lot) THEN jsonb_build_object(
      'status', 'unknown_lot', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'no auction_events row has this id and a Bring a Trailer listing URL')
    WHEN (SELECT regime FROM st) = 'no_time' THEN jsonb_build_object(
      'status', 'no_time', 'auction_event_id', p_auction_event_id,
      'reason', 'no time of the read was given')
    WHEN (SELECT regime FROM st) = 'no_close' THEN jsonb_build_object(
      'status', 'no_close', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'the lot has no close time and none was given')
    WHEN (SELECT regime FROM st) = 'ended' THEN jsonb_build_object(
      'status', 'ended', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'ends_at', (SELECT ends_at FROM st), 'ends_at_source', (SELECT ends_at_source FROM st),
      'reason', 'the close time is at or before the time of the read')
    WHEN (SELECT regime FROM st) = 'no_bid' THEN jsonb_build_object(
      'status', 'no_bid', 'as_of', p_at, 'auction_event_id', p_auction_event_id,
      'reason', 'no current bid was given')
    ELSE (
      SELECT jsonb_build_object(
        'status', 'ok',
        'reader', 'live_lot_temperature_at',
        'as_of', p_at,
        'lot', jsonb_build_object(
          'auction_event_id', st.event_id, 'vehicle_id', st.vehicle_id, 'slug', st.slug,
          'year', st.year, 'make', st.make, 'model', st.model),
        'input', jsonb_build_object('bid', p_bid, 'bidders', p_bidders, 'at', p_at),
        'clock', jsonb_build_object(
          'ends_at', st.ends_at, 'ends_at_source', st.ends_at_source,
          'seconds_left', round(st.secs, 1), 'regime', st.regime,
          'extensions', ext.n, 'extensions_basis', ext.basis,
          'basis', CASE st.regime
                     WHEN 'hours' THEN 'comparables are read the same time before their own final close; the final close of a closed lot includes any soft-close extension, an error of a few minutes that is under 2% of the 90th ratio from 1 h out'
                     ELSE 'comparables are lots with a recorded clock in the same soft-close state: before any extension, read the same time before their scheduled close (the close before any extension); after i extensions, read the same time after their i-th bid inside the last 120 s; in both, with no later bid yet' END),
        'cohort', CASE st.regime
          WHEN 'hours' THEN jsonb_build_object(
            'key', jsonb_build_object('make', st.make, 'model', st.model, 'model_family', st.family),
            'level', (SELECT level FROM lvl),
            'how', CASE (SELECT level FROM lvl)
                     WHEN 1 THEN 'BaT lots whose vehicle has this exact make and model text'
                     WHEN 2 THEN 'BaT lots whose vehicle has this make and the same model family, vehicles.normalized_model (the exact make and model text had fewer than 9 sold lots)'
                     ELSE 'no cohort: neither the exact make and model text nor the make with the model family has 9 sold lots' END
                   || '; one row per listing, closed between ' || (SELECT cohort_days FROM cfg) || ' days and 1 hour before the time of the read, sold with a hammer, most recent 150; a lot counts when its bid rows reproduce its hammer. A cohort of more than 6,000 vehicles is read through its newest lots, so its denominator is a floor',
            'n_comparables', (SELECT n FROM cohort_n),
            'denominator', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) WHEN 2 THEN (SELECT sold FROM l2_n) END,
            'denominator_is_a_floor', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT floor FROM l1_n) WHEN 2 THEN (SELECT floor FROM l2_n) END,
            'funnel', jsonb_build_object(
              'closed_lots', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT closed FROM l1_n) WHEN 2 THEN (SELECT closed FROM l2_n) ELSE (SELECT closed FROM l1_n) END,
              'sold_with_hammer', CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) WHEN 2 THEN (SELECT sold FROM l2_n) ELSE (SELECT sold FROM l1_n) END,
              'read', (SELECT read FROM cohort_n),
              'bid_log_reproduces_hammer', (SELECT log_ok FROM cohort_n),
              'no_bid_yet_at_this_time', (SELECT no_bid_yet FROM cohort_n),
              'with_a_bid_at_this_time', (SELECT n FROM cohort_n)))
          ELSE jsonb_build_object(
            'key', jsonb_build_object('make', st.make, 'model', st.model, 'model_family', st.family),
            'level', NULL, 'n_comparables', NULL, 'denominator', NULL,
            'how', 'not read in the minutes regime: the band comes from lots with a recorded clock, across cohorts (see band.pool)') END,
        'cohort_miss', CASE WHEN st.regime = 'hours' AND (SELECT sold FROM l1_n) < (SELECT min_n FROM cfg) THEN jsonb_build_object(
            'level', 'exact make and model text',
            'reason', CASE WHEN st.make IS NULL OR st.model IS NULL THEN 'the lot''s vehicle has no make or no model'
                           WHEN (SELECT closed FROM l1_n) = 0 THEN 'no closed BaT lot has this make and model text'
                           ELSE 'fewer than 9 sold BaT lots have this make and model text' END,
            'make', st.make, 'model', st.model, 'model_family', st.family,
            'denominator', jsonb_build_object(
              'closed_lots_with_this_text', (SELECT closed FROM l1_n),
              'sold_with_this_text', (SELECT sold FROM l1_n),
              'vehicles_with_this_make_to_10000', CASE WHEN (SELECT level FROM lvl) IS NULL AND st.make IS NOT NULL
                                                       THEN (SELECT count(*) FROM (SELECT 1 FROM vehicles v WHERE v.make = st.make LIMIT 10000) m) END,
              'closed_lots_in_the_model_family', (SELECT closed FROM l2_n),
              'sold_in_the_model_family', (SELECT sold FROM l2_n)),
            'resolved_by', CASE (SELECT level FROM lvl) WHEN 2 THEN 'make and model family (normalized_model)' END,
            'family_note', CASE WHEN st.family IS NULL THEN 'the lot''s vehicle has no normalized_model, so there is no wider level to try' END)
          END,
        'position', CASE WHEN st.regime = 'hours' AND (SELECT n FROM cohort_pos) > 0 THEN jsonb_build_object(
            'basis', 'the lot against the cohort''s comparables the same time before their own close',
            'seconds_left', round(st.secs, 1),
            'price', jsonb_build_object('bid', p_bid, 'n', (SELECT n FROM cohort_pos),
                       'below', (SELECT below FROM cohort_pos), 'same', (SELECT same FROM cohort_pos),
                       'above', (SELECT n - below - same FROM cohort_pos),
                       'percentile', round(((SELECT below FROM cohort_pos) + 0.5 * (SELECT same FROM cohort_pos)) / (SELECT n FROM cohort_pos), 4)),
            'bidders', CASE WHEN p_bidders IS NOT NULL THEN jsonb_build_object('bidders', p_bidders, 'n', (SELECT n FROM cohort_pos),
                       'below', (SELECT bidders_below FROM cohort_pos), 'same', (SELECT bidders_same FROM cohort_pos),
                       'above', (SELECT n - bidders_below - bidders_same FROM cohort_pos),
                       'percentile', round(((SELECT bidders_below FROM cohort_pos) + 0.5 * (SELECT bidders_same FROM cohort_pos)) / (SELECT n FROM cohort_pos), 4)) END)
          END,
        'band', CASE WHEN ords.k IS NOT NULL AND ext.n IS NOT NULL THEN jsonb_build_object(
            'level', 0.8,
            'applies_to', 'the hammer of a lot that sells; every comparable sold, so a lot that ends under its reserve has no hammer to bracket',
            'method', CASE st.regime WHEN 'hours' THEN 'cohort_ratio_upper_order_statistic' ELSE 'clocked_lots_ratio_upper_order_statistic' END,
            'description', 'The hammer is never below the standing bid. The upper end is the k-th smallest of the n comparables'' hammer / bid ratios, read the same time before their close, k = ceil(0.8 (n + 1)); the lot''s ratio is at or below it with probability k/(n + 1), at least 0.8, when the lot is exchangeable with its comparables. No parameter is fitted.',
            'n', ords.n, 'rank_high', ords.k,
            'coverage_if_exchangeable', round(ords.k::numeric / (ords.n + 1), 4),
            'denominator', CASE st.regime
                             WHEN 'hours' THEN CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT sold FROM l1_n) ELSE (SELECT sold FROM l2_n) END
                             ELSE (SELECT read FROM pool_n) END,
            'denominator_is_a_floor', CASE st.regime
                             WHEN 'hours' THEN CASE (SELECT level FROM lvl) WHEN 1 THEN (SELECT floor FROM l1_n) ELSE (SELECT floor FROM l2_n) END
                             ELSE false END,
            'as_of', p_at, 'seconds_left', round(st.secs, 1),
            'bid', p_bid,
            'ratio_low', 1, 'ratio_mid', round(ratios.mid, 4), 'ratio_high', round(ratios.hi, 4),
            'low', p_bid, 'mid', round(p_bid * ratios.mid), 'high', ceil(p_bid * ratios.hi),
            'pool', CASE st.regime WHEN 'minutes' THEN jsonb_build_object(
                'price_tier', (SELECT tier FROM pool_tier), 'tier_alone', (SELECT tier_alone FROM pool_n),
                'extensions', ext.n,
                'seconds_since_last_bid', CASE WHEN ext.n > 0 THEN greatest(0, 120 - round(st.secs, 1)) END,
                'funnel', jsonb_build_object(
                  'clocked_sold_lots_read', (SELECT read FROM pool_n),
                  'scheduled_close_known', (SELECT clock_ok FROM pool_n),
                  'bid_log_reproduces_hammer', (SELECT log_ok FROM pool_n),
                  'in_the_same_state_with_a_bid', (SELECT in_state FROM pool_n),
                  'in_the_sample', (SELECT n FROM pool_n))) END)
          END,
        'band_unavailable', CASE
          WHEN ords.k IS NOT NULL AND ext.n IS NOT NULL THEN NULL
          WHEN ext.n IS NULL THEN jsonb_build_object(
            'reason', 'the lot''s soft-close state is unknown: fewer than 3 bid rows agree on its scheduled close and no extension count was given',
            'extensions_basis', ext.basis, 'floor', p_bid)
          WHEN st.regime = 'hours' THEN jsonb_build_object(
            'reason', CASE WHEN (SELECT level FROM lvl) IS NULL THEN 'no cohort: see cohort_miss'
                           ELSE 'fewer than 9 comparables had a bid this long before their close' END,
            'n', (SELECT n FROM cohort_n), 'min_n', 9,
            'sold_lots_found', CASE (SELECT level FROM lvl) WHEN 2 THEN (SELECT sold FROM l2_n) ELSE (SELECT sold FROM l1_n) END)
          ELSE jsonb_build_object(
            'reason', CASE WHEN ext.n > 0 THEN 'fewer than 9 lots with a recorded clock reached the same number of extensions and had no later bid by this time'
                           ELSE 'fewer than 9 lots with a recorded clock had a bid at this time to close and no extension yet' END,
            'n', (SELECT n FROM pool_n), 'min_n', 9, 'extensions', ext.n, 'floor', p_bid,
            'funnel', jsonb_build_object('clocked_sold_lots_read', (SELECT read FROM pool_n),
                      'scheduled_close_known', (SELECT clock_ok FROM pool_n),
                      'bid_log_reproduces_hammer', (SELECT log_ok FROM pool_n),
                      'in_the_same_state_with_a_bid', (SELECT in_state FROM pool_n)))
          END,
        'prior', (SELECT jsonb_build_object(
            'model_version', 31, 'method', 'title-only CompBase band, priced once at first sight (scripts/market/live-bands.sql); does not use the live bid',
            'low', pr.predicted_low, 'mid', pr.predicted_hammer, 'high', pr.predicted_high,
            'price_tier', pr.price_tier, 'comp_count', pr.comp_count, 'predicted_at', pr.predicted_at,
            'bid_below_low', p_bid < pr.predicted_low, 'bid_above_high', p_bid > pr.predicted_high)
          FROM prior pr),
        'coverage', jsonb_build_object(
          'as_of', p_at,
          'bid_rows', jsonb_build_object('source', 'auction_comments, comment_type bid, posted at or before as_of',
                        'n', own.n, 'first_posted_at', own.first_at, 'last_posted_at', own.last_at,
                        'max_bid', own.bid, 'bidders', own.bidders, 'rows_in_last_15_min', own.n_15,
                        'agrees_with_input_bid', own.bid IS NOT DISTINCT FROM p_bid),
          'live_frames', jsonb_build_object('source', 'vehicle_observations, bat_public_live_v1, observed and ingested at or before as_of, last 3 hours',
                        'n', frames.n, 'first_observed_at', frames.first_at, 'last_observed_at', frames.last_at,
                        'frames_in_last_15_min', frames.n_15, 'minutes_with_a_frame_of_last_15', frames.minutes_15)))
      FROM st, ext, own, frames, ords, ratios
    )
  END;
$fn$;

COMMENT ON FUNCTION public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer) IS
'Live-state reader for a Bring a Trailer lot (2026-10-07, case ledger 13.7 step 1). Takes the bid and bidders the lot page shows, the time of the read, the clock the page shows (p_ends_at; else auction_events.auction_end_date) and the extensions seen (p_extensions; else read from the lot''s bid rows), and returns jsonb: status ok, unknown_lot, no_time, no_close, ended or no_bid; clock (seconds left, regime, extensions); cohort (key, level, how it was formed, n_comparables, denominator, funnel); cohort_miss (reason and denominators when the exact make and model text has fewer than 9 sold lots, and what resolved it); position (bid and bidders against the cohort''s comparables the same time before their own close, hours regime); band (80%, from the standing bid to the k-th smallest hammer/bid ratio of n comparables, k = ceil(0.8 (n + 1)), n >= 9, with denominator, method, as_of, coverage_if_exchangeable) or band_unavailable with the reason and the floor; prior (hammer_predictions model 31 as it stood at p_at); coverage (bid rows and live frames held at p_at). Hours regime (1 h or more left): comparables are read the same time before their final close, cohort = exact make and model text, else the model family (vehicles.normalized_model), the 150 newest sold lots; a cohort over 6,000 vehicles is read through its newest lots and its denominator is a floor. Minutes regime: sold lots the live collector followed (monitored_auctions.stream_state), read in the lot''s own soft-close state (before any extension, the same time before their SCHEDULED close; after i extensions, the same time after their i-th bid inside the last 120 s; no later bid), because auction_events keeps only the final close and a read 120 s before it already sees the hammer. Point in time: nothing posted, observed, ingested or predicted after p_at, and no lot that closed within 1 h of p_at, enters a read. STABLE, SECURITY INVOKER, writes nothing; EXECUTE for service_role only. Contract: supabase/sql/test_live_lot_reader.sql. Replay: scripts/market/replay-live-lot-reader.sql.';

REVOKE ALL ON FUNCTION public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.live_lot_temperature_at(uuid, numeric, integer, timestamptz, timestamptz, integer) TO service_role;
  END IF;
END $grants$;

COMMIT;
