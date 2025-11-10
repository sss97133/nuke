-- =====================================================
-- INTELLIGENT PARTS KNOWLEDGE SYSTEM
-- Integrate catalog into DB's "mind" for condition assessment
-- =====================================================

-- 1. ENHANCE part_catalog with condition intelligence
DO $$
BEGIN
  IF to_regclass('public.part_catalog') IS NULL THEN
    RAISE NOTICE 'Skipping part_catalog enhancements: table does not exist.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'condition_indicators'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN condition_indicators JSONB DEFAULT ''{}''::jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'typical_lifespan_miles'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN typical_lifespan_miles INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'typical_lifespan_years'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN typical_lifespan_years INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'common_failure_modes'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN common_failure_modes TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'wear_patterns'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN wear_patterns JSONB DEFAULT ''{}''::jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_new_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_new_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_excellent_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_excellent_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_good_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_good_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_fair_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_fair_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_poor_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_poor_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'price_core_cents'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN price_core_cents INTEGER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'key_visual_features'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN key_visual_features TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'color_variants'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN color_variants TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'size_dimensions'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN size_dimensions JSONB DEFAULT ''{}''::jsonb';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'mounting_location'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN mounting_location TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'adjacent_parts'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN adjacent_parts TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'example_images_new'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN example_images_new TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'example_images_worn'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN example_images_worn TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'example_images_damaged'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN example_images_damaged TEXT[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'part_catalog' AND column_name = 'ai_recognition_confidence_threshold'
  ) THEN
    EXECUTE 'ALTER TABLE public.part_catalog ADD COLUMN ai_recognition_confidence_threshold DECIMAL(3,2) DEFAULT 0.80';
  END IF;
END
$$;

-- 2. CREATE part_condition_guidelines table
CREATE TABLE IF NOT EXISTS part_condition_guidelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_category TEXT NOT NULL,
  
  -- Condition Definitions
  condition_grade INTEGER CHECK (condition_grade BETWEEN 1 AND 10),
  condition_label TEXT, -- 'Mint', 'Excellent', 'Good', 'Fair', 'Poor'
  
  -- Visual Indicators for This Grade
  visual_indicators JSONB, -- {chrome: "mirror finish", paint: "no chips", plastic: "no cracks"}
  disqualifying_damage TEXT[], -- Issues that drop to lower grade
  
  -- Functional Assessment
  functional_tests JSONB, -- How to verify it works
  expected_performance TEXT,
  
  -- Value Impact
  price_multiplier DECIMAL(4,2), -- vs new price (0.10 = 10% of new, 1.00 = full price)
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.part_condition_guidelines') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'part_condition_guidelines_unique'
        AND conrelid = 'public.part_condition_guidelines'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.part_condition_guidelines ADD CONSTRAINT part_condition_guidelines_unique UNIQUE (part_category, condition_grade)';
    END IF;
  END IF;
END
$$;

-- 3. SEED condition guidelines for common parts

-- CHROME PARTS (bumpers, grilles, trim)
DO $$
BEGIN
  IF to_regclass('public.part_condition_guidelines') IS NULL THEN
    RAISE NOTICE 'Skipping condition guideline seed: table does not exist.';
    RETURN;
  END IF;

  INSERT INTO public.part_condition_guidelines (part_category, condition_grade, condition_label, visual_indicators, disqualifying_damage, price_multiplier)
  VALUES
    ('chrome_bumper', 10, 'Mint/New', '{"chrome": "mirror finish, no pitting", "surface": "no scratches", "mounting": "perfect fitment"}'::jsonb, ARRAY['any visible damage'], 1.00),
    ('chrome_bumper', 8, 'Excellent', '{"chrome": "bright with minimal micro-scratches", "surface": "minor surface marks only", "mounting": "solid brackets"}'::jsonb, ARRAY['pitting', 'rust', 'dents'], 0.75),
    ('chrome_bumper', 6, 'Good', '{"chrome": "some dulling, light surface rust spots", "surface": "minor dings", "mounting": "functional"}'::jsonb, ARRAY['major dents', 'holes', 'heavy rust'], 0.50),
    ('chrome_bumper', 4, 'Fair', '{"chrome": "significant pitting, oxidation", "surface": "dents visible", "mounting": "needs repair"}'::jsonb, ARRAY['structural damage', 'missing sections'], 0.30),
    ('chrome_bumper', 2, 'Poor/Core', '{"chrome": "rust through, flaking", "surface": "heavy damage", "mounting": "broken"}'::jsonb, ARRAY[]::text[], 0.10)
  ON CONFLICT (part_category, condition_grade) DO UPDATE
  SET condition_label = EXCLUDED.condition_label,
      visual_indicators = EXCLUDED.visual_indicators,
      disqualifying_damage = EXCLUDED.disqualifying_damage,
      price_multiplier = EXCLUDED.price_multiplier;

