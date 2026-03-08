

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."approve_ownership_verification"("verification_id" "uuid", "reviewer_id" "uuid", "review_notes" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  verification_record ownership_verifications%ROWTYPE;
  vehicle_record vehicles%ROWTYPE;
BEGIN
  -- Get verification record
  SELECT * INTO verification_record 
  FROM ownership_verifications 
  WHERE id = verification_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;
  
  -- Update verification status
  UPDATE ownership_verifications 
  SET 
    status = 'approved',
    human_reviewer_id = reviewer_id,
    human_review_notes = review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = verification_id;
  
  -- Update vehicle ownership
  UPDATE vehicles 
  SET 
    user_id = verification_record.user_id,
    ownership_verified = true,
    ownership_verified_at = NOW(),
    ownership_verification_id = verification_id
  WHERE id = verification_record.vehicle_id;
  
  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    verification_id, 'approved', reviewer_id, 'reviewer',
    jsonb_build_object('review_notes', review_notes)
  );
  
  -- Update queue status
  UPDATE verification_queue 
  SET queue_status = 'completed', completed_at = NOW()
  WHERE verification_id = verification_id;
  
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."approve_ownership_verification"("verification_id" "uuid", "reviewer_id" "uuid", "review_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_verification_to_reviewer"("verification_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  selected_reviewer_id UUID;
  queue_record_id UUID;
BEGIN
  -- Find available reviewer with lowest current workload
  SELECT vr.user_id INTO selected_reviewer_id
  FROM verification_reviewers vr
  LEFT JOIN verification_queue vq ON vq.assigned_reviewer_id = vr.id 
    AND vq.queue_status IN ('assigned', 'in_review')
  WHERE vr.is_active = true
  GROUP BY vr.user_id, vr.max_daily_reviews
  HAVING COUNT(vq.id) < vr.max_daily_reviews
  ORDER BY COUNT(vq.id) ASC
  LIMIT 1;
  
  IF selected_reviewer_id IS NOT NULL THEN
    -- Create queue entry
    INSERT INTO verification_queue (
      verification_id, 
      assigned_reviewer_id, 
      priority_score,
      queue_status,
      assigned_at
    ) VALUES (
      verification_id,
      (SELECT id FROM verification_reviewers WHERE user_id = selected_reviewer_id),
      calculate_verification_priority(verification_id),
      'assigned',
      NOW()
    ) RETURNING id INTO queue_record_id;
    
    -- Log the assignment
    INSERT INTO verification_audit_log (
      verification_id, action, actor_type, details
    ) VALUES (
      verification_id, 'human_review_assigned', 'system',
      jsonb_build_object('reviewer_id', selected_reviewer_id, 'queue_id', queue_record_id)
    );
  END IF;
  
  RETURN selected_reviewer_id;
END;
$$;


ALTER FUNCTION "public"."assign_verification_to_reviewer"("verification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."award_achievement"("user_uuid" "uuid", "achievement_type_param" "text", "achievement_title_param" "text" DEFAULT NULL::"text", "achievement_description_param" "text" DEFAULT NULL::"text", "points_param" integer DEFAULT 0) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  default_title TEXT;
  default_description TEXT;
  default_points INTEGER;
BEGIN
  -- Set defaults based on achievement type
  CASE achievement_type_param
    WHEN 'first_vehicle' THEN
      default_title := 'First Vehicle';
      default_description := 'Added your first vehicle to the platform';
      default_points := 10;
    WHEN 'profile_complete' THEN
      default_title := 'Profile Complete';
      default_description := 'Completed your profile information';
      default_points := 25;
    WHEN 'first_image' THEN
      default_title := 'First Image';
      default_description := 'Uploaded your first vehicle image';
      default_points := 5;
    WHEN 'contributor' THEN
      default_title := 'Contributor';
      default_description := 'Made your first contribution to the platform';
      default_points := 15;
    WHEN 'vehicle_collector' THEN
      default_title := 'Vehicle Collector';
      default_description := 'Added 5 or more vehicles';
      default_points := 20;
    WHEN 'image_enthusiast' THEN
      default_title := 'Image Enthusiast';
      default_description := 'Uploaded 25 or more images';
      default_points := 15;
    WHEN 'community_member' THEN
      default_title := 'Community Member';
      default_description := 'Active community participant';
      default_points := 10;
    WHEN 'verified_user' THEN
      default_title := 'Verified User';
      default_description := 'Completed ownership verification';
      default_points := 5;
    ELSE
      default_title := 'Achievement';
      default_description := 'Earned an achievement';
      default_points := 0;
  END CASE;
  
  -- Insert achievement (will fail silently if duplicate due to UNIQUE constraint)
  INSERT INTO profile_achievements (
    user_id, achievement_type, achievement_title, achievement_description, points_awarded
  ) VALUES (
    user_uuid, 
    achievement_type_param,
    COALESCE(achievement_title_param, default_title),
    COALESCE(achievement_description_param, default_description),
    COALESCE(points_param, default_points)
  ) ON CONFLICT (user_id, achievement_type) DO NOTHING;
  
  -- Log activity with correct column names
  INSERT INTO profile_activity (
    user_id, activity_type, activity_description
  ) VALUES (
    user_uuid, 'achievement_earned', 
    'Earned: ' || COALESCE(achievement_title_param, default_title) || ' - ' || COALESCE(achievement_description_param, default_description)
  );
  
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."award_achievement"("user_uuid" "uuid", "achievement_type_param" "text", "achievement_title_param" "text", "achievement_description_param" "text", "points_param" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_profile_completion"("user_uuid" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  completion_count INTEGER := 0;
  total_fields INTEGER := 7; -- Number of completion fields
  completion_record profile_completion%ROWTYPE;
BEGIN
  SELECT * INTO completion_record 
  FROM profile_completion 
  WHERE user_id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Count completed fields
  IF completion_record.basic_info_complete THEN completion_count := completion_count + 1; END IF;
  IF completion_record.avatar_uploaded THEN completion_count := completion_count + 1; END IF;
  IF completion_record.bio_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.social_links_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.first_vehicle_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.skills_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.location_added THEN completion_count := completion_count + 1; END IF;
  
  RETURN (completion_count * 100) / total_fields;
END;
$$;


ALTER FUNCTION "public"."calculate_profile_completion"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_verification_priority"("verification_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  priority_score INTEGER := 0;
  verification_record ownership_verifications%ROWTYPE;
BEGIN
  SELECT * INTO verification_record 
  FROM ownership_verifications 
  WHERE id = verification_id;
  
  -- Base priority
  priority_score := 100;
  
  -- Higher priority for high-value vehicles (if we have value data)
  -- Higher priority for low AI confidence (needs human attention)
  IF verification_record.ai_confidence_score < 0.7 THEN
    priority_score := priority_score + 50;
  END IF;
  
  -- Higher priority for older submissions
  priority_score := priority_score + EXTRACT(HOURS FROM (NOW() - verification_record.submitted_at))::INTEGER;
  
  -- Higher priority for users with good history (future enhancement)
  
  RETURN priority_score;
END;
$$;


ALTER FUNCTION "public"."calculate_verification_priority"("verification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_daily_leaderboard_snapshot"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    r RECORD;
    user_rank INTEGER := 0;
BEGIN
    -- Create snapshots for top 1000 users
    FOR r IN 
        SELECT 
            u.user_id,
            u.total_points,
            COUNT(DISTINCT v.id) as discoveries,
            COUNT(DISTINCT c.id) FILTER (WHERE c.contribution_type = 'enrichment') as enrichments,
            u.skill_level,
            ROW_NUMBER() OVER (ORDER BY u.total_points DESC) as rank
        FROM user_legitimacy_scores u
        LEFT JOIN vehicles v ON v.discovered_by = u.user_id
        LEFT JOIN user_contributions c ON c.user_id = u.user_id AND c.contribution_type = 'enrichment'
        GROUP BY u.user_id, u.total_points, u.skill_level
        ORDER BY u.total_points DESC
        LIMIT 1000
    LOOP
        INSERT INTO leaderboard_snapshots (
            user_id,
            snapshot_date,
            rank,
            points,
            discoveries,
            enrichments,
            skill_level
        ) VALUES (
            r.user_id,
            CURRENT_DATE,
            r.rank,
            r.total_points,
            r.discoveries,
            r.enrichments,
            r.skill_level
        )
        ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
            rank = EXCLUDED.rank,
            points = EXCLUDED.points,
            discoveries = EXCLUDED.discoveries,
            enrichments = EXCLUDED.enrichments,
            skill_level = EXCLUDED.skill_level;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."create_daily_leaderboard_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_data_conflicts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Find conflicting annotations for the same field with different values
    INSERT INTO data_source_conflicts (
        vehicle_id, field_name, primary_source_id, conflicting_source_id,
        conflict_type, conflict_description
    )
    SELECT DISTINCT
        NEW.vehicle_id,
        NEW.field_name,
        NEW.data_source_id,
        vfa.data_source_id,
        'value_mismatch',
        'Different values found for ' || NEW.field_name || ': "' || NEW.field_value || '" vs "' || vfa.field_value || '"'
    FROM vehicle_field_annotations vfa
    WHERE vfa.vehicle_id = NEW.vehicle_id
    AND vfa.field_name = NEW.field_name
    AND vfa.field_value != NEW.field_value
    AND vfa.data_source_id != NEW.data_source_id
    ON CONFLICT (primary_source_id, conflicting_source_id) DO NOTHING;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."detect_data_conflicts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_timeline_conflicts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check for mileage inconsistencies
    INSERT INTO timeline_event_conflicts (primary_event_id, conflicting_event_id, conflict_type, conflict_description)
    SELECT 
        NEW.id,
        te.id,
        'mileage_inconsistency',
        'Mileage reading inconsistent with timeline order'
    FROM timeline_events te
    WHERE te.vehicle_id = NEW.vehicle_id
    AND te.id != NEW.id
    AND te.mileage_at_event IS NOT NULL
    AND NEW.mileage_at_event IS NOT NULL
    AND (
        (te.event_date < NEW.event_date AND te.mileage_at_event > NEW.mileage_at_event) OR
        (te.event_date > NEW.event_date AND te.mileage_at_event < NEW.mileage_at_event)
    )
    ON CONFLICT (primary_event_id, conflicting_event_id) DO NOTHING;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."detect_timeline_conflicts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_discovery_stats"("p_user_id" "uuid") RETURNS TABLE("total_discoveries" integer, "total_enrichments" integer, "total_points" integer, "current_streak" integer, "longest_streak" integer, "rank_percentile" numeric, "skill_level" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(COUNT(DISTINCT v.id) FILTER (WHERE v.discovered_by = p_user_id), 0)::INTEGER as total_discoveries,
        COALESCE(COUNT(DISTINCT c.id) FILTER (WHERE c.contribution_type = 'enrichment'), 0)::INTEGER as total_enrichments,
        COALESCE(MAX(l.total_points), 0) as total_points,
        COALESCE(MAX(s.current_streak), 0) as current_streak,
        COALESCE(MAX(s.longest_streak), 0) as longest_streak,
        ROUND(
            100.0 * (
                1.0 - (
                    RANK() OVER (ORDER BY COALESCE(MAX(l.total_points), 0) DESC)::NUMERIC / 
                    COUNT(*) OVER ()::NUMERIC
                )
            ), 2
        ) as rank_percentile,
        COALESCE(MAX(l.skill_level), 'novice') as skill_level
    FROM auth.users u
    LEFT JOIN vehicles v ON v.discovered_by = u.id
    LEFT JOIN user_contributions c ON c.user_id = u.id
    LEFT JOIN user_legitimacy_scores l ON l.user_id = u.id
    LEFT JOIN discovery_streaks s ON s.user_id = u.id
    WHERE u.id = p_user_id
    GROUP BY u.id;
END;
$$;


ALTER FUNCTION "public"."get_user_discovery_stats"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_contribution"("user_uuid" "uuid", "contribution_type_param" "text", "related_vehicle_uuid" "uuid", "contribution_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO user_contributions (
    user_id, vehicle_id, contribution_type, metadata
  ) VALUES (
    user_uuid, related_vehicle_uuid, contribution_type_param, contribution_metadata
  );
END;
$$;


ALTER FUNCTION "public"."log_contribution"("user_uuid" "uuid", "contribution_type_param" "text", "related_vehicle_uuid" "uuid", "contribution_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_rank_advancement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    old_level TEXT;
BEGIN
    -- Get the old skill level
    old_level := OLD.skill_level;
    
    -- Check if skill level increased
    IF NEW.skill_level != old_level AND (
        (old_level = 'novice' AND NEW.skill_level IN ('apprentice', 'journeyman', 'expert', 'master')) OR
        (old_level = 'apprentice' AND NEW.skill_level IN ('journeyman', 'expert', 'master')) OR
        (old_level = 'journeyman' AND NEW.skill_level IN ('expert', 'master')) OR
        (old_level = 'expert' AND NEW.skill_level = 'master')
    ) THEN
        INSERT INTO discovery_notifications (
            user_id,
            notification_type,
            title,
            message,
            data
        ) VALUES (
            NEW.user_id,
            'rank_up',
            'Rank Advancement!',
            'Congratulations! You''ve advanced from ' || old_level || ' to ' || NEW.skill_level || '!',
            jsonb_build_object(
                'old_rank', old_level,
                'new_rank', NEW.skill_level,
                'total_points', NEW.total_points
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_rank_advancement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_vehicle_view"("p_vehicle_id" "uuid", "p_session_id" "text" DEFAULT NULL::"text", "p_referrer" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO vehicle_views (vehicle_id, user_id, session_id, referrer)
    VALUES (p_vehicle_id, auth.uid(), p_session_id, p_referrer);
END;
$$;


ALTER FUNCTION "public"."record_vehicle_view"("p_vehicle_id" "uuid", "p_session_id" "text", "p_referrer" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_assign_verification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- If status changed to human_review, auto-assign to reviewer
  IF NEW.status = 'human_review' AND OLD.status != 'human_review' THEN
    PERFORM assign_verification_to_reviewer(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_assign_verification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_discovery_streak"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Check if this is a discovery contribution
    IF NEW.contribution_type = 'discovery' THEN
        -- Update or insert streak record
        INSERT INTO discovery_streaks (
            user_id,
            current_streak,
            longest_streak,
            last_discovery_date,
            streak_start_date
        ) VALUES (
            NEW.user_id,
            1,
            1,
            CURRENT_DATE,
            CURRENT_DATE
        )
        ON CONFLICT (user_id) DO UPDATE SET
            current_streak = CASE
                WHEN discovery_streaks.last_discovery_date = CURRENT_DATE - INTERVAL '1 day' THEN discovery_streaks.current_streak + 1
                WHEN discovery_streaks.last_discovery_date < CURRENT_DATE - INTERVAL '1 day' THEN 1
                ELSE discovery_streaks.current_streak
            END,
            longest_streak = GREATEST(
                discovery_streaks.longest_streak,
                CASE
                    WHEN discovery_streaks.last_discovery_date = CURRENT_DATE - INTERVAL '1 day' THEN discovery_streaks.current_streak + 1
                    ELSE 1
                END
            ),
            last_discovery_date = CURRENT_DATE,
            streak_start_date = CASE
                WHEN discovery_streaks.last_discovery_date < CURRENT_DATE - INTERVAL '1 day' THEN CURRENT_DATE
                ELSE discovery_streaks.streak_start_date
            END,
            updated_at = NOW();
            
        -- Check for streak milestones
        IF (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id) IN (7, 30, 100) THEN
            INSERT INTO discovery_notifications (
                user_id,
                notification_type,
                title,
                message,
                data
            ) VALUES (
                NEW.user_id,
                'milestone',
                'Streak Milestone!',
                'You''ve maintained a ' || (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id) || ' day discovery streak!',
                jsonb_build_object('streak', (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id))
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_discovery_streak"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_field_annotation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- This function is simplified since we're using a different annotation structure
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_field_annotation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_completion_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Ensure profile_completion record exists
  INSERT INTO profile_completion (user_id) 
  VALUES (NEW.id) 
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Update completion fields
  UPDATE profile_completion SET
    basic_info_complete = (NEW.full_name IS NOT NULL AND NEW.full_name != ''),
    avatar_uploaded = (NEW.avatar_url IS NOT NULL AND NEW.avatar_url != ''),
    bio_added = (NEW.bio IS NOT NULL AND NEW.bio != ''),
    location_added = (NEW.location IS NOT NULL AND NEW.location != ''),
    social_links_added = (NEW.website_url IS NOT NULL OR NEW.github_url IS NOT NULL OR NEW.linkedin_url IS NOT NULL),
    last_updated = NOW()
  WHERE user_id = NEW.id;
  
  -- Update completion percentage
  UPDATE profile_completion SET
    total_completion_percentage = calculate_profile_completion(NEW.id)
  WHERE user_id = NEW.id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_profile_completion_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_stats_on_vehicle_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  user_uuid UUID;
  vehicle_count INTEGER;
BEGIN
  -- Determine user_id based on operation
  IF TG_OP = 'DELETE' THEN
    user_uuid := OLD.user_id;
  ELSE
    user_uuid := NEW.user_id;
  END IF;

  -- Count user's vehicles
  SELECT COUNT(*) INTO vehicle_count
  FROM vehicles
  WHERE user_id = user_uuid;

  -- Ensure profile_stats record exists
  INSERT INTO profile_stats (user_id)
  VALUES (user_uuid)
  ON CONFLICT (user_id) DO NOTHING;

  -- Update vehicle count
  UPDATE profile_stats SET
    total_vehicles = vehicle_count,
    updated_at = NOW()
  WHERE user_id = user_uuid;

  -- Award achievements
  IF TG_OP = 'INSERT' THEN
    -- First vehicle achievement
    IF vehicle_count = 1 THEN
      PERFORM award_achievement(user_uuid, 'first_vehicle');

      -- Update profile completion
      UPDATE profile_completion SET
        first_vehicle_added = true,
        last_updated = NOW()
      WHERE user_id = user_uuid;
    END IF;

    -- Vehicle collector achievement
    IF vehicle_count >= 5 THEN
      PERFORM award_achievement(user_uuid, 'vehicle_collector');
    END IF;

    -- Log contribution with valid type
    PERFORM log_contribution(user_uuid, 'enrichment', NEW.id);

    -- Log activity
    INSERT INTO profile_activity (
      user_id, activity_type, activity_description, related_entity_type, related_entity_id
    ) VALUES (
      user_uuid, 'vehicle_added', 
      'Added vehicle: ' || NEW.year || ' ' || NEW.make || ' ' || NEW.model, 
      'vehicle', NEW.id
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Log activity for deletion
    INSERT INTO profile_activity (
      user_id, activity_type, activity_description, related_entity_type, related_entity_id
    ) VALUES (
      user_uuid, 'vehicle_removed', 
      'Removed vehicle: ' || OLD.year || ' ' || OLD.make || ' ' || OLD.model, 
      'vehicle', OLD.id
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_profile_stats_on_vehicle_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_timeline_event_confidence"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Recalculate confidence score based on verifications
    UPDATE timeline_events 
    SET confidence_score = LEAST(100, GREATEST(0, 
        50 + COALESCE((
            SELECT AVG(confidence_adjustment)
            FROM timeline_event_verifications 
            WHERE timeline_event_id = NEW.timeline_event_id
            AND verification_status = 'verified'
        ), 0)
    ))
    WHERE id = NEW.timeline_event_id;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_timeline_event_confidence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."data_point_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "data_point_type" character varying(50) NOT NULL,
    "data_point_value" "text",
    "user_id" "uuid" NOT NULL,
    "comment_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."data_point_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."data_source_conflicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "field_name" "text" NOT NULL,
    "primary_source_id" "uuid",
    "conflicting_source_id" "uuid",
    "conflict_type" "text" NOT NULL,
    "conflict_description" "text" NOT NULL,
    "resolution_status" "text" DEFAULT 'unresolved'::"text",
    "resolution_method" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "resolution_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "data_source_conflicts_check" CHECK (("primary_source_id" <> "conflicting_source_id")),
    CONSTRAINT "data_source_conflicts_conflict_type_check" CHECK (("conflict_type" = ANY (ARRAY['value_mismatch'::"text", 'confidence_dispute'::"text", 'source_reliability'::"text"]))),
    CONSTRAINT "data_source_conflicts_resolution_method_check" CHECK (("resolution_method" = ANY (ARRAY['higher_confidence'::"text", 'newer_data'::"text", 'professional_verification'::"text", 'manual_review'::"text"]))),
    CONSTRAINT "data_source_conflicts_resolution_status_check" CHECK (("resolution_status" = ANY (ARRAY['unresolved'::"text", 'resolved'::"text", 'accepted_variance'::"text", 'merged_sources'::"text"])))
);


ALTER TABLE "public"."data_source_conflicts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "data" "jsonb",
    "read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "discovery_notifications_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['first_discovery'::"text", 'enrichment'::"text", 'rank_up'::"text", 'milestone'::"text", 'overtaken'::"text"])))
);


ALTER TABLE "public"."discovery_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_streaks" (
    "user_id" "uuid" NOT NULL,
    "current_streak" integer DEFAULT 0 NOT NULL,
    "longest_streak" integer DEFAULT 0 NOT NULL,
    "last_discovery_date" "date",
    "streak_start_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."discovery_streaks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_detection_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pattern_type" "text" NOT NULL,
    "pattern_data" "jsonb" NOT NULL,
    "confidence_level" numeric(3,2) NOT NULL,
    "first_detected_at" timestamp without time zone DEFAULT "now"(),
    "last_seen_at" timestamp without time zone DEFAULT "now"(),
    "occurrence_count" integer DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "reviewed_by_human" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "fraud_detection_patterns_pattern_type_check" CHECK (("pattern_type" = ANY (ARRAY['duplicate_document'::"text", 'tampered_document'::"text", 'suspicious_user_pattern'::"text", 'known_fraudulent_document'::"text", 'blacklisted_document_hash'::"text"])))
);


ALTER TABLE "public"."fraud_detection_patterns" OWNER TO "postgres";


COMMENT ON TABLE "public"."fraud_detection_patterns" IS 'AI-detected patterns for document fraud prevention';



CREATE TABLE IF NOT EXISTS "public"."leaderboard_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "rank" integer NOT NULL,
    "points" integer NOT NULL,
    "discoveries" integer NOT NULL,
    "enrichments" integer NOT NULL,
    "skill_level" "text" NOT NULL
);


ALTER TABLE "public"."leaderboard_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ownership_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "vehicle_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "title_document_url" "text" NOT NULL,
    "drivers_license_url" "text" NOT NULL,
    "face_scan_url" "text",
    "insurance_document_url" "text",
    "extracted_data" "jsonb" DEFAULT '{}'::"jsonb",
    "title_owner_name" "text",
    "license_holder_name" "text",
    "vehicle_vin_from_title" "text",
    "ai_confidence_score" numeric(3,2),
    "ai_processing_results" "jsonb" DEFAULT '{}'::"jsonb",
    "name_match_score" numeric(3,2),
    "vin_match_confirmed" boolean,
    "document_authenticity_score" numeric(3,2),
    "human_reviewer_id" "uuid",
    "human_review_notes" "text",
    "rejection_reason" "text",
    "requires_supervisor_review" boolean DEFAULT false,
    "submitted_at" timestamp without time zone DEFAULT "now"(),
    "ai_processed_at" timestamp without time zone,
    "human_reviewed_at" timestamp without time zone,
    "approved_at" timestamp without time zone,
    "rejected_at" timestamp without time zone,
    "expires_at" timestamp without time zone DEFAULT ("now"() + '90 days'::interval),
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "ownership_verifications_ai_confidence_score_check" CHECK ((("ai_confidence_score" >= 0.00) AND ("ai_confidence_score" <= 1.00))),
    CONSTRAINT "ownership_verifications_document_authenticity_score_check" CHECK ((("document_authenticity_score" >= 0.00) AND ("document_authenticity_score" <= 1.00))),
    CONSTRAINT "ownership_verifications_name_match_score_check" CHECK ((("name_match_score" >= 0.00) AND ("name_match_score" <= 1.00))),
    CONSTRAINT "ownership_verifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'documents_uploaded'::"text", 'ai_processing'::"text", 'human_review'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."ownership_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."ownership_verifications" IS 'Core table for vehicle ownership verification workflow with document upload and human review process';



CREATE TABLE IF NOT EXISTS "public"."profile_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "achievement_type" "text" NOT NULL,
    "achievement_title" "text" NOT NULL,
    "achievement_description" "text",
    "icon_url" "text",
    "points_awarded" integer DEFAULT 0,
    "earned_at" timestamp without time zone DEFAULT "now"(),
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "profile_achievements_achievement_type_check" CHECK (("achievement_type" = ANY (ARRAY['first_vehicle'::"text", 'profile_complete'::"text", 'first_image'::"text", 'contributor'::"text", 'vehicle_collector'::"text", 'image_enthusiast'::"text", 'community_member'::"text", 'verified_user'::"text"])))
);


ALTER TABLE "public"."profile_achievements" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_achievements" IS 'Achievement system for user engagement and gamification';



CREATE TABLE IF NOT EXISTS "public"."profile_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "activity_type" "text" NOT NULL,
    "activity_description" "text" NOT NULL,
    "related_entity_type" "text",
    "related_entity_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."profile_activity" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_activity" IS 'Activity feed showing user actions and contributions';



CREATE TABLE IF NOT EXISTS "public"."profile_completion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "basic_info_complete" boolean DEFAULT false,
    "avatar_uploaded" boolean DEFAULT false,
    "bio_added" boolean DEFAULT false,
    "social_links_added" boolean DEFAULT false,
    "first_vehicle_added" boolean DEFAULT false,
    "skills_added" boolean DEFAULT false,
    "location_added" boolean DEFAULT false,
    "total_completion_percentage" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "last_updated" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "profile_completion_total_completion_percentage_check" CHECK ((("total_completion_percentage" >= 0) AND ("total_completion_percentage" <= 100)))
);


ALTER TABLE "public"."profile_completion" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_completion" IS 'Tracks user profile completion progress for onboarding and gamification';



CREATE TABLE IF NOT EXISTS "public"."profile_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "vehicles_count" integer DEFAULT 0,
    "images_count" integer DEFAULT 0,
    "verifications_count" integer DEFAULT 0,
    "contributions_count" integer DEFAULT 0,
    "total_vehicles" integer DEFAULT 0,
    "total_images" integer DEFAULT 0,
    "total_contributions" integer DEFAULT 0,
    "last_activity" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."profile_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_stats" IS 'Aggregated statistics for user profiles and leaderboards';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "avatar_url" "text",
    "bio" "text",
    "location" "text",
    "website" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "payment_verified" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Enhanced user profiles with social features and customization options';



CREATE TABLE IF NOT EXISTS "public"."schema_migrations" (
    "version" bigint NOT NULL,
    "inserted_at" timestamp(0) without time zone
);


ALTER TABLE "public"."schema_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_event_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "comment_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timeline_event_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_event_conflicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "primary_event_id" "uuid",
    "conflicting_event_id" "uuid",
    "conflict_type" "text" NOT NULL,
    "conflict_description" "text" NOT NULL,
    "resolution_status" "text" DEFAULT 'unresolved'::"text",
    "resolution_notes" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timeline_event_conflicts_check" CHECK (("primary_event_id" <> "conflicting_event_id")),
    CONSTRAINT "timeline_event_conflicts_conflict_type_check" CHECK (("conflict_type" = ANY (ARRAY['date_mismatch'::"text", 'mileage_inconsistency'::"text", 'duplicate_event'::"text", 'contradictory_info'::"text"]))),
    CONSTRAINT "timeline_event_conflicts_resolution_status_check" CHECK (("resolution_status" = ANY (ARRAY['unresolved'::"text", 'resolved'::"text", 'accepted_discrepancy'::"text", 'merged_events'::"text"])))
);


ALTER TABLE "public"."timeline_event_conflicts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_event_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "timeline_event_id" "uuid",
    "verifier_id" "uuid",
    "verification_type" "text" NOT NULL,
    "verification_status" "text" NOT NULL,
    "confidence_adjustment" integer DEFAULT 0,
    "notes" "text",
    "supporting_evidence" "text"[],
    "professional_license" "text",
    "professional_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "timeline_event_verifications_confidence_adjustment_check" CHECK ((("confidence_adjustment" >= '-100'::integer) AND ("confidence_adjustment" <= 100))),
    CONSTRAINT "timeline_event_verifications_professional_type_check" CHECK (("professional_type" = ANY (ARRAY['mechanic'::"text", 'appraiser'::"text", 'inspector'::"text", 'dealer'::"text", 'insurance_adjuster'::"text"]))),
    CONSTRAINT "timeline_event_verifications_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['verified'::"text", 'disputed'::"text", 'needs_review'::"text", 'insufficient_evidence'::"text"]))),
    CONSTRAINT "timeline_event_verifications_verification_type_check" CHECK (("verification_type" = ANY (ARRAY['owner_confirmation'::"text", 'professional_inspection'::"text", 'document_review'::"text", 'cross_reference'::"text", 'third_party_validation'::"text"])))
);


ALTER TABLE "public"."timeline_event_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "event_date" "date" NOT NULL,
    "mileage_at_event" integer,
    "location" "text",
    "source_type" "text" NOT NULL,
    "confidence_score" integer DEFAULT 50,
    "verification_status" "text" DEFAULT 'unverified'::"text",
    "documentation_urls" "text"[],
    "receipt_amount" numeric(10,2),
    "receipt_currency" "text" DEFAULT 'USD'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "affects_value" boolean DEFAULT false,
    "affects_safety" boolean DEFAULT false,
    "affects_performance" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "timeline_events_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 100))),
    CONSTRAINT "timeline_events_event_category_check" CHECK (("event_category" = ANY (ARRAY['ownership'::"text", 'maintenance'::"text", 'legal'::"text", 'performance'::"text", 'cosmetic'::"text", 'safety'::"text"]))),
    CONSTRAINT "timeline_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['purchase'::"text", 'sale'::"text", 'registration'::"text", 'inspection'::"text", 'maintenance'::"text", 'repair'::"text", 'modification'::"text", 'accident'::"text", 'insurance_claim'::"text", 'recall'::"text", 'ownership_transfer'::"text", 'lien_change'::"text", 'title_update'::"text", 'mileage_reading'::"text"]))),
    CONSTRAINT "timeline_events_source_type_check" CHECK (("source_type" = ANY (ARRAY['user_input'::"text", 'service_record'::"text", 'government_record'::"text", 'insurance_record'::"text", 'dealer_record'::"text", 'manufacturer_recall'::"text", 'inspection_report'::"text", 'receipt'::"text"]))),
    CONSTRAINT "timeline_events_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['unverified'::"text", 'user_verified'::"text", 'professional_verified'::"text", 'multi_verified'::"text", 'disputed'::"text"]))),
    CONSTRAINT "valid_event_date" CHECK (("event_date" <= CURRENT_DATE)),
    CONSTRAINT "valid_mileage" CHECK (("mileage_at_event" >= 0))
);


ALTER TABLE "public"."timeline_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_contributions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "contribution_type" "text" NOT NULL,
    "fields_added" "text"[],
    "fields_corrected" "text"[],
    "points_earned" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_contributions_contribution_type_check" CHECK (("contribution_type" = ANY (ARRAY['discovery'::"text", 'enrichment'::"text", 'verification'::"text", 'image'::"text", 'correction'::"text"])))
);


ALTER TABLE "public"."user_contributions" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_contributions" IS 'GitHub-style contribution tracking for user activity visualization';



CREATE TABLE IF NOT EXISTS "public"."vehicle_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "comment_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_data_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "created_by" "uuid",
    "source_type" "text" NOT NULL,
    "source_name" "text" NOT NULL,
    "source_url" "text",
    "extraction_method" "text",
    "confidence_score" integer DEFAULT 50,
    "data_extracted" "jsonb" DEFAULT '{}'::"jsonb",
    "extraction_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_data_sources_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 100))),
    CONSTRAINT "vehicle_data_sources_extraction_method_check" CHECK (("extraction_method" = ANY (ARRAY['manual'::"text", 'ocr'::"text", 'ai_vision'::"text", 'api_call'::"text", 'form_input'::"text"]))),
    CONSTRAINT "vehicle_data_sources_source_type_check" CHECK (("source_type" = ANY (ARRAY['user_input'::"text", 'ai_extraction'::"text", 'service_record'::"text", 'government_record'::"text", 'insurance_record'::"text", 'dealer_record'::"text", 'manufacturer_data'::"text", 'inspection_report'::"text", 'receipt'::"text", 'photo_metadata'::"text", 'third_party_api'::"text"])))
);


ALTER TABLE "public"."vehicle_data_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_field_annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "field_name" "text" NOT NULL,
    "field_value" "text" NOT NULL,
    "data_source_id" "uuid",
    "confidence_score" integer DEFAULT 50,
    "verification_status" "text" DEFAULT 'unverified'::"text",
    "verification_notes" "text",
    "is_primary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_field_annotations_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 100))),
    CONSTRAINT "vehicle_field_annotations_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['unverified'::"text", 'user_verified'::"text", 'professional_verified'::"text", 'disputed'::"text"])))
);


