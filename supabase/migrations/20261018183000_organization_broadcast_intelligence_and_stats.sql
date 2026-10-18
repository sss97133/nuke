-- Align organization broadcast intelligence reader and auction-house universe totals with C15 fold.
SET statement_timeout = '120s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.read_broadcast_entity_profile(p_organization_id uuid, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'organization_id', org.id,
    'name', org.business_name,
    'slug', org.slug,
    'fold', org.broadcast_evidence_state,
    'proxy_unit', 'USD/nominal media second',
    'accepted_bid_velocity', NULL,
    'excitation', NULL,
    'derived_subject_claims', coalesce((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT o.id, o.source_id, o.source_identifier, o.subject_organization_id,
               o.observed_at, o.ingested_at, o.structured_data, o.property_id
        FROM public.vehicle_observations o
        WHERE o.subject_organization_id = org.id
          AND (
            to_regclass('public.observation_sources') IS NULL
            OR o.source_id IS NULL
            OR o.source_id = coalesce((SELECT id FROM public.observation_sources WHERE slug = 'youtube'), o.source_id)
          )
          AND o.structured_data->>'kind_detail' = 'broadcast_profile_derived'
          AND (public.observation_is_public(o.kind, o.structured_data) OR o.structured_data->>'kind_detail' = 'broadcast_profile_derived')
        ORDER BY o.ingested_at DESC
        LIMIT greatest(1, least(p_limit, 100))
      ) x
    ), '[]'::jsonb),
    'presentations', coalesce((
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT e.id, e.vehicle_id, e.broadcast_evidence_state, e.broadcast_evidence_last_observation_id,
               public.broadcast_event_display_proxy(e.broadcast_evidence_state) AS sampled_display_regression_proxy
        FROM public.auction_events e
        WHERE e.broadcast_publisher_organization_id = org.id
          AND e.broadcast_evidence_state IS NOT NULL
        ORDER BY e.id
        LIMIT greatest(1, least(p_limit, 100))
      ) x
    ), '[]'::jsonb)
  )
  FROM public.organizations org
  WHERE org.id = p_organization_id AND org.is_public IS TRUE
$$;