-- LIGHTING (headlights, taillights)
  INSERT INTO public.part_condition_guidelines (part_category, condition_grade, condition_label, visual_indicators, disqualifying_damage, price_multiplier)
  VALUES
    ('headlight', 10, 'Mint/New', '{"lens": "crystal clear", "housing": "no cracks", "chrome": "perfect reflector", "seal": "intact"}'::jsonb, ARRAY['any damage'], 1.00),
    ('headlight', 8, 'Excellent', '{"lens": "clear with minor scratches", "housing": "solid", "chrome": "bright", "seal": "good"}'::jsonb, ARRAY['cracks', 'moisture inside', 'clouding'], 0.70),
    ('headlight', 6, 'Good', '{"lens": "light yellowing/hazing", "housing": "minor cracks", "chrome": "some tarnish", "seal": "functional"}'::jsonb, ARRAY['missing lens', 'broken housing', 'heavy oxidation'], 0.45),
    ('headlight', 4, 'Fair', '{"lens": "heavy yellowing, cracks", "housing": "damaged", "chrome": "oxidized", "seal": "compromised"}'::jsonb, ARRAY['shattered', 'missing parts'], 0.25),
    ('headlight', 2, 'Poor/Core', '{"lens": "opaque or missing", "housing": "broken", "chrome": "rusted", "seal": "none"}'::jsonb, ARRAY[]::text[], 0.10)
  ON CONFLICT (part_category, condition_grade) DO UPDATE
  SET condition_label = EXCLUDED.condition_label,
      visual_indicators = EXCLUDED.visual_indicators,
      disqualifying_damage = EXCLUDED.disqualifying_damage,
      price_multiplier = EXCLUDED.price_multiplier;

-- PAINTED PARTS (hoods, fenders, doors)
  INSERT INTO public.part_condition_guidelines (part_category, condition_grade, condition_label, visual_indicators, disqualifying_damage, price_multiplier)
  VALUES
    ('painted_panel', 10, 'Mint/New', '{"paint": "factory finish", "body": "no dents", "edges": "perfect", "rust": "none"}'::jsonb, ARRAY['any damage'], 1.00),
    ('painted_panel', 8, 'Excellent', '{"paint": "great shine, minor chips", "body": "straight", "edges": "clean", "rust": "none"}'::jsonb, ARRAY['dents', 'rust', 'major chips'], 0.70),
    ('painted_panel', 6, 'Good', '{"paint": "faded but intact", "body": "minor dings", "edges": "light rust", "rust": "surface only"}'::jsonb, ARRAY['holes', 'heavy rust', 'major dents'], 0.45),
    ('painted_panel', 4, 'Fair', '{"paint": "peeling/oxidized", "body": "visible dents", "edges": "rust through", "rust": "moderate"}'::jsonb, ARRAY['rot', 'major structural damage'], 0.25),
    ('painted_panel', 2, 'Poor/Core', '{"paint": "gone or heavy damage", "body": "major damage", "edges": "rusted", "rust": "heavy"}'::jsonb, ARRAY[]::text[], 0.10)
  ON CONFLICT (part_category, condition_grade) DO UPDATE
  SET condition_label = EXCLUDED.condition_label,
      visual_indicators = EXCLUDED.visual_indicators,
      disqualifying_damage = EXCLUDED.disqualifying_damage,
      price_multiplier = EXCLUDED.price_multiplier;

