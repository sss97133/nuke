-- Revert v12 schema (run only on Skylar's call). Rows are identified by run_id; no data deletes needed otherwise.
drop table if exists public.vehicle_event_listing_mileage;
alter table public.auction_event_listing_mileage drop constraint if exists auction_event_listing_mileage_has_source;
-- only valid once no row relies solely on source_snapshot_id:
alter table public.auction_event_listing_mileage
  add constraint auction_event_listing_mileage_has_source check (source_observation_id is not null or source_vehicle_id is not null) not valid;
alter table public.auction_event_listing_mileage drop column if exists source_snapshot_id;
