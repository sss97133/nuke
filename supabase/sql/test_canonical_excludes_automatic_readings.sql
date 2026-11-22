-- Empty disposable PG17 only, as a superuser (the live view_write_guard event trigger is installed), from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_canonical_tier -f this-file.sql
-- Proves 20261122003000_canonical_excludes_automatic_readings.sql: public.vehicle_canonical never selects an automatic
-- photo reading (agent_tier 'subscription automatic'). A reviewed reading is canonical before and after; an automatic
-- reading that was canonical is not after; where an automatic reading outranked a reviewed one for the same vehicle and
-- property, the reviewed one is canonical after; a reading with no tier is unaffected; the columns, their order and
-- types, owner, options, grants, comment and a dependent view are unchanged; re-applying changes nothing; a definition
-- other than the one the migration was written from, or a config naming another tier (or no config row), is refused and
-- the view is left as it was; the revert restores the earlier ranking. Every id below is invented.
-- Shapes: helpers/vehicle_observations_rls_fixture.sql and helpers/vehicle_canonical_live_20261121.sql (the live view
-- text over tables with the live column types). The first case proves that fixture prints the same definition as
-- production (md5 of pg_get_viewdef 4637af91499a472f5a09f9a5f1eb09c2, read 2026-11-21), so the migration's guard and
-- post-check are exercised against production's definition, not a look-alike.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run as a superuser: vanilla PG17 lets only a superuser create the view_write_guard event trigger';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
\ir helpers/vehicle_observations_rls_fixture.sql
\ir helpers/vehicle_canonical_live_20261121.sql
-- The live guard: it must accept the replace (it fires on CREATE VIEW and checks the view it touches).
\ir ../migrations/20261014214500_view_write_guard.sql
INSERT INTO public.platform_config (config_key, config_value)
  VALUES ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}}');
-- An object that depends on the view, as production has one: a replace must keep it working.
CREATE VIEW public.t_canonical_dependent AS SELECT vehicle_id, property_id, observation_id FROM public.vehicle_canonical;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- The fingerprint the migration computes: the plain pg_get_viewdef with search_path = public.
CREATE FUNCTION pg_temp.def_md5() RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT md5(pg_get_viewdef('public.vehicle_canonical'::regclass)) $$;
-- Owner, options, grants, comment, and the columns with their types in order.
CREATE FUNCTION pg_temp.shape() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), c.relkind::text, coalesce(c.reloptions::text, '-'), coalesce(c.relacl::text, '-'),
           coalesce(obj_description(c.oid, 'pg_class'), '-'),
           (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass $$;
-- The canonical observation per (vehicle, property), one line each, in a fixed order.
CREATE FUNCTION pg_temp.canon() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(vehicle_id || '/' || property_id || '=' || observation_id, E'\n' ORDER BY vehicle_id, property_id, observation_id)
    FROM public.vehicle_canonical $$;
CREATE FUNCTION pg_temp.is_canonical(p_id uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_canonical WHERE observation_id = p_id) $$;

-- ===== rows =====
-- Two vehicles; three registered properties (no discriminator, so one canonical row per vehicle and property).
INSERT INTO public.vehicles (id) VALUES ('10000000-0000-0000-0000-00000000000a'), ('10000000-0000-0000-0000-00000000000b');
INSERT INTO public.observation_properties (id, property_key, label, data_type, applies_to_kinds, ratified_at) VALUES
  ('40000000-0000-0000-0000-000000000001', 't_paint_condition', 'Paint condition', 'string', '{condition}', '2026-11-01'),
  ('40000000-0000-0000-0000-000000000002', 't_glass_condition', 'Glass condition', 'string', '{condition}', '2026-11-01'),
  ('40000000-0000-0000-0000-000000000003', 't_trim_condition', 'Trim condition', 'string', '{condition}', '2026-11-01');
-- Vehicle a, property 1: a reviewed reading (a1) and an automatic one (a2) that outranks it (higher confidence, later).
-- Vehicle a, property 2: only an automatic reading (a3).
-- Vehicle a, property 3: only a reading with no tier (a4).
-- Vehicle b, property 1: only a reviewed reading (b1).
-- Vehicle b, property 2: a reading with no tier (b2) above an automatic one (b3).
-- Vehicle b, property 3: an automatic reading (b4) above a reading with no tier (b5).
INSERT INTO public.vehicle_observations (id, vehicle_id, property_id, observed_at, kind, structured_data, confidence_score, agent_tier) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '2026-11-01', 'condition', '{"value": "fair"}', 0.60, 'interactive'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '2026-11-10', 'condition', '{"value": "good"}', 0.90, 'subscription automatic'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', '2026-11-10', 'condition', '{"value": "good"}', 0.80, 'subscription automatic'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000003', '2026-11-01', 'condition', '{"value": "fair"}', 0.50, NULL),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', '2026-11-01', 'condition', '{"value": "fair"}', 0.70, 'interactive'),
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000002', '2026-11-10', 'condition', '{"value": "poor"}', 0.90, NULL),
  ('20000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000002', '2026-11-01', 'condition', '{"value": "good"}', 0.40, 'subscription automatic'),
  ('20000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000003', '2026-11-10', 'condition', '{"value": "good"}', 0.95, 'subscription automatic'),
  ('20000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000003', '2026-11-01', 'condition', '{"value": "fair"}', 0.30, NULL);

