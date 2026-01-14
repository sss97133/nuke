-- Relax overly-strict uniqueness on vehicle_listings.
-- Previous UNIQUE(vehicle_id, status) prevented multiple historical listings (e.g. multiple expired auctions).

ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_vehicle_id_status_key;

-- The backing index is usually dropped with the constraint, but keep this defensive.
DROP INDEX IF EXISTS public.vehicle_listings_vehicle_id_status_key;

-- Optional: old non-unique partial index becomes redundant once we add a unique one.
DROP INDEX IF EXISTS public.idx_vehicle_listings_vehicle_status;

-- Enforce at most one draft listing per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_listings_one_draft_per_vehicle
  ON public.vehicle_listings (vehicle_id)
  WHERE status = 'draft';

-- Enforce at most one active listing per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_listings_one_active_per_vehicle
  ON public.vehicle_listings (vehicle_id)
  WHERE status = 'active';

