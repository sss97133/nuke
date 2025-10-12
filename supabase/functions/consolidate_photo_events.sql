-- Function to consolidate photo_added events into work sessions
-- Groups photos within 30 minutes into single events

CREATE OR REPLACE FUNCTION consolidate_photo_events_for_vehicle(p_vehicle_id UUID)
RETURNS TABLE (
  sessions_created INT,
  events_deleted INT
) AS $$
DECLARE
  v_sessions_created INT := 0;
  v_events_deleted INT := 0;
BEGIN
  -- Create work session events from photo_added events
  WITH ordered_events AS (
    SELECT 
      id,
      vehicle_id,
      user_id,
      event_date,
      created_at,
      metadata,
      LAG(event_date) OVER (ORDER BY event_date, created_at) as prev_event_date
    FROM vehicle_timeline_events
    WHERE vehicle_id = p_vehicle_id
      AND event_type = 'photo_added'
    ORDER BY event_date, created_at
  ),
  session_markers AS (
    SELECT 
      *,
      CASE 
        WHEN prev_event_date IS NULL THEN TRUE
        WHEN (event_date - prev_event_date) > INTERVAL '30 minutes' THEN TRUE
        ELSE FALSE
      END as is_new_session
    FROM ordered_events
  ),
  session_groups AS (
    SELECT 
      *,
      SUM(CASE WHEN is_new_session THEN 1 ELSE 0 END) OVER (ORDER BY event_date, created_at) as session_num
    FROM session_markers
  ),
  session_summary AS (
    SELECT 
      vehicle_id,
      user_id,
      session_num,
      MIN(event_date) as session_start,
      MAX(event_date) as session_end,
      COUNT(*) as photo_count,
      EXTRACT(EPOCH FROM (MAX(event_date) - MIN(event_date)))/60 as duration_minutes,
      ARRAY_AGG(id ORDER BY event_date) as old_event_ids
    FROM session_groups
    GROUP BY vehicle_id, user_id, session_num
  )
  INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    event_date,
    title,
    description,
    metadata
  )
  SELECT 
    vehicle_id,
    user_id,
    'photo_session',
    'consolidated',
    session_start,
    CASE 
      WHEN photo_count = 1 THEN 'Photo Added'
      ELSE 'Work Session - ' || photo_count || ' photos'
    END,
    CASE 
      WHEN photo_count = 1 THEN 'Vehicle photo'
      WHEN duration_minutes < 1 THEN photo_count || ' photos taken'
      ELSE photo_count || ' photos over ' || ROUND(duration_minutes::numeric, 0) || ' minutes'
    END,
    jsonb_build_object(
      'photo_count', photo_count,
      'duration_minutes', ROUND(duration_minutes::numeric, 0),
      'start_time', session_start,
      'end_time', session_end,
      'consolidated', true,
      'consolidated_at', NOW()
    )
  FROM session_summary;
  
  GET DIAGNOSTICS v_sessions_created = ROW_COUNT;
  
  -- Delete old photo_added events for this vehicle
  DELETE FROM vehicle_timeline_events
  WHERE vehicle_id = p_vehicle_id
    AND event_type = 'photo_added';
  
  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;
  
  -- Also delete from legacy timeline_events table
  DELETE FROM timeline_events
  WHERE vehicle_id = p_vehicle_id
    AND event_type = 'photo_added';
  
  RETURN QUERY SELECT v_sessions_created, v_events_deleted;
END;
$$ LANGUAGE plpgsql;

-- Function to consolidate all vehicles
CREATE OR REPLACE FUNCTION consolidate_all_photo_events()
RETURNS TABLE (
  vehicle_id UUID,
  sessions_created INT,
  events_deleted INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    (consolidate_photo_events_for_vehicle(v.id)).*
  FROM (
    SELECT DISTINCT vehicle_id as id
    FROM vehicle_timeline_events
    WHERE event_type = 'photo_added'
  ) v;
END;
$$ LANGUAGE plpgsql;
