-- Function to create a contribution with related data
CREATE OR REPLACE FUNCTION create_contribution(
  contribution_data JSONB,
  vehicle_ids UUID[],
  project_ids UUID[],
  skill_data JSONB[]
) RETURNS JSONB AS $$
DECLARE
  new_contribution_id UUID;
  skill JSONB;
BEGIN
  -- Insert the contribution
  INSERT INTO contributions (
    title,
    description,
    contribution_type,
    status,
    start_date,
    end_date,
    hours_spent,
    user_id
  )
  SELECT
    contribution_data->>'title',
    contribution_data->>'description',
    (contribution_data->>'contribution_type')::contribution_type,
    (contribution_data->>'status')::contribution_status,
    (contribution_data->>'start_date')::DATE,
    (contribution_data->>'end_date')::DATE,
    (contribution_data->>'hours_spent')::DECIMAL,
    (contribution_data->>'user_id')::UUID
  RETURNING id INTO new_contribution_id;

  -- Link to vehicles
  INSERT INTO vehicle_contributions (vehicle_id, contribution_id)
  SELECT unnest(vehicle_ids), new_contribution_id;

  -- Link to projects
  INSERT INTO project_contributions (project_id, contribution_id)
  SELECT unnest(project_ids), new_contribution_id;

  -- Link to skills
  FOREACH skill IN ARRAY skill_data
  LOOP
    INSERT INTO contribution_skills (
      contribution_id,
      skill_id,
      proficiency_level
    )
    VALUES (
      new_contribution_id,
      (skill->>'skill_id')::UUID,
      (skill->>'proficiency_level')::skill_level
    );
  END LOOP;

  -- Return the complete contribution data
  RETURN (
    SELECT jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'description', c.description,
      'contribution_type', c.contribution_type,
      'status', c.status,
      'start_date', c.start_date,
      'end_date', c.end_date,
      'hours_spent', c.hours_spent,
      'user_id', c.user_id,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'vehicles', (
        SELECT jsonb_agg(vc.vehicle_id)
        FROM vehicle_contributions vc
        WHERE vc.contribution_id = c.id
      ),
      'projects', (
        SELECT jsonb_agg(pc.project_id)
        FROM project_contributions pc
        WHERE pc.contribution_id = c.id
      ),
      'skills', (
        SELECT jsonb_agg(jsonb_build_object(
          'skill_id', cs.skill_id,
          'proficiency_level', cs.proficiency_level
        ))
        FROM contribution_skills cs
        WHERE cs.contribution_id = c.id
      )
    )
    FROM contributions c
    WHERE c.id = new_contribution_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get skill progress
CREATE OR REPLACE FUNCTION get_skill_progress(skill_id UUID)
RETURNS JSONB AS $$
DECLARE
  skill_data JSONB;
  contributions_data JSONB;
  total_hours DECIMAL;
  avg_proficiency skill_level;
BEGIN
  -- Get skill data
  SELECT jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'category', s.category,
    'level', s.level
  )
  INTO skill_data
  FROM skills s
  WHERE s.id = skill_id;

  -- Get recent contributions
  SELECT jsonb_agg(jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'contribution_type', c.contribution_type,
    'status', c.status,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'hours_spent', c.hours_spent,
    'proficiency_level', cs.proficiency_level
  ))
  INTO contributions_data
  FROM contributions c
  JOIN contribution_skills cs ON cs.contribution_id = c.id
  WHERE cs.skill_id = skill_id
  ORDER BY c.created_at DESC
  LIMIT 5;

  -- Calculate total hours
  SELECT COALESCE(SUM(c.hours_spent), 0)
  INTO total_hours
  FROM contributions c
  JOIN contribution_skills cs ON cs.contribution_id = c.id
  WHERE cs.skill_id = skill_id;

  -- Calculate average proficiency
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE (
      SELECT proficiency_level
      FROM (
        SELECT proficiency_level, COUNT(*) as count
        FROM contribution_skills
        WHERE skill_id = $1
        GROUP BY proficiency_level
        ORDER BY count DESC
        LIMIT 1
      ) sub
    )
  END
  INTO avg_proficiency
  FROM contribution_skills
  WHERE skill_id = $1;

  -- Return complete progress data
  RETURN jsonb_build_object(
    'skill', skill_data,
    'total_contributions', (
      SELECT COUNT(*)
      FROM contribution_skills
      WHERE skill_id = $1
    ),
    'total_hours', total_hours,
    'average_proficiency', avg_proficiency,
    'recent_contributions', contributions_data
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get user's skill progress
CREATE OR REPLACE FUNCTION get_user_skill_progress(user_id UUID)
RETURNS JSONB[] AS $$
DECLARE
  skill_progress JSONB[];
BEGIN
  -- Get progress for each skill the user has contributed to
  SELECT array_agg(get_skill_progress(s.id))
  INTO skill_progress
  FROM skills s
  WHERE EXISTS (
    SELECT 1
    FROM contributions c
    JOIN contribution_skills cs ON cs.contribution_id = c.id
    WHERE cs.skill_id = s.id
    AND c.user_id = $1
  );

  RETURN skill_progress;
END;
$$ LANGUAGE plpgsql; 