-- Contract: 20261111195000_garage_derivation_evidence.sql is safe to re-apply where the table already exists (production,
-- created 2026-11-08 and since extended by the receipt-work kind check). The deploy workflow applies every migration a merge
-- adds, so the re-apply must succeed and leave the table, its rows, trigger, policy, grants and functions unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;

\ir ../migrations/20261111195000_garage_derivation_evidence.sql
-- production's later state: the receipt-work kind is allowed and a row of it exists
ALTER TABLE public.garage_derivation_evidence DROP CONSTRAINT garage_derivation_evidence_kind_check;
ALTER TABLE public.garage_derivation_evidence ADD CONSTRAINT garage_derivation_evidence_kind_check
  CHECK (kind IN ('scene_label', 'place_match', 'place_exemplar', 'sign_read', 'duplicate_judgment', 'seller_history_match',
                  'relationship_role', 'receipt_work_correlation'));
INSERT INTO public.garage_derivation_evidence(kind, conclusion, producer_script, producer_version, run_id, content_hash, dedupe_key)
VALUES ('receipt_work_correlation', 'proposed', 'scripts/receipt-work/reconcile-receipt-work.mjs', 'sha:test', gen_random_uuid(), 'h', 'k');

CREATE TEMP TABLE before AS
SELECT (SELECT string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), E'\n' ORDER BY p.proname) FROM pg_proc p
         WHERE p.proname IN ('derived_rows_append_only', 'rollback_garage_derivation_run')) AS fns,
       (SELECT string_agg(conname || pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint
         WHERE conrelid = 'public.garage_derivation_evidence'::regclass) AS cons,
       (SELECT string_agg(indexdef, ',' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'garage_derivation_evidence') AS idx,
       (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.garage_derivation_evidence'::regclass AND NOT tgisinternal) AS trg,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'garage_derivation_evidence') AS pol,
       (SELECT relacl::text FROM pg_class WHERE oid = 'public.garage_derivation_evidence'::regclass) AS acl,
       (SELECT md5(string_agg(to_jsonb(g)::text, ',' ORDER BY id)) FROM public.garage_derivation_evidence g) AS rows_md5;

\ir ../migrations/20261111195000_garage_derivation_evidence.sql
\ir ../migrations/20261111195000_garage_derivation_evidence.sql

DO $$
DECLARE b record; a record;
BEGIN
  SELECT * INTO b FROM before;
  SELECT (SELECT string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), E'\n' ORDER BY p.proname) FROM pg_proc p
           WHERE p.proname IN ('derived_rows_append_only', 'rollback_garage_derivation_run')) AS fns,
         (SELECT string_agg(conname || pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint
           WHERE conrelid = 'public.garage_derivation_evidence'::regclass) AS cons,
         (SELECT string_agg(indexdef, ',' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'garage_derivation_evidence') AS idx,
         (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.garage_derivation_evidence'::regclass AND NOT tgisinternal) AS trg,
         (SELECT count(*) FROM pg_policies WHERE tablename = 'garage_derivation_evidence') AS pol,
         (SELECT relacl::text FROM pg_class WHERE oid = 'public.garage_derivation_evidence'::regclass) AS acl,
         (SELECT md5(string_agg(to_jsonb(g)::text, ',' ORDER BY id)) FROM public.garage_derivation_evidence g) AS rows_md5
    INTO a;
  IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'CONTRACT FAIL re-apply changed state: before % after %', row_to_json(b), row_to_json(a); END IF;
  IF a.trg <> 1 OR a.pol <> 1 THEN RAISE EXCEPTION 'CONTRACT FAIL trigger/policy count % %', a.trg, a.pol; END IF;
  IF a.cons NOT LIKE '%receipt_work_correlation%' THEN RAISE EXCEPTION 'CONTRACT FAIL kind check lost receipt_work_correlation'; END IF;
  RAISE NOTICE 'garage_derivation_evidence re-apply contract ok';
END $$;
