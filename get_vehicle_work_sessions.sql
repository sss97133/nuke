-- Create RPC function to get vehicle work sessions
-- Groups images by date and identifies what work was done
CREATE OR REPLACE FUNCTION get_vehicle_work_sessions(p_vehicle_id uuid)
RETURNS TABLE (
  work_date date,
  image_count integer,
  detected_work text,
  labor_hours numeric
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH work_sessions AS (
    SELECT
      DATE(vi.taken_at) as work_date,
      COUNT(*)::integer as image_count,
      STRING_AGG(DISTINCT it.tag_name, ', ' ORDER BY it.tag_name) as detected_work
    FROM vehicle_images vi
    LEFT JOIN image_tags it ON vi.id = it.image_id
    WHERE vi.vehicle_id = p_vehicle_id
      AND vi.taken_at IS NOT NULL
      AND (it.tag_name IS NULL OR it.metadata->>'category' IN (
        'engine', 'body_panel', 'body', 'suspension', 'paint', 'interior',
        'electrical', 'brake_system', 'transmission', 'drivetrain',
        'cooling', 'fuel_system', 'exhaust', 'axle'
      ))
    GROUP BY DATE(vi.taken_at)
    HAVING COUNT(*) > 2  -- Only sessions with multiple images
  ),
  session_labor AS (
    SELECT
      ws.work_date,
      ws.image_count,
      ws.detected_work,
      COALESCE(
        (SELECT SUM(te.labor_hours)
         FROM timeline_events te
         WHERE te.vehicle_id = p_vehicle_id
           AND DATE(te.event_date) = ws.work_date
           AND te.labor_hours IS NOT NULL),
        0
      ) as labor_hours
    FROM work_sessions ws
  )
  SELECT * FROM session_labor ORDER BY work_date;
END;
$$;