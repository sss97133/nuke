-- Revert 20261123121500_project_photo_keys_from_readings.sql.
-- Restores automatic.admits rust/paint lists from 20261120140000. Does not delete
-- any vehicle_observations: run revert_project_photo_keys_v1 for each recorded
-- apply run first, or leave those rows current.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

UPDATE public.platform_config
SET config_value = jsonb_set(
      jsonb_set(config_value,
        '{automatic,admits,rust_severity}',
        '["surface"]'::jsonb),
      '{automatic,admits,paint_state}',
      '[]'::jsonb)
WHERE config_key = 'image_reading_tiers';

DROP FUNCTION IF EXISTS public.revert_project_photo_keys_v1(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.record_project_photo_keys_v1(uuid, uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.project_photo_keys_v1(uuid, uuid, uuid, boolean, integer, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.project_photo_keys_signature_v1();
DROP TABLE IF EXISTS public.photo_key_projection_items;
DROP TABLE IF EXISTS public.photo_key_projection_runs;
