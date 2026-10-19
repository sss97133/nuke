-- Organization link totals come from the links again, and auction-house episodes get a bounded link writer.
--
-- 20261018183000 made update_organization_stats() and refresh_org_total_vehicles() ratchet total_vehicles /
-- total_events with GREATEST(stored, counted), so hand-set auction-house "universe" numbers survive every
-- recount. Barrett-Jackson shows total_vehicles 48,465 while organization_vehicles held 4,631 vehicles
-- (measured 2026-10-18 02:58Z): the number on the organization page was not computed from anything.
-- Both writers now store the counted value; universe estimates belong in source_census.
--
-- recount_organization_stats(org) is the one recount, shared by the per-row trigger and the backfill.
--
-- backfill_org_vehicles_from_vehicle_events(org, platform, cursor, batch) links the vehicles whose retained
-- auction episodes (vehicle_events.source_platform) ran on the organization's platform, as relationship
-- 'auction_platform' (the same relationship sync_external_listing_to_organization_vehicles writes for a
-- listing's platform). The platform has to belong to the organization through observation_sources.business_id.
-- It pages by (created_at, id) on idx_vehicle_events_platform_created (~0.35 s per 1,000 events measured);
-- paging by vehicle_id read ~10k pages per 1,000 rows (19.5 s). The per-row stats trigger recounts the whole
-- organization on every insert, so a batch skips it (app.skip_org_stats_trigger) and recounts once.
--
-- Revert: restore update_organization_stats() and refresh_org_total_vehicles() from 20261018183000 and DROP FUNCTION the two new ones.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.recount_organization_stats(p_organization_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.businesses b
  SET
    total_images = (SELECT COUNT(*) FROM public.organization_images WHERE organization_id = p_organization_id),
    total_events = (SELECT COUNT(*) FROM public.business_timeline_events WHERE business_id = p_organization_id),
    total_vehicles = (SELECT COUNT(DISTINCT vehicle_id) FROM public.organization_vehicles WHERE organization_id = p_organization_id),
    updated_at = NOW()
  WHERE b.id = p_organization_id;
$function$;

REVOKE ALL ON FUNCTION public.recount_organization_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_organization_stats(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_organization_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org_id UUID;
BEGIN
  IF current_setting('app.skip_org_stats_trigger', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'organization_images' THEN
    org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSIF TG_TABLE_NAME = 'business_timeline_events' THEN
    org_id := COALESCE(NEW.business_id, OLD.business_id);
  ELSIF TG_TABLE_NAME = 'organization_vehicles' THEN
    org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  END IF;

  IF org_id IS NOT NULL THEN
    PERFORM public.recount_organization_stats(org_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_org_total_vehicles()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE businesses b
  SET total_vehicles = (
    SELECT COUNT(DISTINCT ov.vehicle_id)
    FROM organization_vehicles ov
    WHERE ov.organization_id = b.id
  ),
  updated_at = NOW()
  WHERE EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = b.id);
  SELECT COUNT(*)::int FROM businesses b WHERE EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = b.id);
$function$;

CREATE OR REPLACE FUNCTION public.backfill_org_vehicles_from_vehicle_events(
  p_organization_id uuid,
  p_source_platform text,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_event_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 1000
)
RETURNS TABLE(
  scanned integer,
  inserted integer,
  skipped_missing_vehicle integer,
  skipped_merged_vehicle integer,
  next_created_at timestamptz,
  next_event_id uuid,
  organization_total_vehicles integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_previous_skip text := current_setting('app.skip_org_stats_trigger', true);
  v_vehicle_ids uuid[];
  v_last_created_at timestamptz;
  v_last_event_id uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch_size_out_of_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM observation_sources os
    WHERE os.business_id = p_organization_id
      AND regexp_replace(lower(os.slug), '[^a-z0-9]', '', 'g') = regexp_replace(lower(p_source_platform), '[^a-z0-9]', '', 'g')
  ) THEN
    RAISE EXCEPTION 'platform_not_owned_by_organization';
  END IF;

  WITH page AS MATERIALIZED (
    SELECT e.id, e.vehicle_id, e.created_at
    FROM vehicle_events e
    WHERE e.source_platform = p_source_platform
      AND (e.created_at, e.id) < (COALESCE(p_before_created_at, 'infinity'::timestamptz),
                                  COALESCE(p_before_event_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT p_batch_size
  ), last_row AS (
    SELECT p.created_at, p.id FROM page p ORDER BY p.created_at, p.id LIMIT 1
  )
  SELECT count(*)::int,
    array_agg(DISTINCT p.vehicle_id) FILTER (WHERE p.vehicle_id IS NOT NULL),
    (SELECT l.created_at FROM last_row l), (SELECT l.id FROM last_row l)
  INTO scanned, v_vehicle_ids, v_last_created_at, v_last_event_id
  FROM page p;

  SELECT
    count(*) FILTER (WHERE v.id IS NULL)::int,
    count(*) FILTER (WHERE v.merged_into_vehicle_id IS NOT NULL)::int
  INTO skipped_missing_vehicle, skipped_merged_vehicle
  FROM unnest(COALESCE(v_vehicle_ids, '{}'::uuid[])) AS c(vehicle_id)
  LEFT JOIN vehicles v ON v.id = c.vehicle_id;

  PERFORM set_config('app.skip_org_stats_trigger', 'on', true);
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT p_organization_id, c.vehicle_id, 'auction_platform', 'active', true, 'Vehicle event platform: ' || p_source_platform
  FROM unnest(COALESCE(v_vehicle_ids, '{}'::uuid[])) AS c(vehicle_id)
  JOIN vehicles v ON v.id = c.vehicle_id AND v.merged_into_vehicle_id IS NULL
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  PERFORM set_config('app.skip_org_stats_trigger', COALESCE(v_previous_skip, ''), true);

  IF scanned = p_batch_size THEN
    next_created_at := v_last_created_at;
    next_event_id := v_last_event_id;
  END IF;

  IF inserted > 0 OR next_created_at IS NULL THEN
    PERFORM public.recount_organization_stats(p_organization_id);
  END IF;
  SELECT b.total_vehicles INTO organization_total_vehicles FROM businesses b WHERE b.id = p_organization_id;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_org_vehicles_from_vehicle_events(uuid, text, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_org_vehicles_from_vehicle_events(uuid, text, timestamptz, uuid, integer) TO service_role;
