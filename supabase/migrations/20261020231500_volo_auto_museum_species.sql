-- volo-auto-museum: the one source holding data on the Sources board with no species. The deploy gate ("Every source
-- holding data declares its species with evidence") failed run 39373819182 (2026-10-20 05:14Z) on it after the
-- 20261020200000 writer gave it a row: 4 lots in mv_source_target_landed (slug volocars, measured 2026-10-19 10:27Z),
-- the four volocars.com/auto-sales/vehicles/<id>/<car> listing rows of 2025-12-28. Its registry note already says
-- "dealer-museum hybrid, categorized as dealer; commercial sales-incentive on consigned cars"; organizations row:
-- business_type dealer, website https://www.volocars.com. Species dealer, read from those pages. Idempotent.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
BEGIN;
UPDATE public.observation_sources
   SET species = 'dealer', species_set = '{dealer}', updated_at = now(),
       species_evidence = '{"examined_at": "2026-10-19", "examined": ["vehicle_events volocars (4), e.g. https://volocars.com/auto-sales/vehicles/18214/1967-chevrolet-camaro-ss-396 (2025-12-28)", "mv_source_target_landed volocars: 4 lots, measured 2026-10-19 10:27Z", "observation_sources notes: dealer-museum hybrid, consigned cars; organizations.business_type dealer, website https://www.volocars.com"], "seen": "Its own site''s /auto-sales/vehicles/<stock id>/<car> pages: consigned cars for sale at a museum that sells, dealer stock on the seller''s own site. No bids, no lot, no close.", "doc": "docs/ledger/theory/data-machine-cases.md §6 names dealers under Dealer sites"}'::jsonb
 WHERE slug = 'volo-auto-museum' AND species IS NULL;
COMMIT;