ALTER TABLE "public"."vehicle_field_annotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_image_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "image_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "comment_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_image_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_image_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "image_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "liked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_image_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_image_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "image_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "viewed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_image_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "image_url" "text" NOT NULL,
    "image_type" "text" DEFAULT 'general'::"text",
    "image_category" "text" DEFAULT 'exterior'::"text",
    "category" "text" DEFAULT 'general'::"text",
    "position" integer DEFAULT 0,
    "caption" "text",
    "is_primary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "exif_data" "jsonb"
);


ALTER TABLE "public"."vehicle_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_modifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "field_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text" NOT NULL,
    "change_reason" "text" NOT NULL,
    "data_source_id" "uuid",
    "modified_by" "uuid",
    "modification_type" "text" NOT NULL,
    "confidence_impact" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_modifications_modification_type_check" CHECK (("modification_type" = ANY (ARRAY['correction'::"text", 'update'::"text", 'verification'::"text", 'dispute_resolution'::"text"])))
);


ALTER TABLE "public"."vehicle_modifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "session_id" "text",
    "referrer" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year" integer,
    "vin" "text",
    "license_plate" "text",
    "color" "text",
    "mileage" integer,
    "fuel_type" "text",
    "transmission" "text",
    "engine_size" "text",
    "horsepower" integer,
    "torque" integer,
    "drivetrain" "text",
    "body_style" "text",
    "doors" integer,
    "seats" integer,
    "weight_lbs" integer,
    "length_inches" integer,
    "width_inches" integer,
    "height_inches" integer,
    "wheelbase_inches" integer,
    "fuel_capacity_gallons" numeric(5,2),
    "mpg_city" integer,
    "mpg_highway" integer,
    "mpg_combined" integer,
    "msrp" numeric(10,2),
    "current_value" numeric(10,2),
    "purchase_price" numeric(10,2),
    "purchase_date" "date",
    "purchase_location" "text",
    "previous_owners" integer DEFAULT 0,
    "is_modified" boolean DEFAULT false,
    "modification_details" "text",
    "condition_rating" integer,
    "maintenance_notes" "text",
    "title_transfer_date" "date",
    "insurance_company" "text",
    "insurance_policy_number" "text",
    "registration_state" "text",
    "registration_expiry" "date",
    "inspection_expiry" "date",
    "is_public" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "discovered_by" "uuid",
    "discovered_at" timestamp with time zone,
    "discovery_source" "text",
    "discovery_url" "text",
    "sale_price" integer,
    "auction_end_date" "text",
    "bid_count" integer,
    "view_count" integer,
    "auction_source" "text",
    "bat_listing_title" "text",
    "bat_bids" integer,
    "bat_comments" integer,
    "bat_views" integer,
    "bat_location" "text",
    "bat_seller" "text",
    "sale_status" "text" DEFAULT 'available'::"text",
    "sale_date" "date",
    "status" "text" DEFAULT 'active'::"text",
    "completion_percentage" integer DEFAULT 0,
    "displacement" "text",
    "interior_color" "text",
    "ownership_verified" boolean DEFAULT false,
    "ownership_verified_at" timestamp without time zone,
    "ownership_verification_id" "uuid",
    CONSTRAINT "vehicles_condition_rating_check" CHECK ((("condition_rating" >= 1) AND ("condition_rating" <= 10)))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vehicles"."discovered_by" IS 'User who first discovered/imported this vehicle';



