-- ============================================================
-- LAW 2 — SEPARATE VERACITY FROM CONSECRATION
--
-- Doctrine: docs/library/intellectual/contemplations/habitus-and-the-exchange.md (§V, Law 2)
--
-- base_trust_score collapses two ORTHOGONAL axes into one scalar:
--   * veracity     — how much we believe a source is honest / correct.
--                    A forum lifer who has owned forty Blazers is highly veracious.
--   * consecration — the field's licensed authority to CONFER legitimate worth.
--                    An auction house / registry / concours holds power the lifer does not.
--
-- These come apart. The lifer is more truthful than the auction house and holds
-- almost none of its power to make a price real. This migration creates the two
-- axes on the source registry, seeds them honestly (veracity from the existing
-- trust score; consecration from source category), and leaves base_trust_score
-- in place as a legacy read. Nothing is destroyed.
--
-- Additive + idempotent. Touches the ~160-row source registry, NOT the 5.7M-row
-- vehicle_observations fact table.
-- ============================================================

ALTER TABLE observation_sources
  ADD COLUMN IF NOT EXISTS veracity     DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS consecration DECIMAL(3,2);

-- Veracity: the existing base_trust_score already approximates believability.
-- Seed veracity from it; the two diverge later as evidence separates them.
UPDATE observation_sources
SET veracity = base_trust_score
WHERE veracity IS NULL;

-- Consecration: derived from category — the field's authority to confer worth,
-- independent of honesty. A completed sale at auction MAKES a price real; an
-- honest forum post never can. An owner cannot consecrate their own asset's
-- worth (self-interest), though their veracity for occurrence is high. We — the
-- internal instrument — do not consecrate by fiat (reflexivity, §IV).
UPDATE observation_sources
SET consecration = CASE category
    WHEN 'registry'      THEN 0.92  -- Hagerty, marque registries: confer legitimate identity/value
    WHEN 'auction'       THEN 0.90  -- the hammer is the field's supreme consecratory act
    WHEN 'event'         THEN 0.85  -- concours is a consecration ceremony
    WHEN 'museum'        THEN 0.85  -- provenance legitimation; a museum consecrates by holding
    WHEN 'documentation' THEN 0.80  -- titles/build sheets: state & factory consecration of fact
    WHEN 'shop'          THEN 0.55  -- a named shop converts cultural -> symbolic capital, variably
    WHEN 'media'         THEN 0.50  -- a feature confers fame, a soft consecration
    WHEN 'aggregator'    THEN 0.40  -- republishes; does not consecrate
    WHEN 'marketplace'   THEN 0.25  -- a listing is an ASK, not a sale; only the sale consecrates
    WHEN 'dealer'        THEN 0.25  -- sells; the listing is an ask, the sale (auction) consecrates
    WHEN 'agent'         THEN 0.25  -- broker/sales agent: represents, does not confer worth
    WHEN 'owner'         THEN 0.20  -- high veracity for occurrence, no authority over own worth
    WHEN 'forum'         THEN 0.20  -- can be highly veracious, near-zero consecratory power
    WHEN 'social_media'  THEN 0.15
    WHEN 'internal'      THEN 0.10  -- the instrument must not consecrate by fiat
    ELSE 0.25
  END
WHERE consecration IS NULL;

COMMENT ON COLUMN observation_sources.veracity IS
  'How much we believe this source is honest/correct (Searle: claims about brute fact). Seeded from base_trust_score. Doctrine: habitus-and-the-exchange.md §V Law 2.';
COMMENT ON COLUMN observation_sources.consecration IS
  'The field''s licensed authority to CONFER legitimate worth (Bourdieu: consecration), orthogonal to veracity. Seeded by category. Read this — not veracity — when ranking sources for VALUATION. Doctrine: habitus-and-the-exchange.md §III, §V Law 2.';

-- Verification readout (no-op SELECT for migration logs)
DO $$
DECLARE n_null integer;
BEGIN
  SELECT count(*) INTO n_null FROM observation_sources WHERE veracity IS NULL OR consecration IS NULL;
  IF n_null > 0 THEN
    RAISE WARNING 'veracity/consecration split: % rows left unseeded', n_null;
  ELSE
    RAISE NOTICE 'veracity/consecration split: all source-registry rows seeded';
  END IF;
END $$;
