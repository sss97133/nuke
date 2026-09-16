-- ============================================================================
-- SENDER_CONTACT_AFFINITY: L0.5 cheap-cascade layer for vision-gate
-- ============================================================================
--
-- Per Skylar 2026-05-05: "system has to work for everyone — take anyone's
-- image library and organize their images." Generic, no hardcoded
-- per-user rules. The system learns about each contact by observing their
-- image patterns over time.
--
-- The K2500 contamination story (May 3 handoff): Jenny's iMessage thread
-- mass-mapped to K2500 because there was no cheap signal that "Jenny's
-- photos historically don't go on vehicle profiles." This layer captures
-- that signal as derived data — no curation needed.
--
-- Cold-start safe: < 10 observations → affinity NULL → L0.5 returns null
-- and falls through to L2/L3/L4. Once enough observations accumulate,
-- pattern emerges automatically.
--
-- Justification (Hard Rule #2): one new table, derived from existing
-- vehicle_images verdict history. Reduces vision API spend by routing
-- known-personal contacts away from L4 vision compute.

CREATE TABLE IF NOT EXISTS sender_contact_affinity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_scope_id UUID NOT NULL,           -- vehicle owner; affinity is per-library
  contact_identifier TEXT NOT NULL,       -- format-agnostic: phone, email, name, device
  contact_display_name TEXT,
  vehicle_photos_count INT DEFAULT 0 CHECK (vehicle_photos_count >= 0),
  personal_photos_count INT DEFAULT 0 CHECK (personal_photos_count >= 0),
  vehicle_affinity NUMERIC(3, 2)
    CHECK (vehicle_affinity IS NULL OR (vehicle_affinity >= 0 AND vehicle_affinity <= 1)),
  confidence NUMERIC(3, 2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  observation_count INT DEFAULT 0 CHECK (observation_count >= 0),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_scope_id, contact_identifier)
);

CREATE INDEX IF NOT EXISTS idx_sender_affinity_lookup
  ON sender_contact_affinity (user_scope_id, contact_identifier);

CREATE INDEX IF NOT EXISTS idx_sender_affinity_updated
  ON sender_contact_affinity (last_updated DESC);

COMMENT ON TABLE sender_contact_affinity IS
  'L0.5 vision-gate layer: per-library contact-affinity. Captures which contacts historically contribute vehicle vs personal photos. Derived from image verdicts; no user curation. Cold-start (< 10 obs) returns NULL.';

COMMENT ON COLUMN sender_contact_affinity.vehicle_affinity IS
  'Affinity 0..1: 1.0 = always vehicle photos, 0.0 = always personal. NULL if observation_count < 10. L0.5 rules: > 0.8 → auto-approve, < 0.2 → auto-reject_personal.';

COMMENT ON COLUMN sender_contact_affinity.confidence IS
  'Reliability score: min(sqrt(observation_count / 30), 1.0). Used to gate verdict confidence.';

-- ─── Recompute function ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_sender_contact_affinity(p_user_scope_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE
  v_affected INT;
BEGIN
  -- Aggregate verdicts into affinity rows.
  INSERT INTO sender_contact_affinity (
    user_scope_id, contact_identifier, contact_display_name,
    vehicle_photos_count, personal_photos_count, observation_count,
    vehicle_affinity, confidence, last_updated
  )
  SELECT
    v.user_id AS user_scope_id,
    COALESCE(vi.photographer_attribution, vi.documented_by_device) AS contact_identifier,
    COALESCE(vi.photographer_attribution, vi.documented_by_device) AS contact_display_name,
    COUNT(*) FILTER (WHERE vi.vision_gate_status = 'approved') AS vehicle_photos_count,
    COUNT(*) FILTER (WHERE vi.vision_gate_status IN ('rejected_personal', 'rejected_misattributed')) AS personal_photos_count,
    COUNT(*) AS observation_count,
    CASE
      WHEN COUNT(*) < 10 THEN NULL
      ELSE ROUND(
        COUNT(*) FILTER (WHERE vi.vision_gate_status = 'approved')::numeric
        / NULLIF(COUNT(*) FILTER (WHERE vi.vision_gate_status IN ('approved','rejected_personal','rejected_misattributed')), 0),
        2)
    END AS vehicle_affinity,
    CASE
      WHEN COUNT(*) < 10 THEN NULL
      ELSE LEAST(ROUND(SQRT(COUNT(*)::numeric / 30.0), 2), 1.00)
    END AS confidence,
    NOW()
  FROM vehicle_images vi
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE COALESCE(vi.photographer_attribution, vi.documented_by_device) IS NOT NULL
    AND vi.vision_gate_status IS NOT NULL
    AND (p_user_scope_id IS NULL OR v.user_id = p_user_scope_id)
    AND (vi.is_superseded IS NULL OR vi.is_superseded = false)
  GROUP BY v.user_id, COALESCE(vi.photographer_attribution, vi.documented_by_device)
  ON CONFLICT (user_scope_id, contact_identifier) DO UPDATE SET
    vehicle_photos_count = EXCLUDED.vehicle_photos_count,
    personal_photos_count = EXCLUDED.personal_photos_count,
    observation_count = EXCLUDED.observation_count,
    vehicle_affinity = EXCLUDED.vehicle_affinity,
    confidence = EXCLUDED.confidence,
    last_updated = NOW();

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$func$;

COMMENT ON FUNCTION recompute_sender_contact_affinity IS
  'Recomputes sender-contact affinity from current vision_gate verdicts. Pass p_user_scope_id to scope to one user library; NULL for all. Idempotent; safe to re-run.';

-- ─── Bootstrap: seed from current verdict history ────────────────────────
-- Run scoped to all users — single execution at migration time. Subsequent
-- runs invoked from cron or after vision-gate-classify completes.

SELECT recompute_sender_contact_affinity(NULL);
