-- vehicle_identifiers: typed, cited identifiers (VIN is one kind among several), era-aware rules,
-- body-style canon additions, replica flag, numbers state. Additive only; no existing column changes.
-- One shared rule set: listing-text extractors (_shared/identifierClaims.ts) and the photo/capture-set path
-- both land claims through land_identifier_claims() and validate with identifier_rule_for().

CREATE TABLE IF NOT EXISTS public.identifier_rules (
  id bigserial PRIMARY KEY,
  make_canonical text NOT NULL,            -- canonical_makes.canonical_name
  model_prefix text NOT NULL DEFAULT '',   -- lower-case prefix of model, '' = any
  kind text NOT NULL CHECK (kind IN ('vin','chassis','engine','body_number','transmission','assigned_vin','coachbuilder_plate')),
  series text, body_style text, coachbuilder text,
  model_year_from int, model_year_to int,
  pattern text NOT NULL,                   -- POSIX regex on normalized value
  range_lo bigint, range_hi bigint,        -- numeric range when value is all digits
  citation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identifier_rules_lookup ON public.identifier_rules (make_canonical, kind, model_prefix);

CREATE TABLE IF NOT EXISTS public.vehicle_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('vin','chassis','engine','body_number','transmission','assigned_vin','coachbuilder_plate','kardex','coa')),
  value text,                              -- null for document kinds (kardex, coa) asserted without a number
  value_norm text GENERATED ALWAYS AS (upper(regexp_replace(coalesce(value,''), '[\s\-/.]', '', 'g'))) STORED,
  make_canonical text,
  coachbuilder text,
  source_kind text NOT NULL CHECK (source_kind IN ('listing_text','photo','kardex','coa','title','owner','legacy_vin_column')),
  source_url text, source_image_id uuid, quote text,
  extractor text, run_id uuid,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rule_id bigint REFERENCES public.identifier_rules(id),
  rule_status text NOT NULL DEFAULT 'unchecked' CHECK (rule_status IN ('unchecked','in_range','out_of_range','no_rule')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_identifiers_claim_uniq
  ON public.vehicle_identifiers (vehicle_id, kind, value_norm, source_kind, coalesce(source_url,''));
-- Identity key for dedup: chassis/VIN scoped by make. Not unique: two profiles sharing it are dedup candidates, not errors.
CREATE INDEX IF NOT EXISTS vehicle_identifiers_identity_key
  ON public.vehicle_identifiers (make_canonical, kind, value_norm) WHERE kind IN ('vin','chassis') AND superseded_at IS NULL;
ALTER TABLE public.vehicle_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identifier_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_identifiers_read ON public.vehicle_identifiers FOR SELECT USING (true);
CREATE POLICY identifier_rules_read ON public.identifier_rules FOR SELECT USING (true);

-- Vehicle-level labels (additive columns).
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_replica boolean,
  ADD COLUMN IF NOT EXISTS replica_quote text,
  ADD COLUMN IF NOT EXISTS numbers_state text CHECK (numbers_state IN ('matching','non_matching','unknown')),
  ADD COLUMN IF NOT EXISTS numbers_documented_by text[] ,
  ADD COLUMN IF NOT EXISTS numbers_quote text,
  ADD COLUMN IF NOT EXISTS body_style_quote text;

-- Body-style canon: extend the existing canonical_body_styles table (no enum, no duplicate table).
INSERT INTO public.canonical_body_styles (canonical_name, display_name, vehicle_type, aliases, description, is_active)
VALUES
  ('SPEEDSTER','Speedster','CAR',ARRAY['speedster'],'Low-windscreen open two-seater (e.g. Porsche 356 Speedster 1954-58)',true),
  ('CONVERTIBLE_D','Convertible D','CAR',ARRAY['convertible d','convertible "d"'],'Porsche 356A Convertible D (Drauz) 1958-59',true),
  ('CABRIOLET','Cabriolet','CAR',ARRAY['cabriolet','cabrio'],'Fully trimmed convertible with padded top',true),
  ('HARDTOP','Hardtop','CAR',ARRAY['hardtop','karmann hardtop','notchback'],'Fixed or welded hardtop body (e.g. 356B Karmann Hardtop)',true)
ON CONFLICT (canonical_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.identifier_rule_for(p_make text, p_model text, p_kind text, p_value text)
RETURNS TABLE (rule_id bigint, rule_status text, series text, body_style text, coachbuilder text, model_year_from int, model_year_to int)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH v AS (SELECT upper(regexp_replace(coalesce(p_value,''), '[\s\-/.]', '', 'g')) AS n),
  r AS (SELECT ir.* FROM identifier_rules ir, v
        WHERE ir.make_canonical = upper(public.normalize_make(p_make)) AND ir.kind = p_kind
          AND lower(coalesce(p_model,'')) LIKE ir.model_prefix || '%')
  SELECT r.id, 'in_range', r.series, r.body_style, r.coachbuilder, r.model_year_from, r.model_year_to
  FROM r, v WHERE v.n ~ r.pattern AND (r.range_lo IS NULL OR (v.n ~ '^[0-9]+$' AND v.n::bigint BETWEEN r.range_lo AND r.range_hi))
  UNION ALL
  SELECT NULL::bigint, CASE WHEN EXISTS (SELECT 1 FROM r) THEN 'out_of_range' ELSE 'no_rule' END, NULL, NULL, NULL, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM r, v WHERE v.n ~ r.pattern AND (r.range_lo IS NULL OR (v.n ~ '^[0-9]+$' AND v.n::bigint BETWEEN r.range_lo AND r.range_hi)))
  LIMIT 1
$$;

-- Lands one readIdentifierClaims() result (listing text or photo/capture-set read). Service role only.
CREATE OR REPLACE FUNCTION public.land_identifier_claims(p_vehicle_id uuid, p_read jsonb, p_source_url text, p_extractor text,
  p_source_kind text DEFAULT 'listing_text', p_source_image_id uuid DEFAULT NULL, p_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; c jsonb; n int := 0; rr record; v_rule_body text; v_body text;
BEGIN
  SELECT id, make, model FROM vehicles WHERE id = p_vehicle_id INTO v;
  IF v.id IS NULL THEN RETURN jsonb_build_object('status','no_vehicle'); END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_read->'identifiers','[]')) LOOP
    SELECT * INTO rr FROM identifier_rule_for(v.make, v.model, c->>'kind', c->>'value');
    INSERT INTO vehicle_identifiers (vehicle_id, kind, value, make_canonical, source_kind, source_url, source_image_id, quote,
      extractor, run_id, confidence, rule_id, rule_status)
    VALUES (p_vehicle_id, c->>'kind', c->>'value', upper(normalize_make(v.make)), p_source_kind, p_source_url, p_source_image_id,
      left(c->>'quote', 400), p_extractor, p_run_id,
      least(1, greatest(0, (c->>'confidence')::numeric + CASE WHEN rr.rule_status = 'in_range' THEN 0.1 WHEN rr.rule_status = 'out_of_range' THEN -0.3 ELSE 0 END)),
      rr.rule_id, CASE WHEN c->>'value' IS NULL THEN 'unchecked' ELSE rr.rule_status END)
    ON CONFLICT DO NOTHING;
    IF c->>'kind' = 'chassis' AND rr.rule_status = 'in_range' THEN v_rule_body := coalesce(v_rule_body, rr.body_style); END IF;
  END LOOP;
  -- Body-style precedence: title, then the chassis rule range, then description text.
  v_body := CASE WHEN p_read->>'body_style_basis' = 'title' THEN p_read->>'body_style'
                 ELSE coalesce(v_rule_body, p_read->>'body_style') END;
  -- Vehicle labels: fill only when empty; never overwrite a human or earlier value.
  UPDATE vehicles SET
    is_replica = coalesce(is_replica, CASE WHEN (p_read->>'is_replica')::boolean THEN true END),
    replica_quote = coalesce(replica_quote, p_read->>'replica_quote'),
    numbers_state = coalesce(numbers_state, p_read->>'numbers_claim'),
    numbers_quote = coalesce(numbers_quote, p_read->>'numbers_quote'),
    numbers_documented_by = coalesce(numbers_documented_by, nullif(ARRAY(SELECT jsonb_array_elements_text(p_read->'documented_by')), '{}')),
    canonical_body_style = coalesce(canonical_body_style, CASE WHEN (p_read->>'is_replica')::boolean THEN NULL ELSE v_body END),
    body_style_quote = coalesce(body_style_quote, p_read->>'body_style_quote')
  WHERE id = p_vehicle_id;
  RETURN jsonb_build_object('status','ok');
END $$;
REVOKE ALL ON FUNCTION public.land_identifier_claims(uuid, jsonb, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Dedup candidates: same make + chassis/VIN on >1 live profile. Folding is done by merge_vehicle_into_primary_by_url (supersession
-- into superseded_rows); this view only proposes.
CREATE OR REPLACE VIEW public.identifier_dedup_candidates AS
SELECT make_canonical, kind, value_norm, array_agg(DISTINCT vehicle_id) AS vehicle_ids, count(DISTINCT vehicle_id) AS profiles
FROM vehicle_identifiers WHERE kind IN ('vin','chassis') AND superseded_at IS NULL AND value_norm <> ''
GROUP BY 1,2,3 HAVING count(DISTINCT vehicle_id) > 1;
