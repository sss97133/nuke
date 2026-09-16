-- Identity seam: make it self-describing and queryable.
--
-- WHY: the content-identity ROOT (image_identities) and the seam column
-- (vehicle_images.image_identity_id) both exist, but nothing TELLS an agent to
-- target them -- so agents keep writing leaf-first and forking (the same root
-- cause as the ai_scan_metadata fork, the parallel nuke_estimates render-store,
-- the dark assets spine: an agent that didn't know the correct target existed).
-- Awareness can't be assumed per-agent; it has to be encoded in the substrate.
--
-- This migration adds NO tables and changes NO data. It only makes the existing
-- seam announce itself (column comment) and gives ONE canonical read surface (a
-- view) so the composed leaf -> identity shape is the easy shape. Enforcement
-- (FK VALIDATE, identity-required-on-write) is a later rung, deferred until
-- rooting coverage is meaningful -- VALIDATE would scan ~34.5M rows today.
--
-- Pairs with 20260625000000_identity_first_image_ingestion.sql (the write chokepoint).
-- Lane: data/identity layer only. Touches no image-analysis pipeline code.

-- 1. Self-document the seam so `\d vehicle_images` / information_schema tells the agent.
COMMENT ON COLUMN public.vehicle_images.image_identity_id IS
  'Content-identity ROOT link (FK -> image_identities.id). Every image leaf should carry one. Populate ONLY via ingest_image_identity_first() (identity -> appearance -> leaf); never bare-INSERT a leaf without rooting. NULL = unrooted legacy row (pre identity-first). Read images via the image_with_identity view, not this table directly.';

-- 2. Canonical read surface: the composed leaf -> identity shape in one place, so an
--    agent gets the identity without knowing the join AND sees which leaves are unrooted.
--    security_invoker so the caller's RLS on vehicle_images applies (no privilege bypass).
CREATE OR REPLACE VIEW public.image_with_identity
  WITH (security_invoker = true) AS
SELECT
  vi.id                              AS image_id,
  vi.vehicle_id,
  vi.user_id,
  vi.image_url,
  vi.source,
  vi.file_hash,
  vi.image_identity_id,
  (vi.image_identity_id IS NOT NULL) AS is_rooted,
  ii.phash_hex                       AS identity_key,
  ii.content_hash_sha256,
  ii.photographer_id,
  ii.taken_at                        AS identity_taken_at,
  ii.observation_count
FROM public.vehicle_images vi
LEFT JOIN public.image_identities ii ON ii.id = vi.image_identity_id;

COMMENT ON VIEW public.image_with_identity IS
  'Canonical read surface for an image and its content identity (leaf -> root). Query THIS instead of vehicle_images to get an image plus its identity fields and is_rooted flag. is_rooted=false marks legacy leaves not yet rooted -- root via ingest_image_identity_first(). Appearances drill via image_appearances on image_identity_id.';
