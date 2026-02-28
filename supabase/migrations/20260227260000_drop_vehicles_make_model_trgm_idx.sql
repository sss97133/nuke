-- Drop the GIN trigram index on vehicles(make||model) that is no longer needed
DROP INDEX IF EXISTS public.idx_vehicles_make_model_trgm;
