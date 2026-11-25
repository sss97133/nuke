-- Contract for 20261124194600_settle_due_and_backfill_pace (empty disposable PG17; the settle stubbed to record its calls).
-- Asserts: only vehicles with non-rejected ai_visual rows are visited, in id order from the cursor, at most p_limit a run,
-- the cursor wraps; totals accumulate; idempotent re-apply.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.field_evidence') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text, status text);
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text, updated_at timestamptz);
CREATE TABLE public._calls (vehicle_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.field_evidence_rank_settle_v1(p_vehicle_id uuid, p_dry_run boolean DEFAULT true, p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN INSERT INTO public._calls (vehicle_id) VALUES (p_vehicle_id); RETURN jsonb_build_object('fields', 1, 'rows_rejected', 2); END $f$;
INSERT INTO public.field_evidence (vehicle_id, source_type, status) VALUES
 ('10000000-0000-0000-0000-000000000001', 'ai_visual', NULL), ('10000000-0000-0000-0000-000000000001', 'ai_visual', 'pending'),
 ('10000000-0000-0000-0000-000000000002', 'ai_visual', 'rejected'), ('10000000-0000-0000-0000-000000000003', 'bat', NULL),
 ('10000000-0000-0000-0000-000000000004', 'ai_visual', NULL), ('10000000-0000-0000-0000-000000000005', 'ai_visual', NULL);

\ir ../migrations/20261124194600_settle_due_and_backfill_pace.sql
\ir ../migrations/20261124194600_settle_due_and_backfill_pace.sql

DO $$
DECLARE r jsonb;
BEGIN
  r := public.field_evidence_rank_settle_due_v1(2);
  ASSERT (r->'last_run'->>'vehicles')::int = 2 AND (r->>'cursor')::uuid = '10000000-0000-0000-0000-000000000004', 'first page: 1 and 4; got ' || r::text;
  r := public.field_evidence_rank_settle_due_v1(2);
  ASSERT (r->'last_run'->>'vehicles')::int = 1 AND (r->>'cursor')::uuid = '10000000-0000-0000-0000-000000000005', 'second page: 5';
  r := public.field_evidence_rank_settle_due_v1(2);
  ASSERT (r->'last_run'->>'vehicles')::int = 0 AND r->>'cursor' IS NULL, 'end of lap: cursor wraps';
  r := public.field_evidence_rank_settle_due_v1(2);
  ASSERT (r->'last_run'->>'vehicles')::int = 2, 'next lap starts over';
  ASSERT NOT EXISTS (SELECT 1 FROM public._calls WHERE vehicle_id IN ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003')),
    'rejected-only and non-photo vehicles are not visited';
  ASSERT (r->>'fields_total')::int = 5 AND (r->>'rows_total')::int = 10, 'totals accumulate; got ' || r::text;
END $$;
\echo settle_due_and_backfill_pace: ok
