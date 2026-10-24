-- revert perf_idx_v1_20261024 (run with psql -f, outside a transaction)
drop index concurrently if exists public.idx_vehicle_events_platform_listing_id;
drop index concurrently if exists public.idx_vehicle_events_attach_basis_cited;
