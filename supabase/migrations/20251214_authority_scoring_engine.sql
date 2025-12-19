-- ============================================================
-- Authority Scoring Engine (Evidence-Based)
-- ============================================================
-- Purpose:
-- - Compute evidence-based authority over a vehicle using multiple signal categories
-- - Title/ID/VIN is strong (~90) but never 100 on its own
-- - "100" is only reachable via multiple independent categories
-- - Weights/policies are configurable and future-proof
--
-- Output:
-- - RPC `calculate_vehicle_authority(vehicle_id, user_id)` returns JSON:
--   { legal_ownership_score, operational_authority_score, overall_authority_score, category_coverage, breakdown }
--
-- Idempotent:
-- - Uses IF NOT EXISTS + guarded constraints

-- ============================================
-- 1) Signal weights
-- ============================================

CREATE TABLE IF NOT EXISTS authority_signal_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key TEXT NOT NULL,                 -- e.g. 'title_verified', 'insurance_doc', 'images_uploaded'
  category_key TEXT NOT NULL,               -- e.g. 'legal_docs', 'custody_presence', 'economic_activity', 'operational_work'
  weight_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_signal_weights_signal_key_key') THEN
    ALTER TABLE authority_signal_weights
      ADD CONSTRAINT authority_signal_weights_signal_key_key UNIQUE (signal_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_authority_signal_weights_active ON authority_signal_weights(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_authority_signal_weights_category ON authority_signal_weights(category_key);

COMMENT ON TABLE authority_signal_weights IS 'Configurable weights for authority signals. Used by calculate_vehicle_authority().';

-- Default weights (safe starting point; adjustable later)
INSERT INTO authority_signal_weights (signal_key, category_key, weight_points, notes)
VALUES
  -- Legal docs (cap will prevent title-only reaching 100)
  ('title_verified',        'legal_docs',        90, 'Approved ownership verification (title+ID+VIN). Strong but not absolute.'),
  ('insurance_document',    'legal_docs',        7,  'Insurance evidence tied to vehicle.'),
  ('registration_document', 'legal_docs',        7,  'Registration evidence tied to vehicle.'),

  -- Custody / presence
  ('images_uploaded',       'custody_presence',  10, 'User uploaded photos for this vehicle (scaled by count).'),
  ('device_consistency',    'custody_presence',  10, 'Device fingerprint consistency across images (EXIF/device attribution).'),

  -- Operational work / proof-of-work
  ('docs_uploaded',         'operational_work',  10, 'Uploaded receipts/invoices/service records (scaled).'),
  ('timeline_events',       'operational_work',  10, 'Created timeline events on this vehicle (scaled).')
ON CONFLICT (signal_key) DO UPDATE SET
  category_key = EXCLUDED.category_key,
  weight_points = EXCLUDED.weight_points,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================
-- 2) Policy thresholds (decision types)
-- ============================================

CREATE TABLE IF NOT EXISTS authority_policy_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_key TEXT NOT NULL,               -- e.g. 'claim_activity', 'claim_ownership', 'edit_vehicle'
  min_overall_score INTEGER NOT NULL DEFAULT 0 CHECK (min_overall_score >= 0 AND min_overall_score <= 100),
  min_legal_score INTEGER NOT NULL DEFAULT 0 CHECK (min_legal_score >= 0 AND min_legal_score <= 100),
  min_operational_score INTEGER NOT NULL DEFAULT 0 CHECK (min_operational_score >= 0 AND min_operational_score <= 100),
  min_categories_required INTEGER NOT NULL DEFAULT 1 CHECK (min_categories_required >= 1 AND min_categories_required <= 10),
  requires_legal_docs BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_policy_thresholds_decision_key_key') THEN
    ALTER TABLE authority_policy_thresholds
      ADD CONSTRAINT authority_policy_thresholds_decision_key_key UNIQUE (decision_key);
  END IF;
END $$;

COMMENT ON TABLE authority_policy_thresholds IS 'Thresholds for decisions. Keep policy separate from scoring.';

INSERT INTO authority_policy_thresholds (decision_key, min_overall_score, min_legal_score, min_operational_score, min_categories_required, requires_legal_docs)
VALUES
  ('claim_activity', 70, 0, 20, 2, false),
  ('claim_ownership', 90, 80, 30, 3, true),
  ('edit_vehicle', 75, 0, 40, 2, false)
ON CONFLICT (decision_key) DO UPDATE SET
  min_overall_score = EXCLUDED.min_overall_score,
  min_legal_score = EXCLUDED.min_legal_score,
  min_operational_score = EXCLUDED.min_operational_score,
  min_categories_required = EXCLUDED.min_categories_required,
  requires_legal_docs = EXCLUDED.requires_legal_docs,
  updated_at = NOW();

-- ============================================
-- 3) RLS (readable config, controlled writes)
-- ============================================

