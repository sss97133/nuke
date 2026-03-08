-- Fix trigger functions to use uploaded_by instead of user_id
-- The vehicles table has uploaded_by, not user_id

-- Fix award_vehicle_milestones trigger function
CREATE OR REPLACE FUNCTION award_vehicle_milestones()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_count int;
BEGIN
  -- Determine affected user - use uploaded_by instead of user_id
  IF TG_OP = 'INSERT' THEN
    v_user_id := NEW.uploaded_by;
  ELSE
    v_user_id := OLD.uploaded_by;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Count vehicles for the user
  SELECT COUNT(*) INTO v_count
  FROM public.vehicles v
  WHERE v.uploaded_by = v_user_id;

  -- Upsert each milestone exactly once
  IF v_count = 1 THEN
    INSERT INTO public.profile_achievements (user_id, achievement_type, achievement_title, achievement_description, points_awarded)
    VALUES (v_user_id, 'first_vehicle', 'First Vehicle', 'Added your first vehicle', 10)
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
  ELSIF v_count = 5 THEN
    INSERT INTO public.profile_achievements (user_id, achievement_type, achievement_title, achievement_description, points_awarded)
    VALUES (v_user_id, 'vehicle_collector', 'Vehicle Collector', 'Added five vehicles', 25)
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
  ELSIF v_count = 10 THEN
    INSERT INTO public.profile_achievements (user_id, achievement_type, achievement_title, achievement_description, points_awarded)
    VALUES (v_user_id, 'enthusiast', 'Enthusiast', 'Added ten vehicles', 50)
    ON CONFLICT (user_id, achievement_type) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Fix vehicles_stats_aiud trigger function  
CREATE OR REPLACE FUNCTION vehicles_stats_aiud()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.uploaded_by IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.profile_stats (user_id, total_vehicles)
    VALUES (NEW.uploaded_by, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET total_vehicles = public.profile_stats.total_vehicles + 1,
          updated_at = NOW();
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.uploaded_by IS NULL THEN
      RETURN OLD;
    END IF;
    UPDATE public.profile_stats
       SET total_vehicles = GREATEST(0, total_vehicles - 1),
           updated_at = NOW()
     WHERE user_id = OLD.uploaded_by;
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
      IF OLD.uploaded_by IS NOT NULL THEN
        UPDATE public.profile_stats
           SET total_vehicles = GREATEST(0, total_vehicles - 1),
               updated_at = NOW()
         WHERE user_id = OLD.uploaded_by;
      END IF;

      IF NEW.uploaded_by IS NOT NULL THEN
        INSERT INTO public.profile_stats (user_id, total_vehicles)
        VALUES (NEW.uploaded_by, 1)
        ON CONFLICT (user_id) DO UPDATE
          SET total_vehicles = public.profile_stats.total_vehicles + 1,
              updated_at = NOW();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
