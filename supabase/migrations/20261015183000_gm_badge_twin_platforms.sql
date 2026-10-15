-- canonical_models.platform: the shared platform of badge twins, so a price population can pool across badges.
--
-- MEASURED 2026-10-15 06:00Z (skylar-08, listing-merit fold mv_family_year_prices): a 1995 GMC K1500 ask saw only 6
-- recorded sales across 1990-2000, because the GMC K1500 and the Chevrolet K1500 are separate families
-- (mv_model_family_names keys by make), though they are one truck with two badges. The same holds for Sierra and
-- Silverado, Jimmy and the K5 Blazer, Yukon and Tahoe, the two Suburbans, and the smaller GM trucks and vans.
--
-- CHANGE: a nullable platform column on canonical_models (a cited key, null for most rows) and its values for the GM
-- (Chevrolet / GMC) badge twins below, set on every row of each make and model, duplicates included, so whichever row
-- id mv_model_family_names picks as the family id carries it. Readers pool by platform within a model-year window, so
-- one platform key spanning generations is safe. Nothing else changes: no view, no fold. Reference rows, not testimony.
-- Basis: the GM truck and van lines sold the same vehicle under Chevrolet and GMC badges (C/K and its successors,
-- Blazer/Jimmy, Suburban, Tahoe/Yukon, S-10/S-15 and Sonoma, Astro/Safari, Express/Savana, El Camino/Caballero,
-- Colorado/Canyon, TrailBlazer/Envoy).
--
-- EXPECTED after: 13 platform keys, each on both badges; the GMC and Chevrolet K1500 rows share 'gm-k1500'.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.canonical_models ADD COLUMN IF NOT EXISTS platform text;
COMMENT ON COLUMN public.canonical_models.platform IS
  'Shared platform of badge twins (the same vehicle sold under two makes), e.g. gm-k1500 for the Chevrolet and GMC '
  'K1500. A cited key for pooling price populations across badges within a model-year window; null when the model '
  'has no badge twin. 20261015183000.';

WITH twin (make_l, model_l, platform) AS (VALUES
  ('chevrolet', 'c1500', 'gm-c1500'), ('gmc', 'c1500', 'gm-c1500'),
  ('chevrolet', 'k1500', 'gm-k1500'), ('gmc', 'k1500', 'gm-k1500'),
  ('chevrolet', 'silverado', 'gm-silverado-sierra'), ('gmc', 'sierra', 'gm-silverado-sierra'),
  ('chevrolet', 'k5 blazer', 'gm-k5-blazer-jimmy'), ('chevrolet', 'blazer', 'gm-k5-blazer-jimmy'), ('gmc', 'jimmy', 'gm-k5-blazer-jimmy'),
  ('chevrolet', 'suburban', 'gm-suburban'), ('gmc', 'suburban', 'gm-suburban'), ('gmc', 'yukon xl', 'gm-suburban'),
  ('chevrolet', 'tahoe', 'gm-tahoe-yukon'), ('gmc', 'yukon', 'gm-tahoe-yukon'),
  ('chevrolet', 's10', 'gm-s10-sonoma'), ('chevrolet', 's-10 pickup', 'gm-s10-sonoma'), ('gmc', 'sonoma', 'gm-s10-sonoma'),
  ('gmc', 's15 pickup', 'gm-s10-sonoma'),
  ('chevrolet', 's-10 blazer', 'gm-s-blazer-jimmy'), ('gmc', 's15 utility', 'gm-s-blazer-jimmy'),
  ('chevrolet', 'astro', 'gm-astro-safari'), ('chevrolet', 'astro van', 'gm-astro-safari'), ('gmc', 'safari', 'gm-astro-safari'),
  ('chevrolet', 'express', 'gm-express-savana'), ('gmc', 'savana', 'gm-express-savana'),
  ('chevrolet', 'el camino', 'gm-el-camino-caballero'), ('gmc', 'caballero', 'gm-el-camino-caballero'),
  ('chevrolet', 'colorado', 'gm-colorado-canyon'), ('gmc', 'canyon', 'gm-colorado-canyon'),
  ('chevrolet', 'trailblazer', 'gm-trailblazer-envoy'), ('gmc', 'envoy', 'gm-trailblazer-envoy')
)
UPDATE public.canonical_models m
SET platform = t.platform
FROM twin t
WHERE lower(m.make) = t.make_l AND lower(m.canonical_model) = t.model_l
  AND m.platform IS DISTINCT FROM t.platform;

DO $check$
DECLARE one_badge text;
BEGIN
  SELECT string_agg(platform, ', ') INTO one_badge FROM (
    SELECT platform FROM public.canonical_models WHERE platform LIKE 'gm-%'
    GROUP BY platform HAVING count(DISTINCT lower(make)) < 2
  ) x;
  IF one_badge IS NOT NULL THEN
    RAISE EXCEPTION 'platforms on one badge only (a twin row is missing): %', one_badge;
  END IF;
END $check$;

COMMIT;
