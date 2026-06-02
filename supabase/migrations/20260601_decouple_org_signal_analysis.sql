-- The org auto-tag (auto_tag_organization_from_gps) inserts into organization_vehicles
-- on EVERY vehicle_images insert. That insert fired trigger_update_primary_focus, which
-- ran analyze_organization_data_signals() SYNCHRONOUSLY — a full-organization scan
-- (counts every image/timeline_event for every vehicle in the org). On a shop org with
-- 100+ vehicles and thousands of images this is O(org) PER IMAGE, so any bulk image
-- ingest/reattribution blew the statement_timeout. (Violates the "no full-table
-- aggregation per row" platform rule.)
--
-- Fix: in the high-frequency organization_vehicles branch, stop running the heavy
-- analytics inline. The org→vehicle link is still created; org signals are analytics
-- (not correctness-critical) and are recomputed on demand / by batch elsewhere. The
-- low-frequency branches (businesses INSERT/UPDATE, receipts, timeline_events) are
-- unchanged.

CREATE OR REPLACE FUNCTION public.trigger_update_primary_focus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    IF TG_OP = 'UPDATE' AND (
      OLD.ui_config IS DISTINCT FROM NEW.ui_config OR
      OLD.business_type IS DISTINCT FROM NEW.business_type
    ) THEN
      PERFORM compute_and_store_primary_focus(NEW.id);
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM compute_and_store_primary_focus(NEW.id);
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
      PERFORM analyze_organization_data_signals(NEW.scope_id::uuid);
      PERFORM compute_and_store_primary_focus(NEW.scope_id::uuid);
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'timeline_events' THEN
    FOR v_org_id IN
      SELECT DISTINCT organization_id
      FROM organization_vehicles
      WHERE vehicle_id = COALESCE(NEW.vehicle_id, OLD.vehicle_id)
        AND organization_id IS NOT NULL
    LOOP
      PERFORM analyze_organization_data_signals(v_org_id);
      PERFORM compute_and_store_primary_focus(v_org_id);
    END LOOP;
    RETURN COALESCE(NEW, OLD);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
