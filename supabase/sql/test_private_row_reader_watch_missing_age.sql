-- Contract: 20261126013700 private_row_watch_missing_age_v1, on the reader-probe fixture with the policy-copy table
-- (20261125204500) and the budget watch (20261125235500). A probe or copy reading missing for less than
-- missing_after_hours is silent; past it the watch fails naming it; a present probe however old is never listed; the
-- config row moves the age; the watch is replaced only over the budget watch's body. Synthetic rows only.
\ir test_private_row_reader_probes.sql
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
\ir ../migrations/20261125204500_private_row_policy_copy_drift.sql
\ir ../migrations/20261125235500_private_row_watch_budget.sql
\ir ../migrations/20261126013700_private_row_watch_missing_age.sql
\ir ../migrations/20261126013700_private_row_watch_missing_age.sql

-- the fixture's tables carry other policies than production, so every copy but the reader-less one reads drifted:
-- leave only that one active, and the watch raises only for the age rule
UPDATE public.private_row_policy_copies SET active = (reader = 'vehicle_plates_read(uuid[])');
DO $$
DECLARE r jsonb; msg text;
BEGIN
  IF (SELECT (config_value->>'missing_after_hours')::int FROM public.platform_config WHERE config_key = 'private_row_watch') <> 72 THEN
    RAISE EXCEPTION 'FAIL: missing_after_hours not 72';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_row_probes p WHERE p.active AND p.relation = 'image_tags')
     OR to_regclass('public.image_tags') IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE: expected an active probe on image_tags, a relation this database lacks';
  END IF;
  IF to_regprocedure('public.vehicle_plates_read(uuid[])') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.private_row_policy_copies WHERE reader = 'vehicle_plates_read(uuid[])') THEN
    RAISE EXCEPTION 'FIXTURE: expected the vehicle_plates_read copy with no reader';
  END IF;

  -- everything registered just now: missing rows are silent
  r := public.private_row_exposure_watch();
  IF jsonb_array_length(r->'missing_too_long') <> 0 OR r->>'line' LIKE '%missing too long%' THEN
    RAISE EXCEPTION 'FAIL: young missing rows listed: %', r->'missing_too_long';
  END IF;

  -- a missing probe and a missing copy past 72 h fail the watch by name; a present probe past 72 h does not
  UPDATE public.private_row_probes SET added_at = now() - interval '100 hours' WHERE relation IN ('image_tags');
  UPDATE public.private_row_probes SET added_at = now() - interval '100 hours' WHERE reader = 'get_field_provenance';
  UPDATE public.private_row_policy_copies SET first_recorded_at = now() - interval '100 hours'
   WHERE reader IN ('vehicle_plates_read(uuid[])', 'get_field_provenance(uuid,text)');  -- the second is inactive
  BEGIN
    PERFORM public.private_row_exposure_watch();
    RAISE EXCEPTION 'FAIL: watch green with rows missing past the age';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg LIKE 'FAIL:%' THEN RAISE; END IF;
    IF msg NOT LIKE 'private rows: exposed 0 of % probed, not assessed 0, missing too long 2: missing over 72 h: %'
       OR msg NOT LIKE '%image_tags%' OR msg NOT LIKE '%vehicle_plates_read(uuid[]) policy copy of vehicles%'
       OR msg LIKE '%get_field_provenance%' THEN
      RAISE EXCEPTION 'FAIL: message %', msg;
    END IF;
  END;

  -- a re-record (recorded_at = now(), as #3955 does) does not restart the clock of a copy whose reader is absent
  UPDATE public.private_row_policy_copies SET recorded_at = now() WHERE reader = 'vehicle_plates_read(uuid[])';
  BEGIN
    PERFORM public.private_row_exposure_watch();
    RAISE EXCEPTION 'FAIL: a re-record restarted the age (watch green)';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg LIKE 'FAIL:%' THEN RAISE; END IF;
    IF msg NOT LIKE '%vehicle_plates_read(uuid[]) policy copy of vehicles%' THEN
      RAISE EXCEPTION 'FAIL: a re-record restarted the age: %', msg;
    END IF;
  END;
  -- a copy registered now carries first_recorded_at now (the default), so it is young
  IF (SELECT count(*) FROM public.private_row_policy_copies WHERE first_recorded_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL: first_recorded_at not backfilled';
  END IF;

  -- the config row moves the age
  UPDATE public.platform_config SET config_value = config_value || '{"missing_after_hours": 200}' WHERE config_key = 'private_row_watch';
  r := public.private_row_exposure_watch();
  IF jsonb_array_length(r->'missing_too_long') <> 0 OR (r->>'missing_after_hours')::int <> 200 THEN
    RAISE EXCEPTION 'FAIL: 200 h still lists %', r->'missing_too_long';
  END IF;
  -- an inactive row is never listed
  UPDATE public.platform_config SET config_value = config_value || '{"missing_after_hours": 72}' WHERE config_key = 'private_row_watch';
  UPDATE public.private_row_probes SET active = false WHERE relation = 'image_tags';
  UPDATE public.private_row_policy_copies SET active = false WHERE reader = 'vehicle_plates_read(uuid[])';
  r := public.private_row_exposure_watch();
  IF jsonb_array_length(r->'missing_too_long') <> 0 THEN RAISE EXCEPTION 'FAIL: inactive rows listed %', r->'missing_too_long'; END IF;
END $$;

-- the replacement refuses a body it does not know
CREATE OR REPLACE FUNCTION public.private_row_exposure_watch() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126013700_private_row_watch_missing_age.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.private_row_exposure_watch()'::regprocedure) NOT LIKE '%SELECT ''{}''::jsonb%' THEN
    RAISE EXCEPTION 'FAIL: watch replaced over an unknown body';
  END IF;
END $$;
SELECT 'private_row_watch_missing_age: ok';
