-- Compact full-metadata compare-and-swap token for the existing episode writer.
-- The row is already subject to its normal table permissions/RLS. This function
-- reads only, is not SECURITY DEFINER, and is executable only by service_role.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
CREATE OR REPLACE FUNCTION public.vehicle_event_metadata_digest(public.vehicle_events)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(
    CASE WHEN ($1).metadata IS NULL THEN 'SQL_NULL'
         ELSE 'JSONB:' || ($1).metadata::text END, 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public.vehicle_event_metadata_digest(public.vehicle_events) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_event_metadata_digest(public.vehicle_events) TO service_role;
COMMENT ON FUNCTION public.vehicle_event_metadata_digest(public.vehicle_events) IS
  'Service-only PostgREST computed field: SHA256 token for full metadata CAS without putting gallery JSON in a request URL. SQL NULL differs from JSON null.';
NOTIFY pgrst, 'reload schema';
COMMIT;