REVOKE ALL ON FUNCTION public.read_broadcast_entity_profile(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_broadcast_entity_profile(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_organization_broadcast_intelligence(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_rows jsonb;
  v_pub_key text;
  v_bound_vehicles jsonb;
  v_publications jsonb;
  v_native_profile jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', vo.id,
      'source_identifier', vo.source_identifier,
      'source_url', vo.source_url,
      'observed_at', vo.observed_at,
      'ingested_at', vo.ingested_at,
      'context_bound_at', vo.context_bound_at,
      'subject_organization_id', vo.subject_organization_id,
      'confidence', vo.confidence,
      'confidence_score', vo.confidence_score,
      'content_text', vo.content_text,
      'structured_data', vo.structured_data
    ) ORDER BY vo.source_identifier
  ), '[]'::jsonb)
  INTO v_org_rows
  FROM public.vehicle_observations vo
  WHERE vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
    AND vo.subject_type = 'organization'
    AND vo.subject_organization_id = p_organization_id
    AND COALESCE(vo.is_superseded, false) = false;

  SELECT COALESCE(vo.structured_data->>'publisher_key', vo.structured_data->>'publisher')
  INTO v_pub_key
  FROM public.vehicle_observations vo
  WHERE vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
    AND vo.subject_type = 'organization'
    AND vo.subject_organization_id = p_organization_id
    AND (vo.structured_data ? 'publisher_key' OR vo.structured_data ? 'publisher')
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_bound_vehicles
  FROM (
    SELECT
      v.id AS vehicle_id,
      v.year,
      v.make,
      v.model,
      v.trim,
      v.vin,
      v.sale_price,
      count(vo.id)::int AS broadcast_claim_count,
      count(vo.property_id)::int AS bound_property_count,
      (SELECT count(*)::int FROM public.vehicle_observations vo2 WHERE vo2.vehicle_id = v.id AND COALESCE(vo2.is_superseded, false) = false) AS total_observation_count,
      min(vo.source_url) AS sample_broadcast_url,
      max(p.platform_id) AS video_id,
      max(p.id::text)::uuid AS publication_id,
      max(vo.auction_event_id::text)::uuid AS auction_event_id
    FROM public.vehicle_observations vo
    JOIN public.publications p ON p.id = vo.citation_publication_id
    JOIN public.vehicles v ON v.id = vo.vehicle_id
    WHERE vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
      AND vo.subject_type = 'vehicle'
      AND vo.vehicle_id IS NOT NULL
      AND p.organization_id = p_organization_id
      AND COALESCE(vo.is_superseded, false) = false
    GROUP BY v.id, v.year, v.make, v.model, v.trim, v.vin, v.sale_price
    ORDER BY broadcast_claim_count DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(pub_row)), '[]'::jsonb)
  INTO v_publications
  FROM (
    SELECT
      p.id AS publication_id,
      p.platform,
      p.platform_id AS video_id,
      p.title,
      p.platform_url,
      p.publication_date,
      count(vo.id)::int AS bound_claim_count,
      count(DISTINCT vo.vehicle_id)::int AS bound_vehicle_count,
      count(DISTINCT vo.auction_event_id)::int AS bound_event_count
    FROM public.publications p
    LEFT JOIN public.vehicle_observations vo
      ON vo.citation_publication_id = p.id
     AND vo.source_id = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4'::uuid
     AND COALESCE(vo.is_superseded, false) = false
    WHERE p.organization_id = p_organization_id
      AND p.platform = 'youtube'
    GROUP BY p.id, p.platform, p.platform_id, p.title, p.platform_url, p.publication_date
    ORDER BY bound_claim_count DESC, p.publication_date DESC NULLS LAST
  ) pub_row;

  SELECT public.read_broadcast_entity_profile(p_organization_id, 20)
  INTO v_native_profile;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'publisher_key', v_pub_key,
    'observations', v_org_rows,
    'bound_vehicles', v_bound_vehicles,
    'publications', v_publications,
    'native_profile', v_native_profile
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_organization_broadcast_intelligence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_broadcast_intelligence(uuid) TO anon, authenticated, service_role;

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
    UPDATE public.businesses b
    SET
      total_images = (SELECT COUNT(*) FROM public.organization_images WHERE organization_id = org_id),
      total_events = GREATEST(
        COALESCE(b.total_events, 0),
        (SELECT COUNT(*) FROM public.business_timeline_events WHERE business_id = org_id)
      ),
      total_vehicles = GREATEST(
        COALESCE(b.total_vehicles, 0),
        (SELECT COUNT(*) FROM public.organization_vehicles WHERE organization_id = org_id)
      ),
      updated_at = NOW()
    WHERE b.id = org_id;
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
  SET total_vehicles = GREATEST(
    COALESCE(b.total_vehicles, 0),
    (
      SELECT COUNT(DISTINCT ov.vehicle_id)
      FROM organization_vehicles ov
      WHERE ov.organization_id = b.id AND COALESCE(ov.status, 'active') = 'active'
    )
  ),
  updated_at = NOW()
  WHERE EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = b.id);
  SELECT COUNT(*)::int FROM businesses b WHERE EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = b.id);
$function$;

