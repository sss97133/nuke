-- Factory model separation in existing Fiat catalog; vehicle/source testimony is unchanged.
-- Fiat history and Stellantis Heritage identify 1100/126/127/128/130/131/Panda/Uno/barchetta separately.
-- Giugiaro's original-designer portfolio identifies Fiat850 Spider. Topolino remains a supported500 alias.
-- Named source specimens do not establish whole production ranges; new ranges remain NULL.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
-- Preserve concurrent owner edits; these are public SHA-256 definition fingerprints in base64.
-- No credential or secret-check exception is introduced. Repeated application is accepted.
DO $normalizer_guard$
BEGIN
 IF to_regprocedure('public.normalize_vehicle_model(text,text,integer)') IS NULL
    OR encode(sha256(convert_to(pg_get_functiondef('public.normalize_vehicle_model(text,text,integer)'::regprocedure),'UTF8')),'base64')
       NOT IN ('SHSHmiMgUbtPY2bpyw29HrbAKq/IBFg2C8Uz67KUJEI=','RHKCFe88xwr/r3NCPoF+zmaoRL/edzMjfBUksbOEczI=') THEN
   RAISE EXCEPTION 'model normalizer changed; review before applying Fiat correction';
 END IF;
END $normalizer_guard$;
CREATE TEMP TABLE fiat_identity_repair(id uuid PRIMARY KEY,make text,model text,before_aliases text[],after_aliases text[]) ON COMMIT DROP;
INSERT INTO fiat_identity_repair VALUES
  ('9da55c01-a98e-4a60-b60f-35898ffcf86a'::uuid,'Fiat','500',ARRAY['1100', '1100d', '1200', '126', '128', '130', '131', '1400', '1500', '1600s', '2300s', '500', '500c', '500d', '500f', '500f jolly', '500 jolly', '500l', '500n', '500r', '509 s', '519s', '600 jolly', 'barchetta', 'campagnola', 'eden roc', 'gamine', 'jolly', 'michelotti shellette', 'model 56', 'model 643', 'multipla', 'nuova 500', 'panda', 'shellette', 'spiaggetta', 'tipo 55', 'tipo 6', 'tipo 642', 'tipo 682', 'topolino', 'type 24/32', 'uno', '127a', '1300', '509', 'coupe 16v', 'project', 'siata 750', 'stabilimenti farina', 'pinin farina', 'bianchina', 'transformable', '1100es', 'gipsy', '110', '525n', 'tipo 1a', '1200tv', '1100b', '508', 'balilla', '127', 'trasformabile', '18p', '2300', 'nuova', 'tipo 2b', 'vetture speciali', 'millecento', '103e', '238']::text[],ARRAY['500', '500c', '500d', '500f', '500f jolly', '500 jolly', '500l', '500n', '500r', 'nuova 500', 'topolino']::text[]),
  ('00000000-0000-4000-f000-000000000189'::uuid,'Fiat','X1/9',ARRAY['850', '850 spider', '850 sport spider', 'bertone x1/9', 'x1/9']::text[],ARRAY['bertone x1/9', 'x1/9']::text[]);

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM fiat_identity_repair r LEFT JOIN public.canonical_models m ON m.id = r.id
             WHERE m.id IS NULL OR m.make IS DISTINCT FROM r.make OR m.canonical_model IS DISTINCT FROM r.model
                OR (m.aliases IS DISTINCT FROM r.before_aliases AND m.aliases IS DISTINCT FROM r.after_aliases)) THEN
    RAISE EXCEPTION 'model alias catalog changed; review identity repair before applying';
  END IF;
END $guard$;

UPDATE public.canonical_models m
SET aliases = r.after_aliases,
    notes = concat_ws(E'\n', nullif(m.notes, ''), '[2026-10-19 Fiat identity separation] Superseded broad-bucket aliases: ' || to_jsonb(m.aliases)::text)
FROM fiat_identity_repair r
WHERE m.id = r.id AND m.aliases IS DISTINCT FROM r.after_aliases;

