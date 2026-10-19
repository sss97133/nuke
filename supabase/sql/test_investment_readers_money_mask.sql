-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_investment -f this-file.sql
-- Proves that the investment proof and the investment timeline carry the owner's money only to the
-- signed-in owner, uploader or contributor, mask it for every other caller while keeping counts, dates,
-- kinds and the modeled market estimate, and read as NULL for a private vehicle the caller may not see.
-- Starts from the live definitions, then applies the migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The tables and helpers the two readers touch, with the columns they read.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT true, purchase_price numeric, purchase_date date);
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, vendor_name text,
  total numeric, total_amount numeric, receipt_date date, transaction_date date, purchase_date date, superseded_at timestamptz);
CREATE TABLE public.payment_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_type text, scope_id uuid,
  direction text, amount_usd numeric, method text, is_superseded boolean NOT NULL DEFAULT false,
  counterparty_name text, confirmation_number text, description text, paid_at timestamptz);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, session_date date,
  total_job_cost numeric, owner_confirmed_at timestamptz);
CREATE TABLE public.nuke_estimates (vehicle_id uuid, estimated_value numeric, confidence_score numeric);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, status text);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
CREATE FUNCTION public.resolve_labor_rate(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT '{"rate": 95, "rate_confidence": "reported", "source": "shop rate card", "note": "owner reported"}'::jsonb $$;
CREATE FUNCTION public.compute_active_minutes_burst_total(p_vehicle_id uuid, p_gap integer) RETURNS bigint LANGUAGE sql STABLE AS
$$ SELECT 120::bigint $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

\ir helpers/compute_vehicle_investment_proof_live_20261013.sql
\ir helpers/get_vehicle_investment_timeline_live_20261013.sql
GRANT EXECUTE ON FUNCTION public.compute_vehicle_investment_proof(uuid), public.get_vehicle_investment_timeline(uuid) TO anon, authenticated;
\ir ../migrations/20261013170000_investment_readers_money_owner_only.sql

-- Seeds (a disposable database, never production): a public vehicle (owner u1, uploader u2, contributor u6)
-- bought for 15000 with two dated receipts, one undated receipt, one payment out, one attested payment,
-- one confirmed work session and a modeled estimate; a private vehicle (user u4).
INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', NULL, NULL, '20000000-0000-0000-0000-000000000002', true, 15000, '2024-06-01'),
 ('10000000-0000-0000-0000-000000000004', NULL, '20000000-0000-0000-0000-000000000004', NULL, NULL, false, 5000, '2025-01-01');
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'active');
INSERT INTO public.receipts (vehicle_id, vendor_name, total, total_amount, receipt_date) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Summit Racing', 120.50, 120.50, '2025-01-24'),
 ('10000000-0000-0000-0000-000000000001', 'Rock Auto', 79.50, NULL, '2025-02-10'),
 ('10000000-0000-0000-0000-000000000001', 'Swap meet', 40, NULL, NULL),
 ('10000000-0000-0000-0000-000000000004', 'Private vendor', 10, NULL, '2025-02-01');
INSERT INTO public.payment_events (scope_type, scope_id, direction, amount_usd, method, counterparty_name, paid_at) VALUES
 ('vehicle', '10000000-0000-0000-0000-000000000001', 'out', 300, 'card', 'Shop A', '2025-01-30T00:00:00Z'),
 ('vehicle', '10000000-0000-0000-0000-000000000001', 'out', 50, 'owner_attestation', 'Shop B', '2025-02-01T00:00:00Z');
INSERT INTO public.work_sessions (vehicle_id, session_date, total_job_cost, owner_confirmed_at) VALUES
 ('10000000-0000-0000-0000-000000000001', '2025-01-24', 420.50, '2025-01-25T00:00:00Z');
INSERT INTO public.nuke_estimates VALUES ('10000000-0000-0000-0000-000000000001', 112200, 0.8);

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;

