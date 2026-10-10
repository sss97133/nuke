-- Enable the retained-target handoff inside the existing feed invocation.
-- The worker defaults this new lane to zero until this approved control change
-- is applied. Preserve global/source pauses, explicit target settings, cron
-- cadence and the existing total admission ceiling.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $target_controls$
DECLARE
  v_config jsonb;
BEGIN
  SELECT config_value INTO v_config FROM public.platform_config
    WHERE config_key = 'source_intake';
  IF FOUND THEN
    IF jsonb_typeof(v_config) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Existing intake controls are malformed; preserve the current hold';
    END IF;
    IF v_config ? 'targets' THEN
      RETURN; -- an explicit operator setting, including zero, takes precedence
    END IF;
  END IF;

  INSERT INTO public.platform_config (config_key, config_value, description)
  VALUES ('source_intake',
    '{"targets":{"enabled":true,"max_ingests":2,"scan_limit":200}}'::jsonb,
    'Shared feed/queue admission controls; retained native targets use at most two remaining slots')
  ON CONFLICT (config_key) DO UPDATE
    SET config_value = public.platform_config.config_value || EXCLUDED.config_value,
        updated_at = now()
    WHERE NOT (public.platform_config.config_value ? 'targets');
END
$target_controls$;

COMMIT;
