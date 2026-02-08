-- Deal Score Spectrum: Replace 5-tier judgmental labels with 7-tier neutral +/- system
--
-- Old: steal, good_deal, fair, overpriced, way_overpriced
-- New: plus_3, plus_2, plus_1, fair, minus_1, minus_2, minus_3
--
-- Thresholds (deal_score = (estimate - asking) / estimate * 100 * freshness):
--   >= 25  → plus_3   (+++, significantly below market)
--   >= 15  → plus_2   (++,  well below market)
--   >= 5   → plus_1   (+,   below market)
--   >= -5  → fair     (at market)
--   >= -15 → minus_1  (-,   above market)
--   >= -25 → minus_2  (--, well above market)
--   < -25  → minus_3  (---, significantly above market)

BEGIN;

-- 1. Drop old CHECK constraint
ALTER TABLE nuke_estimates
  DROP CONSTRAINT IF EXISTS nuke_estimates_deal_score_label_check;

-- 2. Migrate existing rows to new labels
UPDATE nuke_estimates SET deal_score_label = 'plus_3'  WHERE deal_score_label = 'steal';
UPDATE nuke_estimates SET deal_score_label = 'plus_2'  WHERE deal_score_label = 'good_deal';
-- 'fair' stays 'fair'
UPDATE nuke_estimates SET deal_score_label = 'minus_1' WHERE deal_score_label = 'overpriced';
UPDATE nuke_estimates SET deal_score_label = 'minus_2' WHERE deal_score_label = 'way_overpriced';

-- 3. Add new CHECK constraint with all 7 values
ALTER TABLE nuke_estimates
  ADD CONSTRAINT nuke_estimates_deal_score_label_check
  CHECK (deal_score_label IS NULL OR deal_score_label IN (
    'plus_3', 'plus_2', 'plus_1', 'fair', 'minus_1', 'minus_2', 'minus_3'
  ));

-- 4. Refresh materialized view
REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed;

COMMIT;
