-- Add display_price and nuke_estimate indexes to vehicle_valuation_feed
-- Without these, ORDER BY display_price DESC times out under anon's 3s timeout
-- (480K+ rows in the materialized view need index-backed sorting)

CREATE INDEX IF NOT EXISTS idx_vvf_display_price ON vehicle_valuation_feed(display_price DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vvf_nuke_estimate ON vehicle_valuation_feed(nuke_estimate DESC NULLS LAST);
