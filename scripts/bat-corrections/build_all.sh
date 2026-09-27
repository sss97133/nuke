#!/bin/bash
# build_all.sh <live.jsonl> <batches-dir> [batch_size=100]
# Loads a live export of BaT vehicles rows, prints the BEFORE picture, runs the per-vehicle generator
# against the archive truth, and exports null-free batches for correct_vehicle_sale_provenance_batch.
set -u
LIVE=$1; OUT=$2; SIZE=${3:-100}
W=${BATW:-scripts/data/bat-corrections}
duckdb ${BATW:-scripts/data/bat-corrections}/work.duckdb <<EOF
CREATE OR REPLACE TABLE live AS SELECT * FROM read_json('$LIVE', format='newline_delimited', maximum_object_size=4194304,
  columns={id:'VARCHAR', bat_auction_url:'VARCHAR', listing_url:'VARCHAR', discovery_url:'VARCHAR', vin:'VARCHAR', year:'BIGINT', make:'VARCHAR', model:'VARCHAR',
           sale_price:'BIGINT', sold_price:'BIGINT', bat_sold_price:'DOUBLE', winning_bid:'BIGINT', high_bid:'BIGINT', canonical_sold_price:'DOUBLE', canonical_outcome:'VARCHAR',
           auction_outcome:'VARCHAR', reserve_status:'VARCHAR', sale_status:'VARCHAR', sale_date:'DATE', bat_sale_date:'DATE', auction_end_date:'VARCHAR', bat_buyer:'VARCHAR', bat_seller:'VARCHAR',
           merged_into_vehicle_id:'VARCHAR', deleted_at:'VARCHAR', is_public:'BOOLEAN', status:'VARCHAR', updated_at:'VARCHAR', description_source:'VARCHAR', description_len:'BIGINT', has_corr:'BOOLEAN'});
SELECT '== live BaT rows (the picture before this pass)' AS note;
SELECT count(*) AS rows_total, count(*) FILTER (WHERE deleted_at IS NULL) AS live_rows, count(*) FILTER (WHERE merged_into_vehicle_id IS NOT NULL) AS merged, count(*) FILTER (WHERE has_corr) AS with_corrections,
       count(*) FILTER (WHERE deleted_at IS NULL AND sale_price > 0 AND coalesce(sale_status,'') <> 'sold') AS priced_not_status_sold,
       count(*) FILTER (WHERE deleted_at IS NULL AND sale_price > 0 AND auction_outcome IS NULL) AS priced_no_auction_outcome,
       count(*) FILTER (WHERE deleted_at IS NULL AND sale_status = 'sold' AND (sale_price IS NULL OR sale_price = 0)) AS status_sold_no_price,
       count(*) FILTER (WHERE deleted_at IS NULL AND sale_status = 'sold' AND sale_date IS NULL) AS status_sold_no_date,
       count(*) FILTER (WHERE deleted_at IS NULL AND sale_status = 'sold') AS status_sold,
       count(*) FILTER (WHERE deleted_at IS NULL AND description_source = 'source_imported' AND description_len = 481) AS description_truncated_481
FROM live;
CREATE OR REPLACE TABLE pvrows AS
SELECT id, bat_auction_url, listing_url, discovery_url, vin, year, make, merged_into_vehicle_id AS merged_into, sale_price, sale_status, auction_outcome, reserve_status, high_bid,
       sale_date, auction_end_date, bat_buyer, winning_bid, bat_sold_price, sold_price, bat_sale_date
FROM live WHERE deleted_at IS NULL;
.read $W/gen_corrections.sql
SELECT '== links and proposals' AS note;
SELECT via, count(*) n FROM vlots GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) AS vehicles_linked, count(*) FILTER (WHERE n_lots > 1) AS with_2plus_lots FROM vtruth;
SELECT count(*) AS vehicles_to_correct, sum(n_fields) AS fields,
       count(*) FILTER (WHERE f_sale_status) sale_status, count(*) FILTER (WHERE f_sale_price) sale_price, count(*) FILTER (WHERE f_sale_date) sale_date,
       count(*) FILTER (WHERE f_high_bid) high_bid, count(*) FILTER (WHERE f_auction_end_date) auction_end_date, count(*) FILTER (WHERE f_bat_buyer) bat_buyer,
       count(*) FILTER (WHERE f_auction_outcome) auction_outcome, count(*) FILTER (WHERE f_reserve_status) reserve_status FROM corrections;
SELECT json_extract_string(row_json, '\$.corrections.sale_status.expected') AS live_status, json_extract_string(row_json, '\$.corrections.sale_status.value') AS proposed, count(*) n
FROM corrections WHERE f_sale_status GROUP BY ALL ORDER BY n DESC LIMIT 10;
SELECT 'unsold vehicles carrying a sale_price' k, count(*) n FROM corrections WHERE f_sale_price AND json_extract_string(row_json, '\$.corrections.sale_price.value') IS NULL
UNION ALL SELECT 'sold vehicles with a different price', count(*) FROM corrections WHERE f_sale_price AND json_extract_string(row_json, '\$.corrections.sale_price.value') IS NOT NULL AND json_extract_string(row_json, '\$.corrections.sale_price.expected') IS NOT NULL
UNION ALL SELECT 'sold vehicles with no price', count(*) FROM corrections WHERE f_sale_price AND json_extract_string(row_json, '\$.corrections.sale_price.value') IS NOT NULL AND json_extract_string(row_json, '\$.corrections.sale_price.expected') IS NULL
UNION ALL SELECT 'sold vehicles with no sale_date', count(*) FROM corrections WHERE f_sale_date AND json_extract_string(row_json, '\$.corrections.sale_date.value') IS NOT NULL AND json_extract_string(row_json, '\$.corrections.sale_date.expected') IS NULL
UNION ALL SELECT 'unsold vehicles carrying a sale_date', count(*) FROM corrections WHERE f_sale_date AND json_extract_string(row_json, '\$.corrections.sale_date.value') IS NULL;
EOF
$W/export_batches.sh "$OUT" "$SIZE"
echo "null specs across batches: $(cat "$OUT"/batch_*.json | jq -c '[.[] | .corrections | to_entries[] | select(.value == null)] | length' | paste -sd+ - | bc)"
