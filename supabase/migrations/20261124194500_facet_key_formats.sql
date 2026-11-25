-- vehicle_facet_key_formats: a fact item whose value is one field of a printed line (a body tag, a casting with its
-- foundry mark) is compared by the token its decode rule rows define, not by the whole string.
--
-- WHY. Measured 2026-11-25, logged out, on the proof vehicle: three items in conflict since the doubt answers landed
-- (20261124193100), each the same value read with different framing: body_style.body_tag '2fs87' (2 photos) vs
-- '73 2fs87' (the doubt re-read, model year token included); body_style.body_number '189504' vs 'n 189504' (plant letter
-- included); transmission.current.tailhousing_casting '3857584' vs '3857584gm' (foundry mark included). A second read
-- that agrees made the fact worse. vehicle_decode_rules already defines the line (body_tag_line_format: 'ST <model year>
-- <style number> <plant> <body number> BDY'), the codes (body_tag_style_number, body_tag_plant_code,
-- transmission_*_casting) and the foundry mark (qualifiers.oem_group).
--
-- WHAT.
-- 1. vehicle_facet_key_formats (item_key PK): format_rule_key (the vehicle_decode_rules rule_key that defines the line,
--    the citation), code_rule_key (the rule whose codes are this item's value), strip_rule_keys (rules whose codes are
--    other fields' tokens on the same line), strip_model_year (drop a two-digit token equal to the vehicle's model year),
--    suffix_qualifier (a qualifier of the code row naming a mark that may follow the code), match_vehicle_year (whether
--    the code row's year range must hold the vehicle's year; false for castings, a part can come from another year).
-- 2. vehicle_facet_key_norm(item_key, nk, value, make, year): with no format row, vehicle_facet_norm(nk, value) as
--    before. With one: the value's alphanumeric tokens; tokens that are codes of strip_rule_keys dropped; the model-year
--    token dropped when others remain; then the code of code_rule_key that a token equals, or starts with followed by
--    exactly the row's suffix_qualifier mark; else the remaining tokens joined. Patterns come from the rule rows only.
-- 3. vehicle_facet_items compares by it at its one normalisation line (anchored). The new key is a function of the old
--    one (lower-cased, whitespace-collapsed), so distinct values can only merge: no item can become a conflict.
--
-- REVERT: re-run the vehicle_facet_items body without the anchored change (the marker facet_key_formats_v1), DROP
-- FUNCTION vehicle_facet_key_norm, DROP TABLE vehicle_facet_key_formats. Contract: supabase/sql/test_facet_key_formats.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.vehicle_facet_key_formats (
  item_key text PRIMARY KEY,
  format_rule_key text NOT NULL,
  code_rule_key text,
  strip_rule_keys text[] NOT NULL DEFAULT '{}',
  strip_model_year boolean NOT NULL DEFAULT false,
  suffix_qualifier text,
  match_vehicle_year boolean NOT NULL DEFAULT true,
  note text NOT NULL
);
ALTER TABLE public.vehicle_facet_key_formats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_facet_key_formats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_facet_key_formats TO service_role;
COMMENT ON TABLE public.vehicle_facet_key_formats IS
  'Rule rows: which token of a printed line a fact item compares by, named through vehicle_decode_rules rule keys. Read by vehicle_facet_key_norm. 20261124194500.';
INSERT INTO public.vehicle_facet_key_formats
  (item_key, format_rule_key, code_rule_key, strip_rule_keys, strip_model_year, suffix_qualifier, match_vehicle_year, note) VALUES
  ('body_style.body_tag', 'body_tag_line_format', 'body_tag_style_number', '{body_tag_plant_code}', true, NULL, true,
   'ST <model year> <style number> <plant> <body number> BDY: the style number, without the model year or plant'),
  ('body_style.body_number', 'body_tag_line_format', NULL, '{body_tag_plant_code,body_tag_style_number}', true, NULL, true,
   'ST <model year> <style number> <plant> <body number> BDY: the body number, without the plant letter'),
  ('transmission.current.tailhousing_casting', 'transmission_tailhousing_casting', 'transmission_tailhousing_casting', '{}', false,
   'oem_group', false, 'casting number; a trailing foundry mark (qualifiers.oem_group, GM) is not part of it'),
  ('transmission.current.case_casting', 'transmission_case_casting', 'transmission_case_casting', '{}', false,
   'oem_group', false, 'casting number; a trailing foundry mark (qualifiers.oem_group, GM) is not part of it')
