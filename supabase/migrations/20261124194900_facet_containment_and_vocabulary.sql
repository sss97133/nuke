-- vehicle_facet_items: two values of one text item are one value when the words of one are contained in the other, or
-- when a vocabulary rule row names them the same class. Builds on vehicle_facet_key_formats (20261124194500).
--
-- WHY. Measured 2026-11-25, logged out, on the facts bench: after the settle (20261124193600), six items stayed in conflict
-- with the vehicle record on one side. Four are the same fact worded twice: model.recorded 'Mustang Coupe 289' (BaT) vs
-- 'Mustang' (record); 'Pickup R3500 Cheyenne' (listing) vs 'R3500' (record); body_style.recorded 'Truck' (listing + a photo
-- reading) vs 'PICKUP' (record, canonical_body_styles), twice. Two are real disagreements and stay: 'Charger 360' vs
-- 'Charger 318'; 'K2500' vs 'K1500'.
--
-- WHAT.
-- 1. vehicle_facet_key_formats gains vocabulary (CHECK: 'canonical_body_styles'). A row with a vocabulary compares by the
--    vocabulary class: the one active canonical_body_styles row whose canonical_name or one of whose aliases equals the
--    value (lower-cased, trimmed); no single match, the value as before. Row: body_style.recorded. format_rule_key names the
--    vocabulary table (its citation). SELECT on the rule rows for anon/authenticated (rule rows only), because the reader
--    now reads them as its caller.
-- 2. vehicle_facet_items, for text items with no format row (the lead's fallback, board 2026-11-24): a value whose
--    word set (split on non-alphanumerics) is contained in another value's word set of the same item compares as the
--    largest such value, when the values containing it form one chain. 'mustang' -> 'mustang coupe 289'. Two values that
--    each contain it ('charger 318', 'charger 360') are not a chain: each keeps its own key, so their conflict stays.
--    Merging only joins keys, so no item gains a conflict.
--
-- REVERT: re-run the reader body without the facet_containment_v1 change (marker facet_containment_v1), restore
-- vehicle_facet_key_norm from 20261124194500, ALTER TABLE vehicle_facet_key_formats DROP COLUMN vocabulary, DELETE the
-- body_style.recorded row. Contract: supabase/sql/test_facet_containment_and_vocabulary.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.vehicle_facet_key_formats ADD COLUMN IF NOT EXISTS vocabulary text;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_facet_key_formats_vocabulary_check') THEN
    ALTER TABLE public.vehicle_facet_key_formats ADD CONSTRAINT vehicle_facet_key_formats_vocabulary_check
      CHECK (vocabulary IS NULL OR vocabulary IN ('canonical_body_styles'));
  END IF;
END $c$;
DROP POLICY IF EXISTS vehicle_facet_key_formats_read ON public.vehicle_facet_key_formats;
CREATE POLICY vehicle_facet_key_formats_read ON public.vehicle_facet_key_formats FOR SELECT USING (true);
GRANT SELECT ON public.vehicle_facet_key_formats TO anon, authenticated, service_role;
INSERT INTO public.vehicle_facet_key_formats (item_key, format_rule_key, vocabulary, note) VALUES
  ('body_style.recorded', 'canonical_body_styles', 'canonical_body_styles',
   'the body style class: canonical_body_styles.canonical_name, matched by name or alias')
ON CONFLICT (item_key) DO UPDATE SET format_rule_key = excluded.format_rule_key, vocabulary = excluded.vocabulary, note = excluded.note;

CREATE OR REPLACE FUNCTION public.vehicle_facet_key_norm(p_item_key text, p_kind text, p_value text, p_make text, p_year integer)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE f public.vehicle_facet_key_formats; toks text[]; kept text[]; t text; code text; yy text; lv text;
BEGIN
  SELECT * INTO f FROM public.vehicle_facet_key_formats WHERE item_key = p_item_key;
  IF NOT FOUND OR p_value IS NULL THEN RETURN public.vehicle_facet_norm(p_kind, p_value); END IF;
  IF f.vocabulary = 'canonical_body_styles' THEN
    lv := lower(btrim(p_value));
    SELECT CASE WHEN count(*) = 1 THEN lower(min(c.canonical_name)) END INTO code
      FROM public.canonical_body_styles c
     WHERE c.is_active IS NOT FALSE AND (lower(c.canonical_name) = lv OR lv = ANY (SELECT lower(a) FROM unnest(c.aliases) a));
    RETURN coalesce(code, public.vehicle_facet_norm(p_kind, p_value));
  END IF;
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

DO $patch$
DECLARE d text;
  a0 text := '-- One row per (item, independent source, stated value): the observation-writer mirror and its observation count once.';
  a1 text := 'FROM (SELECT t.*, public.vehicle_facet_key_norm(t.key, t.nk, t.val, (SELECT v.make FROM v), (SELECT v.year FROM v)) AS norm FROM t) x';
  r1 text := 'FROM (SELECT tn.*, coalesce(tc.norm, tn.norm0) AS norm FROM tn LEFT JOIN tc ON tc.key = tn.key AND tc.norm0 = tn.norm0) x';
  cte text := $cte$-- facet_containment_v1: each value's comparison key (vehicle_facet_key_norm); then, for a text item with no format row,
-- a value whose words are contained in other values of the item that form one chain compares as the largest of them.
tn AS MATERIALIZED (
  SELECT t.*, public.vehicle_facet_key_norm(t.key, t.nk, t.val, (SELECT v.make FROM v), (SELECT v.year FROM v)) AS norm0 FROM t
),
tk AS MATERIALIZED (
  SELECT DISTINCT tn.key, tn.norm0, array_remove(regexp_split_to_array(tn.norm0, '[^a-z0-9]+'), '') AS tok
  FROM tn
  WHERE tn.norm0 IS NOT NULL AND tn.nk = 'text'
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_facet_key_formats f WHERE f.item_key = tn.key)
),
tc AS (
  SELECT a.key, a.norm0,
         (SELECT b.norm0 FROM tk b WHERE b.key = a.key AND a.tok <@ b.tok ORDER BY cardinality(b.tok) DESC, b.norm0 LIMIT 1) AS norm
  FROM tk a
  WHERE cardinality(a.tok) > 0
    AND NOT EXISTS (SELECT 1 FROM tk b JOIN tk c ON c.key = b.key
                     WHERE b.key = a.key AND a.tok <@ b.tok AND a.tok <@ c.tok
                       AND NOT (b.tok <@ c.tok) AND NOT (c.tok <@ b.tok))
),
$cte$;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid, text)'::regprocedure);
  IF position('facet_containment_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, a0, ''))) / length(a0) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: td comment anchor not found exactly once'; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'vehicle_facet_items: norm anchor not found exactly once (needs 20261124194500)'; END IF;
  d := replace(d, a0, cte || a0);
  d := replace(d, a1, r1);
  EXECUTE d;
END $patch$;