-- ===== 1. before =====
SELECT pg_temp.ok('fixture: the view prints exactly as production''s (md5 4637af91499a472f5a09f9a5f1eb09c2), so the cases run on its definition',
  pg_temp.def_md5() = '4637af91499a472f5a09f9a5f1eb09c2');
SELECT pg_temp.ok('before: an ordinary view with no options and production''s twelve columns, in order, with their types',
  (SELECT relkind = 'v' AND reloptions IS NULL FROM pg_class WHERE oid = 'public.vehicle_canonical'::regclass)
  AND split_part(pg_temp.shape(), E'\n', 6) = 'vehicle_id uuid, property_id uuid, observation_id uuid, structured_data jsonb, '
      'content_text text, confidence_score numeric(3,2), observed_at timestamp with time zone, source_id uuid, kind observation_kind, '
      'rank vfc_rank, changeset_id uuid, discriminator_value text');
SELECT pg_temp.shape() AS shape_before, pg_temp.canon() AS canon_before \gset
SELECT pg_temp.ok('before: the automatic readings that rank first are canonical (a2 over the reviewed a1, a3 alone, b4 over b5), so the cases below are not vacuous',
  pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a2') AND NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a1')
  AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a3') AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b4')
  AND NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b5'));
SELECT pg_temp.ok('before: the reviewed reading b1 and the untiered readings a4 and b2 are canonical; b3 (automatic, below b2) is not',
  pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b1') AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a4')
  AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b2') AND NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b3')
  AND (SELECT count(*) FROM public.vehicle_canonical) = 6);

-- ===== 2. apply =====
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
SELECT pg_temp.ok('applied: the definition is the one the migration names (md5 4d1a2e57a880181691e5bd8eb0c30002) and carries the configured tier',
  pg_temp.def_md5() = '4d1a2e57a880181691e5bd8eb0c30002'
  AND strpos(pg_get_viewdef('public.vehicle_canonical'::regclass),
             '(o.agent_tier IS DISTINCT FROM ' || quote_literal((SELECT config_value -> 'automatic' ->> 'tier' FROM public.platform_config
                                                                  WHERE config_key = 'image_reading_tiers')) || '::text)') > 0);
SELECT pg_temp.ok('applied: owner, kind, options, grants, comment, columns, their order and types are as before',
  pg_temp.shape() = :'shape_before'
  AND has_table_privilege('dm_contract_canonical_grantee', 'public.vehicle_canonical', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));
SELECT pg_temp.ok('applied: still not auto-updatable, and the dependent view still reads it',
  pg_relation_is_updatable('public.vehicle_canonical'::regclass, false) = 0
  AND (SELECT count(*) FROM public.t_canonical_dependent) = (SELECT count(*) FROM public.vehicle_canonical));

-- ===== 3. after =====
SELECT pg_temp.ok('after: no automatic reading is canonical',
  NOT EXISTS (SELECT 1 FROM public.vehicle_canonical c JOIN public.vehicle_observations o ON o.id = c.observation_id
               WHERE o.agent_tier = 'subscription automatic'));
SELECT pg_temp.ok('after: the automatic reading that outranked a reviewed one (a2) is not canonical; the reviewed one (a1) is',
  NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a2') AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.ok('after: a property whose only reading is automatic (a/2) has no canonical row',
  NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a3')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_canonical WHERE vehicle_id = '10000000-0000-0000-0000-00000000000a'
                    AND property_id = '40000000-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('after: the untiered reading below an automatic one (b5) is canonical; the automatic one (b4) is not',
  pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b5') AND NOT pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b4'));
SELECT pg_temp.ok('after: the reviewed reading b1 and the untiered readings a4 and b2 are canonical, as before',
  pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b1') AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a4')
  AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000b2'));
SELECT pg_temp.ok('after: exactly five canonical rows, one per (vehicle, property) that has a non-automatic reading',
  pg_temp.canon() = concat_ws(E'\n',
    '10000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-000000000001=20000000-0000-0000-0000-0000000000a1',
    '10000000-0000-0000-0000-00000000000a/40000000-0000-0000-0000-000000000003=20000000-0000-0000-0000-0000000000a4',
    '10000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-000000000001=20000000-0000-0000-0000-0000000000b1',
    '10000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-000000000002=20000000-0000-0000-0000-0000000000b2',
    '10000000-0000-0000-0000-00000000000b/40000000-0000-0000-0000-000000000003=20000000-0000-0000-0000-0000000000b5'));
SELECT pg_temp.canon() AS canon_after \gset

-- ===== 4. re-applying changes nothing =====
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
SELECT pg_temp.ok('re-applied: the same definition, shape and canonical rows',
  pg_temp.def_md5() = '4d1a2e57a880181691e5bd8eb0c30002' AND pg_temp.shape() = :'shape_before' AND pg_temp.canon() = :'canon_after');

