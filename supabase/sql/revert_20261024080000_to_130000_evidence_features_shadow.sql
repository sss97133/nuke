-- Revert evidence feature layer + shadow estimate (migrations 080000..130000). Live nuke_estimates untouched by these.
begin;
drop view if exists public.vehicle_quality_shadow, public.evidence_features_current, public.shadow_sale_prices;
drop function if exists public.compute_shadow_estimates, public.compute_shadow_comp_base, public.shadow_sale_prices_snap_chunk,
  public.evidence_features_next, public.compute_evidence_features, public.evidence_items, public.evidence_backfill_next;
drop table if exists public.nuke_estimates_shadow, public.shadow_valuation_models, public.shadow_quality_weights,
  public.shadow_comp_base, public.shadow_sale_prices_snap, public.shadow_price_basis_factors,
  public.evidence_features, public.evidence_source_feature_map, public.evidence_backfill_queue;
-- Backfilled claims (listing_description only, run bf001). Adjust table name if claims live elsewhere.
delete from public.evidence_claims where run_id::text like '%bf001';
commit;
