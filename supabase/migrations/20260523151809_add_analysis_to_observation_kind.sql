-- Add 'analysis' to observation_kind enum so deep-image-analysis pipelines
-- (BYOK Claude reads + Gemini reads + future cluster narratives) can emit
-- a canonical-layer observation per image, not just stash the testimony
-- inside vehicle_images.ai_scan_metadata.
--
-- Companion: scripts/deep-image-analysis-byok.mjs ingest path.

ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'analysis';
