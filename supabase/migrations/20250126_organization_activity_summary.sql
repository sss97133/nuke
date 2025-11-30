-- Organization Activity Summary
-- Materialized view for quick access to organization stats

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS organization_activity_summary;

CREATE MATERIALIZED VIEW organization_activity_summary AS
SELECT 
  oc.organization_id,
  oc.user_id,
  COUNT(DISTINCT ov.vehicle_id) as vehicle_count,
  COUNT(DISTINCT CASE WHEN ov.relationship_type = 'in_stock' THEN ov.vehicle_id END) as in_stock_count,
  COUNT(DISTINCT CASE WHEN ov.relationship_type = 'sold' THEN ov.vehicle_id END) as sold_count,
  COALESCE(SUM(CASE WHEN v.current_value IS NOT NULL THEN v.current_value ELSE 0 END), 0) as total_value,
  COUNT(DISTINCT te.id) as contribution_count,
  MAX(te.created_at) as last_activity_at,
  COUNT(DISTINCT oc2.id) as team_member_count
FROM organization_contributors oc
LEFT JOIN organization_vehicles ov ON ov.organization_id = oc.organization_id
LEFT JOIN vehicles v ON v.id = ov.vehicle_id
LEFT JOIN timeline_events te ON te.organization_id = oc.organization_id
LEFT JOIN organization_contributors oc2 ON oc2.organization_id = oc.organization_id AND oc2.status = 'active'
WHERE oc.status = 'active'
GROUP BY oc.organization_id, oc.user_id;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_activity_summary_org ON organization_activity_summary(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_activity_summary_user ON organization_activity_summary(user_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_organization_activity_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW organization_activity_summary;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW organization_activity_summary IS 'Aggregated stats for organizations: vehicle count, value, contributions, last activity';
COMMENT ON FUNCTION refresh_organization_activity_summary IS 'Refresh the organization activity summary materialized view';



