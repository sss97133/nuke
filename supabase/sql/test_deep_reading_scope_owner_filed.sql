-- Contract for 20261123220000_deep_reading_scope_owner_filed.sql on a fresh
-- disposable database. The first-car scope row becomes the owner's filed
-- photos (vehicle_ids omitted, max_open 5); image_stage_scope_ok then admits
-- the owner's other cars and still refuses excluded cars, another user, and
-- an unfiled photo. A second apply is a no-op; the revert restores the
-- first-car row. The migration itself does not enqueue.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.platform_config') IS NOT NULL THEN
    RAISE EXCEPTION 'needs an empty disposable database';
  END IF;
END $$;

CREATE TABLE public.platform_config (
  config_key text PRIMARY KEY,
  config_value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- Production's body (20261120130000).
CREATE FUNCTION public.image_stage_scope_ok(p_cfg jsonb, p_user_id uuid, p_vehicle_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(CASE
    WHEN p_cfg IS NULL OR p_user_id IS NULL OR p_vehicle_id IS NULL THEN false
    WHEN p_cfg -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN false
    WHEN jsonb_typeof(p_cfg -> 'user_ids') IS DISTINCT FROM 'array' THEN false
    WHEN NOT (p_cfg -> 'user_ids' ? p_user_id::text) THEN false
    WHEN jsonb_typeof(p_cfg -> 'exclude_vehicle_ids') = 'array' AND (p_cfg -> 'exclude_vehicle_ids' ? p_vehicle_id::text) THEN false
    WHEN jsonb_typeof(p_cfg -> 'vehicle_ids') = 'array' THEN (p_cfg -> 'vehicle_ids' ? p_vehicle_id::text)
    ELSE true END, false) $$;

CREATE FUNCTION public.t_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT config_value FROM public.platform_config WHERE config_key = 'image_stage_deep_reading' $$;
CREATE FUNCTION public.t_ok(p_user uuid, p_vehicle uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.image_stage_scope_ok(public.t_scope(), p_user, p_vehicle) $$;
CREATE FUNCTION public.t_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ok THEN RAISE EXCEPTION 'assert failed: %', msg; END IF;
END $$;

CREATE TABLE public.t_expected(name text PRIMARY KEY, v jsonb);
INSERT INTO public.t_expected VALUES
 ('from', '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}'),
 ('to', '{"enabled": true, "max_open": 5,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}');

-- An unrecognized row is refused and left unchanged.
INSERT INTO public.platform_config(config_key, config_value) VALUES
  ('image_stage_deep_reading', '{"enabled": true, "max_open": 1, "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"]}');
DO $$
DECLARE
  v_old jsonb;
  v_from jsonb := (SELECT v FROM public.t_expected WHERE name = 'from');
  v_to jsonb := (SELECT v FROM public.t_expected WHERE name = 'to');
BEGIN
  SELECT config_value INTO v_old FROM public.platform_config WHERE config_key = 'image_stage_deep_reading';
  IF v_old IS NOT DISTINCT FROM v_to OR v_old IS NOT DISTINCT FROM v_from THEN
    RAISE EXCEPTION 'fixture: expected an unrecognized row';
  END IF;
  BEGIN
    -- The same refusal the migration raises (the file itself is applied only to the first-car row below).
    RAISE EXCEPTION 'platform_config image_stage_deep_reading is not the first-car row this migration was written against; refusing to replace it: %', v_old;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not the first-car row%' THEN RAISE; END IF;
  END;
  PERFORM public.t_assert(public.t_scope() = '{"enabled": true, "max_open": 1, "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"]}'::jsonb,
    'unrecognized row is not replaced');
END $$;

UPDATE public.platform_config
   SET config_value = (SELECT v FROM public.t_expected WHERE name = 'from')
 WHERE config_key = 'image_stage_deep_reading';

\ir ../migrations/20261123220000_deep_reading_scope_owner_filed.sql

SELECT public.t_assert(public.t_scope() = (SELECT v FROM public.t_expected WHERE name = 'to'),
  'scope row drops vehicle_ids and sets max_open 5');
SELECT public.t_assert(NOT (public.t_scope() ? 'vehicle_ids'), 'vehicle_ids key is absent, not empty');
SELECT public.t_assert((public.t_scope() ->> 'max_open')::int = 5, 'max_open is 5');

SELECT public.t_assert(public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '67127bcb-1f2b-4472-ae4f-a2b86825027b'),
  'canary Mustang stays in scope');
SELECT public.t_assert(public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '80e04dd6-983e-4c78-ba15-c0599e50ecd9'),
  'K10 enters scope once vehicle_ids is omitted');
SELECT public.t_assert(public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '1b16f3ec-97c6-4826-b1af-89c8c4687e7b'),
  'Chevelle enters scope');
SELECT public.t_assert(public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '20d21fb0-4651-4469-a0ba-e751309a1e54'),
  'Firebird enters scope');
SELECT public.t_assert(NOT public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '7b0e02b9-42af-4998-b27d-69e3459b452b'),
  'excluded vehicle stays out');
SELECT public.t_assert(NOT public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '1e9fdf16-b453-44a9-8b74-46bbe886625a'),
  'second excluded vehicle stays out');
SELECT public.t_assert(NOT public.t_ok('11111111-1111-1111-1111-111111111111', '80e04dd6-983e-4c78-ba15-c0599e50ecd9'),
  'another user stays out');
SELECT public.t_assert(NOT public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', NULL),
  'an unfiled photo stays out');

-- Applying again is a no-op.
\ir ../migrations/20261123220000_deep_reading_scope_owner_filed.sql
SELECT public.t_assert(public.t_scope() = (SELECT v FROM public.t_expected WHERE name = 'to'),
  'second apply leaves the owner-filed row');

\ir ../migrations/20261123220001_deep_reading_scope_owner_filed_revert.sql
SELECT public.t_assert(public.t_scope() = (SELECT v FROM public.t_expected WHERE name = 'from'),
  'revert restores the first-car row');
SELECT public.t_assert(public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '67127bcb-1f2b-4472-ae4f-a2b86825027b'),
  'after revert the canary is in');
SELECT public.t_assert(NOT public.t_ok('0b9f107a-d124-49de-9ded-94698f63c1c4', '80e04dd6-983e-4c78-ba15-c0599e50ecd9'),
  'after revert the K10 is out again');
