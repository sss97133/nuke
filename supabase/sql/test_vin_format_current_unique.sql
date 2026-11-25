-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vin_format_unique -f this-file.sql
-- Proves 20261125143000_vin_format_current_unique.sql: a second current vin_format row for the same make (any case)
-- and code is refused; a superseded copy, another code, another make and other rule keys are not affected. The table
-- holds production's columns as of 2026-11-25. Rows are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_decode_rules') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE TABLE public.vehicle_decode_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text NOT NULL, make text,
  model text, code text, year_min integer, year_max integer, qualifiers jsonb, value jsonb, citation_url text,
  citation_title text, citation_locator text, cited_on date, created_at timestamptz DEFAULT now(),
  superseded_by uuid, superseded_at timestamptz,
  CONSTRAINT vehicle_decode_rules_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.vehicle_decode_rules(id),
  CONSTRAINT vehicle_decode_rules_check1 CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)));

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- true when the insert is refused by a unique violation.
CREATE FUNCTION public.t_refused(p_rule text, p_make text, p_code text, p_url text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.vehicle_decode_rules (rule_key, make, code, citation_url) VALUES (p_rule, p_make, p_code, p_url);
  RETURN false;
EXCEPTION WHEN unique_violation THEN RETURN true;
END $$;

-- The replacement path: supersede the current row pointing at the new id, insert the new row, check references now.
-- Returns 'ok' or the SQLSTATE that refused it (the subtransaction is rolled back on refusal).
CREATE FUNCTION public.t_replace(p_make text, p_code text, p_url text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE nid uuid := gen_random_uuid();
BEGIN
  UPDATE public.vehicle_decode_rules SET superseded_at = now(), superseded_by = nid
   WHERE rule_key = 'vin_format' AND lower(make) = lower(p_make) AND code = p_code AND superseded_at IS NULL;
  INSERT INTO public.vehicle_decode_rules (id, rule_key, make, code, citation_url) VALUES (nid, 'vin_format', p_make, p_code, p_url);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;

INSERT INTO public.vehicle_decode_rules (rule_key, make, code, citation_url) VALUES
  ('vin_format', 'Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/a');

-- Before: a second citation of the same format lands beside the first.
SELECT t_assert(NOT t_refused('vin_format', 'pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/b'),
  'before: a second current row for the same format is admitted');
DELETE FROM public.vehicle_decode_rules WHERE citation_url = 'https://x.invalid/b';
SELECT t_assert(t_replace('Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/r0') = '23503',
  'before: superseding first, pointing at the new id, is refused by the foreign key (23503)');

\ir ../migrations/20261125143000_vin_format_current_unique.sql
\ir ../migrations/20261125143000_vin_format_current_unique.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert(t_refused('vin_format', 'pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/b'),
  'after: a second current row for the same make (other case) and code is refused');
SELECT t_assert(NOT t_refused('vin_format', 'Pontiac', 'gm_1981_17_vin_v1', 'https://x.invalid/c'),
  'after: another format code of the same make is admitted');
SELECT t_assert(NOT t_refused('vin_format', 'Chevrolet', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/d'),
  'after: the same code for another make is admitted');
SELECT t_assert(NOT t_refused('vin_series_char', 'Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/e')
  AND NOT t_refused('vin_series_char', 'Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/f'),
  'after: other rule keys are not affected');
-- The replacement path.
DO $$ BEGIN
  UPDATE public.vehicle_decode_rules SET superseded_at = now()
   WHERE rule_key = 'vin_format' AND make = 'Pontiac' AND code = 'gm_1972_1980_car_vin_v1' AND superseded_at IS NULL;
  RAISE EXCEPTION 'FAIL: superseded_at without superseded_by admitted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: stamping superseded_at alone is refused by check1 (as in production)'; END $$;
SELECT t_assert(t_replace('Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/g') = 'ok',
  'after: supersede pointing at the new id, then insert, lands in one transaction');
SELECT t_assert((SELECT count(*) FROM public.vehicle_decode_rules o JOIN public.vehicle_decode_rules n ON n.id = o.superseded_by
   WHERE o.rule_key = 'vin_format' AND o.code = 'gm_1972_1980_car_vin_v1' AND n.citation_url = 'https://x.invalid/g' AND n.superseded_at IS NULL) = 1
  AND (SELECT count(*) FROM public.vehicle_decode_rules WHERE rule_key = 'vin_format' AND code = 'gm_1972_1980_car_vin_v1'
        AND lower(make) = 'pontiac') = 2, 'the superseded row is kept beside its replacement and points at it');
SELECT t_assert(t_replace('Pontiac', 'gm_1972_1980_car_vin_v1', 'https://x.invalid/h') = 'ok',
  'after: a second replacement supersedes the first replacement the same way');
SELECT t_assert((SELECT condeferrable AND condeferred FROM pg_constraint WHERE conname = 'vehicle_decode_rules_superseded_by_fkey'),
  'after: the superseded_by foreign key is deferrable, initially deferred');
