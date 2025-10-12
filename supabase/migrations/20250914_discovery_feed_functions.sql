-- Create function to get user leaderboard based on vehicle count
CREATE OR REPLACE FUNCTION get_user_leaderboard()
RETURNS TABLE (
  user_id uuid,
  total_points bigint,
  activity_count bigint,
  skill_level text,
  profiles jsonb
) 
LANGUAGE sql
AS $$
  SELECT 
    p.id as user_id,
    COALESCE(v.vehicle_count * 100, 0) as total_points,
    COALESCE(v.vehicle_count, 0) as activity_count,
    CASE 
      WHEN COALESCE(v.vehicle_count, 0) >= 5 THEN 'expert'
      WHEN COALESCE(v.vehicle_count, 0) >= 3 THEN 'journeyman'
      WHEN COALESCE(v.vehicle_count, 0) >= 1 THEN 'apprentice'
      ELSE 'novice'
    END as skill_level,
    jsonb_build_array(
      jsonb_build_object(
        'username', p.username,
        'avatar_url', p.avatar_url
      )
    ) as profiles
  FROM profiles p
  LEFT JOIN (
    SELECT user_id, COUNT(*) as vehicle_count
    FROM vehicles 
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  ) v ON p.id = v.user_id
  WHERE p.username IS NOT NULL
  ORDER BY COALESCE(v.vehicle_count, 0) DESC, p.created_at ASC
  LIMIT 10;
$$;

-- Create function to get user discovery stats
CREATE OR REPLACE FUNCTION get_user_discovery_stats(p_user_id uuid)
RETURNS TABLE (
  total_points bigint,
  total_discoveries bigint,
  current_streak integer,
  skill_level text,
  rank_percentile numeric
)
LANGUAGE sql
AS $$
  SELECT 
    COALESCE(v.vehicle_count * 100, 0) as total_points,
    COALESCE(v.vehicle_count, 0) as total_discoveries,
    1 as current_streak, -- Simple implementation
    CASE 
      WHEN COALESCE(v.vehicle_count, 0) >= 5 THEN 'expert'
      WHEN COALESCE(v.vehicle_count, 0) >= 3 THEN 'journeyman'
      WHEN COALESCE(v.vehicle_count, 0) >= 1 THEN 'apprentice'
      ELSE 'novice'
    END as skill_level,
    CASE 
      WHEN COALESCE(v.vehicle_count, 0) >= 5 THEN 10.0
      WHEN COALESCE(v.vehicle_count, 0) >= 3 THEN 25.0
      WHEN COALESCE(v.vehicle_count, 0) >= 1 THEN 50.0
      ELSE 90.0
    END as rank_percentile
  FROM (
    SELECT COUNT(*) as vehicle_count
    FROM vehicles 
    WHERE user_id = p_user_id
  ) v;
$$;
