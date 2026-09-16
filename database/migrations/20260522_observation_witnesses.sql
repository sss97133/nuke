-- =========================================================================
-- 20260522_observation_witnesses.sql
-- Date:   2026-05-22
-- Status: PROPOSED — apply after explicit review.
--
-- Lands the image-as-witness layer per 2026-05-22 conversation.
--
-- The substrate's authentication endpoint is live images. A measurement
-- observation linked to a live-captured photo of a tape extended along
-- the measured run is materially different from an unsourced number.
-- Same for a build photo showing the actual installed wire vs an
-- engineer's estimate of what was installed.
--
-- The substrate already has vehicle_images (35.8M rows with EXIF +
-- timestamps + storage references). What's missing: a formal link from
-- an observation to the specific images that witness it.
--
-- Per "cells not rows": one row per (observation, image) pair, NOT a
-- jsonb array of image_ids on the observation. Each link is its own
-- atomic claim about what the image attests to.
--
-- Design notes:
--
--   witness_role distinguishes the relationship between the image and the
--   claim it witnesses:
--     'primary'   — the image directly shows the measurement / installation
--                    being attested (tape on the wire, the actual crimp,
--                    the routing path)
--     'context'   — the image shows the surrounding scene (the engine bay
--                    at the time of measurement) but not the specific value
--     'supersession' — the image attests a correction to a prior observation
--     'derived'   — value extracted FROM the image by an OCR/vision agent
--                    (e.g. VIN read from a photo of the plate)
--
--   capture_method captures how the image attestation chain is rooted:
--     'live_streaming' — strongest. Real-time camera feed with continuous
--                        timestamps; near-impossible to fake retroactively.
--     'photo_with_exif' — strong. Camera-timestamped, GPS-tagged, hash on
--                          upload.
--     'photo_no_exif'   — moderate. Image exists but the chain back to
--                          camera-time is broken (e.g. screenshot, edited).
--     'composite'       — weak. Image was assembled from multiple sources.
--
--   This data drives a future calibration / verification rule: an
--   observation with witness_role='primary' + capture_method='live_streaming'
--   contributes more strongly to consensus than one with capture_method=
--   'photo_no_exif'.
-- =========================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.observation_witnesses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id        uuid NOT NULL REFERENCES public.vehicle_observations(id) ON DELETE CASCADE,
  image_id              uuid NOT NULL,
  witness_role          text NOT NULL CHECK (witness_role IN (
                          'primary',         -- image directly attests the claim
                          'context',         -- image shows surrounding scene
                          'supersession',    -- image attests a correction
                          'derived'          -- value extracted from image
                        )),
  capture_method        text NOT NULL CHECK (capture_method IN (
                          'live_streaming',  -- strongest: real-time feed
                          'photo_with_exif', -- strong: camera-timestamped
                          'photo_no_exif',   -- moderate: timestamp chain broken
                          'composite',       -- weak: assembled from multiple
                          'unknown'          -- default when not yet classified
                        )),
  image_timestamp       timestamptz,
  attestation_notes     text,
  added_by_user_id      uuid REFERENCES auth.users(id),
  added_by_agent_key    text,
  added_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (observation_id, image_id, witness_role),
  CONSTRAINT attribution_required CHECK (
    added_by_user_id IS NOT NULL OR added_by_agent_key IS NOT NULL
  )
);

COMMENT ON TABLE public.observation_witnesses IS
  'Image-as-witness layer. Each row links an observation to a specific vehicle_image that attests (or contextualizes, or derives) the observation. The witness_role + capture_method determine how strongly the image authenticates the claim. Per 2026-05-22 conversation: live-streamed images are the closest thing to physics-as-validation in software.';

COMMENT ON COLUMN public.observation_witnesses.capture_method IS
  'How the image attestation chain is rooted. live_streaming is the strongest because the timestamp chain is continuous and retroactive fabrication is near-impossible. photo_with_exif is strong (camera-timestamped, GPS-tagged, hash on upload). photo_no_exif is weaker (timestamp chain broken). composite is weakest.';

CREATE INDEX IF NOT EXISTS idx_observation_witnesses_observation
  ON public.observation_witnesses(observation_id);
CREATE INDEX IF NOT EXISTS idx_observation_witnesses_image
  ON public.observation_witnesses(image_id);
CREATE INDEX IF NOT EXISTS idx_observation_witnesses_role
  ON public.observation_witnesses(witness_role, capture_method);

-- ---------------------------------------------------------------------------
-- v_observation_attestation — derived view rolling up witness quality
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_observation_attestation AS
SELECT
  vo.id AS observation_id,
  vo.vehicle_id,
  vo.kind,
  vo.property_id,
  vo.confidence::text AS confidence,
  vo.confidence_score,
  COUNT(ow.id) FILTER (WHERE ow.witness_role = 'primary')      AS primary_witnesses,
  COUNT(ow.id) FILTER (WHERE ow.witness_role = 'context')      AS context_witnesses,
  COUNT(ow.id) FILTER (WHERE ow.witness_role = 'derived')      AS derived_from_images,
  COUNT(ow.id) FILTER (WHERE ow.capture_method = 'live_streaming') AS live_stream_count,
  COUNT(ow.id) FILTER (WHERE ow.capture_method = 'photo_with_exif') AS photo_exif_count,
  MAX(ow.image_timestamp) AS latest_witness_at,
  CASE
    WHEN COUNT(ow.id) FILTER (WHERE ow.witness_role = 'primary' AND ow.capture_method IN ('live_streaming','photo_with_exif')) >= 1
      THEN 'attested_strong'
    WHEN COUNT(ow.id) FILTER (WHERE ow.witness_role = 'primary') >= 1
      THEN 'attested_weak'
    WHEN COUNT(ow.id) FILTER (WHERE ow.witness_role = 'context') >= 1
      THEN 'contextualized_only'
    ELSE 'unwitnessed'
  END AS attestation_tier
FROM public.vehicle_observations vo
LEFT JOIN public.observation_witnesses ow ON ow.observation_id = vo.id
WHERE vo.is_superseded = false
GROUP BY vo.id, vo.vehicle_id, vo.kind, vo.property_id, vo.confidence, vo.confidence_score;

COMMENT ON VIEW public.v_observation_attestation IS
  'Per-observation rollup of witness images. attestation_tier is the actionable summary: attested_strong (primary witness with strong capture method), attested_weak (primary witness but weak chain), contextualized_only (image shows scene but not specific value), unwitnessed (no images linked). Future consensus aggregator weighs attested_strong > attested_weak > contextualized_only > unwitnessed.';

NOTIFY pgrst, 'reload schema';

COMMIT;
