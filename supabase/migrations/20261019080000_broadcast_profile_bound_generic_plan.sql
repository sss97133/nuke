-- The SQL function's parameterized LIMIT makes its generic plan scan the ingestion-time
-- index over all observations looking for an organization claim. A literal LIMIT instead uses
-- the source index; this explains why an inline probe passed while the public RPC still timed out.
-- Materialize the filtered source/organization/derived claims before ordering and limiting them,
-- so both literal and generic plans use the bounded source-index read. Only qualifying rows are
-- materialized; output columns, limits, public-org/source gates, invoker context and grants stay the same.
-- Revert: restore read_broadcast_entity_profile from 20261019074500.
SET statement_timeout = '10s';
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
      WITH derived_claims AS MATERIALIZED (
        SELECT o.id, o.source_id, o.source_identifier, o.subject_organization_id,
               o.observed_at, o.ingested_at, o.structured_data, o.property_id
        FROM public.vehicle_observations o
        WHERE (o.source_id = (SELECT id FROM public.observation_sources WHERE slug = 'youtube')
               OR o.source_id IS NULL)
          AND o.subject_organization_id = org.id
          AND o.structured_data->>'kind_detail' = 'broadcast_profile_derived'
      )
      SELECT jsonb_agg(to_jsonb(x)) FROM (
        SELECT * FROM derived_claims
        ORDER BY ingested_at DESC
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