WITH named(id,make,model,aliases,source) AS (VALUES
  ('bbfe13c9-ef0c-47b8-a820-579ef314e9fb'::uuid,'Fiat','1100',ARRAY['1100']::text[],'https://www.stellantisheritage.com/en-uk/heritage/stories/fiat-128'),
  ('97aadc7a-2bd4-437b-9720-7482590fa58b'::uuid,'Fiat','126',ARRAY['126']::text[],'https://www.fiat.com.au/fiat-world/history'),
  ('354f2726-5ee2-42cf-8f3d-b29e09d7e924'::uuid,'Fiat','127',ARRAY['127']::text[],'https://www.fiat.com.au/fiat-world/history'),
  ('6dff7e3c-6d97-469c-bec2-5cff014666ad'::uuid,'Fiat','128',ARRAY['128']::text[],'https://www.stellantisheritage.com/en-uk/heritage/stories/fiat-128'),
  ('abbfa689-24ce-4457-b7f7-aae1f6621ba1'::uuid,'Fiat','130',ARRAY['130']::text[],'https://www.stellantisheritage.com/en-uk/heritage/stories/fiat-130-familiare'),
  ('911ab920-36eb-440b-b25b-62e8fe5ac355'::uuid,'Fiat','131',ARRAY['131']::text[],'https://www.media.stellantis.com/es-es/fiat/press/50-anos-del-fiat-131-la-berlina-que-gano-el-mundial-de-rallies-y-llevo-con-orgullo-el-nombre-de-mirafiori'),
  ('cf963a5f-9173-4f97-a410-82b849dc3b1b'::uuid,'Fiat','Panda',ARRAY['panda']::text[],'https://www.fiat.com.au/fiat-world/history'),
  ('4b761dc4-df24-4373-8acf-1a6e39916e6d'::uuid,'Fiat','Uno',ARRAY['uno']::text[],'https://www.fiat.com.au/fiat-world/history'),
  ('f6e3b615-6538-4f30-aec5-2afb178231f9'::uuid,'Fiat','Barchetta',ARRAY['barchetta']::text[],'https://www.stellantisheritage.com/it-it/heritage/storie/fiat-barchetta'),
  ('70add75f-58c1-4de9-81a1-a5c22b1d9dc2'::uuid,'Fiat','850',ARRAY['850','850 spider','850 sport spider']::text[],'https://www.giorgettofabriziogiugiaro.it/projects/vehicles/850-spider'))
INSERT INTO public.canonical_models(id,make,canonical_model,aliases,year_start,year_end,notes)
SELECT n.id,n.make,n.model,n.aliases,NULL,NULL,
 '[2026-10-19 Fiat identity separation] Model-name reference: '||n.source||'; not a verified physical vehicle identity.'
FROM named n WHERE NOT EXISTS(SELECT 1 FROM public.canonical_models c
 WHERE lower(c.make)=lower(n.make) AND lower(c.canonical_model)=lower(n.model));

-- A fit made with superseded membership is not a fit for the corrected model. Use its existing writer.
-- The old reference aliases survive above; the pre-repair fit receipt is retained privately by the operator.
DO $invalidate$
DECLARE r record;
BEGIN
  IF to_regclass('public.family_price_change') IS NOT NULL THEN
    FOR r IN SELECT c.brand, c.family_key FROM public.family_price_change c
             JOIN fiat_identity_repair x ON x.make = c.brand AND x.id::text = c.family_key
             WHERE c.method IS DISTINCT FROM 'identity_membership_changed_v1' LOOP
      PERFORM public.record_family_price_index(jsonb_build_object('brand', r.brand, 'family_key', r.family_key, 'fitted_at', now(),
        'period_kind', NULL, 'series', '[]'::jsonb, 'change', jsonb_build_object(
          'change_12m', NULL, 'lo', NULL, 'hi', NULL, 'n_last12', 0, 'n_prior12', 0, 'verdict', 'too few to tell',
          'method', 'identity_membership_changed_v1', 'ref_car', jsonb_build_object('basis', 'Model membership corrected; awaiting a new fit'),
          'pairs', NULL, 'rs_change', NULL, 'rs_lo', NULL, 'rs_hi', NULL, 'chips', '[]'::jsonb)));
    END LOOP;
  END IF;
