-- gen_descriptions.sql — full BaT write-ups for vehicles whose description is the 481-char summary.
-- The vehicle page's description card reads extraction_metadata rows with field_name
-- 'raw_listing_description' (nuke_frontend/src/components/vehicle/VehicleDescriptionCard.tsx:137),
-- one per listing, dated by the lot's auction end. extract-bat-core writes them the same way
-- (trySaveExtractionMetadata); this reproduces that row shape from the local archive for the
-- vehicle's LATEST lot. Inputs: live, vtruth, lots_detail, and `has_raw` (vehicle ids that already
-- hold such a row, looked up live). Output: descriptions (vehicle_id, source_url, text, ...).
CREATE OR REPLACE TABLE descriptions AS
SELECT l.id AS vehicle_id,
       v.latest_url AS source_url,
       v.latest_slug AS slug,
       d.description AS text,
       length(d.description) AS text_len,
       l.description_len AS prod_len,
       d.parsed_at
FROM live l
JOIN vtruth v ON v.vehicle_id = l.id
JOIN lots_detail d ON d.slug = v.latest_slug
WHERE l.deleted_at IS NULL
  AND l.description_source = 'source_imported'
  AND l.description_len = 481
  AND d.description IS NOT NULL AND length(d.description) > 481
  AND l.id NOT IN (SELECT vehicle_id FROM has_raw);
SELECT count(*) AS vehicles, round(sum(text_len)/1e6, 1) AS text_mb, round(avg(text_len)) AS avg_len FROM descriptions;