ON CONFLICT (item_key) DO UPDATE SET format_rule_key = excluded.format_rule_key, code_rule_key = excluded.code_rule_key,
  strip_rule_keys = excluded.strip_rule_keys, strip_model_year = excluded.strip_model_year,
  suffix_qualifier = excluded.suffix_qualifier, match_vehicle_year = excluded.match_vehicle_year, note = excluded.note;

CREATE OR REPLACE FUNCTION public.vehicle_facet_key_norm(p_item_key text, p_kind text, p_value text, p_make text, p_year integer)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE f public.vehicle_facet_key_formats; toks text[]; kept text[]; t text; code text; yy text;
BEGIN
  SELECT * INTO f FROM public.vehicle_facet_key_formats WHERE item_key = p_item_key;
  IF NOT FOUND OR p_value IS NULL THEN RETURN public.vehicle_facet_norm(p_kind, p_value); END IF;
  toks := array_remove(regexp_split_to_array(upper(btrim(p_value)), '[^A-Z0-9]+'), '');
  IF cardinality(toks) = 0 THEN RETURN NULL; END IF;
  -- other fields' codes on the same line
  SELECT array_agg(x ORDER BY o) INTO kept FROM unnest(toks) WITH ORDINALITY u(x, o)
   WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules r
                      WHERE r.rule_key = ANY (f.strip_rule_keys) AND r.superseded_at IS NULL AND upper(r.code) = u.x
                        AND (r.make IS NULL OR lower(r.make) = lower(p_make))
                        AND (p_year IS NULL OR ((r.year_min IS NULL OR r.year_min <= p_year) AND (r.year_max IS NULL OR r.year_max >= p_year))));
  kept := coalesce(kept, '{}');
  yy := CASE WHEN p_year IS NOT NULL THEN right(p_year::text, 2) END;
  IF f.strip_model_year AND yy IS NOT NULL AND cardinality(kept) > 1 THEN kept := array_remove(kept, yy); END IF;
  IF f.code_rule_key IS NOT NULL THEN
    FOREACH t IN ARRAY kept LOOP
      SELECT upper(r.code) INTO code FROM public.vehicle_decode_rules r
       WHERE r.rule_key = f.code_rule_key AND r.superseded_at IS NULL
         AND (r.make IS NULL OR lower(r.make) = lower(p_make))
         AND (NOT f.match_vehicle_year OR p_year IS NULL
              OR ((r.year_min IS NULL OR r.year_min <= p_year) AND (r.year_max IS NULL OR r.year_max >= p_year)))
         AND (upper(r.code) = t
              OR (f.suffix_qualifier IS NOT NULL AND r.qualifiers ? f.suffix_qualifier
                  AND t = upper(r.code) || upper(r.qualifiers ->> f.suffix_qualifier)))
       ORDER BY length(r.code) DESC LIMIT 1;
      IF code IS NOT NULL THEN RETURN lower(code); END IF;
    END LOOP;
  END IF;
  IF cardinality(kept) = 0 THEN RETURN public.vehicle_facet_norm(p_kind, p_value); END IF;
  RETURN lower(array_to_string(kept, ' '));
END;
$$;
REVOKE ALL ON FUNCTION public.vehicle_facet_key_norm(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_facet_key_norm(text, text, text, text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_facet_key_norm(text, text, text, text, integer) IS
  'The comparison key of one fact item value: vehicle_facet_norm, or the token vehicle_facet_key_formats names through vehicle_decode_rules. 20261124194500.';

DO $patch$
DECLARE d text;
  a1 text := 'public.vehicle_facet_norm(t.nk, t.val) AS norm FROM t';
  r1 text := 'public.vehicle_facet_key_norm(t.key, t.nk, t.val, (SELECT v.make FROM v), (SELECT v.year FROM v)) AS norm FROM t';
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('facet_key_formats_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: norm anchor not found exactly once'; END IF;
  d := replace(d, a1, r1);
  d := replace(d, '-- facet_items_v1', '-- facet_items_v1' || chr(10) || '-- facet_key_formats_v1');
  EXECUTE d;
END $patch$;
