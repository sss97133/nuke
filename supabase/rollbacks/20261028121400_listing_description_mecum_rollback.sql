update public.vehicle_listing_description set retired_at = now() where retired_at is null and run_id = 'listing_description_mecum_v1_20261025';