-- GLASS (windows, windshields)
  INSERT INTO public.part_condition_guidelines (part_category, condition_grade, condition_label, visual_indicators, disqualifying_damage, price_multiplier)
  VALUES
    ('glass', 10, 'Mint/New', '{"clarity": "perfect", "tint": "even", "edges": "clean", "cracks": "none"}'::jsonb, ARRAY['any damage'], 1.00),
    ('glass', 8, 'Excellent', '{"clarity": "clear", "tint": "good", "edges": "minor chips", "cracks": "none"}'::jsonb, ARRAY['cracks', 'pits', 'delamination'], 0.60),
    ('glass', 6, 'Good', '{"clarity": "light scratches", "tint": "intact", "edges": "chipped", "cracks": "hairline only"}'::jsonb, ARRAY['major cracks', 'shattered'], 0.35),
    ('glass', 4, 'Fair', '{"clarity": "scratched/pitted", "tint": "fading", "edges": "damaged", "cracks": "visible"}'::jsonb, ARRAY['shattered', 'missing'], 0.15),
    ('glass', 2, 'Poor/Core', '{"clarity": "opaque/damaged", "tint": "failing", "edges": "broken", "cracks": "severe"}'::jsonb, ARRAY[]::text[], 0.05)
  ON CONFLICT (part_category, condition_grade) DO UPDATE
  SET condition_label = EXCLUDED.condition_label,
      visual_indicators = EXCLUDED.visual_indicators,
      disqualifying_damage = EXCLUDED.disqualifying_damage,
      price_multiplier = EXCLUDED.price_multiplier;
END
$$;

-- 4. CREATE ai_part_recognition_rules table
CREATE TABLE IF NOT EXISTS ai_part_recognition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_category TEXT NOT NULL,
  
  -- Visual Recognition Instructions for AI
  primary_identifiers TEXT[], -- What to look for first
  secondary_features TEXT[], -- Confirming details
  dimensional_context TEXT, -- Where it's located
  typical_materials TEXT[], -- Chrome, plastic, steel, etc.
  
  -- Condition Assessment Instructions
  condition_checkpoints JSONB, -- {"chrome_pitting": "check for small holes", "rust": "look for orange/brown"}
  wear_assessment_prompt TEXT, -- Full AI prompt for condition grading
  
  -- Common Mistakes to Avoid
  often_confused_with TEXT[], -- Similar parts
  distinguishing_features TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.ai_part_recognition_rules') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ai_part_recognition_rules_unique'
        AND conrelid = 'public.ai_part_recognition_rules'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.ai_part_recognition_rules ADD CONSTRAINT ai_part_recognition_rules_unique UNIQUE (part_category)';
    END IF;
  END IF;
END
$$;

