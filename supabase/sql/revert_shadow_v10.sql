-- Revert shadow v10 (additive only). Live estimates were never touched.
-- 1) retire model: update public.shadow_valuation_models set notes = coalesce(notes,'')||' RETIRED' where model_version='shadow-v10-pit-gbm';
--    (nuke_estimates_shadow rows for run 7e1d0c24-2026-4a10-9e00-0000000a5021 are ignored by model_version; no deletes needed)
-- 2) to fully remove the new reference tables:
drop table if exists public.model_segment_map;
drop table if exists public.model_name_normalization;
drop table if exists public.auction_event_listing_mileage;
