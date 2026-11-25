-- model_fold_scope_rows_v1: the model fold's scopes are rows, not a CASE in code and two arrays in platform_config.
--
-- WHY. model_fold_scope_of was an IMMUTABLE CASE holding makes, model words and three Pontiac VIN regexes;
-- model_fold_scope_make repeated the makes; which scopes the sweep walks and which decode lived in platform_config
-- 'scopes' / 'decode_scopes'. A new make (Chevrolet trucks, from cited decode rules) needed a function edit.
--
-- ROWS. model_fold_scopes(scope PK, make, model_pattern, vin_body_codes, year_min, year_max, sweep, decode, ord, note).
-- A car is in a scope when its make matches, its year is inside the row's range (when the row has one), and its model
-- matches model_pattern (case-insensitive) or its VIN matches a live vin_format row of the make (vehicle_decode_rules,
-- 20261125103000) and the format's body position holds one of vin_body_codes. The lowest ord wins.
--   pontiac_f_body: model 'firebird|trans ?am' or body 87 under the three Pontiac formats. This is the old CASE: the
--     1970-71 and 1981 format regexes already fix 87 at the body position, and the 1972-80 format regex with body
--     87 at [3,2] is the old regex. sweep and decode follow today's config (both true).
--   ford_mustang_65_73, chevrolet_camaro_67_69: as in the CASE, sweep and decode false (not in today's config).
--
-- FUNCTIONS. model_fold_scope_of (now STABLE), model_fold_scope_make and model_fold_in_scope read the rows;
-- model_fold_sweep walks rows with sweep; model_fold_one decodes cars whose scope row has decode.
--
-- FORCED PASS. The sweep skips a car whose fold already carries the current logic key, so a scope added later, or one
-- whose decode / pattern changes, would leave cars folded before the change undecoded. A row change stamps the scope's
-- cursor (forced_at, snapshot and verified key cleared); the sweep then re-folds members whose last fold
-- (model_fold_work.folded_at) is older than forced_at. The seed rows are written before the trigger exists, so this
-- deploy forces nothing and moves no logic key (none of the changed functions is hashed).
--
-- Contract: supabase/sql/test_model_fold_scope_rows.sql. Dry run: old CASE vs rows on every live Pontiac, Ford
-- 1965-73 and Chevrolet 1967-69 car.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.model_fold_scopes (
  scope text PRIMARY KEY CHECK (scope ~ '^[a-z][a-z0-9_]*$'),
  make text NOT NULL CHECK (make = lower(btrim(make)) AND length(make) > 0),
  model_pattern text,
  vin_body_codes text[],
  year_min integer,
  year_max integer,
  sweep boolean NOT NULL DEFAULT false,
  decode boolean NOT NULL DEFAULT false,
  ord smallint NOT NULL DEFAULT 100,
  note text NOT NULL CHECK (length(btrim(note)) >= 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (model_pattern IS NOT NULL OR vin_body_codes IS NOT NULL),
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max)
);
ALTER TABLE public.model_fold_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_fold_scopes_read ON public.model_fold_scopes;
CREATE POLICY model_fold_scopes_read ON public.model_fold_scopes FOR SELECT USING (true);
REVOKE ALL ON public.model_fold_scopes FROM PUBLIC, anon, authenticated;
-- the vehicles signal triggers reach model_fold_in_scope as the writing role, so every API role reads the rows
GRANT SELECT ON public.model_fold_scopes TO anon, authenticated, service_role;
COMMENT ON TABLE public.model_fold_scopes IS
  'model_fold_scope_rows_v1: which cars a model fold scope holds (make, model pattern, VIN body codes under the make''s vin_format rows, years), whether the sweep walks it and whether its cars decode.';

ALTER TABLE public.model_fold_cursor ADD COLUMN IF NOT EXISTS forced_at timestamptz;

INSERT INTO public.model_fold_scopes (scope, make, model_pattern, vin_body_codes, year_min, year_max, sweep, decode, ord, note)
SELECT s.scope, s.make, s.pat, s.body, s.y0, s.y1,
       coalesce((public.model_fold_config() -> 'scopes') ? s.scope, false),
       coalesce((public.model_fold_config() -> 'decode_scopes') ? s.scope, false), s.ord, s.note
  FROM (VALUES
    ('pontiac_f_body', 'pontiac', 'firebird|trans ?am', ARRAY['87'], NULL::int, NULL::int, 10::smallint,
     'Pontiac F-body: Firebird / Trans Am by model, or body 87 under a Pontiac vin_format row'),
    ('ford_mustang_65_73', 'ford', 'mustang', NULL::text[], 1965, 1973, 20::smallint, 'Ford Mustang 1965-1973 by model'),
    ('chevrolet_camaro_67_69', 'chevrolet', 'camaro', NULL::text[], 1967, 1969, 30::smallint, 'Chevrolet Camaro 1967-1969 by model')
  ) s(scope, make, pat, body, y0, y1, ord, note)
ON CONFLICT (scope) DO NOTHING;

CREATE OR REPLACE FUNCTION public.model_fold_scope_of(p_make text, p_model text, p_vin text, p_year integer)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- model_fold_scope_rows_v1
  select s.scope
    from public.model_fold_scopes s
   where s.make = lower(p_make)
     and (s.year_min is null or p_year >= s.year_min)
     and (s.year_max is null or p_year <= s.year_max)
     and ((s.model_pattern is not null and coalesce(p_model, '') ~* s.model_pattern)
          or (s.vin_body_codes is not null and exists (
                select 1 from public.vehicle_decode_rules f
                 where f.rule_key = 'vin_format' and f.superseded_at is null and lower(f.make) = s.make
                   and upper(btrim(coalesce(p_vin, ''))) ~ (f.value ->> 'regex')
                   and substr(upper(btrim(p_vin)), (f.value #>> '{positions,body,0}')::int, (f.value #>> '{positions,body,1}')::int)
                       = any (s.vin_body_codes))))
   order by s.ord, s.scope
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.model_fold_scope_make(p_scope text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select s.make from public.model_fold_scopes s where s.scope = p_scope  -- model_fold_scope_rows_v1
$function$;

CREATE OR REPLACE FUNCTION public.model_fold_in_scope(p_make text, p_model text, p_vin text, p_year integer, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select p_id is not null and p_id::text not like '9cf5b7a4%'
     and public.model_fold_scope_of(p_make, p_model, p_vin, p_year) in
         (select s.scope from public.model_fold_scopes s where s.sweep)  -- model_fold_scope_rows_v1
$function$;

DO $patch$
DECLARE d text; n int;
  one_a text := $a$(select jsonb_array_elements_text(p_cfg -> 'decode_scopes'))$a$;
  one_r text := $a$(select fs.scope from public.model_fold_scopes fs where fs.decode) /* model_fold_scope_rows_v1 */$a$;
  sw_a text := $a$for s in select jsonb_array_elements_text(p_cfg -> 'scopes') loop$a$;
  sw_r text := $a$for s in select fs.scope from public.model_fold_scopes fs where fs.sweep order by fs.ord, fs.scope loop  -- model_fold_scope_rows_v1$a$;
  fk_a text := $a$or w2.folded_key is not distinct from p_key$a$;
  fk_r text := $a$or (w2.folded_key is not distinct from p_key and (c.forced_at is null or w2.folded_at >= c.forced_at))$a$;
BEGIN
  d := pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure);
  IF position('model_fold_scope_rows_v1' IN d) = 0 THEN
    n := (length(d) - length(replace(d, one_a, ''))) / length(one_a);
    IF n <> 1 THEN RAISE EXCEPTION 'model_fold_one decode_scopes anchor: % matches', n; END IF;
    EXECUTE replace(d, one_a, one_r);
  END IF;

  d := pg_get_functiondef('public.model_fold_sweep(text,jsonb)'::regprocedure);
  IF position('model_fold_scope_rows_v1' IN d) = 0 THEN
    n := (length(d) - length(replace(d, sw_a, ''))) / length(sw_a);
    IF n <> 1 THEN RAISE EXCEPTION 'model_fold_sweep scopes anchor: % matches', n; END IF;
    n := (length(d) - length(replace(d, fk_a, ''))) / length(fk_a);
    IF n <> 1 THEN RAISE EXCEPTION 'model_fold_sweep folded_key anchor: % matches', n; END IF;
    EXECUTE replace(replace(d, sw_a, sw_r), fk_a, fk_r);
  END IF;
END $patch$;

-- A scope row that changes what it holds or does forces its next pass ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.model_fold_scopes_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.make, NEW.model_pattern, NEW.vin_body_codes, NEW.year_min, NEW.year_max, NEW.sweep, NEW.decode, NEW.ord)
       IS NOT DISTINCT FROM (OLD.make, OLD.model_pattern, OLD.vin_body_codes, OLD.year_min, OLD.year_max, OLD.sweep, OLD.decode, OLD.ord) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.model_fold_cursor (scope, forced_at) VALUES (NEW.scope, now())
  ON CONFLICT (scope) DO UPDATE SET forced_at = now(), snapshot_at = NULL, verified_key = NULL, updated_at = now();
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.model_fold_scopes_changed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS model_fold_scopes_changed ON public.model_fold_scopes;
CREATE TRIGGER model_fold_scopes_changed AFTER INSERT OR UPDATE ON public.model_fold_scopes
  FOR EACH ROW EXECUTE FUNCTION public.model_fold_scopes_changed();
