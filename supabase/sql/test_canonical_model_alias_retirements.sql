-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_alias_retire -f this-file.sql
-- Proves 20261126020500_canonical_model_alias_retirements.sql: generic-noun aliases leave canonical_models.aliases with a
-- retirement row each; an alias that is the model's own name stays; other aliases keep their order; the guard refuses a
-- generic alias or a retired one coming back; a restore needs the word ruled non-generic first; applying twice is a
-- no-op; API roles reach none of it. Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.canonical_models') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- canonical_models as live (columns read 2026-11-25)
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text NOT NULL, canonical_model text NOT NULL,
  canonical_series text, year_start integer, year_end integer, body_styles text[], aliases text[], generation text, notes text,
  created_at timestamptz DEFAULT now(), platform text);
GRANT SELECT ON public.canonical_models TO anon, authenticated;
INSERT INTO public.canonical_models (id, make, canonical_model, aliases) VALUES
  ('10000000-0000-0000-0000-000000000001', 'BMW', '3 Series', ARRAY['328i', 'car', 'E30', 'Project', '3er']),
  ('10000000-0000-0000-0000-000000000002', 'Land Rover', 'Defender', ARRAY['speed', 'D90']),
  ('10000000-0000-0000-0000-000000000003', 'Bentley', 'Speed', ARRAY['speed', 'Continental Speed']),
  ('10000000-0000-0000-0000-000000000004', 'Porsche', '356', ARRAY[' Junior ', 'junior', '356A']),
  ('10000000-0000-0000-0000-000000000005', 'Ford', 'Model T', ARRAY['tin lizzie']),
  ('10000000-0000-0000-0000-000000000006', 'Dodge', 'D-Series', NULL);

\ir ../migrations/20261126020500_canonical_model_alias_retirements.sql
\ir ../migrations/20261126020500_canonical_model_alias_retirements.sql

DO $t$
DECLARE rid uuid;
BEGIN
  -- generic nouns leave, names and order stay
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000001') <> ARRAY['328i', 'E30', '3er'] THEN
    RAISE EXCEPTION 'BMW aliases wrong: %', (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000001'); END IF;
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000002') <> ARRAY['D90'] THEN
    RAISE EXCEPTION 'Defender kept speed'; END IF;
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000003') <> ARRAY['speed', 'Continental Speed'] THEN
    RAISE EXCEPTION 'a model lost its own name'; END IF;
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000004') <> ARRAY['356A'] THEN
    RAISE EXCEPTION '356 kept a junior spelling'; END IF;
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000005') <> ARRAY['tin lizzie'] THEN
    RAISE EXCEPTION 'an untouched model changed'; END IF;
  -- one retirement row per alias (the second apply added none); the junior spellings are one current row per lower(alias)
  IF (SELECT count(*) FROM public.canonical_model_alias_retirements WHERE restored_at IS NULL) <> 4 THEN
    RAISE EXCEPTION 'retirement rows: %', (SELECT count(*) FROM public.canonical_model_alias_retirements); END IF;
  IF EXISTS (SELECT 1 FROM public.canonical_model_alias_retirements WHERE retired_by <> 'job:migration-20261126020500') THEN
    RAISE EXCEPTION 'retired_by not the migration job'; END IF;

  -- the guard: a generic alias cannot come back, by update or insert; a retired alias cannot come back
  BEGIN UPDATE public.canonical_models SET aliases = aliases || ARRAY['car'] WHERE id = '10000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'generic alias re-added';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'generic alias re-added' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%generic word%' THEN RAISE; END IF; END;
  BEGIN INSERT INTO public.canonical_models (make, canonical_model, aliases) VALUES ('Nissan', 'Sentra', ARRAY['project']);
        RAISE EXCEPTION 'generic alias inserted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'generic alias inserted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%generic word%' THEN RAISE; END IF; END;
  -- a model whose own name is a generic word may carry it as an alias
  INSERT INTO public.canonical_models (make, canonical_model, aliases) VALUES ('Testmake', 'Junior', ARRAY['junior', 'JR']);
  -- a word ruled non-generic: its retired alias still cannot come back by hand, only by the restore writer
  SELECT id INTO rid FROM public.canonical_model_alias_retirements WHERE model_id = '10000000-0000-0000-0000-000000000002';
  BEGIN PERFORM public.canonical_model_alias_restore(rid, 'agent:ta-facts', 'speed is still generic here');
        RAISE EXCEPTION 'restore of a generic word admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'restore of a generic word admitted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%still a generic word%' THEN RAISE; END IF; END;
END
$t$;

-- a retired alias cannot come back by hand; once 'speed' is ruled non-generic (its word row removed), the restore writer
-- puts it back and the guard admits it
DO $t$
DECLARE rid uuid;
BEGIN
  SELECT id INTO rid FROM public.canonical_model_alias_retirements WHERE model_id = '10000000-0000-0000-0000-000000000002';
  DELETE FROM public.canonical_generic_words WHERE word = 'speed';
  BEGIN UPDATE public.canonical_models SET aliases = aliases || ARRAY['speed'] WHERE id = '10000000-0000-0000-0000-000000000002';
        RAISE EXCEPTION 'retired alias re-added by hand';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'retired alias re-added by hand' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%is retired%' THEN RAISE; END IF; END;
  PERFORM public.canonical_model_alias_restore(rid, 'agent:ta-facts', 'ruled a name for this test');
  IF (SELECT aliases FROM public.canonical_models WHERE id = '10000000-0000-0000-0000-000000000002') <> ARRAY['D90', 'speed'] THEN
    RAISE EXCEPTION 'restore did not put the alias back'; END IF;
  IF (SELECT restored_by FROM public.canonical_model_alias_retirements WHERE id = rid) <> 'agent:ta-facts' THEN
    RAISE EXCEPTION 'restore not stamped'; END IF;
END
$t$;

DO $t$
BEGIN
  IF has_table_privilege('anon', 'public.canonical_generic_words', 'select')
     OR has_table_privilege('anon', 'public.canonical_model_alias_retirements', 'select')
     OR has_function_privilege('anon', 'public.canonical_model_aliases_retire_generic(text)', 'execute')
     OR has_function_privilege('authenticated', 'public.canonical_model_alias_restore(uuid, text, text)', 'execute') THEN
    RAISE EXCEPTION 'rule tables or writers reachable by an API role'; END IF;
END
$t$;
\echo canonical_model_alias_retirements: ok
