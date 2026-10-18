-- Title -> BaT model page (cohort), learned from the archive. Reused for backtest and live.
CREATE OR REPLACE TEMP MACRO title_year(t) AS try_cast(regexp_extract(t, '\b((?:19|20)\d{2})\b', 1) AS INTEGER);
CREATE OR REPLACE TEMP MACRO after_year(t) AS trim(regexp_extract(t, '\b(?:19|20)\d{2}\b\s+(.*)$', 1));
CREATE OR REPLACE TEMP TABLE known_makes AS
  SELECT make, lower(make) AS lmake, length(make) AS len FROM (SELECT DISTINCT make FROM lots WHERE make IS NOT NULL AND length(make) > 1);
-- candidate pool: archive car lots with a model page
CREATE OR REPLACE TEMP TABLE pool AS
  SELECT slug, year, lower(make) AS lmake, lower(model) AS lmodel, cohort, end_ts
  FROM lots JOIN sales USING (slug) WHERE kind = 'car' AND cohort IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL;
CREATE OR REPLACE TEMP MACRO map_cohorts(targets) AS TABLE
WITH t AS (
  SELECT *, title_year(title) AS ty, lower(after_year(title)) AS rest FROM query_table(targets)
), m AS (   -- the longest known make the post-year text starts with
  SELECT t.*, k.lmake, row_number() OVER (PARTITION BY t.key ORDER BY k.len DESC) AS rn
  FROM t JOIN known_makes k ON starts_with(t.rest, k.lmake || ' ')
), tm AS (
  SELECT key, ty, lmake, trim(substr(rest, length(lmake) + 2)) AS lmodel_t FROM m WHERE rn = 1
), cand AS (   -- same make, year within 3, same first model word; score = leading words in common
  SELECT tm.key, p.cohort, p.year, tm.ty,
         (SELECT count(*) FROM (SELECT unnest(string_split(tm.lmodel_t, ' ')) w, generate_subscripts(string_split(tm.lmodel_t, ' '), 1) i) a
            JOIN (SELECT unnest(string_split(p.lmodel, ' ')) w, generate_subscripts(string_split(p.lmodel, ' '), 1) i) b USING (i, w)) AS lead_words
  FROM tm JOIN pool p ON p.lmake = tm.lmake AND abs(p.year - tm.ty) <= 3
   AND split_part(p.lmodel, ' ', 1) = split_part(tm.lmodel_t, ' ', 1)
   AND (p.slug <> tm.key)
), best AS (
  SELECT key, max(lead_words) AS bw FROM cand GROUP BY key
), votes AS (
  SELECT c.key, c.cohort, count(*) AS n, sum(CASE WHEN c.year = c.ty THEN 1 ELSE 0 END) AS same_year
  FROM cand c JOIN best b ON b.key = c.key AND c.lead_words = b.bw GROUP BY ALL
), ranked AS (
  SELECT *, n::DOUBLE / sum(n) OVER (PARTITION BY key) AS share,
         row_number() OVER (PARTITION BY key ORDER BY same_year DESC, n DESC, cohort) AS r
  FROM votes
)
SELECT key, cohort, n AS votes, round(share, 3) AS share FROM ranked WHERE r = 1;

-- Title-only features: what a live lot's title and BaT's live page give before the lot page is read.
CREATE OR REPLACE TEMP MACRO title_drive(t) AS CASE
  WHEN regexp_matches(lower(t), '4x4|4×4|\b4wd\b|\bawd\b|four-wheel|\bk[0-9]{1,4}\b|\bv[0-9]{2}\b') THEN '4wd'
  WHEN regexp_matches(lower(t), '\bc[0-9]{2,4}\b|\br[0-9]{2}\b|\b2wd\b|\brwd\b') THEN '2wd' END;
CREATE OR REPLACE TEMP MACRO title_miles(t) AS CASE
  WHEN regexp_matches(t, '([0-9][0-9,.]*)k-Mile') THEN try_cast(replace(regexp_extract(t, '([0-9][0-9,.]*)k-Mile', 1), ',', '') AS DOUBLE) * 1000
  WHEN regexp_matches(t, '([0-9][0-9,]*)-Mile') THEN try_cast(replace(regexp_extract(t, '([0-9][0-9,]*)-Mile', 1), ',', '') AS DOUBLE) END;
CREATE OR REPLACE TEMP MACRO title_trans(t) AS CASE
  WHEN regexp_matches(t, '\b[3-7]-Speed\b') AND NOT regexp_matches(lower(t), 'automatic|auto\b') THEN 'manual'
  WHEN regexp_matches(lower(t), 'automatic') THEN 'auto' END;

-- Model words: the first 1-4 words after the make ("360 challenge stradale ..."), compared position by position.
CREATE OR REPLACE TEMP MACRO pfx(m, k) AS CASE WHEN len(string_split(m, ' ')) >= k THEN array_to_string(string_split(m, ' ')[1:k], ' ') END;

-- Live lots (live-bands.mjs fills in __LIVE_TSV__ and __BANDS_CSV__) -> model page -> CompBase band as of now.
CREATE OR REPLACE TEMP TABLE live AS
  SELECT vid AS key, title, try_cast(bid AS DOUBLE) AS bid, nr = 'true' AS no_reserve
  FROM read_csv('__LIVE_TSV__', delim = '\t', header = false, quote = '',
                columns = {'vid': 'VARCHAR', 'bid': 'VARCHAR', 'nr': 'VARCHAR', 'title': 'VARCHAR'});
