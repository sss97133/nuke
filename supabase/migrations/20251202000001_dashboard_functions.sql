-- Dashboard Functions for User Inbox and Notifications
-- Provides RLS-powered queries for dashboard data

-- ==========================================================================
-- 1. GET DASHBOARD PENDING COUNTS
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_dashboard_pending_counts(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB;
BEGIN
  SELECT jsonb_build_object(
    'work_approvals', (
      SELECT COUNT(*)::INTEGER
      FROM work_approval_notifications
      WHERE user_id = p_user_id
        AND response_status = 'pending'
    ),
    'vehicle_assignments', (
      SELECT COUNT(*)::INTEGER
      FROM pending_vehicle_assignments pva
      WHERE pva.status = 'pending'
        AND (
          EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = pva.vehicle_id
              AND (v.uploaded_by = p_user_id OR v.user_id = p_user_id)
          )
          OR EXISTS (
            SELECT 1 FROM organization_contributors oc
            WHERE oc.organization_id = pva.organization_id
              AND oc.user_id = p_user_id
              AND oc.status = 'active'
          )
        )
    ),
    'photo_reviews', (
      SELECT COUNT(*)::INTEGER
      FROM photo_review_queue
      WHERE user_id = p_user_id
        AND status = 'pending'
    ),
    'document_reviews', (
      SELECT COUNT(*)::INTEGER
      FROM document_extractions
      WHERE status = 'pending_review'
        AND reviewed_by = p_user_id
    ),
    'user_requests', (
      SELECT COUNT(*)::INTEGER
      FROM user_requests
      WHERE target_user_id = p_user_id
        AND status = 'pending'
    ),
    'interaction_requests', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_interaction_requests vir
      WHERE vir.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vir.vehicle_id
            AND (v.uploaded_by = p_user_id OR v.user_id = p_user_id)
        )
    ),
    'ownership_verifications', (
      SELECT COUNT(*)::INTEGER
      FROM ownership_verifications
      WHERE vehicle_id IN (
        SELECT id FROM vehicles
        WHERE uploaded_by = p_user_id OR user_id = p_user_id
      )
        AND status = 'pending'
    ),
    'unread_notifications', (
      SELECT COUNT(*)::INTEGER
      FROM user_notifications
      WHERE user_id = p_user_id
        AND is_read = false
    )
  ) INTO v_counts;
  
  RETURN v_counts;
END;
$$;

-- ==========================================================================
-- 2. GET RECENT NOTIFICATIONS
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_recent_notifications(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  message TEXT,
  vehicle_id UUID,
  organization_id UUID,
  related_user_id UUID,
  is_read BOOLEAN,
  is_responded BOOLEAN,
  priority INTEGER,
  created_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    un.id,
    un.type,
    un.title,
    un.message,
    un.vehicle_id,
    un.organization_id,
    un.related_user_id,
    un.is_read,
    un.is_responded,
    un.priority,
    un.created_at,
    un.metadata
  FROM user_notifications un
  WHERE un.user_id = p_user_id
  ORDER BY
    un.is_read ASC,
    un.priority ASC,
    un.created_at DESC
  LIMIT p_limit;
END;
$$;

-- ==========================================================================
-- 3. GET PENDING WORK APPROVALS
-- ==========================================================================

DROP FUNCTION IF EXISTS get_pending_work_approvals(UUID);

CREATE OR REPLACE FUNCTION get_pending_work_approvals(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  organization_name TEXT,
  vehicle_name TEXT,
  work_type TEXT,
  work_description TEXT,
  match_confidence NUMERIC,
  created_at TIMESTAMPTZ,
  vehicle_id UUID,
  organization_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wan.id,
    b.business_name,
    v.year || ' ' || v.make || ' ' || v.model,
    iwe.work_type,
    iwe.work_description,
    wom.match_probability,
    wan.created_at,
    wan.vehicle_id,
    wan.organization_id
  FROM work_approval_notifications wan
  JOIN businesses b ON b.id = wan.organization_id
  JOIN vehicles v ON v.id = wan.vehicle_id
  JOIN work_organization_matches wom ON wom.id = wan.work_match_id
  LEFT JOIN image_work_extractions iwe ON iwe.id = wan.work_extraction_id
  WHERE wan.user_id = p_user_id
    AND wan.response_status = 'pending'
  ORDER BY wan.created_at DESC;
END;
$$;

-- ==========================================================================
-- 4. GET PENDING VEHICLE ASSIGNMENTS
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_pending_vehicle_assignments(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  vehicle_name TEXT,
  organization_name TEXT,
  relationship_type TEXT,
  confidence NUMERIC,
  evidence_sources TEXT[],
  created_at TIMESTAMPTZ,
  vehicle_id UUID,
  organization_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pva.id,
    v.year || ' ' || v.make || ' ' || v.model,
    b.business_name,
    pva.suggested_relationship_type,
    pva.overall_confidence,
    pva.evidence_sources,
    pva.created_at,
    pva.vehicle_id,
    pva.organization_id
  FROM pending_vehicle_assignments pva
  JOIN vehicles v ON v.id = pva.vehicle_id
  JOIN businesses b ON b.id = pva.organization_id
  WHERE pva.status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM vehicles v2
        WHERE v2.id = pva.vehicle_id
          AND (v2.uploaded_by = p_user_id OR v2.user_id = p_user_id)
      )
      OR EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = pva.organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      )
    )
  ORDER BY pva.overall_confidence DESC, pva.created_at DESC;
END;
$$;

-- ==========================================================================
-- 5. MARK NOTIFICATION AS READ
-- ==========================================================================

CREATE OR REPLACE FUNCTION mark_notification_read(
  p_user_id UUID,
  p_notification_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_notifications
  SET
    is_read = true,
    read_at = NOW()
  WHERE id = p_notification_id
    AND user_id = p_user_id;
  
  RETURN FOUND;
END;
$$;

-- ==========================================================================
-- 6. MARK ALL NOTIFICATIONS AS READ
-- ==========================================================================

CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_notifications
  SET
    is_read = true,
    read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = false;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ==========================================================================
-- 7. GET CONNECTED PROFILES SUMMARY
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_connected_profiles_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary JSONB;
BEGIN
  SELECT jsonb_build_object(
    'vehicles', (
      SELECT COUNT(*)::INTEGER
      FROM vehicles
      WHERE uploaded_by = p_user_id OR user_id = p_user_id
    ),
    'organizations', (
      SELECT COUNT(*)::INTEGER
      FROM organization_contributors
      WHERE user_id = p_user_id
        AND status = 'active'
    ),
    'recent_activity', (
      SELECT COUNT(*)::INTEGER
      FROM timeline_events te
      WHERE te.vehicle_id IN (
        SELECT id FROM vehicles
        WHERE uploaded_by = p_user_id OR user_id = p_user_id
      )
        AND te.created_at > NOW() - INTERVAL '7 days'
    )
  ) INTO v_summary;
  
  RETURN v_summary;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION get_dashboard_pending_counts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_notifications(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_work_approvals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_vehicle_assignments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_connected_profiles_summary(UUID) TO authenticated;