-- 5. SEED AI recognition rules for common parts
DO $$
BEGIN
  IF to_regclass('public.ai_part_recognition_rules') IS NULL THEN
    RAISE NOTICE 'Skipping AI recognition rule seed: table does not exist.';
    RETURN;
  END IF;

  INSERT INTO public.ai_part_recognition_rules (part_category, primary_identifiers, secondary_features, dimensional_context, typical_materials, condition_checkpoints, wear_assessment_prompt, often_confused_with, distinguishing_features)
  VALUES
  (
    'front_bumper', 
    ARRAY['chrome plated bar', 'horizontal orientation', 'bottom of front fascia', 'mounting brackets visible'],
    ARRAY['bumper guards (vertical black posts)', 'license plate bracket', 'spans full width'],
    'Located at bottom-front, typically 80-95% from top of image, 30-70% width, below grille and headlights',
    ARRAY['chrome-plated steel', 'stainless steel'],
    '{"pitting": "check chrome surface for small holes or bubbles", "rust": "look for orange/brown discoloration especially at edges", "dents": "check for impacts or bends", "mounting_damage": "inspect bracket areas"}'::jsonb,
    'Examine the chrome bumper for: 1) PITTING (small holes in chrome = corrosion underneath), 2) RUST (orange/brown = moisture damage), 3) DENTS (impacts), 4) STRAIGHTNESS (should be perfectly horizontal). Grade 10=mirror finish, 8=bright with minor marks, 6=dulling with light rust, 4=significant pitting, 2=rust through/flaking.',
    ARRAY['nerf bars', 'push bars', 'rear bumper'],
    'Front bumpers are ALWAYS at the bottom-front of the vehicle, below the grille. Chrome finish. Often have vertical bumper guards.'
  ),
  (
    'headlight', 
    ARRAY['round or rectangular lens', 'clear or slightly yellow plastic', 'paired (left and right)', 'chrome reflector visible'],
    ARRAY['bulb socket in back', 'mounting ring', 'sealed beam or replaceable bulb'],
    'Located flanking the grille, typically 55-70% from top, 15-30% (driver) or 70-85% (passenger) from left',
    ARRAY['glass lens', 'plastic lens', 'chrome reflector'],
    '{"lens_clarity": "check for yellowing, hazing, cracks", "housing_cracks": "inspect plastic housing for breaks", "moisture": "look for water/condensation inside", "chrome_reflector": "check for oxidation or peeling"}'::jsonb,
    'Examine headlight for: 1) LENS CLARITY (yellowing = UV damage, hazing = oxidation, cracks = impact), 2) HOUSING INTEGRITY (cracks allow moisture), 3) CHROME REFLECTOR (tarnish reduces light output), 4) SEAL CONDITION (moisture inside = seal failure). Grade 10=crystal clear, 8=clear with minor scratches, 6=light yellowing, 4=heavy yellowing/cracks, 2=opaque/broken.',
    ARRAY['fog lights', 'turn signals', 'marker lights'],
    'Headlights are always PAIRED on either side of the grille. Square (1973-80) or rectangular (1981-87) on GM trucks.'
  ),
  (
    'grille',
    ARRAY['horizontal chrome bars', 'central location', 'GMC or CHEVROLET badging', 'rectangular frame'],
    ARRAY['mounting tabs', 'emblem cutout', 'headlight openings on sides'],
    'Center-front of vehicle, 40-60% width, 60-75% height, between headlights',
    ARRAY['chrome-plated plastic', 'chrome-plated metal', 'painted plastic'],
    '{"chrome_condition": "check for peeling, fading", "cracks": "inspect for breaks in bars", "tabs": "check mounting points", "fitment": "gaps indicate damage"}'::jsonb,
    'Examine grille for: 1) CHROME FINISH (peeling = delamination, fading = UV damage), 2) STRUCTURAL INTEGRITY (cracks in bars, broken tabs), 3) FITMENT (gaps = warped or damaged), 4) EMBLEM CONDITION. Grade 10=perfect chrome, 8=bright with minor wear, 6=fading/minor damage, 4=peeling/cracks, 2=broken/heavily damaged.',
    ARRAY['bumper', 'air dam', 'valance'],
    'Grilles are the central front fascia element with horizontal bars. GMC grilles have GMC badge, Chevy have CHEVROLET or bowtie.'
  )
  ON CONFLICT (part_category) DO UPDATE
  SET primary_identifiers = EXCLUDED.primary_identifiers,
      secondary_features = EXCLUDED.secondary_features,
      dimensional_context = EXCLUDED.dimensional_context,
      typical_materials = EXCLUDED.typical_materials,
      condition_checkpoints = EXCLUDED.condition_checkpoints,
      wear_assessment_prompt = EXCLUDED.wear_assessment_prompt,
      often_confused_with = EXCLUDED.often_confused_with,
      distinguishing_features = EXCLUDED.distinguishing_features;
END
$$;

-- 6. CREATE part_wear_patterns table (teach AI what wear looks like)
CREATE TABLE IF NOT EXISTS part_wear_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_category TEXT NOT NULL,
  wear_type TEXT NOT NULL, -- 'oxidation', 'pitting', 'cracking', 'fading', etc.
  
  -- Visual Description
  visual_description TEXT,
  typical_appearance JSONB, -- {"color": "white/chalky", "texture": "rough", "location": "edges first"}
  severity_levels JSONB, -- {mild: "light haze", moderate: "visible roughness", severe: "flaking"}
  
  -- Causes
  common_causes TEXT[],
  environmental_factors TEXT[],
  
  -- Impact on Value
  value_impact_percentage INTEGER, -- How much this wear type reduces value
  repairability TEXT CHECK (repairability IN ('easy', 'moderate', 'difficult', 'impossible')),
  repair_cost_range TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.part_wear_patterns') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'part_wear_patterns_unique'
        AND conrelid = 'public.part_wear_patterns'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.part_wear_patterns ADD CONSTRAINT part_wear_patterns_unique UNIQUE (part_category, wear_type)';
    END IF;
  END IF;
END
$$;

