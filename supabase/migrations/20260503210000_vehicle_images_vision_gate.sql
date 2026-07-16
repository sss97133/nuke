-- Vision gate at image intake.
--
-- Per Skylar 2026-05-03: the agent (Claude looking at pixels through the
-- library lens) is the first line of defense against blind ingestion of
-- personal / mis-attributed photos onto vehicle profiles.
--
-- Every new vehicle_images row defaults to 'pending'. Profile gallery queries
-- (frontend) filter to (NULL OR 'approved'). NULL means legacy row from before
-- this gate existed — those stay visible until a retroactive review pass moves
-- them through the same gate in controlled batches.
--
-- The reasoning column is the load-bearing artifact: even when an image is
-- rejected, the agent's natural-language reasoning ("toddler in pool with
-- flamingo float; no vehicle") is kept. That's the negative signal Skylar
-- talked about — useful for activity-pattern analysis without storing the
-- pixels long-term on a vehicle profile.

DO $$ BEGIN
  CREATE TYPE vision_gate_status AS ENUM (
    'pending',
    'approved',
    'rejected_personal',
    'rejected_misattributed',
    'review_needed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS vision_gate_status vision_gate_status,
  ADD COLUMN IF NOT EXISTS vision_gate_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vision_gate_agent_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS vision_gate_attribution_confidence NUMERIC;

ALTER TABLE vehicle_images ALTER COLUMN vision_gate_status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_vehicle_images_pending_review
  ON vehicle_images(vehicle_id, created_at DESC)
  WHERE vision_gate_status = 'pending';

COMMENT ON COLUMN vehicle_images.vision_gate_status IS
  'Agent-driven classification gate. New ingestion defaults to pending. Profile queries must filter by approved-or-NULL.';
COMMENT ON COLUMN vehicle_images.vision_gate_agent_reasoning IS
  'Agent natural-language reasoning: what was seen, why classified this way. Kept even when image is rejected (negative-signal payload).';
COMMENT ON COLUMN vehicle_images.vision_gate_attribution_confidence IS
  'Agent confidence (0-1) in the classification decision. 0.99 = visually unambiguous; 0.5 = uncertain (review_needed).';
