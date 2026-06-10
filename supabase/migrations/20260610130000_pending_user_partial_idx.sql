-- ============================================================================
-- Partial index serving the orchestrator's owner-first pending query.
-- Filed 2026-06-10.
--
-- process_pending's owner-first ordering (user uploads before the scraped
-- backlog) initially used ORDER BY user_id DESC over the whole pending set —
-- 57014 statement timeout on every drain fire, silently swallowed as
-- "No pending images". The two-step query in photo-pipeline-orchestrator now
-- reads user-owned pendings via this index (tiny: only user uploads awaiting
-- processing) and falls back to the existing pending_processing index for the
-- backlog. Index pre-built CONCURRENTLY in prod; IF NOT EXISTS no-ops here.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_vehicle_images_pending_user
  ON vehicle_images (created_at DESC)
  WHERE ai_processing_status = 'pending' AND user_id IS NOT NULL;
