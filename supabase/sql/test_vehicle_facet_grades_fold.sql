-- Contract for 20261125064500_vehicle_facet_grades_fold (empty disposable PG17). vehicle_facet_items is a small working
-- stub that holds the live `everything` anchor verbatim and reads two sources: listing claims every caller can read and
-- vehicle_field_evidence under the live policy (the car's uploader only). model_fold_one is a stub holding its live
-- anchor. Synthetic rows only.
-- Asserts: before the fold a logged-out caller and the service role disagree; after it they agree on every item of every
-- public car (the parity the lead asked for); anon gets private_witnesses and only its own sources; a value known only
-- from private witnesses is shown for a publishable item and withheld for a private one (location, VIN-derivative
-- stamp); a private item with a visible value keeps the caller's grade; a hidden conflicting value turns the grade to
-- conflict without naming it; a stale fold (caller sees as many witnesses) leaves the caller's doc alone; anon cannot
-- read the table, nor the grades of a car that is not public; the fold ignores its own rows (raw); a failing read is
-- recorded, not raised; items with no rule row are listed, not stored; the seed queues at priority 9 behind the
-- backfill and the backlog; both patches land once; the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_facet_grades') IS NOT NULL OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub'), '')::uuid $f$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, user_id uuid, owner_id uuid,
  uploaded_by uuid, boom boolean NOT NULL DEFAULT false);
CREATE TABLE public.listing_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  item_key text, value text, cls text NOT NULL DEFAULT 'claim');
CREATE TABLE public.vehicle_field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles (id), item_key text, value_text text);
ALTER TABLE public.vehicle_field_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view evidence for their vehicles" ON public.vehicle_field_evidence FOR SELECT
  USING (vehicle_id IN (SELECT vehicles.id FROM public.vehicles WHERE vehicles.uploaded_by = (SELECT auth.uid())));
