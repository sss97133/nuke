-- read_broadcast_entity_profile reads derived organization claims through the source_id index.
--
-- The derived-claims subquery filtered `subject_organization_id = org` and
-- `source_id IS NULL OR source_id = coalesce(<youtube source>, source_id)`. vehicle_observations has no
-- subject_organization_id index (20261002131000 skips idx_vo_organization_subject_time above 1M rows) and the
-- coalesce form is not sargable, so every call parallel-seq-scanned the table (about 10M rows). The org page's
-- get_organization_broadcast_intelligence call hit the anon 15 s statement timeout on every organization,
-- including ones with no broadcast evidence (measured logged out 2026-10-18 05:20Z: Barrett-Jackson, Mecum,
-- Bonhams, RM Sotheby's).
--
-- The filter is now `source_id = <youtube source> OR source_id IS NULL`, a BitmapOr on idx_observations_source
-- (25 derived claims under the YouTube source and 9,653 NULL-source rows on 2026-10-18; 1.1 s for Barrett-Jackson).
-- When no 'youtube' source row exists only NULL-source claims are read, where the old form read every source.
-- Output shape and the presentations subquery are unchanged; CREATE OR REPLACE keeps the existing grants.
--
-- Revert: re-run the read_broadcast_entity_profile definition from 20261018183000.
SET statement_timeout = '30s';
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
        WHERE (o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'youtube')
               OR o.source_id IS NULL)
          AND o.subject_organization_id = org.id
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

RESET statement_timeout;
RESET lock_timeout;