-- 1. Anonymous reader: the owner's figures masked, counts and the market estimate kept.
SET ROLE anon;
DO $$
DECLARE p jsonb; t jsonb;
BEGIN
  p := public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(p->'money_masked' = 'true'::jsonb AND p->'is_owner_view' = 'false'::jsonb, 'anon: proof masked');
  PERFORM public.t_assert(p->'proven'->'parts'->'value' = 'null'::jsonb AND (p->'proven'->'parts'->>'count')::int = 3
    AND p->'proven'->'parts'->>'source' = 'receipts', format('anon: parts value masked, count and source kept; got %s', p->'proven'->'parts'));
  PERFORM public.t_assert(p->'proven'->'confirmed_labor'->'value' = 'null'::jsonb AND p->'proven'->'money_out'->'value' = 'null'::jsonb
    AND p->'attributed'->'cost'->'value' = 'null'::jsonb, 'anon: labor, money out and attributed cost masked');
  PERFORM public.t_assert(p->'projected'->'labor'->'value' = 'null'::jsonb AND p->'projected'->'labor'->'method' = 'null'::jsonb
    AND p->'projected'->'labor'->'rate_note' = 'null'::jsonb AND (p->'projected'->'labor'->>'count')::int = 1,
    format('anon: projected labor value, rate method and note masked; got %s', p->'projected'->'labor'));
  PERFORM public.t_assert((p->'market'->>'value')::numeric = 112200 AND p->'market'->>'confidence' = 'modeled', 'anon: the modeled market estimate stays');
  PERFORM public.t_assert(p->'totals'->'invested_proven' = 'null'::jsonb AND p->'totals'->'invested_with_projected' = 'null'::jsonb
    AND p->'totals'->'net_proven' = 'null'::jsonb AND p->'totals'->'roi_proven_pct' = 'null'::jsonb, format('anon: totals masked; got %s', p->'totals'));
  PERFORM public.t_assert(p->'by_party' = '[]'::jsonb AND p->'audit' = '{}'::jsonb, 'anon: no party or audit detail, as before');

  t := public.get_vehicle_investment_timeline('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(t->'money_masked' = 'true'::jsonb AND (t->>'n_points')::int = 3, format('anon: timeline masked, three points kept; got %s', t));
  PERFORM public.t_assert(t->'points'->0->'delta' = 'null'::jsonb AND t->'points'->0->'cumulative' = 'null'::jsonb
    AND t->'points'->0->>'date' = '2024-06-01' AND t->'points'->0->>'kind' = 'purchase' AND t->'points'->0->'source' = 'null'::jsonb,
    format('anon: point amounts masked, date and kind kept; got %s', t->'points'->0));
  PERFORM public.t_assert(t->'points'->2->'delta' = 'null'::jsonb AND t->'points'->2->>'kind' = 'parts', 'anon: receipt points masked');
  PERFORM public.t_assert(t->'baseline'->'delta' = 'null'::jsonb AND t->'baseline'->>'date' = '2024-06-01', 'anon: baseline amount masked, date kept');
  PERFORM public.t_assert(t->'undated'->'undated_total' = 'null'::jsonb AND (t->'undated'->>'n_undated')::int = 1
    AND t->'final_cumulative_dated' = 'null'::jsonb AND t->'total_with_undated' = 'null'::jsonb, format('anon: undated and overall totals masked; got %s', t));

  PERFORM public.t_assert(public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000004') IS NULL, 'anon: a private proof reads as NULL');
  PERFORM public.t_assert(public.get_vehicle_investment_timeline('10000000-0000-0000-0000-000000000004') IS NULL, 'anon: a private timeline reads as NULL');
END $$;
RESET ROLE;

-- 2. Signed-in readers.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE p jsonb; t jsonb;
BEGIN
  p := public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(p->'money_masked' = 'false'::jsonb AND p->'is_owner_view' = 'true'::jsonb, 'owner: proof unmasked');
  PERFORM public.t_assert((p->'proven'->'parts'->>'value')::numeric = 240 AND (p->'proven'->'confirmed_labor'->>'value')::numeric = 421
    AND (p->'proven'->'money_out'->>'value')::numeric = 300 AND (p->'attributed'->'cost'->>'value')::numeric = 50,
    format('owner: proven and attributed figures present; got %s', p->'proven'));
  PERFORM public.t_assert((p->'totals'->>'invested_proven')::numeric = 961 AND p->'projected'->'labor'->>'method' LIKE 'burst 120 min%'
    AND jsonb_array_length(p->'by_party') = 2 AND jsonb_array_length(p->'audit'->'receipts') = 3, format('owner: totals, method, parties and audit present; got %s', p->'totals'));
  t := public.get_vehicle_investment_timeline('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(t->'money_masked' = 'false'::jsonb AND (t->'points'->0->>'delta')::numeric = 15000
    AND (t->>'final_cumulative_dated')::numeric = 15200 AND (t->>'total_with_undated')::numeric = 15240
    AND t->'points'->1->>'source' = 'Summit Racing', format('owner: curve amounts and sources present; got %s', t));
END $$;
SET test.auth_uid = '20000000-0000-0000-0000-000000000002';
SELECT public.t_assert(public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000001')->'money_masked' = 'false'::jsonb, 'uploader sees money');
SET test.auth_uid = '20000000-0000-0000-0000-000000000006';
SELECT public.t_assert(public.get_vehicle_investment_timeline('10000000-0000-0000-0000-000000000001')->'money_masked' = 'false'::jsonb, 'contributor sees money');
SET test.auth_uid = '20000000-0000-0000-0000-000000000009';
SELECT public.t_assert(public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000001')->'money_masked' = 'true'::jsonb, 'a stranger is masked');
SELECT public.t_assert(public.compute_vehicle_investment_proof('10000000-0000-0000-0000-000000000004') IS NULL, 'a stranger cannot read a private proof');
SET test.auth_uid = '20000000-0000-0000-0000-000000000004';
SELECT public.t_assert((public.get_vehicle_investment_timeline('10000000-0000-0000-0000-000000000004')->>'total_with_undated')::numeric = 5010, 'a private vehicle reads for its user, with money');
RESET ROLE;

-- 3. The masker alone.
SELECT public.t_assert(public.jsonb_mask_keys('{"a": {"value": 5, "count": 2, "items": [{"delta": 1, "date": "d"}]}, "value": 9}'::jsonb, ARRAY['value', 'delta'])
  = '{"a": {"value": null, "count": 2, "items": [{"delta": null, "date": "d"}]}, "value": null}'::jsonb, 'masker nulls the named keys at every depth and keeps the rest');
SELECT 'investment readers money mask contract: PASS' AS result;