ALTER TABLE authority_signal_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_policy_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read authority signal weights" ON authority_signal_weights;
CREATE POLICY "Public read authority signal weights"
  ON authority_signal_weights
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Public read authority policy thresholds" ON authority_policy_thresholds;
CREATE POLICY "Public read authority policy thresholds"
  ON authority_policy_thresholds
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role manages authority signal weights" ON authority_signal_weights;
CREATE POLICY "Service role manages authority signal weights"
  ON authority_signal_weights
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Service role manages authority policy thresholds" ON authority_policy_thresholds;
CREATE POLICY "Service role manages authority policy thresholds"
  ON authority_policy_thresholds
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 4) RPC: calculate_vehicle_authority(vehicle_id, user_id)
-- ============================================

CREATE OR REPLACE FUNCTION calculate_vehicle_authority(
  p_vehicle_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_breakdown JSONB := '[]'::jsonb;
  v_categories TEXT[] := ARRAY[]::text[];

  -- Scores
  v_legal INTEGER := 0;
  v_operational INTEGER := 0;
  v_overall INTEGER := 0;

  -- Weights (defaults if not present)
  w_title NUMERIC := 90;
  w_insurance NUMERIC := 7;
  w_registration NUMERIC := 7;
  w_images NUMERIC := 10;
  w_device NUMERIC := 10;
  w_docs NUMERIC := 10;
  w_events NUMERIC := 10;

  -- Evidence counts
  c_images INTEGER := 0;
  c_docs INTEGER := 0;
  c_events INTEGER := 0;
  c_device_attrib INTEGER := 0;
  c_device_distinct INTEGER := 0;

  has_title BOOLEAN := false;
  has_insurance BOOLEAN := false;
  has_registration BOOLEAN := false;

  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_vehicle_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'legal_ownership_score', 0,
      'operational_authority_score', 0,
      'overall_authority_score', 0,
      'category_coverage', '[]'::jsonb,
      'breakdown', '[]'::jsonb
    );
  END IF;

  -- Load weights from table (if present/active)
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'title_verified' AND is_active), w_title) INTO w_title FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'insurance_document' AND is_active), w_insurance) INTO w_insurance FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'registration_document' AND is_active), w_registration) INTO w_registration FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'images_uploaded' AND is_active), w_images) INTO w_images FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'device_consistency' AND is_active), w_device) INTO w_device FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'docs_uploaded' AND is_active), w_docs) INTO w_docs FROM authority_signal_weights;
  SELECT COALESCE(MAX(weight_points) FILTER (WHERE signal_key = 'timeline_events' AND is_active), w_events) INTO w_events FROM authority_signal_weights;

  -- ----------------------------
  -- LEGAL DOC SIGNALS
  -- ----------------------------
  -- Approved title verification
  SELECT EXISTS(
    SELECT 1
    FROM public.ownership_verifications ov
    WHERE ov.vehicle_id = p_vehicle_id
      AND ov.user_id = p_user_id
      AND ov.status = 'approved'
  ) INTO has_title;

  IF has_title THEN
    v_legal := LEAST(100, v_legal + w_title::int);
    v_categories := array_append(v_categories, 'legal_docs');
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'title_verified',
      'category', 'legal_docs',
      'points', w_title,
      'evidence', jsonb_build_object(
        'vehicle_id', p_vehicle_id,
        'source', 'ownership_verifications',
        'status', 'approved'
      )
    ));
  END IF;

  -- Registration / insurance documents (best-effort via vehicle_documents)
  BEGIN
    SELECT COUNT(*) FILTER (WHERE document_type::text = 'insurance') > 0,
           COUNT(*) FILTER (WHERE document_type::text = 'registration') > 0,
           COUNT(*) FILTER (WHERE document_type::text IN ('insurance','registration','title')) as doc_count
    INTO has_insurance, has_registration, c_docs
    FROM public.vehicle_documents vd
    WHERE vd.vehicle_id = p_vehicle_id
      AND vd.uploaded_by = p_user_id;
  EXCEPTION WHEN undefined_table THEN
    has_insurance := false;
    has_registration := false;
    c_docs := 0;
  END;

  IF has_insurance THEN
    v_legal := LEAST(100, v_legal + w_insurance::int);
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'insurance_document',
      'category', 'legal_docs',
      'points', w_insurance,
      'evidence', jsonb_build_object('vehicle_id', p_vehicle_id, 'source', 'vehicle_documents', 'document_type', 'insurance')
    ));
    IF NOT ('legal_docs' = ANY(v_categories)) THEN
      v_categories := array_append(v_categories, 'legal_docs');
    END IF;
  END IF;

  IF has_registration THEN
    v_legal := LEAST(100, v_legal + w_registration::int);
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'registration_document',
      'category', 'legal_docs',
      'points', w_registration,
      'evidence', jsonb_build_object('vehicle_id', p_vehicle_id, 'source', 'vehicle_documents', 'document_type', 'registration')
    ));
    IF NOT ('legal_docs' = ANY(v_categories)) THEN
      v_categories := array_append(v_categories, 'legal_docs');
    END IF;
  END IF;

  -- ----------------------------
  -- CUSTODY / PRESENCE SIGNALS
  -- ----------------------------
  -- Photos uploaded by user on this vehicle
  BEGIN
    SELECT COUNT(*) INTO c_images
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND vi.user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN
    c_images := 0;
  END;

  IF c_images > 0 THEN
    -- Scale photos contribution: reach full weight by ~25 images
    v_operational := LEAST(100, v_operational + LEAST(w_images, (w_images * LEAST(1, c_images::numeric / 25.0)))::int);
    v_categories := array_append(v_categories, 'custody_presence');
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'images_uploaded',
      'category', 'custody_presence',
      'points', LEAST(w_images, (w_images * LEAST(1, c_images::numeric / 25.0))),
      'evidence', jsonb_build_object('vehicle_id', p_vehicle_id, 'image_count', c_images, 'source', 'vehicle_images')
    ));
  END IF;

  -- Device attribution consistency (EXIF/device fingerprint)
  BEGIN
    SELECT COUNT(*)::int, COUNT(DISTINCT da.device_fingerprint)::int
    INTO c_device_attrib, c_device_distinct
    FROM public.device_attributions da
    WHERE da.image_id IN (
      SELECT vi.id FROM public.vehicle_images vi WHERE vi.vehicle_id = p_vehicle_id AND vi.user_id = p_user_id
    );
  EXCEPTION WHEN undefined_table THEN
    c_device_attrib := 0;
    c_device_distinct := 0;
  END;

  IF c_device_attrib >= 3 THEN
    -- Reward consistency: fewer distinct devices = higher confidence
    -- 1 device -> full weight, 2 devices -> 70%, 3+ -> 40%
    v_operational := LEAST(100, v_operational + (
      CASE
        WHEN c_device_distinct <= 1 THEN w_device
        WHEN c_device_distinct = 2 THEN w_device * 0.7
        ELSE w_device * 0.4
      END
    )::int);
    IF NOT ('custody_presence' = ANY(v_categories)) THEN
      v_categories := array_append(v_categories, 'custody_presence');
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'device_consistency',
      'category', 'custody_presence',
      'points', (
        CASE
          WHEN c_device_distinct <= 1 THEN w_device
          WHEN c_device_distinct = 2 THEN w_device * 0.7
          ELSE w_device * 0.4
        END
      ),
      'evidence', jsonb_build_object(
        'vehicle_id', p_vehicle_id,
        'device_attribution_count', c_device_attrib,
        'distinct_devices', c_device_distinct,
        'source', 'device_attributions'
      )
    ));
  END IF;

  -- ----------------------------
  -- OPERATIONAL WORK SIGNALS
  -- ----------------------------
  IF c_docs > 0 THEN
    -- Scale: reach full weight by ~10 docs
    v_operational := LEAST(100, v_operational + LEAST(w_docs, (w_docs * LEAST(1, c_docs::numeric / 10.0)))::int);
    v_categories := array_append(v_categories, 'operational_work');
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'docs_uploaded',
      'category', 'operational_work',
      'points', LEAST(w_docs, (w_docs * LEAST(1, c_docs::numeric / 10.0))),
      'evidence', jsonb_build_object('vehicle_id', p_vehicle_id, 'document_count', c_docs, 'source', 'vehicle_documents')
    ));
  END IF;

  -- Timeline events created by user on this vehicle (proof of ongoing activity)
  BEGIN
    SELECT COUNT(*) INTO c_events
    FROM public.timeline_events te
    WHERE te.vehicle_id = p_vehicle_id
      AND te.user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN
    c_events := 0;
  END;

  IF c_events > 0 THEN
    -- Scale: reach full weight by ~20 events
    v_operational := LEAST(100, v_operational + LEAST(w_events, (w_events * LEAST(1, c_events::numeric / 20.0)))::int);
    IF NOT ('operational_work' = ANY(v_categories)) THEN
      v_categories := array_append(v_categories, 'operational_work');
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'signal_key', 'timeline_events',
      'category', 'operational_work',
      'points', LEAST(w_events, (w_events * LEAST(1, c_events::numeric / 20.0))),
      'evidence', jsonb_build_object('vehicle_id', p_vehicle_id, 'event_count', c_events, 'source', 'timeline_events')
    ));
  END IF;

  -- ----------------------------
  -- Composite scoring rules
  -- ----------------------------
  -- Legal is capped so it cannot alone reach 100 in future if weights change.
  v_legal := LEAST(95, v_legal);

  -- Operational is capped (never absolute without legal or multiple categories).
  v_operational := LEAST(95, v_operational);

  -- Overall: max but limited by category coverage.
  v_overall := GREATEST(v_legal, v_operational);

  -- Require multi-category coverage to reach 100:
  -- If fewer than 3 categories, cap overall at 95.
  IF array_length(ARRAY(SELECT DISTINCT unnest(v_categories)), 1) IS NULL OR array_length(ARRAY(SELECT DISTINCT unnest(v_categories)), 1) < 3 THEN
    v_overall := LEAST(95, v_overall);
  END IF;

  -- If 3+ categories AND has title AND has either custody or operational work, allow 100.
  IF has_title
     AND array_length(ARRAY(SELECT DISTINCT unnest(v_categories)), 1) >= 3
     AND (('custody_presence' = ANY(v_categories)) OR ('operational_work' = ANY(v_categories)))
  THEN
    v_overall := LEAST(100, GREATEST(v_overall, 98));
    -- Only hit 100 when both legal and operational are strong
    IF v_legal >= 90 AND v_operational >= 70 THEN
      v_overall := 100;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'user_id', p_user_id,
    'computed_at', v_now,
    'legal_ownership_score', v_legal,
    'operational_authority_score', v_operational,
    'overall_authority_score', v_overall,
    'category_coverage', (
      SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
      FROM unnest(v_categories) as x
    ),
    'breakdown', v_breakdown
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_vehicle_authority(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_vehicle_authority(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION calculate_vehicle_authority(UUID, UUID) TO service_role;

-- Convenience wrapper for current user
CREATE OR REPLACE FUNCTION calculate_vehicle_authority_for_me(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN public.calculate_vehicle_authority(p_vehicle_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_vehicle_authority_for_me(UUID) TO authenticated;






