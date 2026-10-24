-- Additive: allow a cited fallback source for listing-time mileage (vehicles.mileage extracted from the vehicle's only BaT listing).
-- Revert: covered by supabase/sql/revert_shadow_v10.sql (table drop); or delete nothing and filter method <> 'vehicles_mileage_single_bat_sale_v1'.
alter table public.auction_event_listing_mileage
  alter column source_observation_id drop not null,
  add column if not exists source_vehicle_id uuid references public.vehicles(id),
  add column if not exists validation jsonb;
alter table public.auction_event_listing_mileage
  add constraint auction_event_listing_mileage_has_source
  check (source_observation_id is not null or source_vehicle_id is not null);