COMMENT ON COLUMN "public"."vehicles"."discovery_source" IS 'Source of vehicle discovery (bat_extension, manual, import, etc)';



COMMENT ON COLUMN "public"."vehicles"."discovery_url" IS 'Original URL where vehicle was discovered';



COMMENT ON COLUMN "public"."vehicles"."sale_price" IS 'Final sale price if sold';



COMMENT ON COLUMN "public"."vehicles"."auction_end_date" IS 'When the auction ends/ended';



COMMENT ON COLUMN "public"."vehicles"."bat_listing_title" IS 'Original Bring a Trailer listing title';



COMMENT ON COLUMN "public"."vehicles"."bat_bids" IS 'Number of bids from BAT listing';



COMMENT ON COLUMN "public"."vehicles"."bat_comments" IS 'Number of comments from BAT listing';



COMMENT ON COLUMN "public"."vehicles"."bat_views" IS 'Number of views from BAT listing';



COMMENT ON COLUMN "public"."vehicles"."bat_location" IS 'Location from BAT listing';



COMMENT ON COLUMN "public"."vehicles"."bat_seller" IS 'Seller username from BAT listing';



COMMENT ON COLUMN "public"."vehicles"."sale_status" IS 'Current sale status (available, sold, discovered, etc)';



COMMENT ON COLUMN "public"."vehicles"."sale_date" IS 'Date of sale if sold';



