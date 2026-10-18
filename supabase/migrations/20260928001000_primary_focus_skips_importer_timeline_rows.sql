-- trigger_update_primary_focus: importer timeline rows (source_type = 'system') skip the org analytics.
--
-- On every timeline_events INSERT/UPDATE the timeline branch loops over the car's organizations and runs
-- analyze_organization_data_signals() + compute_and_store_primary_focus(). For an org with > 500 vehicles
-- the first short-circuits to a constant 'auction_platform' answer, but it still counts the org's links
-- (Bring a Trailer: 94,298; Cars & Bids: 35,385) and both functions UPDATE the org's businesses row, so
-- each BaT timeline row cost a count + two writes to the same hot row, from every reader stream at once.
-- 20260601_decouple_org_signal_analysis took the same analytics out of the organization_vehicles branch
-- and kept the timeline branch because it was low-frequency; the BaT reader made it bulk.
--
-- Measured 2026-09-27 (forced-rollback EXPLAIN ANALYZE of one reader-shaped insert):
--   car linked to Cars & Bids: 931 ms insert, 753 ms of it in this trigger;
--   car linked to Bring a Trailer: 324 ms insert, 73 ms in this trigger.
--   pg_stat_statements since 09-24: reader timeline inserts 1,557 calls mean 1,469 ms max 59.6 s, and
--   760 calls mean 647 ms max 59.6 s; the reader's timeline phase p50 1,406 ms of a 14.1 s lot.
-- User, receipt and work rows keep the inline recompute. Function replace only: no table lock.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.trigger_update_primary_focus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    IF TG_OP = 'UPDATE' AND (
      OLD.ui_config IS DISTINCT FROM NEW.ui_config OR
      OLD.business_type IS DISTINCT FROM NEW.business_type
    ) THEN
      PERFORM public.compute_and_store_primary_focus(NEW.id);
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM public.compute_and_store_primary_focus(NEW.id);
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'organization_vehicles' THEN
    -- HOT PATH: fired once per image via auto_tag_organization_from_gps.
    -- Do NOT run analyze_organization_data_signals() here (full-org scan, O(org) per row).
    -- Org signals are recomputed on demand / by batch, not synchronously per image.
    RETURN COALESCE(NEW, OLD);
  ELSIF TG_TABLE_NAME = 'receipts' THEN
    IF NEW.scope_type = 'org'
       AND NEW.scope_id IS NOT NULL
       AND NEW.scope_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      PERFORM public.analyze_organization_data_signals(NEW.scope_id::uuid);
      PERFORM public.compute_and_store_primary_focus(NEW.scope_id::uuid);
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'timeline_events' THEN
    -- Importer rows (source_type 'system': extract-bat-core, the auction readers) never recompute org
    -- analytics inline: at bulk load every one of them counted the linked org's vehicles and wrote its
    -- businesses row twice (20260928001000).
    IF NEW.source_type = 'system' THEN
      RETURN NEW;
    END IF;
    -- On UPDATE that moves an event between vehicles, both the source (OLD) and
    -- destination (NEW) vehicle's orgs need recomputing — COALESCE alone would
    -- only touch NEW and leave the old vehicle's org analytics stale.
    FOR v_org_id IN
      SELECT DISTINCT organization_id
      FROM organization_vehicles
      WHERE vehicle_id IN (NEW.vehicle_id, OLD.vehicle_id)
        AND vehicle_id IS NOT NULL
        AND organization_id IS NOT NULL
    LOOP
      PERFORM public.analyze_organization_data_signals(v_org_id);
      PERFORM public.compute_and_store_primary_focus(v_org_id);
    END LOOP;
    RETURN COALESCE(NEW, OLD);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

RESET lock_timeout;
RESET statement_timeout;
