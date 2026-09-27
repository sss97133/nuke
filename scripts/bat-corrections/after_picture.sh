#!/bin/bash
# after_picture.sh — load the after export (live_all_after.jsonl) next to the before export (live) and print
# the lead's class table for both, then the cohort shift. Same column contract as build_all.sh.
set -u
W=/private/tmp/claude-501/-Users-skylar/cb179857-844e-47f9-99c5-4faa3bd1d836/scratchpad/batwriter
DB=/private/tmp/claude-501/-Users-skylar/cb179857-844e-47f9-99c5-4faa3bd1d836/scratchpad/work.duckdb
AFTER=${1:-$W/live_all_after.jsonl}
COLS="{id:'VARCHAR', bat_auction_url:'VARCHAR', listing_url:'VARCHAR', discovery_url:'VARCHAR', vin:'VARCHAR', year:'BIGINT', make:'VARCHAR', model:'VARCHAR',
           sale_price:'BIGINT', sold_price:'BIGINT', bat_sold_price:'DOUBLE', winning_bid:'BIGINT', high_bid:'BIGINT', canonical_sold_price:'DOUBLE', canonical_outcome:'VARCHAR',
           auction_outcome:'VARCHAR', reserve_status:'VARCHAR', sale_status:'VARCHAR', sale_date:'DATE', bat_sale_date:'DATE', auction_end_date:'VARCHAR', bat_buyer:'VARCHAR', bat_seller:'VARCHAR',
           merged_into_vehicle_id:'VARCHAR', deleted_at:'VARCHAR', is_public:'BOOLEAN', status:'VARCHAR', updated_at:'VARCHAR', description_source:'VARCHAR', description_len:'BIGINT', has_corr:'BOOLEAN'}"
duckdb "$DB" <<EOF
CREATE TABLE IF NOT EXISTS live_before AS SELECT * FROM live;
CREATE OR REPLACE TABLE live_after AS SELECT * FROM read_json('$AFTER', format='newline_delimited', maximum_object_size=4194304, columns=$COLS);
SELECT 'before rows' AS which, count(*) AS n, count(*) FILTER (WHERE deleted_at IS NULL) AS live_rows FROM live_before
UNION ALL SELECT 'after rows', count(*), count(*) FILTER (WHERE deleted_at IS NULL) FROM live_after;
.read $W/after_table.sql
.mode line
SELECT 'BEFORE (export 15:33Z)' AS picture, * FROM class_table(live_before);
SELECT 'AFTER (export 21:39Z-22:3xZ)' AS picture, * FROM class_table(live_after);
.mode duckbox
-- rows whose sale fields changed between the two exports, by (before class -> after class)
WITH b AS (SELECT id, sale_status, sale_price, sale_date, auction_outcome FROM live_before WHERE deleted_at IS NULL),
     a AS (SELECT id, sale_status, sale_price, sale_date, auction_outcome FROM live_after WHERE deleted_at IS NULL)
SELECT coalesce(b.sale_status,'∅') AS status_before, coalesce(a.sale_status,'∅') AS status_after, count(*) AS n,
       count(*) FILTER (WHERE a.sale_price IS DISTINCT FROM b.sale_price) AS price_changed,
       count(*) FILTER (WHERE a.sale_date IS DISTINCT FROM b.sale_date) AS date_changed
FROM a JOIN b USING (id)
WHERE a.sale_status IS DISTINCT FROM b.sale_status OR a.sale_price IS DISTINCT FROM b.sale_price OR a.sale_date IS DISTINCT FROM b.sale_date OR a.auction_outcome IS DISTINCT FROM b.auction_outcome
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25;
.read $W/cohort_shift.sql
EOF