COMMENT ON COLUMN "public"."vehicles"."status" IS 'Vehicle profile status (draft, active, archived)';



COMMENT ON COLUMN "public"."vehicles"."completion_percentage" IS 'Percentage of required fields completed';



CREATE TABLE IF NOT EXISTS "public"."verification_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "verification_id" "uuid",
    "action" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "session_id" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "verification_audit_log_action_check" CHECK (("action" = ANY (ARRAY['submitted'::"text", 'document_uploaded'::"text", 'ai_processing_started'::"text", 'ai_processing_completed'::"text", 'human_review_assigned'::"text", 'human_review_completed'::"text", 'approved'::"text", 'rejected'::"text", 'document_accessed'::"text", 'document_deleted'::"text", 'escalated_to_supervisor'::"text"]))),
    CONSTRAINT "verification_audit_log_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'system'::"text", 'reviewer'::"text", 'supervisor'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."verification_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."verification_audit_log" IS 'Complete audit trail for all verification actions and document access';



CREATE TABLE IF NOT EXISTS "public"."verification_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "verification_id" "uuid",
    "assigned_reviewer_id" "uuid",
    "priority_score" integer DEFAULT 0,
    "risk_level" "text" DEFAULT 'standard'::"text",
    "estimated_review_time_minutes" integer DEFAULT 15,
    "queue_status" "text" DEFAULT 'pending'::"text",
    "assigned_at" timestamp without time zone,
    "started_review_at" timestamp without time zone,
    "completed_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "verification_queue_queue_status_check" CHECK (("queue_status" = ANY (ARRAY['pending'::"text", 'assigned'::"text", 'in_review'::"text", 'completed'::"text", 'escalated'::"text"]))),
    CONSTRAINT "verification_queue_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'standard'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."verification_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."verification_queue" IS 'Queue management system for assigning verifications to reviewers';



