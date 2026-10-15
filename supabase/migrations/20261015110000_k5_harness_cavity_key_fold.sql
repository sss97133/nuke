-- RSI pass 22 on the harness model: wire ends are keyed to their cavity by a re-runnable fold. Case ledger 13.12.3.
--
-- RSI passes 2 (20261014123000) and 9 (20261014234500) keyed the K5's wire ends to the cited cavity library inline, once,
-- inside their migrations: the 61-pin halves by exact designator (case kept), the M130 / PDM Superseal plugs by number
-- when the cavity's letter is the plug's letter, and Deutsch DT / DTP plugs by the series and size in the plug's housing
-- part number. A wire end the registry loader inserts afterwards is never keyed. After the loader's run of 2026-10-15
-- (56 ends inserted, four wires' ends re-inserted) "wire ends keyed to a cavity" fell 344 -> 340 of 884.
--
-- This pass:
--   1. key_harness_wire_end_cavities(vehicle): the two passes' rules as one function, on live wire ends with no cavity
--      key yet; the housing part follows the cavity model (pass 2's rule). Idempotent; service role. The loader calls it
--      after key_harness_wire_ends.
--   2. One call now for the K5, so the ends the loader has already added are keyed.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.key_harness_wire_ends(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 6 (20261014163000) has not run';
  END IF;
  IF to_regprocedure('public.key_harness_wire_end_cavities(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'key_harness_wire_end_cavities already exists';
  END IF;
END $guard$;

CREATE FUNCTION public.key_harness_wire_end_cavities(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE keyed int; housed int; candidates int; unkeyed int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS cav_key (termination_id uuid PRIMARY KEY, model text, cavity_id text) ON COMMIT DROP;
  TRUNCATE cav_key;

  INSERT INTO cav_key
  SELECT t.id,
         CASE WHEN e.code IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE') AND t.connector_family = 'd38999_20' THEN 'MIL-DTL-38999 III 25-61'
              WHEN e.code ~ '^(M130|PDM30|PDM15)-A$' AND t.connector_family = 'ssc' THEN 'TE Superseal 1.0 34-way key 1'
              WHEN e.code ~ '^(M130|PDM30|PDM15)-B$' AND t.connector_family = 'ssc' THEN 'TE Superseal 1.0 26-way key 1'
              WHEN t.connector_family IN ('dt', 'dtp') AND x.series IS NOT NULL THEN 'Deutsch ' || x.series || ' ' || x.ways || '-way' END,
         CASE WHEN t.connector_family = 'd38999_20' THEN t.cavity
              WHEN t.connector_family = 'ssc' AND substring(t.cavity FROM '^([AB])0*[1-9][0-9]?$') = right(e.code, 1)
                THEN substring(t.cavity FROM '^[AB]0*([1-9][0-9]?)$')
              WHEN t.connector_family IN ('dt', 'dtp') AND substring(t.cavity FROM '^\s*([0-9]+)')::int BETWEEN 1 AND x.ways
                THEN substring(t.cavity FROM '^\s*([0-9]+)')::int::text END
  FROM public.wire_termination_specs t
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id
  LEFT JOIN LATERAL (
    SELECT m[1] AS series, m[2]::int AS ways
    FROM regexp_matches(upper(coalesce(e.part_number, '')), '\m(DTP|DT)0[46]-0?([0-9]+)', 'g') AS m
    LIMIT 1) x ON true
  WHERE t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false) AND t.cavity_layout_id IS NULL;
  DELETE FROM cav_key WHERE model IS NULL OR cavity_id IS NULL;
  SELECT count(*) INTO candidates FROM cav_key;

  UPDATE public.wire_termination_specs t SET cavity_layout_id = l.id
  FROM cav_key k JOIN public.connector_cavity_layouts l ON l.connector_model = k.model AND l.cavity_id = k.cavity_id
  WHERE t.id = k.termination_id AND t.cavity_layout_id IS NULL;
  GET DIAGNOSTICS keyed = ROW_COUNT;

  UPDATE public.wire_termination_specs t SET connector_housing_catalog_id = l.housing_part_id
  FROM (SELECT DISTINCT termination_id, model FROM cav_key) k
  JOIN (SELECT DISTINCT connector_model, housing_part_id FROM public.connector_cavity_layouts WHERE housing_part_id IS NOT NULL) l
    ON l.connector_model = k.model
  WHERE t.id = k.termination_id AND t.connector_housing_catalog_id IS NULL;
  GET DIAGNOSTICS housed = ROW_COUNT;

  SELECT count(*) INTO unkeyed FROM public.wire_termination_specs t
  WHERE t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false) AND t.cavity_layout_id IS NULL;
  RETURN jsonb_build_object('ends_keyed', keyed, 'housings_keyed', housed, 'ends_with_a_keyable_cavity', candidates,
                            'live_ends_without_a_cavity_key', unkeyed);
END $fn$;
COMMENT ON FUNCTION public.key_harness_wire_end_cavities(uuid) IS 'Keys a vehicle''s live wire ends to the cited cavity library (connector_cavity_layouts) where they have no key yet: the 61-pin halves by exact designator (case kept), M130 / PDM Superseal plugs by number when the cavity''s letter is the plug''s letter, Deutsch DT / DTP plugs by the series and size in the plug''s housing part number; the housing part follows the cavity model. The rules of RSI passes 2 and 9, re-runnable. Idempotent; returns counts. The registry loader calls it after key_harness_wire_ends. RSI pass 22, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.key_harness_wire_end_cavities(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_harness_wire_end_cavities(uuid) TO service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'key', 'function', 'key_harness_wire_end_cavities', NULL, 'wire ends keyed to their cavity after every loader run');

DO $check$
DECLARE r jsonb;
BEGIN
  r := public.key_harness_wire_end_cavities('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 22 on the K5: %', r;
END $check$;

COMMIT;
