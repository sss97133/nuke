-- Contract for 20261124193900_code_reading_polarity (empty disposable PG17; dependencies stubbed, fixtures synthetic).
-- Asserts: asserted / negated / changed_from / candidates by rule rows around the span, 0- and 1-based offsets, an
-- unreadable origin is asserted; data_set_code_candidates_v1 drops non-asserted spans of exclusive kinds only; idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, description text, listing_title text, title text, highlights text,
  bat_listing_title text, equipment text, modifications text, numbers_quote text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, content_text text);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY, comment_text text);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY, proposed_value text);
CREATE TABLE public.vehicle_code_readings (id uuid PRIMARY KEY, vehicle_id uuid, kind text, code text, state text,
  origin_table text, origin_id uuid, origin_column text, match_offset int, match_text text);
CREATE TABLE public.data_set_kind_properties (set_kind text PRIMARY KEY, exclusive boolean);
INSERT INTO public.data_set_kind_properties VALUES ('trans_type', true), ('trans_speeds', true), ('rpo_code', false);
CREATE FUNCTION public.data_set_code_candidates_v1(p_vehicles uuid[], p_kinds text[] DEFAULT NULL)
RETURNS TABLE(set_kind text, code text, basis_id uuid) LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH crd AS (
    SELECT r.id, r.kind, r.code
      FROM public.vehicle_code_readings r
     WHERE r.state = 'active' AND (p_kinds IS NULL OR r.kind = ANY (p_kinds))),
  keyed AS (SELECT * FROM crd WHERE true)
  SELECT k.kind, k.code, k.id FROM keyed k
$function$;

-- 0-based offsets in the observation text, 1-based in the vehicle description (both occur live).
INSERT INTO public.vehicles (id, make, description) VALUES ('10000000-0000-0000-0000-000000000001', 'Pontiac',
  'It now runs a 4-speed manual. The Turbo 400 was swapped out. 3-speed standard shift. Converted from a TH400 years ago.');
INSERT INTO public.vehicle_observations VALUES ('0b000000-0000-0000-0000-000000000001',
  'The chart lists a 3-speed manual standard and Hydra-matic optional. Not a 5-speed. M20 or M21 by the pin; RPO M21 listed.');
INSERT INTO public.vehicle_code_readings VALUES
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'trans_speeds', '4', 'active', 'vehicles', '10000000-0000-0000-0000-000000000001', 'description', 15, '4-speed'),
 ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'trans_type', 'AUTOMATIC', 'active', 'vehicles', '10000000-0000-0000-0000-000000000001', 'description', 35, 'Turbo 400'),
 ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'trans_speeds', '3', 'active', 'vehicles', '10000000-0000-0000-0000-000000000001', 'description', 62, '3-speed'),
 ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'trans_type', 'AUTOMATIC', 'active', 'vehicles', '10000000-0000-0000-0000-000000000001', 'description', 103, 'TH400'),
 ('c0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'trans_speeds', '3', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-000000000001', 'content_text', 18, '3-speed'),
 ('c0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'trans_type', 'AUTOMATIC', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-000000000001', 'content_text', 46, 'Hydra-matic'),
 ('c0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'trans_speeds', '5', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-000000000001', 'content_text', 74, '5-speed'),
 ('c0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'trans_type', 'MANUAL', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-000000000001', 'content_text', 83, 'M20'),
 ('c0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'rpo_code', 'M21', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-000000000001', 'content_text', 110, 'M21'),
 ('c0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'trans_type', 'MANUAL', 'active', 'vehicle_observations', '0b000000-0000-0000-0000-00000000dead', 'content_text', 3, 'Muncie');

\ir ../migrations/20261124193900_code_reading_polarity.sql
\ir ../migrations/20261124193900_code_reading_polarity.sql

DO $$
DECLARE got text; adm text;
BEGIN
  SELECT string_agg(right(id::text, 2) || '=' || public.code_reading_polarity_v1(id), ',' ORDER BY id) INTO got FROM public.vehicle_code_readings;
  ASSERT got = '01=asserted,02=changed_from,03=asserted,04=changed_from,05=candidates,06=candidates,07=negated,08=candidates,09=asserted,10=asserted',
    'polarity by rule rows; got ' || got;
  SELECT string_agg(right(basis_id::text, 2), ',' ORDER BY basis_id) INTO adm
    FROM public.data_set_code_candidates_v1(ARRAY['10000000-0000-0000-0000-000000000001'::uuid]);
  ASSERT adm = '01,03,09,10', 'exclusive kinds admit asserted spans only; rpo_code (not exclusive) unchanged; got ' || adm;
  ASSERT (SELECT count(*) FROM public.code_reading_polarity_rules) = 7, 'seven rule rows, re-run idempotent';
  ASSERT NOT has_function_privilege('anon', 'public.code_reading_polarity_v1(uuid)', 'EXECUTE'), 'anon cannot execute';
END $$;
\echo code_reading_polarity: ok