CREATE TABLE IF NOT EXISTS "public"."verification_reviewers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "reviewer_level" "text" DEFAULT 'junior'::"text" NOT NULL,
    "can_approve_high_risk" boolean DEFAULT false,
    "can_approve_without_supervisor" boolean DEFAULT false,
    "max_daily_reviews" integer DEFAULT 50,
    "specializations" "text"[] DEFAULT '{}'::"text"[],
    "total_reviews_completed" integer DEFAULT 0,
    "approval_rate" numeric(3,2),
    "average_review_time_minutes" integer,
    "is_active" boolean DEFAULT true,
    "last_active_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "verification_reviewers_reviewer_level_check" CHECK (("reviewer_level" = ANY (ARRAY['junior'::"text", 'senior'::"text", 'supervisor'::"text"])))
);


ALTER TABLE "public"."verification_reviewers" OWNER TO "postgres";


COMMENT ON TABLE "public"."verification_reviewers" IS 'Back-office team members authorized to review and approve ownership verifications';



ALTER TABLE ONLY "public"."data_point_comments"
    ADD CONSTRAINT "data_point_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_primary_source_id_conflicting_source__key" UNIQUE ("primary_source_id", "conflicting_source_id");



ALTER TABLE ONLY "public"."discovery_notifications"
    ADD CONSTRAINT "discovery_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_streaks"
    ADD CONSTRAINT "discovery_streaks_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."fraud_detection_patterns"
    ADD CONSTRAINT "fraud_detection_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leaderboard_snapshots"
    ADD CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leaderboard_snapshots"
    ADD CONSTRAINT "leaderboard_snapshots_user_id_snapshot_date_key" UNIQUE ("user_id", "snapshot_date");



ALTER TABLE ONLY "public"."ownership_verifications"
    ADD CONSTRAINT "ownership_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ownership_verifications"
    ADD CONSTRAINT "ownership_verifications_user_id_vehicle_id_key" UNIQUE ("user_id", "vehicle_id");



ALTER TABLE ONLY "public"."profile_achievements"
    ADD CONSTRAINT "profile_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_achievements"
    ADD CONSTRAINT "profile_achievements_user_id_achievement_type_key" UNIQUE ("user_id", "achievement_type");



ALTER TABLE ONLY "public"."profile_activity"
    ADD CONSTRAINT "profile_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_completion"
    ADD CONSTRAINT "profile_completion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_completion"
    ADD CONSTRAINT "profile_completion_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."profile_stats"
    ADD CONSTRAINT "profile_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_stats"
    ADD CONSTRAINT "profile_stats_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."timeline_event_comments"
    ADD CONSTRAINT "timeline_event_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timeline_event_conflicts"
    ADD CONSTRAINT "timeline_event_conflicts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timeline_event_conflicts"
    ADD CONSTRAINT "timeline_event_conflicts_primary_event_id_conflicting_event_key" UNIQUE ("primary_event_id", "conflicting_event_id");



ALTER TABLE ONLY "public"."timeline_event_verifications"
    ADD CONSTRAINT "timeline_event_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timeline_event_verifications"
    ADD CONSTRAINT "timeline_event_verifications_timeline_event_id_verifier_id_key" UNIQUE ("timeline_event_id", "verifier_id");



ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_contributions"
    ADD CONSTRAINT "user_contributions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_contributions"
    ADD CONSTRAINT "user_contributions_user_id_vehicle_id_contribution_type_cre_key" UNIQUE ("user_id", "vehicle_id", "contribution_type", "created_at");



