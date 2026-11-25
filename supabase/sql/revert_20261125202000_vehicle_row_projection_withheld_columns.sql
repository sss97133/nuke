-- REVERT of 20261125202000_vehicle_row_projection_withheld_columns.sql: restores the vehicle_row_public_projection body
-- that was live before it (read 2026-11-25 02:05 PT, sha256 of prosrc a7a24cb218d880a3879505453e90114a58d52eaeeb09bbddf9c08bf6be7de1ca).
-- Applying it REOPENS the leak: vehicle_row_read and get_vehicle_profile_data hand anon every vehicles column except the
-- five fixed masks, license_plate among them. Apply only through a migration that copies this file.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) AS j) r) m
$function$;
COMMIT;
