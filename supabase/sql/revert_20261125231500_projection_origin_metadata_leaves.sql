-- REVERT of 20261125231500_projection_origin_metadata_leaves.sql: restores the vehicle_row_public_projection body of
-- 20261125202000 (sha256 of prosrc d72ab841ab9c56dea9e1e4773141e021e979d3c8c0d413057c715831d2e8514d), which redacts
-- emails only, over origin_metadata's serialized text. contact_redaction_rules and the three helper functions are left in
-- place (unused). Apply only through a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- vehicle_row_projection_withheld_columns_v1: a vehicles column the request role cannot SELECT is null here.
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'])
                || coalesce((
                  SELECT pg_catalog.jsonb_object_agg(a.attname::text, 'null'::jsonb)
                  FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                    AND jsonb_typeof(p_row) = 'object' AND jsonb_typeof(p_row -> a.attname::text) <> 'null'
                    AND NOT pg_catalog.has_column_privilege(
                      (SELECT CASE auth.role() WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END),
                      a.attrelid, a.attnum, 'SELECT')), '{}'::jsonb) AS j) r) m
$function$;
COMMIT;