ALTER TABLE ONLY "public"."vehicle_comments"
    ADD CONSTRAINT "vehicle_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_data_sources"
    ADD CONSTRAINT "vehicle_data_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_field_annotations"
    ADD CONSTRAINT "vehicle_field_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_image_comments"
    ADD CONSTRAINT "vehicle_image_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_image_likes"
    ADD CONSTRAINT "vehicle_image_likes_image_id_user_id_key" UNIQUE ("image_id", "user_id");



ALTER TABLE ONLY "public"."vehicle_image_likes"
    ADD CONSTRAINT "vehicle_image_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_image_views"
    ADD CONSTRAINT "vehicle_image_views_image_id_user_id_key" UNIQUE ("image_id", "user_id");



ALTER TABLE ONLY "public"."vehicle_image_views"
    ADD CONSTRAINT "vehicle_image_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_modifications"
    ADD CONSTRAINT "vehicle_modifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_views"
    ADD CONSTRAINT "vehicle_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_vin_key" UNIQUE ("vin");



ALTER TABLE ONLY "public"."verification_audit_log"
    ADD CONSTRAINT "verification_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_queue"
    ADD CONSTRAINT "verification_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_reviewers"
    ADD CONSTRAINT "verification_reviewers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_reviewers"
    ADD CONSTRAINT "verification_reviewers_user_id_key" UNIQUE ("user_id");



CREATE INDEX "idx_contributions_created" ON "public"."user_contributions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_contributions_type" ON "public"."user_contributions" USING "btree" ("contribution_type");



CREATE INDEX "idx_contributions_user" ON "public"."user_contributions" USING "btree" ("user_id");



CREATE INDEX "idx_contributions_vehicle" ON "public"."user_contributions" USING "btree" ("vehicle_id");



CREATE INDEX "idx_data_point_comments_type" ON "public"."data_point_comments" USING "btree" ("data_point_type");



CREATE INDEX "idx_data_point_comments_user_id" ON "public"."data_point_comments" USING "btree" ("user_id");



CREATE INDEX "idx_data_point_comments_vehicle_id" ON "public"."data_point_comments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_data_source_conflicts_unresolved" ON "public"."data_source_conflicts" USING "btree" ("resolution_status") WHERE ("resolution_status" = 'unresolved'::"text");



CREATE INDEX "idx_data_source_conflicts_vehicle_field" ON "public"."data_source_conflicts" USING "btree" ("vehicle_id", "field_name");



CREATE INDEX "idx_leaderboard_date" ON "public"."leaderboard_snapshots" USING "btree" ("snapshot_date" DESC);



CREATE INDEX "idx_leaderboard_rank" ON "public"."leaderboard_snapshots" USING "btree" ("snapshot_date", "rank");



CREATE INDEX "idx_notifications_unread" ON "public"."discovery_notifications" USING "btree" ("user_id", "read") WHERE ("read" = false);



CREATE INDEX "idx_ownership_verifications_status" ON "public"."ownership_verifications" USING "btree" ("status");



CREATE INDEX "idx_ownership_verifications_submitted_at" ON "public"."ownership_verifications" USING "btree" ("submitted_at");



CREATE INDEX "idx_ownership_verifications_user_id" ON "public"."ownership_verifications" USING "btree" ("user_id");



CREATE INDEX "idx_ownership_verifications_vehicle_id" ON "public"."ownership_verifications" USING "btree" ("vehicle_id");



CREATE INDEX "idx_profile_achievements_type" ON "public"."profile_achievements" USING "btree" ("achievement_type");



CREATE INDEX "idx_profile_achievements_user_id" ON "public"."profile_achievements" USING "btree" ("user_id");



CREATE INDEX "idx_profile_activity_created_at" ON "public"."profile_activity" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_profile_activity_user_id" ON "public"."profile_activity" USING "btree" ("user_id");



CREATE INDEX "idx_profile_completion_user_id" ON "public"."profile_completion" USING "btree" ("user_id");



CREATE INDEX "idx_profile_stats_user_id" ON "public"."profile_stats" USING "btree" ("user_id");



CREATE INDEX "idx_timeline_event_comments_event_id" ON "public"."timeline_event_comments" USING "btree" ("event_id");



CREATE INDEX "idx_timeline_event_comments_user_id" ON "public"."timeline_event_comments" USING "btree" ("user_id");



CREATE INDEX "idx_timeline_event_conflicts_primary" ON "public"."timeline_event_conflicts" USING "btree" ("primary_event_id");



CREATE INDEX "idx_timeline_event_verifications_event_id" ON "public"."timeline_event_verifications" USING "btree" ("timeline_event_id");



CREATE INDEX "idx_timeline_events_confidence_score" ON "public"."timeline_events" USING "btree" ("confidence_score" DESC);



CREATE INDEX "idx_timeline_events_event_date" ON "public"."timeline_events" USING "btree" ("event_date" DESC);



CREATE INDEX "idx_timeline_events_event_type" ON "public"."timeline_events" USING "btree" ("event_type");



CREATE INDEX "idx_timeline_events_vehicle_id" ON "public"."timeline_events" USING "btree" ("vehicle_id");



CREATE INDEX "idx_timeline_events_verification_status" ON "public"."timeline_events" USING "btree" ("verification_status");



CREATE INDEX "idx_user_contributions_user_id" ON "public"."user_contributions" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_comments_user_id" ON "public"."vehicle_comments" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_comments_vehicle_id" ON "public"."vehicle_comments" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_data_sources_confidence" ON "public"."vehicle_data_sources" USING "btree" ("confidence_score" DESC);



CREATE INDEX "idx_vehicle_data_sources_source_type" ON "public"."vehicle_data_sources" USING "btree" ("source_type");



CREATE INDEX "idx_vehicle_data_sources_vehicle" ON "public"."vehicle_data_sources" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_field_annotations_primary" ON "public"."vehicle_field_annotations" USING "btree" ("vehicle_id", "field_name", "is_primary");



CREATE INDEX "idx_vehicle_field_annotations_vehicle" ON "public"."vehicle_field_annotations" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_image_comments_image_id" ON "public"."vehicle_image_comments" USING "btree" ("image_id");



CREATE INDEX "idx_vehicle_image_comments_user_id" ON "public"."vehicle_image_comments" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_image_likes_image_id" ON "public"."vehicle_image_likes" USING "btree" ("image_id");



CREATE INDEX "idx_vehicle_image_likes_user_id" ON "public"."vehicle_image_likes" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_image_views_image_id" ON "public"."vehicle_image_views" USING "btree" ("image_id");



CREATE INDEX "idx_vehicle_image_views_user_id" ON "public"."vehicle_image_views" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_images_position" ON "public"."vehicle_images" USING "btree" ("position");



CREATE INDEX "idx_vehicle_images_primary" ON "public"."vehicle_images" USING "btree" ("is_primary");



CREATE INDEX "idx_vehicle_images_user_id" ON "public"."vehicle_images" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_images_vehicle_id" ON "public"."vehicle_images" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_modifications_type" ON "public"."vehicle_modifications" USING "btree" ("modification_type");



CREATE INDEX "idx_vehicle_modifications_vehicle" ON "public"."vehicle_modifications" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_views_created" ON "public"."vehicle_views" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_vehicle_views_vehicle" ON "public"."vehicle_views" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicles_created_at" ON "public"."vehicles" USING "btree" ("created_at");



CREATE INDEX "idx_vehicles_discovered_at" ON "public"."vehicles" USING "btree" ("discovered_at" DESC);



CREATE INDEX "idx_vehicles_discovered_by" ON "public"."vehicles" USING "btree" ("discovered_by");



CREATE INDEX "idx_vehicles_discovery_source" ON "public"."vehicles" USING "btree" ("discovery_source");



CREATE INDEX "idx_vehicles_make_model" ON "public"."vehicles" USING "btree" ("make", "model");



CREATE INDEX "idx_vehicles_public" ON "public"."vehicles" USING "btree" ("is_public");



CREATE INDEX "idx_vehicles_user_id" ON "public"."vehicles" USING "btree" ("user_id");



CREATE INDEX "idx_vehicles_vin" ON "public"."vehicles" USING "btree" ("vin");



CREATE INDEX "idx_vehicles_year" ON "public"."vehicles" USING "btree" ("year");



CREATE INDEX "idx_verification_audit_log_created_at" ON "public"."verification_audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_verification_audit_log_verification_id" ON "public"."verification_audit_log" USING "btree" ("verification_id");