-- 7. SEED wear patterns
DO $$
BEGIN
  IF to_regclass('public.part_wear_patterns') IS NULL THEN
    RAISE NOTICE 'Skipping wear pattern seed: table does not exist.';
    RETURN;
  END IF;

  INSERT INTO public.part_wear_patterns (part_category, wear_type, visual_description, typical_appearance, severity_levels, common_causes, value_impact_percentage, repairability, repair_cost_range)
  VALUES
  (
    'chrome', 'pitting', 
    'Small holes or bubbles in chrome surface caused by corrosion of underlying metal',
    '{"color": "dark spots on chrome", "texture": "rough bumps or holes", "location": "edges and low points where water sits"}'::jsonb,
    '{"mild": "few small pits <1mm", "moderate": "numerous pits 1-3mm", "severe": "heavy pitting >3mm, chrome flaking off"}'::jsonb,
    ARRAY['moisture exposure', 'salt/road chemicals', 'age', 'poor chrome plating quality'],
    30,
    'difficult',
    '$200-500 for re-chrome'
  ),
  (
    'chrome', 'rust_through', 
    'Chrome has failed completely allowing base metal to rust',
    '{"color": "orange/brown rust visible", "texture": "bubbling, flaking", "location": "usually starts at mounting points or damage areas"}'::jsonb,
    '{"mild": "surface rust spots", "moderate": "rust bubbling through chrome", "severe": "structural rust, holes forming"}'::jsonb,
    ARRAY['chrome failure', 'moisture intrusion', 'impact damage breaking chrome layer'],
    60,
    'difficult',
    '$300-800 for replacement or re-chrome'
  ),
  (
    'plastic', 'uv_fading',
    'Plastic loses color and becomes chalky from sun exposure',
    '{"color": "faded from original color to grey/white", "texture": "chalky surface", "location": "sun-exposed areas worst"}'::jsonb,
    '{"mild": "slight color fade", "moderate": "noticeable greyishness", "severe": "completely faded, chalky white"}'::jsonb,
    ARRAY['UV exposure', 'lack of protectant', 'age', 'outdoor storage'],
    25,
    'moderate',
    '$50-150 for restoration or $100-300 for replacement'
  ),
  (
    'plastic', 'cracking',
    'Plastic develops cracks from age, UV damage, or stress',
    '{"color": "white stress marks, crack lines", "texture": "separated material", "location": "mounting points, stress areas, sun-exposed"}'::jsonb,
    '{"mild": "hairline cracks <1 inch", "moderate": "cracks >1 inch or multiple", "severe": "broken pieces, missing sections"}'::jsonb,
    ARRAY['age embrittlement', 'UV damage', 'impact', 'overtightening', 'temperature cycling'],
    40,
    'difficult',
    '$200-600 for replacement (plastic parts rarely repairable)'
  ),
  (
    'glass', 'pitting',
    'Small chips or pits in glass surface from road debris',
    '{"color": "white spots in glass", "texture": "rough feel", "location": "windshield lower area, headlight lenses"}'::jsonb,
    '{"mild": "<5 pits", "moderate": "5-20 pits", "severe": ">20 pits or clustered"}'::jsonb,
    ARRAY['road debris', 'sandblasting effect', 'age'],
    15,
    'impossible',
    'Replacement only: $150-500'
  ),
  (
    'paint', 'oxidation',
    'Paint loses gloss and becomes chalky from UV and age',
    '{"color": "faded from original", "texture": "chalky, no shine", "location": "horizontal surfaces worst (hood, roof)"}'::jsonb,
    '{"mild": "slight fading, reduced gloss", "moderate": "noticeable chalkiness", "severe": "completely oxidized, paint coming off"}'::jsonb,
    ARRAY['UV exposure', 'lack of waxing', 'poor quality paint', 'age'],
    20,
    'moderate',
    '$100-300 for compound/polish, $500-2000 for repaint'
  )
  ON CONFLICT (part_category, wear_type) DO UPDATE
  SET visual_description = EXCLUDED.visual_description,
      typical_appearance = EXCLUDED.typical_appearance,
      severity_levels = EXCLUDED.severity_levels,
      common_causes = EXCLUDED.common_causes,
      value_impact_percentage = EXCLUDED.value_impact_percentage,
      repairability = EXCLUDED.repairability,
      repair_cost_range = EXCLUDED.repair_cost_range;
END
$$;