-- ===== 5. the revert =====
\ir revert_20261122003000_canonical_excludes_automatic_readings.sql
\ir revert_20261122003000_canonical_excludes_automatic_readings.sql
SELECT pg_temp.ok('reverted (twice): the earlier definition, the same shape, and the earlier canonical rows (a2, a3 and b4 again)',
  pg_temp.def_md5() = '4637af91499a472f5a09f9a5f1eb09c2' AND pg_temp.shape() = :'shape_before' AND pg_temp.canon() = :'canon_before'
  AND pg_temp.is_canonical('20000000-0000-0000-0000-0000000000a2'));

-- ===== 6. the guard =====
-- The refusal message is read from a separate psql run of the migration file (in this session a failed \ir leaves only
-- "current transaction is aborted" as the last error); the in-session run proves nothing changed.
\setenv PGDATABASE :DBNAME
-- 6a. A definition other than the one the migration was written from.
SELECT pg_get_viewdef('public.vehicle_canonical'::regclass) AS was_def \gset
DO $$ BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '
          || replace(pg_get_viewdef('public.vehicle_canonical'::regclass), 'WHERE (rn = 1)', 'WHERE (rn = 1) AND (observation_id IS NOT NULL)');
END $$;
SELECT pg_temp.def_md5() AS drifted_md5 \gset
SELECT pg_temp.ok('drift fixture: the view now differs from the one the migration was written from',
  :'drifted_md5' NOT IN ('4637af91499a472f5a09f9a5f1eb09c2', '4d1a2e57a880181691e5bd8eb0c30002'));
\! "$DB_CONTRACT_PSQL" -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20261122003000_canonical_excludes_automatic_readings.sql 2>&1 | grep -q "is not the definition this migration was written from"
\if :SHELL_ERROR
  SELECT pg_temp.ok('refused with the guard''s message when the definition differs', false);
\endif
\set ON_ERROR_STOP off
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: a different definition is left untouched (same md5, same shape)',
  pg_temp.def_md5() = :'drifted_md5' AND pg_temp.shape() = :'shape_before');
\! "$DB_CONTRACT_PSQL" -X -q -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122003000_canonical_excludes_automatic_readings.sql 2>&1 | grep -q "is not the definition 20261122003000 left"
\if :SHELL_ERROR
  SELECT pg_temp.ok('the revert refuses with its guard''s message when the definition differs', false);
\endif
SELECT pg_temp.ok('the revert refused too: the different definition is still untouched', pg_temp.def_md5() = :'drifted_md5');
-- Put the earlier definition back (as the revert left it).
SET search_path = public;
SELECT 'CREATE OR REPLACE VIEW public.vehicle_canonical AS ' || :'was_def' \gexec
RESET search_path;
SELECT pg_temp.ok('drift undone: the earlier definition is back', pg_temp.def_md5() = '4637af91499a472f5a09f9a5f1eb09c2');

-- 6b. The config names another tier.
UPDATE public.platform_config SET config_value = '{"automatic": {"tier": "renamed tier"}}' WHERE config_key = 'image_reading_tiers';
\! "$DB_CONTRACT_PSQL" -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20261122003000_canonical_excludes_automatic_readings.sql 2>&1 | grep -q "names the automatic tier 'renamed tier', not 'subscription automatic'"
\if :SHELL_ERROR
  SELECT pg_temp.ok('refused with the guard''s message when the config names another tier', false);
\endif
\set ON_ERROR_STOP off
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: with the config naming another tier the view is unchanged',
  pg_temp.def_md5() = '4637af91499a472f5a09f9a5f1eb09c2' AND pg_temp.canon() = :'canon_before');

-- 6c. No config row.
DELETE FROM public.platform_config WHERE config_key = 'image_reading_tiers';
\! "$DB_CONTRACT_PSQL" -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20261122003000_canonical_excludes_automatic_readings.sql 2>&1 | grep -q "names the automatic tier (no row or no value)"
\if :SHELL_ERROR
  SELECT pg_temp.ok('refused with the guard''s message when the config row is missing', false);
\endif
\set ON_ERROR_STOP off
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('refused: with no config row the view is unchanged',
  pg_temp.def_md5() = '4637af91499a472f5a09f9a5f1eb09c2' AND pg_temp.canon() = :'canon_before');

-- With the config back it applies again.
INSERT INTO public.platform_config (config_key, config_value)
  VALUES ('image_reading_tiers', '{"automatic": {"tier": "subscription automatic"}}');
\ir ../migrations/20261122003000_canonical_excludes_automatic_readings.sql
SELECT pg_temp.ok('re-applied after the refusals: the new definition, the same shape, no automatic reading canonical',
  pg_temp.def_md5() = '4d1a2e57a880181691e5bd8eb0c30002' AND pg_temp.shape() = :'shape_before' AND pg_temp.canon() = :'canon_after');
\echo 'test_canonical_excludes_automatic_readings: all contract assertions passed'
