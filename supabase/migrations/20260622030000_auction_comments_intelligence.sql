-- 20260622030000_auction_comments_intelligence.sql
-- Applied to prod 2026-06-22 (additive, ADD COLUMN IF NOT EXISTS — no data rewrite).
-- Comment-intelligence-at-scale columns on auction_comments. Two SEPARATED polarity axes
-- (do not collapse them — rubric v1 leaked condition into stance at r=0.656; v2 must keep
-- them orthogonal):
--   community_stance_score  : stance toward the SELLER's claims (challenges ↔ vouches)
--   condition_polarity      : polarity about the CAR's condition/authenticity (defect ↔ exceptional)
-- Plus the citation/provenance scaffolding: extracted_claims carries each claim with its
-- source comment_id + author + corroborates/challenges, drillable to the BaT comment;
-- rubric_version anchors which scoring rubric produced the scores so re-scores are auditable.
-- BYOK-scored on demand (Ollama default; Haiku Batch reserved for gold/contested).
-- Mirrors prod; idempotent.

ALTER TABLE public.auction_comments
  ADD COLUMN IF NOT EXISTS community_stance_score numeric,
  ADD COLUMN IF NOT EXISTS stance_scored_at       timestamptz,
  ADD COLUMN IF NOT EXISTS stance_model           text,
  ADD COLUMN IF NOT EXISTS condition_polarity     numeric,
  ADD COLUMN IF NOT EXISTS extracted_claims       jsonb,
  ADD COLUMN IF NOT EXISTS rubric_version         smallint;

COMMENT ON COLUMN public.auction_comments.community_stance_score IS
  'Community stance toward the car''s claims: -1 challenges authenticity/originality, +1 vouches, 0 neutral. The alignment-map Y axis. BYOK-scored on demand.';
COMMENT ON COLUMN public.auction_comments.condition_polarity IS
  'Calibrated condition/authenticity polarity of the comment about the CAR (-1 hard defect/misrep … +1 evidenced exceptional). Separated from community_stance_score (stance toward the SELLER''s claims). 5-bucket, rubric_version-anchored.';