CREATE OR REPLACE FUNCTION public.analyze_organization_data_signals(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_signals JSONB;
  v_service_count INTEGER := 0;
  v_inventory_count INTEGER := 0;
  v_sold_count INTEGER := 0;
  v_vehicle_total INTEGER := 0;
  v_quick_count INTEGER := 0;
  v_org_total_vehicles INTEGER := 0;
  v_receipt_data RECORD;
  v_timeline_data RECORD;
  v_image_data RECORD;
  v_inferred_type TEXT;
  v_primary_focus TEXT;
  v_confidence NUMERIC := 0.0;
BEGIN
  SELECT COALESCE(total_vehicles, 0) INTO v_org_total_vehicles
  FROM businesses
  WHERE id = p_organization_id;

  SELECT GREATEST(v_org_total_vehicles, COUNT(*)::int) INTO v_quick_count
  FROM organization_vehicles
  WHERE organization_id = p_organization_id;

  IF v_quick_count > 500 THEN
    v_signals := jsonb_build_object(
      'vehicles', jsonb_build_object('total', v_quick_count, 'service', 0, 'inventory', 0, 'sold', 0),
      'receipts', jsonb_build_object('total', 0, 'with_labor', 0, 'with_parts', 0, 'avg_value', 0, 'total_investment', 0),
      'timeline', jsonb_build_object('total_events', 0, 'work_events', 0, 'avg_duration_hours', 0),
      'images', jsonb_build_object('total', 0, 'work_in_progress', 0, 'finished_work', 0),
      'inferred_type', 'auction_platform',
      'primary_focus', 'marketplace',
      'confidence', 0.95,
      'skipped_deep_analysis', true,
      'reason', 'org_too_large_for_row_scan',
      'analyzed_at', NOW()
    );

    UPDATE businesses
    SET data_signals = v_signals, intelligence_last_updated = NOW()
    WHERE id = p_organization_id;

    RETURN v_signals;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('service_provider', 'work_location')) as service,
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('in_stock', 'consigner', 'owner', 'current_consignment')) as inventory,
    COUNT(*) FILTER (WHERE v.sale_date IS NOT NULL OR v.sale_price IS NOT NULL) as sold,
    COUNT(*) as total
  INTO v_service_count, v_inventory_count, v_sold_count, v_vehicle_total
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = p_organization_id
    AND ov.status = 'active';

  SELECT
    COUNT(*) as total,
    0 as with_labor,
    0 as with_parts,
    COALESCE(AVG(r.total), 0) as avg_value,
    COALESCE(SUM(r.total), 0) as total_investment
  INTO v_receipt_data
  FROM receipts r
  WHERE r.scope_type = 'org'
    AND r.scope_id::uuid = p_organization_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE te.event_type IN ('work', 'service', 'repair', 'maintenance')) as work_events,
    COALESCE(AVG(te.duration_hours), 0) as avg_duration
  INTO v_timeline_data
  FROM timeline_events te
  JOIN organization_vehicles ov ON ov.vehicle_id = te.vehicle_id
  WHERE ov.organization_id = p_organization_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE vi.category IN ('work_in_progress', 'service')) as work_images,
    COUNT(*) FILTER (WHERE vi.category IN ('finished_work', 'completed')) as finished_images
  INTO v_image_data
  FROM vehicle_images vi
  JOIN organization_vehicles ov ON ov.vehicle_id = vi.vehicle_id
  WHERE ov.organization_id = p_organization_id;

  IF v_service_count > v_inventory_count * 2 AND v_receipt_data.with_labor > 0 THEN
    v_inferred_type := 'body_shop'; v_primary_focus := 'service'; v_confidence := 0.8;
  ELSIF v_inventory_count > v_service_count * 2 THEN
    v_inferred_type := 'dealership'; v_primary_focus := 'inventory'; v_confidence := 0.8;
  ELSIF v_service_count > 0 AND v_receipt_data.total > 0 THEN
    v_inferred_type := 'garage'; v_primary_focus := 'service'; v_confidence := 0.6;
  ELSIF v_inventory_count > 0 THEN
    v_inferred_type := 'dealership'; v_primary_focus := 'inventory'; v_confidence := 0.6;
  ELSE
    v_inferred_type := 'unknown'; v_primary_focus := 'mixed'; v_confidence := 0.3;
  END IF;

  v_signals := jsonb_build_object(
    'vehicles', jsonb_build_object(
      'total', GREATEST(v_org_total_vehicles, COALESCE(v_service_count + v_inventory_count, 0)),
      'service', v_service_count, 'inventory', v_inventory_count, 'sold', v_sold_count
    ),
    'receipts', jsonb_build_object(
      'total', COALESCE(v_receipt_data.total, 0), 'with_labor', COALESCE(v_receipt_data.with_labor, 0),
      'with_parts', COALESCE(v_receipt_data.with_parts, 0), 'avg_value', COALESCE(v_receipt_data.avg_value, 0),
      'total_investment', COALESCE(v_receipt_data.total_investment, 0)
    ),
    'timeline', jsonb_build_object(
      'total_events', COALESCE(v_timeline_data.total, 0), 'work_events', COALESCE(v_timeline_data.work_events, 0),
      'avg_duration_hours', COALESCE(v_timeline_data.avg_duration, 0)
    ),
    'images', jsonb_build_object(
      'total', COALESCE(v_image_data.total, 0), 'work_in_progress', COALESCE(v_image_data.work_images, 0),
      'finished_work', COALESCE(v_image_data.finished_images, 0)
    ),
    'inferred_type', v_inferred_type, 'primary_focus', v_primary_focus,
    'confidence', v_confidence, 'analyzed_at', NOW()
  );

  UPDATE businesses SET data_signals = v_signals, intelligence_last_updated = NOW()
  WHERE id = p_organization_id;

  RETURN v_signals;
END;
$function$;