CREATE INDEX "idx_verification_queue_assigned_reviewer" ON "public"."verification_queue" USING "btree" ("assigned_reviewer_id");



CREATE INDEX "idx_verification_queue_priority" ON "public"."verification_queue" USING "btree" ("priority_score" DESC);



CREATE INDEX "idx_verification_queue_status" ON "public"."verification_queue" USING "btree" ("queue_status");



CREATE OR REPLACE TRIGGER "assign_verification_trigger" AFTER UPDATE ON "public"."ownership_verifications" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_assign_verification"();



CREATE OR REPLACE TRIGGER "detect_data_conflicts_trigger" AFTER INSERT OR UPDATE ON "public"."vehicle_field_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."detect_data_conflicts"();



CREATE OR REPLACE TRIGGER "detect_timeline_conflicts_trigger" AFTER INSERT OR UPDATE ON "public"."timeline_events" FOR EACH ROW EXECUTE FUNCTION "public"."detect_timeline_conflicts"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_streak_on_contribution" AFTER INSERT ON "public"."user_contributions" FOR EACH ROW EXECUTE FUNCTION "public"."update_discovery_streak"();



CREATE OR REPLACE TRIGGER "update_timeline_confidence_trigger" AFTER INSERT OR UPDATE ON "public"."timeline_event_verifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_timeline_event_confidence"();



CREATE OR REPLACE TRIGGER "update_timeline_events_updated_at" BEFORE UPDATE ON "public"."timeline_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vehicle_images_updated_at" BEFORE UPDATE ON "public"."vehicle_images" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vehicles_updated_at" BEFORE UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "vehicle_stats_trigger" AFTER INSERT OR DELETE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."update_profile_stats_on_vehicle_change"();



ALTER TABLE ONLY "public"."data_point_comments"
    ADD CONSTRAINT "data_point_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_point_comments"
    ADD CONSTRAINT "data_point_comments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_conflicting_source_id_fkey" FOREIGN KEY ("conflicting_source_id") REFERENCES "public"."vehicle_data_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_primary_source_id_fkey" FOREIGN KEY ("primary_source_id") REFERENCES "public"."vehicle_data_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."data_source_conflicts"
    ADD CONSTRAINT "data_source_conflicts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_notifications"
    ADD CONSTRAINT "discovery_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_streaks"
    ADD CONSTRAINT "discovery_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leaderboard_snapshots"
    ADD CONSTRAINT "leaderboard_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ownership_verifications"
    ADD CONSTRAINT "ownership_verifications_human_reviewer_id_fkey" FOREIGN KEY ("human_reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ownership_verifications"
    ADD CONSTRAINT "ownership_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ownership_verifications"
    ADD CONSTRAINT "ownership_verifications_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_achievements"
    ADD CONSTRAINT "profile_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_activity"
    ADD CONSTRAINT "profile_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_completion"
    ADD CONSTRAINT "profile_completion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_stats"
    ADD CONSTRAINT "profile_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_comments"
    ADD CONSTRAINT "timeline_event_comments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."timeline_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_comments"
    ADD CONSTRAINT "timeline_event_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_conflicts"
    ADD CONSTRAINT "timeline_event_conflicts_conflicting_event_id_fkey" FOREIGN KEY ("conflicting_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_conflicts"
    ADD CONSTRAINT "timeline_event_conflicts_primary_event_id_fkey" FOREIGN KEY ("primary_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_conflicts"
    ADD CONSTRAINT "timeline_event_conflicts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."timeline_event_verifications"
    ADD CONSTRAINT "timeline_event_verifications_timeline_event_id_fkey" FOREIGN KEY ("timeline_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_event_verifications"
    ADD CONSTRAINT "timeline_event_verifications_verifier_id_fkey" FOREIGN KEY ("verifier_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timeline_events"
    ADD CONSTRAINT "timeline_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_contributions"
    ADD CONSTRAINT "user_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_contributions"
    ADD CONSTRAINT "user_contributions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_comments"
    ADD CONSTRAINT "vehicle_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_comments"
    ADD CONSTRAINT "vehicle_comments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_data_sources"
    ADD CONSTRAINT "vehicle_data_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_data_sources"
    ADD CONSTRAINT "vehicle_data_sources_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_field_annotations"
    ADD CONSTRAINT "vehicle_field_annotations_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "public"."vehicle_data_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_field_annotations"
    ADD CONSTRAINT "vehicle_field_annotations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_comments"
    ADD CONSTRAINT "vehicle_image_comments_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "public"."vehicle_images"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_comments"
    ADD CONSTRAINT "vehicle_image_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_likes"
    ADD CONSTRAINT "vehicle_image_likes_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "public"."vehicle_images"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_likes"
    ADD CONSTRAINT "vehicle_image_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_views"
    ADD CONSTRAINT "vehicle_image_views_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "public"."vehicle_images"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_image_views"
    ADD CONSTRAINT "vehicle_image_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_modifications"
    ADD CONSTRAINT "vehicle_modifications_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "public"."vehicle_data_sources"("id");



ALTER TABLE ONLY "public"."vehicle_modifications"
    ADD CONSTRAINT "vehicle_modifications_modified_by_fkey" FOREIGN KEY ("modified_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_modifications"
    ADD CONSTRAINT "vehicle_modifications_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_views"
    ADD CONSTRAINT "vehicle_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vehicle_views"
    ADD CONSTRAINT "vehicle_views_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_discovered_by_fkey" FOREIGN KEY ("discovered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_ownership_verification_id_fkey" FOREIGN KEY ("ownership_verification_id") REFERENCES "public"."ownership_verifications"("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_audit_log"
    ADD CONSTRAINT "verification_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."verification_audit_log"
    ADD CONSTRAINT "verification_audit_log_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "public"."ownership_verifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_queue"
    ADD CONSTRAINT "verification_queue_assigned_reviewer_id_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."verification_reviewers"("id");



ALTER TABLE ONLY "public"."verification_queue"
    ADD CONSTRAINT "verification_queue_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "public"."ownership_verifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_reviewers"
    ADD CONSTRAINT "verification_reviewers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Anyone can view achievements" ON "public"."profile_achievements" FOR SELECT USING (true);



CREATE POLICY "Anyone can view activity" ON "public"."profile_activity" FOR SELECT USING (true);



CREATE POLICY "Anyone can view contributions" ON "public"."user_contributions" FOR SELECT USING (true);



CREATE POLICY "Anyone can view profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Anyone can view stats" ON "public"."profile_stats" FOR SELECT USING (true);



CREATE POLICY "Leaderboard is public" ON "public"."leaderboard_snapshots" FOR SELECT USING (true);



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public vehicles are viewable by everyone" ON "public"."vehicles" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Reviewers can view assigned verifications" ON "public"."ownership_verifications" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."verification_reviewers" "vr"
  WHERE (("vr"."user_id" = "auth"."uid"()) AND ("vr"."is_active" = true)))));



CREATE POLICY "Reviewers can view audit logs" ON "public"."verification_audit_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."verification_reviewers" "vr"
  WHERE (("vr"."user_id" = "auth"."uid"()) AND ("vr"."is_active" = true)))));



CREATE POLICY "Reviewers can view queue" ON "public"."verification_queue" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."verification_reviewers" "vr"
  WHERE (("vr"."user_id" = "auth"."uid"()) AND ("vr"."is_active" = true)))));