CREATE OR REPLACE TEMP TABLE live_map AS SELECT * FROM map_cohorts('live');
CREATE OR REPLACE TEMP TABLE live_words AS
WITH r AS (SELECT key, lower(after_year(title)) AS rest FROM live),
m AS (SELECT r.key, trim(substr(r.rest, length(k.lmake) + 2)) AS lm, row_number() OVER (PARTITION BY r.key ORDER BY k.len DESC) AS rn
      FROM r JOIN known_makes k ON starts_with(r.rest, k.lmake || ' '))
SELECT key, pfx(lm, 1) AS t1, pfx(lm, 2) AS t2, pfx(lm, 3) AS t3, pfx(lm, 4) AS t4 FROM m WHERE rn = 1;
CREATE OR REPLACE TEMP TABLE comp_words AS
  SELECT slug, pfx(lower(model), 1) AS m1, pfx(lower(model), 2) AS m2, pfx(lower(model), 3) AS m3, pfx(lower(model), 4) AS m4
  FROM lots WHERE model IS NOT NULL;

-- Model version 31: the page's comps, weighted toward the lot's own variant. lw = leading model words shared with the
-- title; the variant is the most specific level holding >= 5 effective comps, and the rest of the page together carries
-- at most half the variant's weight (a 360 Challenge Stradale is priced mostly from Challenge Stradales, not Modenas).
-- Backtest, 10,065 cars sold 2026-06-27..09-26 priced from earlier sales with title-only features, v30 (page) -> v31:
-- 80% band caught 77.6% -> 77.5%, 50% band 48.6% -> 49.3%, width 1.16 -> 1.09, median miss 27.3% -> 25.5%, sold above
-- 2x the middle 6.5% -> 5.6%; on the 900 whose variant is under 10% of its page, median miss 33.6% -> 29.6%.
COPY (
  WITH t AS (SELECT l.*, m.cohort, m.share, title_year(l.title) AS ty, title_drive(l.title) AS td, title_miles(l.title) AS tmi,
                    title_trans(l.title) AS ttr, w.t1, w.t2, w.t3, w.t4
             FROM live l JOIN live_map m USING (key) LEFT JOIN live_words w USING (key) WHERE m.share >= 0.6),
  pairs AS (SELECT t.key, c.price,
                   comp_weight(epoch(now()) - epoch(c.end_ts), t.td, c.drive, t.ty, c.year, t.tmi, c.miles, t.ttr, c.trans,
                               NULL, c.build, t.no_reserve, c.no_reserve, NULL, c.photos, NULL, c.desc_len) AS w,
                   CASE WHEN cw.m4 = t.t4 THEN 4 WHEN cw.m3 = t.t3 THEN 3 WHEN cw.m2 = t.t2 THEN 2 WHEN cw.m1 = t.t1 THEN 1 ELSE 0 END AS lw
            FROM t JOIN comp_base c ON c.cohort = t.cohort AND c.end_ts >= now() - INTERVAL 10 YEAR
                                    AND (t.td IS NULL OR c.drive IS NULL OR c.drive = t.td)
                   LEFT JOIN comp_words cw ON cw.slug = c.slug),
  levels AS (SELECT p.key, L.L, power(sum(p.w), 2) / sum(p.w * p.w) AS n_eff
             FROM pairs p JOIN (SELECT unnest([1, 2, 3, 4]) AS L) L ON p.lw >= L.L WHERE p.w > 0 GROUP BY ALL),
  best AS (SELECT key, max(L) FILTER (WHERE n_eff >= 5) AS lvl, max(n_eff) FILTER (WHERE n_eff >= 5) AS lvl_n_eff FROM levels GROUP BY key),
  tagged AS (SELECT p.key, p.price, p.w, b.lvl IS NULL OR p.lw >= b.lvl AS in_variant FROM pairs p LEFT JOIN best b USING (key) WHERE p.w > 0),
  sums AS (SELECT key, sum(w) FILTER (WHERE in_variant) AS wv, sum(w) FILTER (WHERE NOT in_variant) AS wo FROM tagged GROUP BY key),
  weighted AS (SELECT t.key, t.price, t.w * CASE WHEN t.in_variant THEN 1.0 ELSE least(1.0, 0.5 * s.wv / s.wo) END AS w
               FROM tagged t JOIN sums s USING (key)),
  cum AS (SELECT *, sum(w) OVER (PARTITION BY key ORDER BY price ROWS UNBOUNDED PRECEDING) / sum(w) OVER (PARTITION BY key) AS cf
          FROM weighted),
  band AS (SELECT key, count(*) AS n_comps, power(sum(w), 2) / sum(w * w) AS n_eff,
                  min(price) FILTER (WHERE cf >= 0.10) AS p10, min(price) FILTER (WHERE cf >= 0.25) AS p25,
                  min(price) FILTER (WHERE cf >= 0.50) AS p50, min(price) FILTER (WHERE cf >= 0.75) AS p75,
                  min(price) FILTER (WHERE cf >= 0.90) AS p90
           FROM cum GROUP BY key)
  SELECT b.key AS vehicle_id, m.cohort, m.share, b.n_comps, round(b.n_eff, 1) AS n_eff, b.p10, b.p25, b.p50, b.p75, b.p90, l.bid,
         coalesce(bs.lvl, 0) AS variant_level,
         replace(CASE bs.lvl WHEN 4 THEN w.t4 WHEN 3 THEN w.t3 WHEN 2 THEN w.t2 WHEN 1 THEN w.t1 END, ',', ' ') AS variant_words
  FROM band b JOIN live_map m USING (key) JOIN live l USING (key) LEFT JOIN best bs USING (key) LEFT JOIN live_words w USING (key)
  WHERE b.n_eff >= 5          -- under 5 effective comps: "not priced yet", no band
) TO '__BANDS_CSV__' (HEADER);
