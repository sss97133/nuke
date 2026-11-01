-- Use the same recorded identity inputs as vehicle_profile_read (20261018193000).
-- No aliases inferred, catalogue scope broadened, vehicle rows changed, or grants altered.
CREATE OR REPLACE FUNCTION public.vehicle_identity_artwork(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('vehicle_id', v.id, 'marks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('identity_mark_id', m.id, 'kind', m.mark_kind,
      'label', m.display_label, 'assets', assets.rows) ORDER BY m.mark_kind, m.id)
    FROM public.resolve_vehicle_identity_marks(v.make, COALESCE(v.normalized_model, v.model), v.year, v.series, v.trim, v.body_style) m
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.asset_kind, a.id) AS rows
      FROM public.vehicle_identity_mark_assets a
      WHERE a.identity_mark_id = m.id AND a.review_state = 'usable'
        AND NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets newer WHERE newer.supersedes_id = a.id)
        AND (a.asset_kind = 'source' OR EXISTS (
          SELECT 1 FROM public.vehicle_identity_mark_assets original WHERE original.id = a.source_asset_id
            AND original.review_state <> 'withdrawn'
            AND NOT EXISTS (SELECT 1 FROM public.vehicle_identity_mark_assets newer WHERE newer.supersedes_id = original.id)
        ))
    ) assets WHERE assets.rows IS NOT NULL AND v.year IS NOT NULL AND v.make IS NOT NULL AND COALESCE(v.normalized_model, v.model) IS NOT NULL
  ), '[]'::jsonb))
  FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.is_public = true AND v.deleted_at IS NULL;
$$;