END $invalidate$;

-- The same catalog feeds intake normalization. Unknown ranges do not contradict a supplied year;
-- explicit bounds still exclude it. A longer generic display label must not outrank a more specific alias.
-- Preserve signature, owner, grants and trigger wiring; no scalar backfill or raw source mutation.
CREATE OR REPLACE FUNCTION public.normalize_vehicle_model(p_make text, p_raw_model text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(canonical_model text, canonical_series text, generation text, confidence integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  cleaned_model TEXT;
  v_canonical_model TEXT;
  v_canonical_series TEXT;
  v_generation TEXT;
  v_confidence INT := 0;
  -- Preserve the separately held GM truck lookup decisions and unqualified make requests.
  v_repaired_rules boolean := p_make IS NOT NULL
    AND lower(p_make) NOT IN ('chevrolet','gmc')
    AND position('%' IN p_make)=0 AND position('_' IN p_make)=0;
BEGIN
  IF p_raw_model IS NULL OR btrim(p_raw_model) = '' THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, 0;
    RETURN;
  END IF;

  -- Clean the input: lowercase, trim, remove common junk
  cleaned_model := LOWER(TRIM(p_raw_model));
  -- Remove location suffixes like "in Roseville, California"
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+in\s+[a-z]+.*$', '', 'i');
  -- Remove common noise words
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+(truck|vehicle|car|for sale)$', '', 'i');
  -- Normalize spaces
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+', ' ', 'g');

  -- Try exact alias match first
  SELECT cm.canonical_model, cm.canonical_series, cm.generation, 100
  INTO v_canonical_model, v_canonical_series, v_generation, v_confidence
  FROM canonical_models cm
  WHERE (cm.make ILIKE p_make OR p_make IS NULL)
    AND cleaned_model = ANY(cm.aliases)
    AND (p_year IS NULL OR ((cm.year_start <= p_year OR (v_repaired_rules AND cm.year_start IS NULL)) AND (cm.year_end IS NULL OR cm.year_end >= p_year)))
  LIMIT 1;

  IF v_canonical_model IS NOT NULL THEN
    RETURN QUERY SELECT v_canonical_model, v_canonical_series, v_generation, v_confidence;
    RETURN;
  END IF;

  -- Partial aliases are literal; adjacent digits cannot turn130 into1300 or911 into9110.
  -- Rank what actually matched, rather than an unrelated display-name length.
  SELECT cm.canonical_model, cm.canonical_series, cm.generation, 75
  INTO v_canonical_model, v_canonical_series, v_generation, v_confidence
  FROM canonical_models cm
  CROSS JOIN LATERAL (
    SELECT max(length(alias)) AS alias_length FROM unnest(cm.aliases) alias
    WHERE (NOT v_repaired_rules AND cleaned_model LIKE '%' || alias || '%')
       OR (v_repaired_rules AND alias <> '' AND position(alias IN cleaned_model) > 0
         AND (left(alias,1) !~ '[0-9]' OR
              substr(cleaned_model,position(alias IN cleaned_model)-1,1) !~ '[0-9]')
         AND (right(alias,1) !~ '[0-9]' OR
              substr(cleaned_model,position(alias IN cleaned_model)+length(alias),1) !~ '[0-9]'))
  ) matched
  WHERE (cm.make ILIKE p_make OR p_make IS NULL)
    AND matched.alias_length IS NOT NULL
    AND (p_year IS NULL OR ((cm.year_start <= p_year OR (v_repaired_rules AND cm.year_start IS NULL)) AND (cm.year_end IS NULL OR cm.year_end >= p_year)))
  ORDER BY CASE WHEN v_repaired_rules THEN matched.alias_length ELSE length(cm.canonical_model) END DESC,
           length(cm.canonical_model) DESC
  LIMIT 1;

  IF v_canonical_model IS NOT NULL THEN
    RETURN QUERY SELECT v_canonical_model, v_canonical_series, v_generation, v_confidence;
    RETURN;
  END IF;

  -- No match found
  RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, 0;
END;
$function$;

COMMIT;
