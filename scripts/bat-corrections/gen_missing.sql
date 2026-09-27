-- gen_missing.sql — BaT lots with no live vehicles row reachable by URL (bat_auction_url / listing_url /
-- discovery_url). These go to the deployed reader (extract-bat-core v4) by URL; the reader resolves a
-- relisting by VIN itself before creating a vehicle. Newest first: recent sales are the comps that
-- matter, and the outage gap (closed since 2025-08-01) is where the market read is blind today.
CREATE OR REPLACE TABLE missing AS
SELECT t.slug, t.canonical_url, t.sold, t.end_ts, t.kind, t.has_detail, t.vin, t.title,
       EXISTS (SELECT 1 FROM live l WHERE l.deleted_at IS NULL AND l.vin IS NOT NULL AND upper(trim(l.vin)) = t.vin) AS vin_matches_live_vehicle
FROM truth t
WHERE t.slug <> ''
  AND NOT EXISTS (SELECT 1 FROM vlots v WHERE v.slug = t.slug);
SELECT count(*) AS missing_lots, count(*) FILTER (WHERE sold) AS sold, count(*) FILTER (WHERE kind = 'car') AS cars,
       count(*) FILTER (WHERE end_ts >= '2025-08-01') AS closed_since_aug_2025, count(*) FILTER (WHERE vin_matches_live_vehicle) AS vin_relistings,
       count(*) FILTER (WHERE has_detail) AS page_in_archive
FROM missing;
