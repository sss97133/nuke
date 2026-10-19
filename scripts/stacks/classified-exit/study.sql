-- Exit study on the production family key (see README.md). Run from the pull output directory. Inputs: fbfam.jsonl
-- (Facebook listings with family), fold.jsonl (the live mv_family_year_prices sold rows). Output: study2.csv.
CREATE OR REPLACE TABLE fbf AS
SELECT id, vid, price::double AS ask, st, try_cast(fs AS timestamptz) fs, try_cast(ls AS timestamptz) ls,
       try_cast(ra AS timestamptz) ra, rg, vy AS y,
       CASE WHEN fid IS NOT NULL AND vy IS NOT NULL AND (ys IS NULL OR vy >= ys - 1) AND (ye IS NULL OR vy <= ye + 1) THEN fid END AS fid
FROM read_json_auto('fbfam.jsonl', format='newline_delimited', columns={id:'VARCHAR',vid:'VARCHAR',price:'INT',st:'VARCHAR',fs:'VARCHAR',ls:'VARCHAR',ra:'VARCHAR',rg:'VARCHAR',vy:'INT',fid:'VARCHAR',ys:'INT',ye:'INT'})
WHERE coalesce(st, '') NOT IN ('duplicate', 'blocked');
-- Known fate at 7 days (as v_classified_exit_outcomes): exited, or stayed (gone later or seen 7+ days on).
CREATE OR REPLACE TABLE kall AS
SELECT *, CASE WHEN ra > fs AND ra - fs <= INTERVAL 7 DAY THEN 1 ELSE 0 END AS exit7
FROM fbf
WHERE ask > 0 AND fs IS NOT NULL AND fid IS NOT NULL
  AND ((ra > fs) OR (greatest(ls, fs) - fs >= INTERVAL 7 DAY));
-- Only weeks in which removals were being detected: in a week with no recorded exit, a listing that left has an
-- unknown fate and only survivors remain, which would bias the test (2026: Feb 23, Mar 2, Mar 23, Mar 30, Jun 8).
CREATE OR REPLACE TABLE k AS
SELECT * FROM kall WHERE date_trunc('week', fs) IN (SELECT date_trunc('week', fs) FROM kall GROUP BY 1 HAVING sum(exit7) > 0);
-- Asks, point-in-time: other Facebook asks of the family first seen in the 365 days before this one, another vehicle.
CREATE OR REPLACE TABLE ap AS
SELECT l.id, abs(o.y - l.y) AS dy, o.ask AS oask
FROM k l JOIN fbf o ON o.fid = l.fid AND abs(o.y - l.y) <= 5 AND o.ask > 0
  AND o.fs < l.fs AND o.fs >= l.fs - INTERVAL 365 DAY AND o.vid IS DISTINCT FROM l.vid;
CREATE OR REPLACE TABLE aw AS
SELECT id, CASE WHEN count(*) FILTER (WHERE dy = 0) >= 10 THEN 0 WHEN count(*) FILTER (WHERE dy <= 1) >= 10 THEN 1
  WHEN count(*) FILTER (WHERE dy <= 2) >= 10 THEN 2 WHEN count(*) FILTER (WHERE dy <= 3) >= 10 THEN 3 ELSE 5 END AS w
FROM ap GROUP BY id;
CREATE OR REPLACE TABLE apos AS
SELECT p.id, count(*) AS an, quantile_cont(p.oask, 0.5) AS ap50, count(*) FILTER (WHERE p.oask <= l.ask) AS a_below
FROM ap p JOIN aw ON aw.id = p.id AND p.dy <= aw.w JOIN k l ON l.id = p.id GROUP BY p.id;
-- Sales: the fold's sold row for the listing's family and model year (its own window).
CREATE OR REPLACE TABLE fold AS
SELECT family_id AS fid, year AS y, n, offered, thin, p50::double AS p50, prices
FROM read_json_auto('fold.jsonl', format='newline_delimited', columns={family_id:'VARCHAR',year:'INT',n:'INT',offered:'INT',thin:'BOOLEAN',p50:'INT',prices:'INT[]'});
COPY (
  SELECT k.id, k.ask, k.exit7, k.fs, k.y, k.rg, k.fid,
    f.n AS n, f.offered, f.p50,
    CASE WHEN NOT f.thin THEN len(list_filter(f.prices, lambda x: x <= k.ask)) END AS at_or_below,
    a.an, a.ap50, a.a_below
  FROM k LEFT JOIN fold f ON f.fid = k.fid AND f.y = k.y AND NOT f.thin
  LEFT JOIN apos a ON a.id = k.id
) TO 'study2.csv' (HEADER, DELIMITER ',');
