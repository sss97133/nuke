-- work_sessions: day-level intent + drift-repair of owner confirmation columns
-- ============================================================================
-- Closes the owner intent-confirmation loop's SCHEMA gap (the top crack in
-- docs/features/image-processing/GOALS.md). Grounded against the LIVE DB on
-- 2026-06-21, NOT against the (stale) goals doc:
--
--   * owner_confirmed_at / owner_confirmed_by ALREADY EXIST in prod but live in
--     NO migration and are referenced by NO code — applied directly via SQL in a
--     past session and orphaned (2 of 778 sessions confirmed; 66 unconfirmed
--     labor days). GOALS.md asked for differently-named confirmed_at/confirmed_by;
--     following the doc would have created DUPLICATE columns. This migration
--     instead repairs the drift: it puts the real columns into version control
--     (IF NOT EXISTS = no-op in prod, correct on a fresh DB).
--   * The genuinely-missing piece is day-level INTENT — what a work day was FOR
--     (the $410-text-to-dad gate). The BYOK detective already produces frame-level
--     intent (scripts/deep-image-analysis-byok.mjs); this is its day-level rollup
--     home so a labor day can be owner-confirmed and feed the compounding loop.
--
-- Mutable rollup row, not testimony: the immutable record stays in the append-only
-- vehicle_observations chain. intent_source tracks whether the current value is an
-- AI guess or owner truth, mirroring the repo's existing *_source provenance idiom
-- (zone_source, angle_source, vehicle_source). Safe + idempotent.

-- 1. Drift repair — bring the orphaned confirmation columns under version control.
ALTER TABLE work_sessions
  ADD COLUMN IF NOT EXISTS owner_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS owner_confirmed_by  uuid REFERENCES auth.users(id);

-- 2. Day-level intent (the missing piece). text + CHECK (not a pg enum — enums are
--    painful to alter) using the BYOK verdict's intent vocabulary so frame→day
--    rollup is consistent. NULL allowed (CHECK passes on NULL) for not-yet-inferred days.
ALTER TABLE work_sessions
  ADD COLUMN IF NOT EXISTS intent             text,
  ADD COLUMN IF NOT EXISTS intent_confidence  numeric(4,3),
  ADD COLUMN IF NOT EXISTS intent_source      text NOT NULL DEFAULT 'ai_inferred';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_sessions_intent_check') THEN
    ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_intent_check
      CHECK (intent IS NULL OR intent IN
        ('labor','inspection','parts_sourcing','communication','acquisition','documentation','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_sessions_intent_source_check') THEN
    ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_intent_source_check
      CHECK (intent_source IN ('ai_inferred','owner_confirmed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_sessions_intent_confidence_range') THEN
    ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_intent_confidence_range
      CHECK (intent_confidence IS NULL OR (intent_confidence >= 0 AND intent_confidence <= 1));
  END IF;
END $$;

-- 3. Triage index — "labor days awaiting owner confirmation" is the candidate set
--    the confirmation surface selects. Partial index keeps it cheap on a growing table.
CREATE INDEX IF NOT EXISTS idx_work_sessions_unconfirmed
  ON work_sessions (vehicle_id, session_date DESC)
  WHERE owner_confirmed_at IS NULL;

-- 4. Column documentation.
COMMENT ON COLUMN work_sessions.owner_confirmed_at IS
  'When the owner confirmed this day actually happened as inferred (testimony, owner-trust tier). NULL = awaiting confirmation → surfaces in triage.';
COMMENT ON COLUMN work_sessions.owner_confirmed_by IS
  'auth.users id of the owner who confirmed the day.';
COMMENT ON COLUMN work_sessions.intent IS
  'Day-level intent: what the work day was FOR. Enum mirrors the BYOK frame-level intent (labor|inspection|parts_sourcing|communication|acquisition|documentation|unknown). Only confirmed labor accrues billable value (the $410 gate).';
COMMENT ON COLUMN work_sessions.intent_confidence IS
  '0.0-1.0 AI confidence in the inferred intent. Low confidence + a labor claim = high triage priority.';
COMMENT ON COLUMN work_sessions.intent_source IS
  'Provenance of intent: ai_inferred (detective guess) or owner_confirmed (owner testimony, set alongside owner_confirmed_at). Owner truth supersedes the AI guess.';

-- 5. Pipeline registry — record ownership so the next agent does not re-discover this.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pipeline_registry') THEN
    INSERT INTO pipeline_registry
      (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via)
    VALUES
      ('work_sessions', 'owner_confirmed_at', 'owner-confirmation',
       'Owner testimony that a work day happened. Set only via the confirmation write path, never auto.',
       NULL, true, 'owner confirmation flow (see GOALS.md "THE NEXT MOVE")'),
      ('work_sessions', 'owner_confirmed_by', 'owner-confirmation',
       'Owner who confirmed the day.', NULL, true, 'owner confirmation flow'),
      ('work_sessions', 'intent', 'work-session-rollup',
       'Day-level intent. AI-inferred by the BYOK detective rollup; owner-correctable via confirmation.',
       ARRAY['labor','inspection','parts_sourcing','communication','acquisition','documentation','unknown'],
       false, NULL),
      ('work_sessions', 'intent_confidence', 'work-session-rollup',
       'AI confidence 0-1 in inferred intent.', NULL, false, NULL),
      ('work_sessions', 'intent_source', 'work-session-rollup',
       'ai_inferred or owner_confirmed.', ARRAY['ai_inferred','owner_confirmed'], false, NULL)
    ON CONFLICT (table_name, column_name) DO UPDATE
      SET owned_by = EXCLUDED.owned_by, description = EXCLUDED.description,
          valid_values = EXCLUDED.valid_values, write_via = EXCLUDED.write_via,
          do_not_write_directly = EXCLUDED.do_not_write_directly, updated_at = now();
  END IF;
END $$;