-- 8. CREATE intelligent_part_assessment function
CREATE OR REPLACE FUNCTION assess_part_condition(
  p_part_category TEXT,
  p_visual_observations JSONB,
  p_age_years INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_grade INTEGER := 10; -- Start at perfect
  v_grade_label TEXT;
  v_price_multiplier DECIMAL(4,2);
  v_issues TEXT[] := '{}';
  v_recommendations TEXT[] := '{}';
  wear_pattern RECORD;
BEGIN
  -- Check each wear pattern against observations
  FOR wear_pattern IN 
    SELECT *
    FROM public.part_wear_patterns 
    WHERE part_category = p_part_category 
  LOOP
    -- If observation matches wear pattern, reduce grade
    IF p_visual_observations ? wear_pattern.wear_type THEN
      v_grade := v_grade - (wear_pattern.value_impact_percentage / 10);
      v_issues := array_append(v_issues, wear_pattern.wear_type);
      v_recommendations := array_append(v_recommendations, 
        CASE wear_pattern.repairability
          WHEN 'easy' THEN 'Can be repaired: ' || wear_pattern.repair_cost_range
          WHEN 'moderate' THEN 'Repairable but may need pro: ' || wear_pattern.repair_cost_range
          WHEN 'difficult' THEN 'Difficult repair: ' || wear_pattern.repair_cost_range
          ELSE 'Replacement recommended: ' || wear_pattern.repair_cost_range
        END
      );
    END IF;
  END LOOP;
  
  -- Factor in age
  IF p_age_years IS NOT NULL THEN
    v_grade := v_grade - (p_age_years / 10); -- Lose 1 point per decade
  END IF;
  
  -- Clamp to 1-10 range
  v_grade := GREATEST(1, LEAST(10, v_grade));
  
  -- Get label and multiplier
  SELECT condition_label, price_multiplier INTO v_grade_label, v_price_multiplier
  FROM public.part_condition_guidelines
  WHERE part_category = p_part_category
  ORDER BY ABS(condition_grade - v_grade)
  LIMIT 1;
  
  RETURN jsonb_build_object(
    'condition_grade', v_grade,
    'condition_label', COALESCE(v_grade_label, 'Unknown'),
    'price_multiplier', COALESCE(v_price_multiplier, 0.50),
    'identified_issues', v_issues,
    'recommendations', v_recommendations,
    'assessed_at', NOW()
  );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

COMMENT ON FUNCTION assess_part_condition IS 'Intelligent condition assessment based on visual observations and catalog knowledge';

-- 9. CREATE view: intelligent_parts_catalog
DO $$
BEGIN
  IF to_regclass('public.intelligent_parts_catalog') IS NOT NULL THEN
    PERFORM 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'intelligent_parts_catalog'
      AND c.relkind = 'v';

    IF FOUND THEN
      EXECUTE 'DROP VIEW public.intelligent_parts_catalog';
    ELSE
      EXECUTE 'DROP TABLE IF EXISTS public.intelligent_parts_catalog CASCADE';
    END IF;
  END IF;

  IF to_regclass('public.part_catalog') IS NULL THEN
    RAISE NOTICE 'Skipping intelligent_parts_catalog view: part_catalog table does not exist.';
    RETURN;
  END IF;

  EXECUTE '
CREATE VIEW public.intelligent_parts_catalog AS
SELECT 
  pc.*,
  jsonb_agg(DISTINCT to_jsonb(pcg)) FILTER (WHERE pcg.id IS NOT NULL) AS condition_guidelines,
  jsonb_agg(DISTINCT to_jsonb(pwp)) FILTER (WHERE pwp.id IS NOT NULL) AS wear_pattern_definitions,
  (
    SELECT to_jsonb(ai)
    FROM public.ai_part_recognition_rules ai
    WHERE ai.part_category = pc.category
    ORDER BY ai.created_at DESC
    LIMIT 1
  ) AS ai_recognition_rule
FROM public.part_catalog pc
LEFT JOIN public.part_condition_guidelines pcg ON pcg.part_category = pc.category
LEFT JOIN public.part_wear_patterns pwp ON pwp.part_category = pc.category
GROUP BY pc.id';

  EXECUTE 'COMMENT ON VIEW public.intelligent_parts_catalog IS ''Complete parts catalog with integrated condition assessment knowledge for AI''';
END
$$;

-- 10. CREATE indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_part_condition_guidelines_category ON part_condition_guidelines(part_category, condition_grade);
CREATE INDEX IF NOT EXISTS idx_part_wear_patterns_category ON part_wear_patterns(part_category, wear_type);
CREATE INDEX IF NOT EXISTS idx_ai_recognition_rules_category ON ai_part_recognition_rules(part_category);

COMMENT ON TABLE part_condition_guidelines IS 'Defines condition grades (1-10) with visual indicators and pricing impact';
COMMENT ON TABLE part_wear_patterns IS 'Common wear types with visual signatures, causes, and repairability';
COMMENT ON TABLE ai_part_recognition_rules IS 'Instructions for AI to identify parts and assess condition from photos';