GRANT SELECT ON public.vehicles, public.listing_claims, public.vehicle_field_evidence TO anon, authenticated, service_role;
CREATE TABLE public.establishment_rules (rule_key text PRIMARY KEY, rule_version int NOT NULL);
INSERT INTO public.establishment_rules VALUES ('default', 1);
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text, updated_at timestamptz);
CREATE TABLE public.model_fold_work (vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles (id), state text NOT NULL DEFAULT 'pending', priority smallint NOT NULL DEFAULT 5,
  reasons text[] NOT NULL DEFAULT '{}', first_dirty_at timestamptz, dirty_at timestamptz, next_attempt_at timestamptz,
  attempts int NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('sweep_pending_cap', coalesce((SELECT (config_value->>'cap')::int FROM public.platform_config WHERE config_key = 'test_cap'), 4)) $f$;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
-- live definition (2026-11-25)
CREATE FUNCTION public.data_set_can_read_vehicle(p_vehicle uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_claims jsonb; v_role text; v_sub uuid; v_x record;
BEGIN
  SELECT x.id, x.is_public, x.user_id, x.owner_id, x.uploaded_by INTO v_x
    FROM public.vehicles x WHERE x.id = p_vehicle AND x.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_x.is_public IS TRUE THEN RETURN true; END IF;
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_role := coalesce(v_claims->>'role', CASE WHEN session_user IN ('authenticator','anon','authenticated') THEN 'anon' ELSE 'service_role' END);
  IF v_role NOT IN ('anon','authenticated') THEN RETURN true; END IF;
  IF coalesce(v_claims->>'sub', '') !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  v_sub := (v_claims->>'sub')::uuid;
  RETURN coalesce(v_sub IN (v_x.user_id, v_x.owner_id, v_x.uploaded_by), false)
      OR coalesce(public.vehicle_user_has_access(p_vehicle, v_sub), false);
END
$function$;

-- The reader stub: the caller's row policies decide which witnesses it counts, as in the live reader.
CREATE FUNCTION public.vehicle_facet_items(p_vehicle_id uuid, p_dimension text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
WITH v AS MATERIALIZED (
  SELECT v.id, 1 / (CASE WHEN v.boom THEN 0 ELSE 1 END) AS ok FROM public.vehicles v
  WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL AND (v.is_public IS TRUE OR (SELECT auth.uid()) = v.uploaded_by)
),
defs (dim, ord, key) AS (VALUES ('year', 0, 'year.recorded'), ('make', 0, 'make.recorded'), ('model', 0, 'model.recorded'),
  ('trim', 0, 'trim.unregistered'), ('transmission', 0, 'transmission.current.id_stamp'), ('location', 0, 'location.current.area')),
t AS (
  SELECT c.item_key AS key, c.value, c.cls, 'listing:' || c.id AS indep,
         jsonb_build_object('class', c.cls, 'kind', 'listing', 'witness', jsonb_build_object('kind', 'observation', 'id', c.id), 'value', c.value) AS src
  FROM v JOIN public.listing_claims c ON c.vehicle_id = v.id
  UNION ALL
  SELECT e.item_key, e.value_text, 'claim', 'vfe:' || e.id,
         jsonb_build_object('class', 'claim', 'kind', 'legacy', 'witness', jsonb_build_object('kind', 'vehicle_field_evidence', 'id', e.id), 'value', e.value_text)
  FROM v JOIN public.vehicle_field_evidence e ON e.vehicle_id = v.id
),
agg AS (
  SELECT key, count(DISTINCT lower(value)) FILTER (WHERE cls <> 'record') AS nv, count(DISTINCT indep) FILTER (WHERE cls <> 'record') AS n,
         min(value) FILTER (WHERE cls <> 'record') AS val, jsonb_agg(src ORDER BY indep) AS sources
  FROM t GROUP BY key
),
docs AS (
  SELECT d.dim, d.key, jsonb_build_object('key', d.key,
    'status', CASE WHEN a.key IS NULL OR a.n = 0 THEN 'missing' WHEN a.nv > 1 THEN 'conflict' WHEN a.n >= 2 THEN 'established' ELSE 'claim' END,
    'value', CASE WHEN a.nv = 1 THEN to_jsonb(a.val) END, 'normalized', CASE WHEN a.nv = 1 THEN lower(a.val) END,
    'basis', CASE WHEN a.n >= 2 AND a.nv = 1 THEN jsonb_build_object('code', 'independent.claims') END,
    'needed', CASE WHEN NOT coalesce(a.n >= 2 AND a.nv = 1, false) THEN 'another source' END,
    'sources', coalesce(a.sources, '[]'::jsonb)) AS doc
  FROM v CROSS JOIN defs d LEFT JOIN agg a ON a.key = d.key
),
item AS (SELECT key, doc FROM docs WHERE dim <> 'location'),
derived_items AS (SELECT NULL::text AS key, NULL::jsonb AS doc WHERE false),
loc_docs AS (SELECT key, doc FROM docs WHERE dim = 'location'),
everything AS (
  SELECT d.dim, d.ord, e.doc
  FROM (SELECT key, doc FROM item UNION ALL SELECT key, doc FROM derived_items UNION ALL SELECT key, doc FROM loc_docs WHERE p_dimension IS DISTINCT FROM 'masthead') e
  JOIN defs d ON d.key = e.key
),
per_dim AS (SELECT dim, jsonb_agg(doc ORDER BY ord) AS items FROM everything GROUP BY dim)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE (SELECT jsonb_object_agg(dim, items) FROM per_dim) END
$function$;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_items(uuid, text) TO anon, authenticated, service_role;

CREATE FUNCTION public.data_set_grade_vehicle(p_vehicle uuid) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
begin
  perform public.data_set_grade_vehicle(p_vehicle);
  return jsonb_build_object('vehicle', p_vehicle);
end $function$;

-- fixtures (disposable database only): A two sources agree, one private; B a private conflicting value; C not public;
-- D folded, then a new public value lands; E the read fails; F public, queued but never folded here.
INSERT INTO public.vehicles (id, is_public, uploaded_by, boom) VALUES
 ('00000000-0000-0000-0000-0000000000a1', true, '00000000-0000-0000-0000-0000000000f0', false),
 ('00000000-0000-0000-0000-0000000000b1', true, NULL, false),
 ('00000000-0000-0000-0000-0000000000c1', false, NULL, false),
 ('00000000-0000-0000-0000-0000000000d1', true, NULL, false),
 ('00000000-0000-0000-0000-0000000000e1', true, NULL, true),
 ('00000000-0000-0000-0000-0000000000f1', true, NULL, false);
INSERT INTO public.listing_claims (vehicle_id, item_key, value, cls) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'year.recorded', '1978', 'claim'),
 ('00000000-0000-0000-0000-0000000000a1', 'year.recorded', '1978', 'record'),
 ('00000000-0000-0000-0000-0000000000a1', 'transmission.current.id_stamp', 'PY', 'claim'),
 ('00000000-0000-0000-0000-0000000000b1', 'model.recorded', 'Firebird', 'claim'),
 ('00000000-0000-0000-0000-0000000000c1', 'year.recorded', '1978', 'claim'),
 ('00000000-0000-0000-0000-0000000000d1', 'year.recorded', '1978', 'claim');
INSERT INTO public.vehicle_field_evidence (vehicle_id, item_key, value_text) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'year.recorded', '1978'),
 ('00000000-0000-0000-0000-0000000000a1', 'make.recorded', 'Pontiac'),
 ('00000000-0000-0000-0000-0000000000a1', 'location.current.area', 'Some City'),
 ('00000000-0000-0000-0000-0000000000a1', 'transmission.current.id_stamp', 'PY'),
 ('00000000-0000-0000-0000-0000000000a1', 'trim.unregistered', 'X'),
 ('00000000-0000-0000-0000-0000000000b1', 'model.recorded', 'Trans Am'),
 ('00000000-0000-0000-0000-0000000000c1', 'year.recorded', '1978'),
 ('00000000-0000-0000-0000-0000000000d1', 'year.recorded', '1978'),
 ('00000000-0000-0000-0000-0000000000e1', 'year.recorded', '1978'),
 ('00000000-0000-0000-0000-0000000000f1', 'year.recorded', '1978');
INSERT INTO public.model_fold_work (vehicle_id, state, priority, reasons, first_dirty_at, dirty_at, next_attempt_at) VALUES
 ('00000000-0000-0000-0000-0000000000f1', 'done', 5, '{vehicles}', now(), now(), now());

-- Status per item as a caller sees it.
CREATE FUNCTION pg_temp.st(p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT coalesce(jsonb_object_agg(i->>'key', i->>'status'), '{}'::jsonb)
  FROM jsonb_each(coalesce(public.vehicle_facet_items(p_vehicle), '{}'::jsonb)) d, jsonb_array_elements(d.value) i $f$;
CREATE FUNCTION pg_temp.doc(p_vehicle uuid, p_key text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT i FROM jsonb_each(coalesce(public.vehicle_facet_items(p_vehicle), '{}'::jsonb)) d, jsonb_array_elements(d.value) i
  WHERE i->>'key' = p_key $f$;
GRANT EXECUTE ON FUNCTION pg_temp.st(uuid), pg_temp.doc(uuid, text) TO anon, service_role;

-- Before: the grade depends on the viewer.
DO $$ DECLARE a jsonb; s jsonb; BEGIN
  SET LOCAL ROLE anon; a := pg_temp.st('00000000-0000-0000-0000-0000000000a1'); RESET ROLE;
  SET LOCAL ROLE service_role; s := pg_temp.st('00000000-0000-0000-0000-0000000000a1'); RESET ROLE;
  IF a->>'year.recorded' <> 'claim' OR s->>'year.recorded' <> 'established' THEN
    RAISE EXCEPTION 'fixture: expected anon claim / service established before the fold, got % / %', a, s; END IF;
END $$;

\ir ../migrations/20261125064500_vehicle_facet_grades_fold.sql
\ir ../migrations/20261125064500_vehicle_facet_grades_fold.sql
RESET statement_timeout; RESET lock_timeout;

DO $$ DECLARE d text; r jsonb; n int; BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF (length(d) - length(replace(d, 'facet_grades_fold_v1_end', ''))) / length('facet_grades_fold_v1_end') <> 1 THEN
    RAISE EXCEPTION 'reader patched % times', (length(d) - length(replace(d, 'facet_grades_fold_v1_end', ''))) / length('facet_grades_fold_v1_end'); END IF;
  d := pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure);
  IF (length(d) - length(replace(d, 'facet_grades_fold_v1_end', ''))) / length('facet_grades_fold_v1_end') <> 1 THEN
    RAISE EXCEPTION 'model_fold_one patched wrong'; END IF;
  IF (SELECT count(*) FROM public.vehicle_facet_item_rules) <> 60 THEN
    RAISE EXCEPTION 'item rules: % rows', (SELECT count(*) FROM public.vehicle_facet_item_rules); END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_facet_item_rules WHERE item_key IN ('location.current.area', 'transmission.current.id_stamp',
               'engine.current.engine_code_stamp', 'body_style.body_number', 'engine.current.machine_work') AND value_publishable) THEN
    RAISE EXCEPTION 'a private item is publishable'; END IF;

  -- Seed: not while the backlog is at the cap; then priority 9, public cars only, a done row revived.
  INSERT INTO public.vehicles (id, is_public) SELECT ('00000000-0000-0000-0000-00000000010' || g)::uuid, false FROM generate_series(1, 4) g;
  INSERT INTO public.model_fold_work (vehicle_id, state, first_dirty_at, dirty_at, next_attempt_at)
  SELECT ('00000000-0000-0000-0000-00000000010' || g)::uuid, 'pending', now(), now(), now() FROM generate_series(1, 4) g;
  r := public.vehicle_facet_grades_enqueue(500);
  IF r->>'waiting' IS DISTINCT FROM 'model_fold_work' THEN RAISE EXCEPTION 'seed ran over the cap: %', r; END IF;
  DELETE FROM public.model_fold_work WHERE state = 'pending';
  INSERT INTO public.platform_config (config_key, config_value) VALUES ('test_cap', '{"cap": 100}');
  r := public.vehicle_facet_grades_enqueue(500);
  SELECT count(*) INTO n FROM public.model_fold_work WHERE priority = 9 AND state = 'pending' AND 'facet_grades' = ANY (reasons);
  IF n <> 5 OR EXISTS (SELECT 1 FROM public.model_fold_work WHERE vehicle_id = '00000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'seed queued % (want a1 b1 d1 e1 f1, not c1): %', n, r; END IF;
  r := public.vehicle_facet_grades_enqueue(500);
  IF NOT (r->>'done')::boolean THEN RAISE EXCEPTION 'seed did not finish: %', r; END IF;

  -- Fold through the vehicle fold (A) and directly (B C D E).
  PERFORM public.model_fold_one(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '{}'::jsonb);
  PERFORM public.vehicle_facet_grades_fold(x) FROM unnest(ARRAY['00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1']::uuid[]) x;
  r := public.vehicle_facet_grades_fold('00000000-0000-0000-0000-0000000000e1');
  IF r->>'error' IS NULL OR (SELECT error FROM public.vehicle_facet_grade_folds WHERE vehicle_id = '00000000-0000-0000-0000-0000000000e1') IS NULL THEN
    RAISE EXCEPTION 'a failing read was not recorded: %', r; END IF;
  IF (SELECT count(*) FROM public.vehicle_facet_grades WHERE vehicle_id = '00000000-0000-0000-0000-0000000000c1') <> 0 THEN
    RAISE EXCEPTION 'a car that is not public was folded'; END IF;
  IF (SELECT unregistered FROM public.vehicle_facet_grade_folds WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') <> '{trim.unregistered}'
     OR EXISTS (SELECT 1 FROM public.vehicle_facet_grades WHERE item_key = 'trim.unregistered') THEN
    RAISE EXCEPTION 'unregistered item handling wrong'; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_facet_grades WHERE item_key IN ('location.current.area', 'transmission.current.id_stamp')
               AND (value IS NOT NULL OR normalized IS NOT NULL)) THEN
    RAISE EXCEPTION 'a private value was stored'; END IF;
  RAISE NOTICE 'gauge %', public.vehicle_facet_grades_gauge();
END $$;

-- Parity: every item of every public car has the same status for anon and the service role.
DO $$ DECLARE v uuid; a jsonb; s jsonb; BEGIN
  FOREACH v IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1']::uuid[] LOOP
    SET LOCAL ROLE anon; a := pg_temp.st(v); RESET ROLE;
    SET LOCAL ROLE service_role; s := pg_temp.st(v); RESET ROLE;
    -- By design, two items keep the caller's grade: transmission.current.id_stamp is private and the caller sees its
    -- value; trim.unregistered has no rule row, so it is listed on the fold record and never stored.
    IF (a - 'transmission.current.id_stamp' - 'trim.unregistered') IS DISTINCT FROM (s - 'transmission.current.id_stamp' - 'trim.unregistered') THEN
      RAISE EXCEPTION 'parity broken on %: anon % service %', v, a, s; END IF;
    RAISE NOTICE 'parity % %', v, a;
  END LOOP;
END $$;

-- What anon sees, item by item.
SET ROLE anon;
DO $$ DECLARE j jsonb; BEGIN
  j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'year.recorded');
  IF j->>'status' <> 'established' OR (j->>'private_witnesses')::int <> 1 OR j->>'value' <> '1978'
     OR jsonb_array_length(j->'sources') <> 2 OR j->'sources' @> '[{"kind": "legacy"}]' OR j->'basis'->>'code' <> 'independent.claims' THEN
    RAISE EXCEPTION 'A year: %', j; END IF;
  j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'make.recorded');
  IF j->>'status' <> 'claim' OR j->>'value' <> 'Pontiac' OR (j->>'value_private')::boolean OR jsonb_array_length(j->'sources') <> 0 THEN
    RAISE EXCEPTION 'A make (publishable, only private witnesses): %', j; END IF;
  j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'location.current.area');
  IF j->>'status' <> 'claim' OR j->'value' <> 'null'::jsonb OR NOT (j->>'value_private')::boolean OR j::text LIKE '%Some City%' THEN
    RAISE EXCEPTION 'A location (private, only private witnesses): %', j; END IF;
  j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'transmission.current.id_stamp');
  IF j->>'status' <> 'claim' OR (j->>'private_witnesses')::int <> 1 THEN
    RAISE EXCEPTION 'A stamp (private, caller sees a value): %', j; END IF;
  j := pg_temp.doc('00000000-0000-0000-0000-0000000000b1', 'model.recorded');
  IF j->>'status' <> 'conflict' OR j->'value' <> 'null'::jsonb OR j::text LIKE '%Trans Am%' OR jsonb_array_length(j->'sides') <> 1 THEN
    RAISE EXCEPTION 'B model (hidden conflicting value): %', j; END IF;
  IF public.vehicle_facet_grades_read('00000000-0000-0000-0000-0000000000c1') IS NOT NULL THEN
    RAISE EXCEPTION 'grades of a car that is not public were read'; END IF;
  BEGIN
    PERFORM 1 FROM public.vehicle_facet_grades LIMIT 1;
    RAISE EXCEPTION 'anon read vehicle_facet_grades';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.vehicle_facet_grades_fold('00000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'anon ran the fold';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Stale: D gains a public value that disagrees after its fold; the caller sees as many witnesses, so its doc stands.
INSERT INTO public.listing_claims (vehicle_id, item_key, value) VALUES ('00000000-0000-0000-0000-0000000000d1', 'year.recorded', '1979');
DO $$ DECLARE j jsonb; BEGIN
  SET LOCAL ROLE anon; j := pg_temp.doc('00000000-0000-0000-0000-0000000000d1', 'year.recorded'); RESET ROLE;
  IF j->>'status' <> 'conflict' OR j ? 'private_witnesses' THEN RAISE EXCEPTION 'D stale fold overlaid: %', j; END IF;
  -- raw: the fold's own read ignores its rows
  PERFORM set_config('nuke.facet_grades', 'raw', true);
  SET LOCAL ROLE anon; j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'year.recorded'); RESET ROLE;
  PERFORM set_config('nuke.facet_grades', '', true);
  IF j->>'status' <> 'claim' OR j ? 'private_witnesses' THEN RAISE EXCEPTION 'raw read took the fold: %', j; END IF;
END $$;
-- A new logic key retires every row until the cars fold again.
UPDATE public.establishment_rules SET rule_version = 2;
DO $$ DECLARE j jsonb; BEGIN
  SET LOCAL ROLE anon; j := pg_temp.doc('00000000-0000-0000-0000-0000000000a1', 'year.recorded'); RESET ROLE;
  IF j->>'status' <> 'claim' THEN RAISE EXCEPTION 'a row under an old logic key was used: %', j; END IF;
END $$;
\echo vehicle_facet_grades_fold: ok
