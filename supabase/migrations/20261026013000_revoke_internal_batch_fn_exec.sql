-- Internal-only batch/backfill/trigger functions: no frontend, edge or iOS callers.
-- Remove PUBLIC/anon/authenticated execute; keep service_role.
-- Rollback: supabase/rollbacks/20261026013000_revoke_internal_batch_fn_exec_down.sql
revoke execute on function public.reclassify_evidence_claims(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.reclassify_evidence_claims(uuid,uuid[]) to service_role;
revoke execute on function public.mine_bat_text_claims(uuid[],uuid,boolean) from public, anon, authenticated;
grant execute on function public.mine_bat_text_claims(uuid[],uuid,boolean) to service_role;
revoke execute on function public.mine_bat_text_claims(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.mine_bat_text_claims(uuid[],uuid) to service_role;
revoke execute on function public.evidence_backfill_next(uuid,integer) from public, anon, authenticated;
grant execute on function public.evidence_backfill_next(uuid,integer) to service_role;
revoke execute on function public.compute_evidence_features(uuid[],timestamptz[],uuid) from public, anon, authenticated;
grant execute on function public.compute_evidence_features(uuid[],timestamptz[],uuid) to service_role;
revoke execute on function public.evidence_features_next(uuid,integer) from public, anon, authenticated;
grant execute on function public.evidence_features_next(uuid,integer) to service_role;
revoke execute on function public.fill_graded_mileage(uuid[],uuid) from public, anon, authenticated;
grant execute on function public.fill_graded_mileage(uuid[],uuid) to service_role;
revoke execute on function public.aed_backfill_shard(text,text) from public, anon, authenticated;
grant execute on function public.aed_backfill_shard(text,text) to service_role;
revoke execute on function public.sync_vehicle_sale_price_from_verified_event() from public, anon, authenticated;
grant execute on function public.sync_vehicle_sale_price_from_verified_event() to service_role;