CREATE POLICY "Users can create comments" ON "public"."vehicle_image_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create data point comments" ON "public"."data_point_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create data sources for their vehicles" ON "public"."vehicle_data_sources" FOR INSERT WITH CHECK ((("auth"."uid"() = "created_by") AND (EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_data_sources"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can create image views" ON "public"."vehicle_image_views" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can create own verifications" ON "public"."ownership_verifications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own contributions" ON "public"."user_contributions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create timeline event comments" ON "public"."timeline_event_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create timeline events for their vehicles" ON "public"."timeline_events" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "timeline_events"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can create vehicle comments" ON "public"."vehicle_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create verifications" ON "public"."timeline_event_verifications" FOR INSERT WITH CHECK (("auth"."uid"() = "verifier_id"));



CREATE POLICY "Users can delete images for their own vehicles" ON "public"."vehicle_images" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_images"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))) AND ("auth"."uid"() = "user_id")));



CREATE POLICY "Users can delete their own comments" ON "public"."vehicle_image_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own data point comments" ON "public"."data_point_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own timeline event comments" ON "public"."timeline_event_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own vehicle comments" ON "public"."vehicle_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own vehicles" ON "public"."vehicles" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert images for their own vehicles" ON "public"."vehicle_images" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_images"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))) AND ("auth"."uid"() = "user_id")));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own vehicles" ON "public"."vehicles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage modifications for their vehicles" ON "public"."vehicle_modifications" USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_modifications"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can manage their own likes" ON "public"."vehicle_image_likes" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can mark notifications as read" ON "public"."discovery_notifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update images for their own vehicles" ON "public"."vehicle_images" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_images"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))) AND ("auth"."uid"() = "user_id")));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own comments" ON "public"."vehicle_image_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own data point comments" ON "public"."data_point_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own timeline event comments" ON "public"."timeline_event_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own timeline events" ON "public"."timeline_events" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "timeline_events"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their own vehicle comments" ON "public"."vehicle_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own vehicles" ON "public"."vehicles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view conflicts for their events" ON "public"."timeline_event_conflicts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."timeline_events" "te"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "te"."vehicle_id")))
  WHERE ((("te"."id" = "timeline_event_conflicts"."primary_event_id") OR ("te"."id" = "timeline_event_conflicts"."conflicting_event_id")) AND ("v"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view conflicts for their vehicles" ON "public"."data_source_conflicts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "data_source_conflicts"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view data point comments" ON "public"."data_point_comments" FOR SELECT USING (true);



CREATE POLICY "Users can view data sources for vehicles they own" ON "public"."vehicle_data_sources" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_data_sources"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view field annotations for their vehicles" ON "public"."vehicle_field_annotations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_field_annotations"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view image comments" ON "public"."vehicle_image_comments" FOR SELECT USING (true);



CREATE POLICY "Users can view image likes" ON "public"."vehicle_image_likes" FOR SELECT USING (true);



CREATE POLICY "Users can view image views" ON "public"."vehicle_image_views" FOR SELECT USING (true);



CREATE POLICY "Users can view images for public vehicles" ON "public"."vehicle_images" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_images"."vehicle_id") AND ("vehicles"."is_public" = true)))));



CREATE POLICY "Users can view images for vehicles they own" ON "public"."vehicle_images" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "vehicle_images"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own profile completion" ON "public"."profile_completion" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own verifications" ON "public"."ownership_verifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their notifications" ON "public"."discovery_notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own vehicles" ON "public"."vehicles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their streaks" ON "public"."discovery_streaks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view timeline event comments" ON "public"."timeline_event_comments" FOR SELECT USING (true);



CREATE POLICY "Users can view timeline events for vehicles they own" ON "public"."timeline_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles"
  WHERE (("vehicles"."id" = "timeline_events"."vehicle_id") AND ("vehicles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view vehicle comments" ON "public"."vehicle_comments" FOR SELECT USING (true);



CREATE POLICY "Users can view verifications for events they can see" ON "public"."timeline_event_verifications" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."timeline_events" "te"
     JOIN "public"."vehicles" "v" ON (("v"."id" = "te"."vehicle_id")))
  WHERE (("te"."id" = "timeline_event_verifications"."timeline_event_id") AND ("v"."user_id" = "auth"."uid"())))));



CREATE POLICY "Vehicle views are write-only for users" ON "public"."vehicle_views" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."data_point_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_source_conflicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_streaks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leaderboard_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ownership_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_completion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timeline_event_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timeline_event_conflicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timeline_event_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timeline_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_contributions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_data_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_field_annotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_image_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_image_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_image_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_modifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verification_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verification_queue" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


























































































































































































GRANT ALL ON FUNCTION "public"."approve_ownership_verification"("verification_id" "uuid", "reviewer_id" "uuid", "review_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_ownership_verification"("verification_id" "uuid", "reviewer_id" "uuid", "review_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_ownership_verification"("verification_id" "uuid", "reviewer_id" "uuid", "review_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_verification_to_reviewer"("verification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_verification_to_reviewer"("verification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_verification_to_reviewer"("verification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."award_achievement"("user_uuid" "uuid", "achievement_type_param" "text", "achievement_title_param" "text", "achievement_description_param" "text", "points_param" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."award_achievement"("user_uuid" "uuid", "achievement_type_param" "text", "achievement_title_param" "text", "achievement_description_param" "text", "points_param" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_achievement"("user_uuid" "uuid", "achievement_type_param" "text", "achievement_title_param" "text", "achievement_description_param" "text", "points_param" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_profile_completion"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_profile_completion"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_profile_completion"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_verification_priority"("verification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_verification_priority"("verification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_verification_priority"("verification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_daily_leaderboard_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_daily_leaderboard_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_daily_leaderboard_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_data_conflicts"() TO "anon";
GRANT ALL ON FUNCTION "public"."detect_data_conflicts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_data_conflicts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_timeline_conflicts"() TO "anon";
GRANT ALL ON FUNCTION "public"."detect_timeline_conflicts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_timeline_conflicts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_discovery_stats"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_discovery_stats"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_discovery_stats"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_contribution"("user_uuid" "uuid", "contribution_type_param" "text", "related_vehicle_uuid" "uuid", "contribution_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_contribution"("user_uuid" "uuid", "contribution_type_param" "text", "related_vehicle_uuid" "uuid", "contribution_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_contribution"("user_uuid" "uuid", "contribution_type_param" "text", "related_vehicle_uuid" "uuid", "contribution_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_rank_advancement"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_rank_advancement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_rank_advancement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_vehicle_view"("p_vehicle_id" "uuid", "p_session_id" "text", "p_referrer" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_vehicle_view"("p_vehicle_id" "uuid", "p_session_id" "text", "p_referrer" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_vehicle_view"("p_vehicle_id" "uuid", "p_session_id" "text", "p_referrer" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_assign_verification"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_assign_verification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_assign_verification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_discovery_streak"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_discovery_streak"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_discovery_streak"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_field_annotation"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_field_annotation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_field_annotation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_completion_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_completion_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_completion_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_stats_on_vehicle_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_stats_on_vehicle_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_stats_on_vehicle_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_timeline_event_confidence"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_timeline_event_confidence"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_timeline_event_confidence"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."data_point_comments" TO "anon";
GRANT ALL ON TABLE "public"."data_point_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."data_point_comments" TO "service_role";



GRANT ALL ON TABLE "public"."data_source_conflicts" TO "anon";
GRANT ALL ON TABLE "public"."data_source_conflicts" TO "authenticated";
GRANT ALL ON TABLE "public"."data_source_conflicts" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_notifications" TO "anon";
GRANT ALL ON TABLE "public"."discovery_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_streaks" TO "anon";
GRANT ALL ON TABLE "public"."discovery_streaks" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_streaks" TO "service_role";



GRANT ALL ON TABLE "public"."fraud_detection_patterns" TO "anon";
GRANT ALL ON TABLE "public"."fraud_detection_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."fraud_detection_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."leaderboard_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."ownership_verifications" TO "anon";
GRANT ALL ON TABLE "public"."ownership_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."ownership_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."profile_achievements" TO "anon";
GRANT ALL ON TABLE "public"."profile_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."profile_activity" TO "anon";
GRANT ALL ON TABLE "public"."profile_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_activity" TO "service_role";



GRANT ALL ON TABLE "public"."profile_completion" TO "anon";
GRANT ALL ON TABLE "public"."profile_completion" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_completion" TO "service_role";



GRANT ALL ON TABLE "public"."profile_stats" TO "anon";
GRANT ALL ON TABLE "public"."profile_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_stats" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."schema_migrations" TO "anon";
GRANT ALL ON TABLE "public"."schema_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."timeline_event_comments" TO "anon";
GRANT ALL ON TABLE "public"."timeline_event_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_event_comments" TO "service_role";



GRANT ALL ON TABLE "public"."timeline_event_conflicts" TO "anon";
GRANT ALL ON TABLE "public"."timeline_event_conflicts" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_event_conflicts" TO "service_role";



GRANT ALL ON TABLE "public"."timeline_event_verifications" TO "anon";
GRANT ALL ON TABLE "public"."timeline_event_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_event_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."timeline_events" TO "anon";
GRANT ALL ON TABLE "public"."timeline_events" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_events" TO "service_role";



GRANT ALL ON TABLE "public"."user_contributions" TO "anon";
GRANT ALL ON TABLE "public"."user_contributions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_contributions" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_comments" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_comments" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_data_sources" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_data_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_data_sources" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_field_annotations" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_field_annotations" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_field_annotations" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_image_comments" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_image_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_image_comments" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_image_likes" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_image_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_image_likes" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_image_views" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_image_views" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_image_views" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_images" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_images" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_images" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_modifications" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_modifications" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_modifications" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_views" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_views" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_views" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."verification_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."verification_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."verification_queue" TO "anon";
GRANT ALL ON TABLE "public"."verification_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_queue" TO "service_role";



GRANT ALL ON TABLE "public"."verification_reviewers" TO "anon";
GRANT ALL ON TABLE "public"."verification_reviewers" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_reviewers" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
