-- Owner-run updatable views stop accepting writes from anon and authenticated.
--
-- Measured 2026-10-14 ~08:45Z. 22 views in public are owned by a BYPASSRLS role, set no security_invoker, are
-- auto-updatable (pg_relation_is_updatable mask 28: INSERT, UPDATE, DELETE) and grant INSERT, UPDATE, DELETE and
-- TRUNCATE to anon and authenticated (vehicles_needing_cascading_correction to authenticated only). A write through
-- such a view runs on its base table with the owner's rights, so no row policy applies. For each view, a plan-only
-- probe as the caller (`begin; set local role anon; explain delete from public.<view>; rollback;`, nothing executed)
-- plans "Delete on <base table>" with no policy filter: the public key could delete any vehicle (vehicle_display_names
-- has no filter at all, and the vehicles foreign keys cascade), any vehicle image, organization, image tag, actor,
-- source registry row or schema proposal. The same statement on the base table itself carries the policies.
--
--   view                                    base table written       code that writes through it
--   actor_profiles                          actors                   none
--   admin_pending_vehicles_analysis         vehicles                 none
--   ai_processing_queue                     vehicle_images           none
--   auction_pricing_dashboard               vehicles                 none
--   concierge_supply_stbarth                organizations            none (one script reads a count)
--   fractional_vehicle_platforms            organizations            none
--   methodology_active                      methodology_references   none (an edge function reads it)
--   orgs_needing_investigation              organizations            none
--   publication_features_public             publication_features     none
--   tag_analysis_view                       image_tags               none
--   user_vehicle_relationships              (anon cannot plan it: a function inside is not executable by anon)
--   v_heat_tag_backtest                     heat_tag_backtest        none
--   v_open_proposals                        schema_proposals         none
--   v_sources_needing_attention             source_registry          none
--   v_ugly_sources                          source_registry          none
--   v_valuation_accuracy                    vehicles                 none
--   vehicle_display_names                   vehicles                 none
--   vehicle_permissions_debug               vehicles                 none
--   vehicle_rarity_view                     vehicle_production_data  none
--   vehicles_needing_cascading_correction   vehicles (authenticated) none
--
-- "Code" is the web (nuke_frontend), the iOS app, edge functions and scripts (git grep, 2026-10-14). SELECT grants
-- are unchanged; the service role keeps its writes. Not here: vehicle_timeline_events (the web writes through it at
-- 12 sites; handled on its own), geometry_columns (PostGIS: its write rules rewrite to nothing; owned by
-- supabase_admin), vehicles_inventory (closed by 20261014073000_private_money_readers).
-- Contract: supabase/sql/test_owner_view_writes_revoked.sql (CI job owner-view-writes-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $revoke$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'actor_profiles', 'admin_pending_vehicles_analysis', 'ai_processing_queue', 'auction_pricing_dashboard',
    'concierge_supply_stbarth', 'fractional_vehicle_platforms', 'methodology_active', 'orgs_needing_investigation',
    'publication_features_public', 'tag_analysis_view', 'user_vehicle_relationships', 'v_heat_tag_backtest',
    'v_open_proposals', 'v_sources_needing_attention', 'v_ugly_sources', 'v_valuation_accuracy',
    'vehicle_display_names', 'vehicle_permissions_debug', 'vehicle_rarity_view', 'vehicles_needing_cascading_correction']
  LOOP
    IF to_regclass(format('public.%I', v)) IS NULL THEN
      RAISE NOTICE 'view public.% is gone; nothing to revoke', v;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', v);
  END LOOP;
END $revoke$;

-- This migration's own result, and the owner-run writable views left for review.
DO $check$
DECLARE
  v_left text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'actor_profiles', 'admin_pending_vehicles_analysis', 'ai_processing_queue', 'auction_pricing_dashboard',
      'concierge_supply_stbarth', 'fractional_vehicle_platforms', 'methodology_active', 'orgs_needing_investigation',
      'publication_features_public', 'tag_analysis_view', 'user_vehicle_relationships', 'v_heat_tag_backtest',
      'v_open_proposals', 'v_sources_needing_attention', 'v_ugly_sources', 'v_valuation_accuracy',
      'vehicle_display_names', 'vehicle_permissions_debug', 'vehicle_rarity_view',
      'vehicles_needing_cascading_correction']) AS v(name)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
    CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
    WHERE to_regclass(format('public.%I', v.name)) IS NOT NULL
      AND has_table_privilege(r.role, format('public.%I', v.name), p.priv)) THEN
    RAISE EXCEPTION 'owner view write grants did not land as written';
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_left
  FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' AND o.rolbypassrls
    AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
        NOT IN ('true', 'on')
    AND (pg_relation_is_updatable(c.oid, false) & 28) > 0
    AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
         OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('authenticated', c.oid, 'INSERT')
         OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE'));
  RAISE NOTICE 'owner-run writable views still granting writes to anon or authenticated: %', coalesce(v_left, 'none');
END $check$;

COMMIT;
