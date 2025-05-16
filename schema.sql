

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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'user',
    'system_admin',
    'business_admin',
    'moderator',
    'expert',
    'dealer',
    'professional',
    'garage_admin'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."certification_status" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'expired'
);


ALTER TYPE "public"."certification_status" OWNER TO "postgres";


CREATE TYPE "public"."feed_importance" AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);


ALTER TYPE "public"."feed_importance" OWNER TO "postgres";


CREATE TYPE "public"."garage_membership_status" AS ENUM (
    'pending',
    'active',
    'rejected'
);


ALTER TYPE "public"."garage_membership_status" OWNER TO "postgres";


CREATE TYPE "public"."garage_role" AS ENUM (
    'manager',
    'technician',
    'staff'
);


ALTER TYPE "public"."garage_role" OWNER TO "postgres";


CREATE TYPE "public"."location_status" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


ALTER TYPE "public"."location_status" OWNER TO "postgres";


CREATE TYPE "public"."service_type" AS ENUM (
    'routine_maintenance',
    'repair',
    'inspection',
    'modification',
    'emergency',
    'recall'
);


ALTER TYPE "public"."service_type" OWNER TO "postgres";


CREATE TYPE "public"."shop_role" AS ENUM (
    'owner',
    'co-founder',
    'manager',
    'staff'
);


ALTER TYPE "public"."shop_role" OWNER TO "postgres";


CREATE TYPE "public"."skill_category" AS ENUM (
    'mechanical',
    'electrical',
    'bodywork',
    'diagnostics',
    'restoration',
    'customization'
);


ALTER TYPE "public"."skill_category" OWNER TO "postgres";


CREATE TYPE "public"."team_member_type" AS ENUM (
    'employee',
    'contractor',
    'intern',
    'partner',
    'collaborator'
);


ALTER TYPE "public"."team_member_type" OWNER TO "postgres";


CREATE TYPE "public"."test_status" AS ENUM (
    'pending',
    'running',
    'passed',
    'failed'
);


ALTER TYPE "public"."test_status" OWNER TO "postgres";


CREATE TYPE "public"."theme_type" AS ENUM (
    'light',
    'dark',
    'system'
);


ALTER TYPE "public"."theme_type" OWNER TO "postgres";


CREATE TYPE "public"."user_type" AS ENUM (
    'viewer',
    'professional'
);


ALTER TYPE "public"."user_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analyze_market_trends"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Updates vehicle_sales_data with market trend analysis
    UPDATE vehicle_sales_data
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{market_trends}',
        (
            SELECT jsonb_build_object(
                'avg_price', AVG(sale_price),
                'price_trend', CASE 
                    WHEN AVG(sale_price) > LAG(AVG(sale_price)) OVER (ORDER BY DATE_TRUNC('week', sale_date)) -- Changed
                    THEN 'increasing'
                    ELSE 'decreasing'
                END,
                'total_sales', COUNT(*),
                'last_updated', CURRENT_TIMESTAMP
            )
            FROM vehicle_sales_data
            WHERE sale_date >= (CURRENT_DATE - INTERVAL '30 days')
            GROUP BY DATE_TRUNC('week', sale_date)
            ORDER BY DATE_TRUNC('week', sale_date) DESC
            LIMIT 1
        )
    );
    -- Removed outer WHERE clause
END;
$$;


ALTER FUNCTION "public"."analyze_market_trends"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_content_relevance"("p_content_id" "uuid", "p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  base_score INTEGER := 50;
  user_prefs user_content_preferences%ROWTYPE;
  content explore_content%ROWTYPE;
  tag_matches INTEGER := 0;
  recency_bonus INTEGER := 0;
BEGIN
  -- Get content and user preferences
  SELECT * INTO content FROM explore_content WHERE id = p_content_id;
  SELECT * INTO user_prefs FROM user_content_preferences WHERE user_id = p_user_id;
  
  -- If no user preferences found, return default score
  IF user_prefs.id IS NULL THEN
    RETURN base_score;
  END IF;
  
  -- Check content type preference
  IF content.type = ANY(user_prefs.preferred_types) THEN
    base_score := base_score + 15;
  END IF;
  
  -- Check tag matches
  SELECT COUNT(*) INTO tag_matches
  FROM unnest(content.tags) t
  WHERE t = ANY(user_prefs.preferred_tags);
  
  base_score := base_score + (tag_matches * 5);
  
  -- Check location preference
  IF content.location = ANY(user_prefs.preferred_locations) THEN
    base_score := base_score + 10;
  END IF;
  
  -- Add recency bonus (newer content gets higher score)
  recency_bonus := CASE
    WHEN content.created_at > now() - interval '1 day' THEN 20
    WHEN content.created_at > now() - interval '1 week' THEN 10
    WHEN content.created_at > now() - interval '1 month' THEN 5
    ELSE 0
  END;
  
  base_score := base_score + recency_bonus;
  
  -- Cap the score at 100
  RETURN LEAST(base_score, 100);
END;
$$;


ALTER FUNCTION "public"."calculate_content_relevance"("p_content_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  exists_check BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = p_schema_name -- Use prefixed param
    AND table_name = p_table_name     -- Use prefixed param
    AND column_name = p_column_name   -- Use prefixed param
  ) INTO exists_check;

  RETURN exists_check;
END;
$$;


ALTER FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."explore_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "content" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reason" "text",
    "location" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "relevance_score" integer DEFAULT 50,
    "user_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "explore_content_type_check" CHECK (("type" = ANY (ARRAY['vehicle'::"text", 'auction'::"text", 'event'::"text", 'garage'::"text", 'article'::"text"])))
);


ALTER TABLE "public"."explore_content" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_personalized_feed"("p_user_id" "uuid", "p_limit" integer DEFAULT 20, "p_type" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."explore_content"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT c.*
  FROM explore_content c
  WHERE (p_type IS NULL OR c.type = p_type)
  ORDER BY 
    -- If we have a user_id, calculate relevance, otherwise order by created_at
    CASE WHEN p_user_id IS NOT NULL 
      THEN calculate_content_relevance(c.id, p_user_id) 
      ELSE c.relevance_score 
    END DESC,
    c.created_at DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_personalized_feed"("p_user_id" "uuid", "p_limit" integer, "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_marketplace_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_marketplace_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_garage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.garage_members (user_id, garage_id)
  VALUES (auth.uid(), NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_garage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.user_preferences (user_id)
  values (new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_shop_member_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_shop_member_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_shop_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_shop_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = role
  );
$$;


ALTER FUNCTION "public"."has_role"("role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safely_add_column"("schema_name" "text", "table_name" "text", "column_name" "text", "column_type" "text", "default_value" "text" DEFAULT NULL::"text", "nullable" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  column_exists BOOLEAN;
  sql_statement TEXT;
BEGIN
  -- Check if column already exists
  SELECT column_exists(schema_name, table_name, column_name) INTO column_exists;
  
  -- If the column doesn't exist, add it
  IF NOT column_exists THEN
    sql_statement := format('ALTER TABLE %I.%I ADD COLUMN %I %s', 
                           schema_name, table_name, column_name, column_type);
    
    -- Add default value if provided
    IF default_value IS NOT NULL THEN
      sql_statement := sql_statement || format(' DEFAULT %s', default_value);
    END IF;
    
    -- Add NOT NULL constraint if not nullable
    IF NOT nullable THEN
      sql_statement := sql_statement || ' NOT NULL';
    END IF;
    
    -- Execute the SQL
    EXECUTE sql_statement;
    
    -- Log the action
    RAISE NOTICE 'Added column %.%.% of type %', 
                 schema_name, table_name, column_name, column_type;
  ELSE
    RAISE NOTICE 'Column %.%.% already exists, skipping', 
                schema_name, table_name, column_name;
  END IF;
END;
$$;


ALTER FUNCTION "public"."safely_add_column"("schema_name" "text", "table_name" "text", "column_name" "text", "column_type" "text", "default_value" "text", "nullable" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safely_create_enum_type"("type_name" "text", "enum_values" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  type_exists BOOLEAN;
  enum_values_str TEXT;
BEGIN
  -- Check if type already exists
  SELECT EXISTS (
    SELECT 1 
    FROM pg_type 
    WHERE typname = type_name
  ) INTO type_exists;
  
  -- If the type doesn't exist, create it
  IF NOT type_exists THEN
    -- Convert array to comma-separated string
    SELECT array_to_string(
      array(
        SELECT quote_literal(v)
        FROM unnest(enum_values) AS v
      ), 
      ', '
    ) INTO enum_values_str;
    
    -- Create the enum type
    EXECUTE format('CREATE TYPE %I AS ENUM (%s)', type_name, enum_values_str);
    
    RAISE NOTICE 'Created enum type % with values: %', type_name, enum_values_str;
  ELSE
    RAISE NOTICE 'Enum type % already exists, skipping', type_name;
  END IF;
END;
$$;


ALTER FUNCTION "public"."safely_create_enum_type"("type_name" "text", "enum_values" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safely_update_column_values"("schema_name" "text", "table_name" "text", "column_name" "text", "new_value" "text", "condition" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  column_exists BOOLEAN;
  sql_statement TEXT;
  affected_rows INTEGER;
BEGIN
  -- Check if column exists
  SELECT column_exists(schema_name, table_name, column_name) INTO column_exists;
  
  -- Only proceed if the column exists
  IF column_exists THEN
    sql_statement := format('UPDATE %I.%I SET %I = %s', 
                           schema_name, table_name, column_name, new_value);
    
    -- Add condition if provided
    IF condition IS NOT NULL THEN
      sql_statement := sql_statement || format(' WHERE %s', condition);
    END IF;
    
    -- Execute the SQL and get affected rows
    EXECUTE sql_statement;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Log the action
    RAISE NOTICE 'Updated % rows in %.%.%', 
                 affected_rows, schema_name, table_name, column_name;
  ELSE
    RAISE NOTICE 'Column %.%.% does not exist, skipping update', 
                schema_name, table_name, column_name;
  END IF;
END;
$$;


ALTER FUNCTION "public"."safely_update_column_values"("schema_name" "text", "table_name" "text", "column_name" "text", "new_value" "text", "condition" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_vehicle_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Check if auth.uid() is available
  IF auth.uid() IS NOT NULL THEN
    NEW.owner_id = auth.uid();
  ELSE
    -- Log the issue and use a default value or raise an exception
    -- We choose to raise an exception as it's safer for production
    -- If logging is desired, a separate logging table (e.g., auth_errors) would need to be created.
    RAISE EXCEPTION 'Authentication required to add vehicles. auth.uid() was null.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_vehicle_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_feed_item_relevance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Calculate new relevance score based on various factors
    NEW.relevance_score = (
        CASE 
            WHEN NEW.importance = 'urgent' THEN 4.0
            WHEN NEW.importance = 'high' THEN 3.0
            WHEN NEW.importance = 'medium' THEN 2.0
            ELSE 1.0
        END *
        COALESCE(NEW.market_impact_score, 1.0) *
        COALESCE(NEW.trending_score, 1.0)
    );
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_feed_item_relevance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_preferences_on_interaction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Insert a new preferences record if one doesn't exist
  INSERT INTO user_content_preferences (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Update the interaction_history array with the new interaction
  UPDATE user_content_preferences
  SET 
    interaction_history = COALESCE(interaction_history, '[]'::jsonb) || 
      jsonb_build_object(
        'content_id', NEW.content_id,
        'interaction_type', NEW.interaction_type,
        'time', NEW.interaction_time
      ),
    updated_at = now()
  WHERE user_id = NEW.user_id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_preferences_on_interaction"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid",
    "action_type" "text" NOT NULL,
    "action_data" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."agent_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "agent_type" "text" NOT NULL,
    "personality" "text",
    "behavior_config" "jsonb" DEFAULT '{}'::"jsonb",
    "last_action_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."ai_agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_explanations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "explanation" "text" NOT NULL,
    "model" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "explanation_length" CHECK (("length"("explanation") >= 10)),
    CONSTRAINT "question_length" CHECK (("length"("question") >= 3))
);


ALTER TABLE "public"."ai_explanations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."algorithm_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_weights" "jsonb" DEFAULT '{"market": 1.0, "social": 1.0, "project": 1.0, "service": 1.0, "inventory": 1.0, "technical": 1.0, "educational": 1.0}'::"jsonb",
    "professional_interests" "text"[] DEFAULT '{}'::"text"[],
    "technical_level_preference" integer DEFAULT 5,
    "market_alert_threshold" numeric DEFAULT 0.1,
    "geographic_radius_km" integer DEFAULT 100,
    "preferred_categories" "text"[] DEFAULT '{}'::"text"[],
    "notification_preferences" "jsonb" DEFAULT '{"price_alerts": true, "inventory_alerts": true, "technical_updates": true, "market_opportunities": true, "certification_reminders": true}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."algorithm_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "part_number" "text",
    "quantity" integer DEFAULT 0 NOT NULL,
    "location" "text",
    "category" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid",
    "ai_classification" "jsonb",
    "department" "text",
    "sub_department" "text",
    "asset_type" "text",
    "condition" "text",
    "manufacturer" "text",
    "model_number" "text",
    "serial_number" "text",
    "purchase_date" "date",
    "purchase_price" numeric(10,2),
    "warranty_expiration" "date",
    "last_maintenance_date" "date",
    "next_maintenance_date" "date",
    "building" "text",
    "floor" "text",
    "room" "text",
    "shelf" "text",
    "bin" "text",
    "photo_url" "text"
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."assets"."ai_classification" IS 'Stores the AI classification results from image processing';



COMMENT ON COLUMN "public"."assets"."department" IS 'Main department (e.g., Maintenance, Kitchen, Office)';



COMMENT ON COLUMN "public"."assets"."sub_department" IS 'Sub-category within department';



COMMENT ON COLUMN "public"."assets"."asset_type" IS 'Type of asset (e.g., Tool, Equipment, Furniture)';



COMMENT ON COLUMN "public"."assets"."condition" IS 'Current condition of the item';



COMMENT ON COLUMN "public"."assets"."manufacturer" IS 'Item manufacturer';



COMMENT ON COLUMN "public"."assets"."model_number" IS 'Model number from manufacturer';



COMMENT ON COLUMN "public"."assets"."serial_number" IS 'Unique serial number';



COMMENT ON COLUMN "public"."assets"."purchase_date" IS 'Date of purchase';



COMMENT ON COLUMN "public"."assets"."purchase_price" IS 'Original purchase price';



COMMENT ON COLUMN "public"."assets"."warranty_expiration" IS 'Warranty expiration date';



COMMENT ON COLUMN "public"."assets"."last_maintenance_date" IS 'Date of last maintenance';



COMMENT ON COLUMN "public"."assets"."next_maintenance_date" IS 'Scheduled next maintenance';



COMMENT ON COLUMN "public"."assets"."building" IS 'Building location';



COMMENT ON COLUMN "public"."assets"."floor" IS 'Floor number/name';



COMMENT ON COLUMN "public"."assets"."room" IS 'Room number/name';



COMMENT ON COLUMN "public"."assets"."shelf" IS 'Shelf identifier';



COMMENT ON COLUMN "public"."assets"."bin" IS 'Bin/Container identifier';



CREATE TABLE IF NOT EXISTS "public"."auction_bids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid",
    "bidder_id" "uuid",
    "amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."auction_bids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auction_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid",
    "user_id" "uuid",
    "comment" "text" NOT NULL,
    "parent_comment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);

ALTER TABLE ONLY "public"."auction_comments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."auction_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auctions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "seller_id" "uuid",
    "starting_price" numeric NOT NULL,
    "reserve_price" numeric,
    "current_price" numeric,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."auctions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automotive_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "location" "jsonb" NOT NULL,
    "type" "text" NOT NULL,
    "rating" numeric,
    "contact_info" "jsonb",
    "website" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "automotive_locations_type_check" CHECK (("type" = ANY (ARRAY['dealership'::"text", 'garage'::"text", 'service'::"text", 'parts'::"text", 'custom_shop'::"text", 'rental'::"text"])))
);


ALTER TABLE "public"."automotive_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."captures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "url" "text",
    "html" "text",
    "images" "jsonb",
    "user_id" "text",
    "captured_at" timestamp with time zone DEFAULT "now"(),
    "meta" "jsonb"
);


ALTER TABLE "public"."captures" OWNER TO "postgres";


COMMENT ON TABLE "public"."captures" IS 'Stores vehicle listings captured from various websites using the VehiDex extension';



CREATE TABLE IF NOT EXISTS "public"."certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "issuing_authority" "text" NOT NULL,
    "required_skills" "uuid"[] DEFAULT '{}'::"uuid"[],
    "validity_period" interval,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid",
    "views" integer DEFAULT 0,
    "engagement_metrics" "jsonb" DEFAULT '{}'::"jsonb",
    "platform_metrics" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."content_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "interaction_type" "text" NOT NULL,
    "interaction_time" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "content_interactions_interaction_type_check" CHECK (("interaction_type" = ANY (ARRAY['view'::"text", 'like'::"text", 'share'::"text", 'save'::"text", 'comment'::"text"])))
);


ALTER TABLE "public"."content_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "scheduled_time" timestamp with time zone NOT NULL,
    "distribution_channels" "jsonb" DEFAULT '[]'::"jsonb",
    "status" "text" DEFAULT 'scheduled'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."content_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dao_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "proposer_id" "uuid",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "votes_for" numeric DEFAULT 0,
    "votes_against" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."dao_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dao_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_id" "uuid",
    "user_id" "uuid",
    "voting_power" numeric DEFAULT 0 NOT NULL,
    "vote_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "dao_votes_vote_type_check" CHECK (("vote_type" = ANY (ARRAY['for'::"text", 'against'::"text", 'abstain'::"text"])))
);


ALTER TABLE "public"."dao_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."derivatives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_token_id" "uuid",
    "type" "text" NOT NULL,
    "strike_price" numeric,
    "expiration_date" timestamp with time zone,
    "current_price" numeric,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."derivatives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."development_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "target_date" timestamp with time zone,
    "status" "text" DEFAULT 'in_progress'::"text",
    "ai_recommendations" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."development_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovered_vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year" integer NOT NULL,
    "price" "text",
    "vin" "text",
    "source" "text" NOT NULL,
    "source_url" "text",
    "notes" "text",
    "location" "text",
    "status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."discovered_vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."engagement_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "view_duration_seconds" integer DEFAULT 0,
    "interaction_type" "text" NOT NULL,
    "interaction_weight" double precision DEFAULT 1.0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "content_type" "text",
    "interaction_time" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."engagement_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feed_item_id" "uuid",
    "user_id" "uuid",
    "interaction_type" "text" NOT NULL,
    "content" "text",
    "amount" numeric,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."feed_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "item_type" "text" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "content" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "importance" "public"."feed_importance" DEFAULT 'medium'::"public"."feed_importance",
    "relevance_score" double precision DEFAULT 1.0,
    "technical_level" integer DEFAULT 1,
    "geographic_relevance" "jsonb",
    "market_impact_score" double precision DEFAULT 0.0,
    "trending_score" double precision DEFAULT 0.0,
    "expiration_time" timestamp with time zone,
    "type" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "feed_items_type_check" CHECK (("type" = ANY (ARRAY['vehicle'::"text", 'asset'::"text", 'service'::"text", 'auction'::"text"])))
);


ALTER TABLE "public"."feed_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garage_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "garage_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "valid_roles" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."garage_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "google_place_id" "text",
    "location" "jsonb",
    "address" "text",
    "rating" numeric,
    "contact_info" "jsonb" DEFAULT '{}'::"jsonb",
    "business_hours" "jsonb" DEFAULT '{"friday": {"open": "09:00", "close": "17:00"}, "monday": {"open": "09:00", "close": "17:00"}, "tuesday": {"open": "09:00", "close": "17:00"}, "thursday": {"open": "09:00", "close": "17:00"}, "wednesday": {"open": "09:00", "close": "17:00"}}'::"jsonb"
);


ALTER TABLE "public"."garages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."governance_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "creator_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "required_votes" integer DEFAULT 0,
    "token_id" "uuid"
);


ALTER TABLE "public"."governance_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "manufacturer" "text",
    "supplier_id" "uuid",
    "unit_price" numeric,
    "quantity_in_stock" integer DEFAULT 0 NOT NULL,
    "reorder_point" integer DEFAULT 0,
    "location" "text",
    "status" "text" DEFAULT 'active'::"text",
    "last_ordered_at" timestamp with time zone,
    "integration_source" "text",
    "integration_id" "text",
    "user_id" "uuid" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "inventory_items_quantity_check" CHECK (("quantity_in_stock" >= 0)),
    CONSTRAINT "inventory_items_reorder_check" CHECK (("reorder_point" >= 0))
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_streams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'offline'::"text",
    "stream_key" "text",
    "viewer_count" integer DEFAULT 0,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "stream_url" "text",
    CONSTRAINT "live_streams_status_check" CHECK (("status" = ANY (ARRAY['offline'::"text", 'live'::"text", 'ended'::"text"])))
);

ALTER TABLE ONLY "public"."live_streams" REPLICA IDENTITY FULL;


ALTER TABLE "public"."live_streams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketplace_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "parent_comment_id" "uuid",
    "is_question" boolean DEFAULT false,
    "is_offer" boolean DEFAULT false,
    "offer_amount" numeric,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);

ALTER TABLE ONLY "public"."marketplace_comments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."marketplace_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketplace_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "price" numeric,
    "condition" "text",
    "listing_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_featured" boolean DEFAULT false,
    "views_count" integer DEFAULT 0,
    "location" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);

ALTER TABLE ONLY "public"."marketplace_listings" REPLICA IDENTITY FULL;


ALTER TABLE "public"."marketplace_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketplace_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "saved_searches" "jsonb" DEFAULT '[]'::"jsonb",
    "keywords" "jsonb" DEFAULT '[]'::"jsonb",
    "geographic_preferences" "jsonb" DEFAULT '{"location": null, "radius_km": 50}'::"jsonb",
    "notification_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."marketplace_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketplace_saved_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "notification_preferences" "jsonb" DEFAULT '{"offers": true, "comments": false, "price_drop": true}'::"jsonb"
);


ALTER TABLE "public"."marketplace_saved_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "full_name" "text",
    "avatar_url" "text",
    "user_type" "public"."user_type" DEFAULT 'viewer'::"public"."user_type",
    "reputation_score" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "social_links" "jsonb" DEFAULT '{}'::"jsonb",
    "streaming_links" "jsonb" DEFAULT '{}'::"jsonb",
    "home_location" "jsonb" DEFAULT '{"lat": 40.7128, "lng": -74.0060}'::"jsonb",
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "skills" "text"[] DEFAULT '{}'::"text"[],
    "first_name" "text",
    "last_name" "text",
    "email" "text",
    "active_garage_id" "uuid",
    "default_garage_id" "uuid",
    "bio" "text" DEFAULT ''::"text",
    "ai_analysis" "jsonb"
);

ALTER TABLE ONLY "public"."profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_collaborators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."project_collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "assigned_to" "uuid",
    "due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."project_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "update_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."project_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'active'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "start_date" timestamp with time zone,
    "target_completion_date" timestamp with time zone,
    "actual_completion_date" timestamp with time zone,
    "budget" numeric,
    "current_spend" numeric DEFAULT 0,
    "vehicle_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "social_media_schedule" "jsonb" DEFAULT '{}'::"jsonb",
    "sponsorship_data" "jsonb" DEFAULT '{}'::"jsonb",
    "client_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposal_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "proposal_id" "uuid",
    "voter_id" "uuid",
    "vote_amount" numeric(78,0) NOT NULL,
    "vote_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."proposal_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realtime_video_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "segment_data" "bytea" NOT NULL,
    "segment_number" integer NOT NULL,
    "timestamp_start" timestamp with time zone NOT NULL,
    "timestamp_end" timestamp with time zone NOT NULL,
    "processed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."realtime_video_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "path" "text" NOT NULL,
    "action" character varying(255) NOT NULL,
    "requires_auth" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "title" "text" NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "show_toast" boolean DEFAULT false
);


ALTER TABLE "public"."routes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "technician_notes" "text",
    "service_date" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "completion_date" timestamp with time zone,
    "service_type" "public"."service_type",
    "parts_used" "jsonb" DEFAULT '[]'::"jsonb",
    "labor_hours" numeric DEFAULT 0,
    "diagnostic_results" "text",
    CONSTRAINT "service_tickets_labor_hours_check" CHECK (("labor_hours" >= (0)::numeric))
);


ALTER TABLE "public"."service_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid",
    "email" "text" NOT NULL,
    "role" "public"."shop_role" DEFAULT 'staff'::"public"."shop_role" NOT NULL,
    "invited_by" "uuid",
    "token" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text"
);


ALTER TABLE "public"."shop_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid",
    "user_id" "uuid",
    "role" "public"."shop_role" DEFAULT 'staff'::"public"."shop_role" NOT NULL,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "invited_by" "uuid",
    "invited_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "joined_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."shop_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "contact_info" "jsonb" DEFAULT '{}'::"jsonb",
    "business_hours" "jsonb" DEFAULT '{}'::"jsonb",
    "location" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "verification_status" "text" DEFAULT 'pending'::"text",
    "business_type" "text",
    "logo_url" "text"
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "public"."skill_category" NOT NULL,
    "prerequisites" "uuid"[] DEFAULT '{}'::"uuid"[],
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stream_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);

ALTER TABLE ONLY "public"."stream_comments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."stream_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stream_tips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);

ALTER TABLE ONLY "public"."stream_tips" REPLICA IDENTITY FULL;


ALTER TABLE "public"."stream_tips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."streaming_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text",
    "is_live" boolean DEFAULT false,
    "started_at" timestamp with time zone DEFAULT "now"(),
    "ended_at" timestamp with time zone,
    "session_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."streaming_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_configurations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "camera_config" "jsonb" DEFAULT '{}'::"jsonb",
    "audio_config" "jsonb" DEFAULT '{}'::"jsonb",
    "lighting_config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "workspace_dimensions" "jsonb" DEFAULT '{"width": 0, "height": 0, "length": 0}'::"jsonb",
    "ptz_configurations" "jsonb" DEFAULT '{"planes": {"walls": [], "ceiling": {}}, "tracks": [], "roboticArms": []}'::"jsonb",
    "fixed_cameras" "jsonb" DEFAULT '{"positions": []}'::"jsonb"
);


ALTER TABLE "public"."studio_configurations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."studio_configurations"."workspace_dimensions" IS 'Stores the workspace dimensions in feet: {"length": 30, "width": 20, "height": 16}';



COMMENT ON COLUMN "public"."studio_configurations"."ptz_configurations" IS 'Stores PTZ camera configurations including track positions and plane definitions';



COMMENT ON COLUMN "public"."studio_configurations"."fixed_cameras" IS 'Stores fixed camera positions and their purposes (workbench, lift, podcast)';



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "contact_info" "jsonb",
    "api_credentials" "jsonb" DEFAULT '{}'::"jsonb",
    "integration_type" "text",
    "status" "text" DEFAULT 'active'::"text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "member_type" "public"."team_member_type" NOT NULL,
    "department" "text",
    "position" "text",
    "start_date" timestamp with time zone DEFAULT "now"(),
    "end_date" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."team_members"."status" IS 'Status of the team member (active, inactive, etc.)';



CREATE TABLE IF NOT EXISTS "public"."test_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" NOT NULL,
    "description" "text",
    "test_code" "text" NOT NULL,
    "status" "public"."test_status" DEFAULT 'pending'::"public"."test_status",
    "execution_count" integer DEFAULT 0,
    "last_execution_time" timestamp with time zone,
    "success_rate" double precision DEFAULT 0.0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tags" "text"[] DEFAULT ARRAY[]::"text"[],
    "complexity_score" double precision DEFAULT 0.0,
    "generated_by" "text" DEFAULT 'ai'::"text",
    "is_active" boolean DEFAULT true,
    "priority" integer DEFAULT 1
);


ALTER TABLE "public"."test_cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "test_case_id" "uuid",
    "status" "public"."test_status" NOT NULL,
    "execution_time" double precision,
    "error_message" "text",
    "stack_trace" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "environment_info" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."test_executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "token_id" "uuid",
    "price_usd" numeric(20,8),
    "volume_24h" numeric(20,8),
    "market_cap" numeric(20,8),
    "timestamp" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."token_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_holdings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "token_id" "uuid",
    "balance" numeric DEFAULT 0 NOT NULL,
    "last_transaction_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."token_holdings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_management" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "token_symbol" "text" NOT NULL,
    "token_name" "text" NOT NULL,
    "total_supply" numeric DEFAULT 0 NOT NULL,
    "decimals" integer DEFAULT 18 NOT NULL,
    "contract_address" "text",
    "network" "text" DEFAULT 'testnet'::"text" NOT NULL,
    "token_type" "text" DEFAULT 'erc20'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."token_management" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "token_id" "uuid",
    "from_address" "text",
    "to_address" "text",
    "amount" numeric(78,0) NOT NULL,
    "transaction_hash" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."token_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text" NOT NULL,
    "symbol" "text" NOT NULL,
    "description" "text",
    "total_supply" numeric(78,0) NOT NULL,
    "decimals" integer DEFAULT 18 NOT NULL,
    "contract_address" "text",
    "owner_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'active'::"text"
);


ALTER TABLE "public"."tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "achievement_type" "text" NOT NULL,
    "achievement_data" "jsonb" DEFAULT '{}'::"jsonb",
    "earned_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "category" "text",
    "skills" "text"[],
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."user_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "certification_id" "uuid",
    "status" "public"."certification_status" DEFAULT 'pending'::"public"."certification_status",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "evidence_urls" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_content_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "preferred_types" "text"[] DEFAULT '{}'::"text"[],
    "preferred_tags" "text"[] DEFAULT '{}'::"text"[],
    "preferred_locations" "text"[] DEFAULT '{}'::"text"[],
    "preferred_technical_level" integer DEFAULT 5,
    "view_history" "jsonb" DEFAULT '[]'::"jsonb",
    "interaction_history" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_content_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "interaction_type" "text" NOT NULL,
    "interaction_data" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "notifications_enabled" boolean DEFAULT true,
    "auto_save_enabled" boolean DEFAULT true,
    "compact_view_enabled" boolean DEFAULT false,
    "theme" "text" DEFAULT 'system'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "distance_unit" "text" DEFAULT 'miles'::"text",
    "currency" "text" DEFAULT 'USD'::"text",
    "default_garage_view" "text" DEFAULT 'list'::"text",
    "service_reminders_enabled" boolean DEFAULT true,
    "inventory_alerts_enabled" boolean DEFAULT true,
    "price_alerts_enabled" boolean DEFAULT true,
    "primary_color" "text",
    "secondary_color" "text",
    "accent_color" "text",
    "font_family" "text",
    "font_size" "text",
    CONSTRAINT "user_preferences_currency_check" CHECK (("currency" = ANY (ARRAY['USD'::"text", 'EUR'::"text", 'GBP'::"text", 'CAD'::"text", 'AUD'::"text"]))),
    CONSTRAINT "user_preferences_default_garage_view_check" CHECK (("default_garage_view" = ANY (ARRAY['list'::"text", 'grid'::"text", 'map'::"text"]))),
    CONSTRAINT "user_preferences_distance_unit_check" CHECK (("distance_unit" = ANY (ARRAY['miles'::"text", 'kilometers'::"text"])))
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" DEFAULT 'user'::"public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "session_type" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "last_action" "text",
    "action_timestamp" timestamp with time zone DEFAULT "now"(),
    "action_result" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."user_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "skill_id" "uuid",
    "level" integer DEFAULT 1,
    "experience_points" integer DEFAULT 0,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_engagement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "views_count" integer DEFAULT 0,
    "saves_count" integer DEFAULT 0,
    "interested_users_count" integer DEFAULT 0,
    "last_viewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_engagement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_date" timestamp with time zone,
    "description" "text",
    "documentation_urls" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "car_id" "uuid",
    "user_id" "uuid",
    "file_path" "text" NOT NULL,
    "public_url" "text",
    "file_name" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "image_type" "text",
    "source" "text" DEFAULT 'supabase'::"text",
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "issue_type" "text" NOT NULL,
    "description" "text",
    "severity" integer,
    "reported_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_issues_severity_check" CHECK ((("severity" >= 1) AND ("severity" <= 5)))
);


ALTER TABLE "public"."vehicle_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_market_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "price_history" "jsonb" DEFAULT '[]'::"jsonb",
    "similar_sales" "jsonb" DEFAULT '[]'::"jsonb",
    "parts_availability" "text",
    "market_trends" "jsonb",
    "last_updated" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_market_data_parts_availability_check" CHECK (("parts_availability" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))
);


ALTER TABLE "public"."vehicle_market_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_probability_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_bounds" "jsonb" NOT NULL,
    "vehicle_type" "text" NOT NULL,
    "probability_score" double precision NOT NULL,
    "estimated_count" integer NOT NULL,
    "confidence_level" double precision NOT NULL,
    "data_sources" "jsonb" NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "search_query" "text" NOT NULL,
    "year_range" "int4range"
);


ALTER TABLE "public"."vehicle_probability_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_sales_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "source" character varying NOT NULL,
    "sale_date" timestamp with time zone,
    "sale_price" numeric(12,2),
    "listing_url" "text",
    "image_url" "text",
    "description" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."vehicle_sales_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_timeline_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "event_type" character varying(50) NOT NULL,
    "source" character varying(100) NOT NULL,
    "event_date" timestamp with time zone NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "confidence_score" integer NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "source_url" "text",
    "image_urls" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_timeline_events_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 100)))
);


ALTER TABLE "public"."vehicle_timeline_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "token_address" "text" NOT NULL,
    "total_supply" numeric NOT NULL,
    "current_price" numeric,
    "contract_uri" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."vehicle_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year" integer NOT NULL,
    "vin" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vin_image_url" "text",
    "vin_processing_status" "text" DEFAULT 'pending'::"text",
    "vin_verification_data" "jsonb",
    "bulk_upload_batch_id" "uuid",
    "historical_data" "jsonb",
    "location" "jsonb",
    "status" "text" DEFAULT 'owned'::"text",
    "source" "text",
    "source_url" "text",
    "icloud_album_link" "text",
    "icloud_folder_id" "text",
    "trim" "text",
    "body_type" "text",
    "engine_type" "text",
    "transmission" "text",
    "drivetrain" "text",
    "vehicle_type" "text" DEFAULT 'car'::"text" NOT NULL,
    "market_value" numeric,
    "price_trend" "text",
    "condition_rating" integer,
    "condition_description" "text",
    "restoration_status" "text",
    "era" "text",
    "special_edition" boolean DEFAULT false,
    "rarity_score" integer,
    "relevance_score" numeric DEFAULT 50.0,
    "ownership_status" "text" DEFAULT 'unclaimed'::"text",
    "public_vehicle" boolean DEFAULT false,
    "owner_id" "uuid",
    "added" timestamp with time zone DEFAULT "now"(),
    "purchase_date" timestamp with time zone,
    "color" "text",
    "license_plate" "text",
    "mileage" integer,
    "purchase_price" numeric,
    "purchase_location" "text",
    "condition" "text",
    CONSTRAINT "vehicles_condition_rating_check" CHECK ((("condition_rating" >= 1) AND ("condition_rating" <= 10))),
    CONSTRAINT "vehicles_price_trend_check" CHECK (("price_trend" = ANY (ARRAY['up'::"text", 'down'::"text", 'stable'::"text"]))),
    CONSTRAINT "vehicles_rarity_score_check" CHECK ((("rarity_score" >= 1) AND ("rarity_score" <= 10))),
    CONSTRAINT "vehicles_restoration_status_check" CHECK (("restoration_status" = ANY (ARRAY['original'::"text", 'restored'::"text", 'modified'::"text", 'project'::"text"]))),
    CONSTRAINT "vehicles_status_check" CHECK (("status" = ANY (ARRAY['owned'::"text", 'rental'::"text", 'project'::"text", 'watchlist'::"text", 'for_sale'::"text"]))),
    CONSTRAINT "vehicles_year_check" CHECK ((("year" >= 1900) AND ("year" <= (("date_part"('year'::"text", CURRENT_DATE))::integer + 1))))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verified_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "building" "text",
    "floor" "text",
    "room" "text",
    "shelf" "text",
    "bin" "text",
    "status" "public"."location_status" DEFAULT 'pending'::"public"."location_status",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "approved_by" "uuid"
);


ALTER TABLE "public"."verified_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_analysis_contributions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "label_count" integer DEFAULT 0 NOT NULL,
    "labels" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."video_analysis_contributions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_analysis_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "timestamp_start" interval,
    "timestamp_end" interval,
    "object_type" "text",
    "confidence_score" double precision,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "normalized_data" "jsonb" DEFAULT '{}'::"jsonb",
    "classification_labels" "text"[],
    "spatial_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."video_analysis_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "video_url" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "processing_started_at" timestamp with time zone,
    "processing_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "streaming_analysis" boolean DEFAULT false,
    "stream_id" "uuid"
);


ALTER TABLE "public"."video_processing_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vin_processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "total_vins" integer DEFAULT 0 NOT NULL,
    "processed_vins" integer DEFAULT 0 NOT NULL,
    "failed_vins" integer DEFAULT 0 NOT NULL,
    "batch_data" "jsonb"
);


ALTER TABLE "public"."vin_processing_jobs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agent_actions"
    ADD CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_agents"
    ADD CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_explanations"
    ADD CONSTRAINT "ai_explanations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."algorithm_preferences"
    ADD CONSTRAINT "algorithm_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_comments"
    ADD CONSTRAINT "auction_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automotive_locations"
    ADD CONSTRAINT "automotive_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."captures"
    ADD CONSTRAINT "captures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certifications"
    ADD CONSTRAINT "certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_analytics"
    ADD CONSTRAINT "content_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_interactions"
    ADD CONSTRAINT "content_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_schedules"
    ADD CONSTRAINT "content_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dao_proposals"
    ADD CONSTRAINT "dao_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dao_votes"
    ADD CONSTRAINT "dao_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dao_votes"
    ADD CONSTRAINT "dao_votes_proposal_id_user_id_key" UNIQUE ("proposal_id", "user_id");



ALTER TABLE ONLY "public"."derivatives"
    ADD CONSTRAINT "derivatives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."development_goals"
    ADD CONSTRAINT "development_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovered_vehicles"
    ADD CONSTRAINT "discovered_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."explore_content"
    ADD CONSTRAINT "explore_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_interactions"
    ADD CONSTRAINT "feed_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_user_id_garage_id_key" UNIQUE ("user_id", "garage_id");



ALTER TABLE ONLY "public"."garages"
    ADD CONSTRAINT "garages_google_place_id_key" UNIQUE ("google_place_id");



ALTER TABLE ONLY "public"."garages"
    ADD CONSTRAINT "garages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_proposals"
    ADD CONSTRAINT "governance_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_streams"
    ADD CONSTRAINT "live_streams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_streams"
    ADD CONSTRAINT "live_streams_stream_key_key" UNIQUE ("stream_key");



ALTER TABLE ONLY "public"."marketplace_comments"
    ADD CONSTRAINT "marketplace_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketplace_preferences"
    ADD CONSTRAINT "marketplace_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketplace_saved_listings"
    ADD CONSTRAINT "marketplace_saved_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketplace_saved_listings"
    ADD CONSTRAINT "marketplace_saved_listings_user_id_listing_id_key" UNIQUE ("user_id", "listing_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_unique" UNIQUE ("username");



ALTER TABLE ONLY "public"."project_collaborators"
    ADD CONSTRAINT "project_collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_collaborators"
    ADD CONSTRAINT "project_collaborators_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_votes"
    ADD CONSTRAINT "proposal_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realtime_video_segments"
    ADD CONSTRAINT "realtime_video_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_action_key" UNIQUE ("action");



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."routes"
    ADD CONSTRAINT "routes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_tickets"
    ADD CONSTRAINT "service_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_invitations"
    ADD CONSTRAINT "shop_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_invitations"
    ADD CONSTRAINT "shop_invitations_shop_id_email_key" UNIQUE ("shop_id", "email");



ALTER TABLE ONLY "public"."shop_invitations"
    ADD CONSTRAINT "shop_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_shop_id_user_id_key" UNIQUE ("shop_id", "user_id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stream_comments"
    ADD CONSTRAINT "stream_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stream_tips"
    ADD CONSTRAINT "stream_tips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."streaming_sessions"
    ADD CONSTRAINT "streaming_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_configurations"
    ADD CONSTRAINT "studio_configurations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_cases"
    ADD CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_executions"
    ADD CONSTRAINT "test_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_analytics"
    ADD CONSTRAINT "token_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_holdings"
    ADD CONSTRAINT "token_holdings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_management"
    ADD CONSTRAINT "token_management_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_transactions"
    ADD CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tokens"
    ADD CONSTRAINT "tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_holdings"
    ADD CONSTRAINT "unique_user_token" UNIQUE ("user_id", "token_id");



ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_certifications"
    ADD CONSTRAINT "user_certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_content_preferences"
    ADD CONSTRAINT "user_content_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_interactions"
    ADD CONSTRAINT "user_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."user_sessions"
    ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_user_id_skill_id_key" UNIQUE ("user_id", "skill_id");



ALTER TABLE ONLY "public"."vehicle_engagement"
    ADD CONSTRAINT "vehicle_engagement_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_history"
    ADD CONSTRAINT "vehicle_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_issues"
    ADD CONSTRAINT "vehicle_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_market_data"
    ADD CONSTRAINT "vehicle_market_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_probability_zones"
    ADD CONSTRAINT "vehicle_probability_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_sales_data"
    ADD CONSTRAINT "vehicle_sales_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_timeline_events"
    ADD CONSTRAINT "vehicle_timeline_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_tokens"
    ADD CONSTRAINT "vehicle_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verified_locations"
    ADD CONSTRAINT "verified_locations_building_floor_room_shelf_bin_key" UNIQUE ("building", "floor", "room", "shelf", "bin");



ALTER TABLE ONLY "public"."verified_locations"
    ADD CONSTRAINT "verified_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_analysis_contributions"
    ADD CONSTRAINT "video_analysis_contributions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_analysis_results"
    ADD CONSTRAINT "video_analysis_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_processing_jobs"
    ADD CONSTRAINT "video_processing_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vin_processing_jobs"
    ADD CONSTRAINT "vin_processing_jobs_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_ai_explanations_created_at" ON "public"."ai_explanations" USING "btree" ("created_at");



CREATE INDEX "idx_ai_explanations_question" ON "public"."ai_explanations" USING "btree" ("question");



CREATE INDEX "idx_engagement_metrics_created_at" ON "public"."engagement_metrics" USING "btree" ("created_at");



CREATE INDEX "idx_engagement_metrics_feed_item" ON "public"."engagement_metrics" USING "btree" ("content_id");



CREATE INDEX "idx_engagement_metrics_user" ON "public"."engagement_metrics" USING "btree" ("user_id");



CREATE INDEX "idx_engagement_metrics_user_id" ON "public"."engagement_metrics" USING "btree" ("user_id");



CREATE INDEX "idx_feed_items_relevance" ON "public"."feed_items" USING "btree" ("relevance_score" DESC, "created_at" DESC);



CREATE INDEX "idx_feed_items_user" ON "public"."feed_items" USING "btree" ("user_id");



CREATE INDEX "idx_feed_items_user_id" ON "public"."feed_items" USING "btree" ("user_id");



CREATE INDEX "idx_garage_members_user_garage" ON "public"."garage_members" USING "btree" ("user_id", "garage_id");



CREATE INDEX "idx_inventory_items_integration" ON "public"."inventory_items" USING "btree" ("integration_source", "integration_id");



CREATE INDEX "idx_inventory_items_sku" ON "public"."inventory_items" USING "btree" ("sku");



CREATE INDEX "idx_inventory_items_user_id" ON "public"."inventory_items" USING "btree" ("user_id");



CREATE INDEX "idx_realtime_segments_job_id" ON "public"."realtime_video_segments" USING "btree" ("job_id");



CREATE INDEX "idx_service_tickets_vehicle_id" ON "public"."service_tickets" USING "btree" ("vehicle_id");



CREATE INDEX "idx_service_tickets_vehicle_user" ON "public"."service_tickets" USING "btree" ("vehicle_id", "user_id");



CREATE INDEX "idx_suppliers_integration" ON "public"."suppliers" USING "btree" ("integration_type");



CREATE INDEX "idx_test_cases_priority" ON "public"."test_cases" USING "btree" ("priority");



CREATE INDEX "idx_test_cases_status" ON "public"."test_cases" USING "btree" ("status");



CREATE INDEX "idx_test_executions_test_case_id" ON "public"."test_executions" USING "btree" ("test_case_id");



CREATE INDEX "idx_token_management_user_id" ON "public"."token_management" USING "btree" ("user_id");



CREATE INDEX "idx_vehicle_probability_zones_location" ON "public"."vehicle_probability_zones" USING "gin" ("location_bounds" "jsonb_path_ops");



CREATE INDEX "idx_vehicle_probability_zones_vehicle_type" ON "public"."vehicle_probability_zones" USING "btree" ("vehicle_type");



CREATE INDEX "idx_vehicle_sales_source_date" ON "public"."vehicle_sales_data" USING "btree" ("source", "sale_date");



CREATE INDEX "idx_vehicle_sales_vehicle_id" ON "public"."vehicle_sales_data" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicles_condition" ON "public"."vehicles" USING "btree" ("condition_rating");



CREATE INDEX "idx_vehicles_historical_data" ON "public"."vehicles" USING "gin" ("historical_data");



CREATE INDEX "idx_vehicles_market_value" ON "public"."vehicles" USING "btree" ("market_value");



CREATE INDEX "idx_vehicles_owner_id" ON "public"."vehicles" USING "btree" ("owner_id");



CREATE INDEX "idx_vehicles_rarity" ON "public"."vehicles" USING "btree" ("rarity_score");



CREATE INDEX "idx_vehicles_type_year" ON "public"."vehicles" USING "btree" ("vehicle_type", "year");



CREATE INDEX "idx_vehicles_user_id" ON "public"."vehicles" USING "btree" ("user_id");



CREATE INDEX "idx_vehicles_vin" ON "public"."vehicles" USING "btree" ("vin");



CREATE INDEX "idx_video_jobs_stream_id" ON "public"."video_processing_jobs" USING "btree" ("stream_id");



CREATE INDEX "realtime_video_segments_job_segment_idx" ON "public"."realtime_video_segments" USING "btree" ("job_id", "segment_number");



CREATE INDEX "vehicle_timeline_events_event_date_idx" ON "public"."vehicle_timeline_events" USING "btree" ("event_date");



CREATE INDEX "vehicle_timeline_events_vehicle_id_idx" ON "public"."vehicle_timeline_events" USING "btree" ("vehicle_id");



CREATE INDEX "vehicles_owner_id_idx" ON "public"."vehicles" USING "btree" ("owner_id");



CREATE INDEX "video_analysis_contributions_date_idx" ON "public"."video_analysis_contributions" USING "btree" ("date");



CREATE INDEX "video_analysis_contributions_user_date_idx" ON "public"."video_analysis_contributions" USING "btree" ("user_id", "date");



CREATE INDEX "video_processing_jobs_stream_id_idx" ON "public"."video_processing_jobs" USING "btree" ("stream_id");



CREATE OR REPLACE TRIGGER "feed_item_relevance_update" BEFORE INSERT OR UPDATE ON "public"."feed_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_feed_item_relevance"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."auction_comments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."automotive_locations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."certifications" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."development_goals" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."feed_items" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."project_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."user_certifications" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."user_skills" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."verified_locations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."video_analysis_contributions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "marketplace_listings_updated_at" BEFORE UPDATE ON "public"."marketplace_listings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_marketplace_updated_at"();



CREATE OR REPLACE TRIGGER "on_content_interaction" AFTER INSERT ON "public"."content_interactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_preferences_on_interaction"();



CREATE OR REPLACE TRIGGER "on_garage_created" AFTER INSERT ON "public"."garages" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_garage"();



CREATE OR REPLACE TRIGGER "set_timestamp" BEFORE UPDATE ON "public"."token_management" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_timestamp" BEFORE UPDATE ON "public"."vehicle_timeline_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "set_vehicle_owner_trigger" BEFORE INSERT ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."set_vehicle_owner"();



CREATE OR REPLACE TRIGGER "shop_members_update_timestamp" BEFORE UPDATE ON "public"."shop_members" FOR EACH ROW EXECUTE FUNCTION "public"."handle_shop_member_updates"();



CREATE OR REPLACE TRIGGER "shops_update_timestamp" BEFORE UPDATE ON "public"."shops" FOR EACH ROW EXECUTE FUNCTION "public"."handle_shop_updates"();



CREATE OR REPLACE TRIGGER "update_achievements_updated_at" BEFORE UPDATE ON "public"."user_achievements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_discovered_vehicles_updated_at" BEFORE UPDATE ON "public"."discovered_vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "update_video_processing_jobs_updated_at" BEFORE UPDATE ON "public"."video_processing_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."agent_actions"
    ADD CONSTRAINT "agent_actions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id");



ALTER TABLE ONLY "public"."ai_agents"
    ADD CONSTRAINT "ai_agents_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."algorithm_preferences"
    ADD CONSTRAINT "algorithm_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id");



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."auction_comments"
    ADD CONSTRAINT "auction_comments_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_comments"
    ADD CONSTRAINT "auction_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."auction_comments"("id");



ALTER TABLE ONLY "public"."auction_comments"
    ADD CONSTRAINT "auction_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."content_analytics"
    ADD CONSTRAINT "content_analytics_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content_schedules"("id");



ALTER TABLE ONLY "public"."content_interactions"
    ADD CONSTRAINT "content_interactions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."explore_content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_interactions"
    ADD CONSTRAINT "content_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_schedules"
    ADD CONSTRAINT "content_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dao_proposals"
    ADD CONSTRAINT "dao_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dao_votes"
    ADD CONSTRAINT "dao_votes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."dao_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dao_votes"
    ADD CONSTRAINT "dao_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."derivatives"
    ADD CONSTRAINT "derivatives_vehicle_token_id_fkey" FOREIGN KEY ("vehicle_token_id") REFERENCES "public"."vehicle_tokens"("id");



ALTER TABLE ONLY "public"."development_goals"
    ADD CONSTRAINT "development_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovered_vehicles"
    ADD CONSTRAINT "discovered_vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_feed_item_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."feed_items"("id");



ALTER TABLE ONLY "public"."engagement_metrics"
    ADD CONSTRAINT "engagement_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."explore_content"
    ADD CONSTRAINT "explore_content_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."feed_interactions"
    ADD CONSTRAINT "feed_interactions_feed_item_id_fkey" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_interactions"
    ADD CONSTRAINT "feed_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."governance_proposals"
    ADD CONSTRAINT "governance_proposals_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."governance_proposals"
    ADD CONSTRAINT "governance_proposals_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."live_streams"
    ADD CONSTRAINT "live_streams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."marketplace_comments"
    ADD CONSTRAINT "marketplace_comments_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_comments"
    ADD CONSTRAINT "marketplace_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."marketplace_comments"("id");



ALTER TABLE ONLY "public"."marketplace_comments"
    ADD CONSTRAINT "marketplace_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_preferences"
    ADD CONSTRAINT "marketplace_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_saved_listings"
    ADD CONSTRAINT "marketplace_saved_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_saved_listings"
    ADD CONSTRAINT "marketplace_saved_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_active_garage_id_fkey" FOREIGN KEY ("active_garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_default_garage_id_fkey" FOREIGN KEY ("default_garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_collaborators"
    ADD CONSTRAINT "project_collaborators_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."project_collaborators"
    ADD CONSTRAINT "project_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_assigned_user_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."proposal_votes"
    ADD CONSTRAINT "proposal_votes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."governance_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_votes"
    ADD CONSTRAINT "proposal_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."realtime_video_segments"
    ADD CONSTRAINT "realtime_video_segments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."video_processing_jobs"("id");



ALTER TABLE ONLY "public"."service_tickets"
    ADD CONSTRAINT "service_tickets_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."service_tickets"
    ADD CONSTRAINT "service_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."service_tickets"
    ADD CONSTRAINT "service_tickets_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."service_tickets"
    ADD CONSTRAINT "service_tickets_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."shop_invitations"
    ADD CONSTRAINT "shop_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shop_invitations"
    ADD CONSTRAINT "shop_invitations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stream_comments"
    ADD CONSTRAINT "stream_comments_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."live_streams"("id");



ALTER TABLE ONLY "public"."stream_comments"
    ADD CONSTRAINT "stream_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stream_tips"
    ADD CONSTRAINT "stream_tips_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stream_tips"
    ADD CONSTRAINT "stream_tips_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stream_tips"
    ADD CONSTRAINT "stream_tips_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."live_streams"("id");



ALTER TABLE ONLY "public"."streaming_sessions"
    ADD CONSTRAINT "streaming_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."studio_configurations"
    ADD CONSTRAINT "studio_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_executions"
    ADD CONSTRAINT "test_executions_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id");



ALTER TABLE ONLY "public"."token_analytics"
    ADD CONSTRAINT "token_analytics_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_holdings"
    ADD CONSTRAINT "token_holdings_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."token_management"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_holdings"
    ADD CONSTRAINT "token_holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."token_management"
    ADD CONSTRAINT "token_management_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_transactions"
    ADD CONSTRAINT "token_transactions_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tokens"
    ADD CONSTRAINT "tokens_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_certifications"
    ADD CONSTRAINT "user_certifications_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "public"."certifications"("id");



ALTER TABLE ONLY "public"."user_certifications"
    ADD CONSTRAINT "user_certifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_content_preferences"
    ADD CONSTRAINT "user_content_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_interactions"
    ADD CONSTRAINT "user_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_sessions"
    ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_engagement"
    ADD CONSTRAINT "vehicle_engagement_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicle_history"
    ADD CONSTRAINT "vehicle_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_images"
    ADD CONSTRAINT "vehicle_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_issues"
    ADD CONSTRAINT "vehicle_issues_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicle_market_data"
    ADD CONSTRAINT "vehicle_market_data_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicle_sales_data"
    ADD CONSTRAINT "vehicle_sales_data_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicle_tokens"
    ADD CONSTRAINT "vehicle_tokens_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."verified_locations"
    ADD CONSTRAINT "verified_locations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."verified_locations"
    ADD CONSTRAINT "verified_locations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."video_analysis_contributions"
    ADD CONSTRAINT "video_analysis_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_analysis_results"
    ADD CONSTRAINT "video_analysis_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."video_processing_jobs"("id");



ALTER TABLE ONLY "public"."video_processing_jobs"
    ADD CONSTRAINT "video_processing_jobs_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "public"."live_streams"("id");



ALTER TABLE ONLY "public"."video_processing_jobs"
    ADD CONSTRAINT "video_processing_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vin_processing_jobs"
    ADD CONSTRAINT "vin_processing_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Admins can manage team members" ON "public"."team_members" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"public"."app_role")))));



CREATE POLICY "Allow all users to read explanations" ON "public"."ai_explanations" FOR SELECT USING (true);



CREATE POLICY "Allow authenticated users CRUD on own images" ON "public"."vehicle_images" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow authenticated users full CRUD on own vehicles" ON "public"."vehicles" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow authenticated users to create explanations" ON "public"."ai_explanations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to create marketplace comments" ON "public"."marketplace_comments" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Allow authorized users to insert timeline events" ON "public"."vehicle_timeline_events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow insert/update access to service role for test_cases" ON "public"."test_cases" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow insert/update access to service role for test_executions" ON "public"."test_executions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow public read access" ON "public"."vehicle_probability_zones" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to feed items" ON "public"."feed_items" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to marketplace comments" ON "public"."marketplace_comments" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to marketplace listings" ON "public"."marketplace_listings" FOR SELECT USING (true);



CREATE POLICY "Allow public read access to profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Allow public read of timeline events" ON "public"."vehicle_timeline_events" FOR SELECT USING (true);



CREATE POLICY "Allow read access to all authenticated users for test_cases" ON "public"."test_cases" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read access to all authenticated users for test_execution" ON "public"."test_executions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow reading automotive_locations" ON "public"."automotive_locations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow users to create their own marketplace listings" ON "public"."marketplace_listings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to delete their own marketplace comments" ON "public"."marketplace_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to delete their own marketplace listings" ON "public"."marketplace_listings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to manage their marketplace preferences" ON "public"."marketplace_preferences" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to manage their saved listings" ON "public"."marketplace_saved_listings" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to update their own marketplace comments" ON "public"."marketplace_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow users to update their own marketplace listings" ON "public"."marketplace_listings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow vehicle owners to update their timeline events" ON "public"."vehicle_timeline_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vehicles" "v"
  WHERE (("v"."id" = "vehicle_timeline_events"."vehicle_id") AND ("v"."user_id" = "auth"."uid"())))));



CREATE POLICY "Anyone can read routes" ON "public"."routes" FOR SELECT USING (true);



CREATE POLICY "Anyone can view live streams" ON "public"."live_streams" FOR SELECT USING (true);



CREATE POLICY "Anyone can view skills" ON "public"."skills" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Anyone can view stream comments" ON "public"."stream_comments" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can comment" ON "public"."stream_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can insert content" ON "public"."explore_content" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can send tips" ON "public"."stream_tips" FOR INSERT WITH CHECK (("auth"."uid"() = "sender_id"));



CREATE POLICY "Authenticated users can view basic profile info" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Certifications are viewable by everyone" ON "public"."certifications" FOR SELECT USING (true);



CREATE POLICY "Collaborators can update projects" ON "public"."projects" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Enable insert for authenticated users" ON "public"."auction_bids" FOR INSERT WITH CHECK (("auth"."uid"() = "bidder_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."auction_comments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."auctions" FOR INSERT WITH CHECK (("auth"."uid"() = "seller_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."automotive_locations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users" ON "public"."dao_proposals" FOR INSERT WITH CHECK (("auth"."uid"() = "proposer_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."governance_proposals" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "creator_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."proposal_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "voter_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."service_tickets" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users" ON "public"."tokens" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."verified_locations" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Enable read access for all authenticated users" ON "public"."governance_proposals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all authenticated users" ON "public"."proposal_votes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all authenticated users" ON "public"."token_analytics" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all authenticated users" ON "public"."token_transactions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all authenticated users" ON "public"."tokens" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."auction_bids" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."auction_comments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."auctions" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."automotive_locations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."dao_proposals" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."derivatives" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."vehicle_tokens" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."verified_locations" FOR SELECT USING (true);



CREATE POLICY "Enable read access for authenticated users" ON "public"."service_tickets" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable token creation for authenticated users" ON "public"."tokens" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Enable token deletion for owners" ON "public"."tokens" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Enable token reading for all authenticated users" ON "public"."tokens" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable token updates for owners" ON "public"."tokens" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "owner_id")) WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Enable update for admin users" ON "public"."verified_locations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"public"."app_role", 'system_admin'::"public"."app_role", 'business_admin'::"public"."app_role"]))))));



CREATE POLICY "Enable update for comment owner" ON "public"."auction_comments" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable update for creators" ON "public"."governance_proposals" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "creator_id")) WITH CHECK (("auth"."uid"() = "creator_id"));



CREATE POLICY "Enable update for owners" ON "public"."tokens" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "owner_id")) WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Enable update for users based on id" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Everyone can view content" ON "public"."explore_content" FOR SELECT USING (true);



CREATE POLICY "Explanations are publicly readable" ON "public"."ai_explanations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Feed interactions are viewable by everyone" ON "public"."feed_interactions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Feed items are viewable by all authenticated users" ON "public"."feed_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Feed items are viewable by everyone" ON "public"."feed_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Garage admins can add members" ON "public"."garage_members" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "garage_members"."garage_id") AND ("gm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['system_admin'::"public"."app_role", 'business_admin'::"public"."app_role"])))))));



CREATE POLICY "Garage admins can manage members" ON "public"."garage_members" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "garage_members"."garage_id") AND ("gm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['system_admin'::"public"."app_role", 'business_admin'::"public"."app_role"])))))));



CREATE POLICY "Garage admins can view their garages" ON "public"."garages" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "garages"."id") AND ("gm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['system_admin'::"public"."app_role", 'business_admin'::"public"."app_role"])))))));



CREATE POLICY "Garage admins can view their members" ON "public"."garage_members" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "garage_members"."garage_id") AND ("gm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['system_admin'::"public"."app_role", 'business_admin'::"public"."app_role"])))))));



CREATE POLICY "Only admins can insert/update/delete roles" ON "public"."user_roles" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "user_roles_1"
  WHERE (("user_roles_1"."user_id" = "auth"."uid"()) AND ("user_roles_1"."role" = 'admin'::"public"."app_role")))));



CREATE POLICY "Only owners and co-founders can manage invitations" ON "public"."shop_invitations" USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members"
  WHERE (("shop_members"."shop_id" = "shop_invitations"."shop_id") AND ("shop_members"."user_id" = "auth"."uid"()) AND ("shop_members"."role" = ANY (ARRAY['owner'::"public"."shop_role", 'co-founder'::"public"."shop_role"]))))));



CREATE POLICY "Only owners and co-founders can manage shop members" ON "public"."shop_members" USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members" "shop_members_1"
  WHERE (("shop_members_1"."shop_id" = "shop_members_1"."shop_id") AND ("shop_members_1"."user_id" = "auth"."uid"()) AND ("shop_members_1"."role" = ANY (ARRAY['owner'::"public"."shop_role", 'co-founder'::"public"."shop_role"]))))));



CREATE POLICY "Only owners can delete shops" ON "public"."shops" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members"
  WHERE (("shop_members"."shop_id" = "shops"."id") AND ("shop_members"."user_id" = "auth"."uid"()) AND ("shop_members"."role" = 'owner'::"public"."shop_role")))));



CREATE POLICY "Shop members can view invitations" ON "public"."shop_invitations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members"
  WHERE (("shop_members"."shop_id" = "shop_invitations"."shop_id") AND ("shop_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Shop owners and co-founders can update their shops" ON "public"."shops" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members"
  WHERE (("shop_members"."shop_id" = "shops"."id") AND ("shop_members"."user_id" = "auth"."uid"()) AND ("shop_members"."role" = ANY (ARRAY['owner'::"public"."shop_role", 'co-founder'::"public"."shop_role"]))))));



CREATE POLICY "Stream owners can update their streams" ON "public"."live_streams" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Tip recipients can view their tips" ON "public"."stream_tips" FOR SELECT USING ((("auth"."uid"() = "recipient_id") OR ("auth"."uid"() = "sender_id")));



CREATE POLICY "Users can access garages they are members of" ON "public"."garages" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members"
  WHERE (("garage_members"."garage_id" = "garages"."id") AND ("garage_members"."user_id" = "auth"."uid"()) AND ("garage_members"."status" = 'active'::"text")))));



CREATE POLICY "Users can add collaborators to their projects" ON "public"."project_collaborators" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can create feed interactions" ON "public"."feed_interactions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create garages" ON "public"."garages" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create own configs" ON "public"."studio_configurations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create projects" ON "public"."projects" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can create shops" ON "public"."shops" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can create tasks for their projects" ON "public"."project_tasks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can create their own VIN processing jobs" ON "public"."vin_processing_jobs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own content schedules" ON "public"."content_schedules" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own goals" ON "public"."development_goals" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own streams" ON "public"."live_streams" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own studio configurations" ON "public"."studio_configurations" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own token holdings" ON "public"."token_holdings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create updates for their projects" ON "public"."project_updates" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can create video processing jobs" ON "public"."video_processing_jobs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete garages they created" ON "public"."garages" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "gm"."id") AND ("gm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own configs" ON "public"."studio_configurations" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own content" ON "public"."explore_content" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own engagement metrics" ON "public"."engagement_metrics" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own inventory" ON "public"."assets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own memberships" ON "public"."garage_members" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own service tickets" ON "public"."service_tickets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own token holdings" ON "public"."token_holdings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own vehicles" ON "public"."vehicles" FOR DELETE TO "authenticated" USING (((("ownership_status" = 'unclaimed'::"text") AND ("user_id" = "auth"."uid"())) OR (("ownership_status" = 'verified'::"text") AND ("owner_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert explanations" ON "public"."ai_explanations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can insert own interactions" ON "public"."content_interactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own preferences" ON "public"."user_content_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert sales data" ON "public"."vehicle_sales_data" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can insert their own algorithm preferences" ON "public"."algorithm_preferences" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own certification progress" ON "public"."user_certifications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own engagement metrics" ON "public"."engagement_metrics" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own inventory" ON "public"."assets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own inventory items" ON "public"."inventory_items" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own memberships" ON "public"."garage_members" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own preferences" ON "public"."user_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own service tickets" ON "public"."service_tickets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own studio configurations" ON "public"."studio_configurations" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own token management records" ON "public"."token_management" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own vehicles" ON "public"."vehicles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own votes" ON "public"."dao_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their suppliers" ON "public"."suppliers" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage their own algorithm preferences" ON "public"."algorithm_preferences" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage their own engagement metrics" ON "public"."engagement_metrics" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage their own studio configurations" ON "public"."studio_configurations" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can only access their own sessions" ON "public"."user_sessions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can only access their own streaming sessions" ON "public"."streaming_sessions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can read their own studio configurations" ON "public"."studio_configurations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update AI classifications" ON "public"."assets" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update garages they created" ON "public"."garages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members" "gm"
  WHERE (("gm"."garage_id" = "gm"."id") AND ("gm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own configs" ON "public"."studio_configurations" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own content" ON "public"."explore_content" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own preferences" ON "public"."user_content_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own skills" ON "public"."user_skills" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update tasks for their projects" ON "public"."project_tasks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own VIN processing jobs" ON "public"."vin_processing_jobs" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own active garage" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can update their own algorithm preferences" ON "public"."algorithm_preferences" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own certification progress" ON "public"."user_certifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own content schedules" ON "public"."content_schedules" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own contributions" ON "public"."video_analysis_contributions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own engagement metrics" ON "public"."engagement_metrics" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own goals" ON "public"."development_goals" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own inventory" ON "public"."assets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own inventory items" ON "public"."inventory_items" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own preferences" ON "public"."user_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own service tickets" ON "public"."service_tickets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own social links" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own studio configurations" ON "public"."studio_configurations" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own token holdings" ON "public"."token_holdings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own token management records" ON "public"."token_management" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own vehicles" ON "public"."vehicles" FOR UPDATE TO "authenticated" USING (((("ownership_status" = 'unclaimed'::"text") AND ("user_id" = "auth"."uid"())) OR (("ownership_status" = 'verified'::"text") AND ("owner_id" = "auth"."uid"())))) WITH CHECK (((("ownership_status" = 'unclaimed'::"text") AND ("user_id" = "auth"."uid"())) OR (("ownership_status" = 'verified'::"text") AND ("owner_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their suppliers" ON "public"."suppliers" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view all profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view all sales data" ON "public"."vehicle_sales_data" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view all votes" ON "public"."dao_votes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view garages they are members of" ON "public"."garages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members"
  WHERE (("garage_members"."garage_id" = "garage_members"."id") AND ("garage_members"."user_id" = "auth"."uid"()) AND ("garage_members"."status" = 'active'::"text")))));



CREATE POLICY "Users can view only their own token holdings" ON "public"."token_holdings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own configs" ON "public"."studio_configurations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own interactions" ON "public"."content_interactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own preferences" ON "public"."user_content_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own skills" ON "public"."user_skills" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view project collaborators" ON "public"."project_collaborators" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view projects they collaborate on" ON "public"."projects" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view results for their jobs" ON "public"."video_analysis_results" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."video_processing_jobs"
  WHERE (("video_processing_jobs"."id" = "video_analysis_results"."job_id") AND ("video_processing_jobs"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view shop members" ON "public"."shop_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members" "sm"
  WHERE (("sm"."shop_id" = "shop_members"."shop_id") AND ("sm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view shops they are members of" ON "public"."shops" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shop_members"
  WHERE (("shop_members"."shop_id" = "shops"."id") AND ("shop_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view tasks for their projects" ON "public"."project_tasks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view team members" ON "public"."team_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view their own VIN processing jobs" ON "public"."vin_processing_jobs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own algorithm preferences" ON "public"."algorithm_preferences" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own certification progress" ON "public"."user_certifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own content analytics" ON "public"."content_analytics" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."content_schedules"
  WHERE (("content_schedules"."id" = "content_analytics"."content_id") AND ("content_schedules"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own content schedules" ON "public"."content_schedules" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own contributions" ON "public"."video_analysis_contributions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own engagement metrics" ON "public"."engagement_metrics" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own garage memberships" ON "public"."garage_members" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own goals" ON "public"."development_goals" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own inventory" ON "public"."assets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own inventory items" ON "public"."inventory_items" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own memberships" ON "public"."garage_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own preferences" ON "public"."user_preferences" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own service tickets" ON "public"."service_tickets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own studio configurations" ON "public"."studio_configurations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own token management records" ON "public"."token_management" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own vehicle history" ON "public"."vehicle_history" FOR SELECT USING (("vehicle_id" IN ( SELECT "vehicles"."id"
   FROM "public"."vehicles"
  WHERE ("vehicles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own vehicle issues" ON "public"."vehicle_issues" FOR SELECT USING (("vehicle_id" IN ( SELECT "vehicles"."id"
   FROM "public"."vehicles"
  WHERE ("vehicles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own vehicles" ON "public"."vehicles" FOR SELECT TO "authenticated" USING (((("ownership_status" = 'unclaimed'::"text") AND ("user_id" = "auth"."uid"())) OR (("ownership_status" = 'verified'::"text") AND ("owner_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own video processing jobs" ON "public"."video_processing_jobs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their suppliers" ON "public"."suppliers" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view updates for their projects" ON "public"."project_updates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_collaborators" "pc"
  WHERE (("pc"."project_id" = "pc"."project_id") AND ("pc"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view vehicle engagement metrics" ON "public"."vehicle_engagement" FOR SELECT USING (true);



CREATE POLICY "Users can view vehicle market data" ON "public"."vehicle_market_data" FOR SELECT USING (true);



ALTER TABLE "public"."agent_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_agents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_explanations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."algorithm_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auction_bids" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auction_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auctions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automotive_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "create_garages" ON "public"."garages" FOR INSERT TO "authenticated" WITH CHECK (true);



ALTER TABLE "public"."dao_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dao_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."derivatives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."development_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovered_vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."engagement_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."explore_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feed_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."garage_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."garages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_streams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketplace_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketplace_listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketplace_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketplace_saved_listings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "policy_delete_own" ON "public"."algorithm_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."assets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."auction_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."content_interactions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."content_schedules" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."dao_votes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."development_goals" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."engagement_metrics" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."explore_content" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."feed_interactions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."inventory_items" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."live_streams" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."marketplace_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."marketplace_listings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."marketplace_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."marketplace_saved_listings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."profiles" FOR DELETE USING (("auth"."uid"() = "id"));



CREATE POLICY "policy_delete_own" ON "public"."project_updates" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."service_tickets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."stream_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."streaming_sessions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."studio_configurations" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."suppliers" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."token_holdings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."token_management" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_achievements" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_certifications" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_content_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_interactions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_sessions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."user_skills" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."video_analysis_contributions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."video_processing_jobs" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_delete_own" ON "public"."vin_processing_jobs" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."algorithm_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."assets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."auction_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."content_interactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."content_schedules" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."dao_votes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."development_goals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."engagement_metrics" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."explore_content" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."feed_interactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."inventory_items" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."live_streams" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."marketplace_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."marketplace_listings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."marketplace_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."marketplace_saved_listings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "policy_insert_own" ON "public"."project_updates" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."service_tickets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."stream_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."streaming_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."studio_configurations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."suppliers" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."token_holdings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."token_management" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_achievements" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_certifications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_content_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_interactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."user_skills" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."video_analysis_contributions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."video_processing_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_insert_own" ON "public"."vin_processing_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_select_public" ON "public"."ai_agents" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."ai_explanations" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."algorithm_preferences" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."assets" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."auction_bids" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."auction_comments" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."auctions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."automotive_locations" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."certifications" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."content_analytics" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."content_interactions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."content_schedules" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."dao_proposals" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."dao_votes" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."derivatives" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."development_goals" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."discovered_vehicles" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."engagement_metrics" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."explore_content" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."feed_interactions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."feed_items" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."garage_members" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."garages" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."governance_proposals" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."inventory_items" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."live_streams" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."marketplace_comments" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."marketplace_listings" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."marketplace_preferences" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."marketplace_saved_listings" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."project_tasks" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."project_updates" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."projects" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."proposal_votes" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."routes" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."service_tickets" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."shop_invitations" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."shop_members" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."shops" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."skills" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."stream_comments" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."stream_tips" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."streaming_sessions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."studio_configurations" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."suppliers" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."token_analytics" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."token_holdings" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."token_management" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."token_transactions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."tokens" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_achievements" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_certifications" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_content_preferences" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_interactions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_preferences" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_sessions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."user_skills" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_engagement" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_history" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_images" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_issues" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_market_data" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_probability_zones" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_sales_data" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_timeline_events" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicle_tokens" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vehicles" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."verified_locations" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."video_analysis_contributions" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."video_analysis_results" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."video_processing_jobs" FOR SELECT USING (true);



CREATE POLICY "policy_select_public" ON "public"."vin_processing_jobs" FOR SELECT USING (true);



CREATE POLICY "policy_update_own" ON "public"."algorithm_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."assets" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."auction_comments" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."content_interactions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."content_schedules" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."dao_votes" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."development_goals" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."engagement_metrics" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."explore_content" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."feed_interactions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."inventory_items" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."live_streams" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."marketplace_comments" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."marketplace_listings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."marketplace_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."marketplace_saved_listings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "policy_update_own" ON "public"."project_updates" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."service_tickets" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."stream_comments" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."streaming_sessions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."studio_configurations" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."suppliers" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."token_holdings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."token_management" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_achievements" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_certifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_content_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_interactions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_sessions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."user_skills" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."video_analysis_contributions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."video_processing_jobs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "policy_update_own" ON "public"."vin_processing_jobs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_policy" ON "public"."profiles" FOR SELECT USING (true);



ALTER TABLE "public"."project_collaborators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposal_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_garages" ON "public"."garages" FOR SELECT USING (true);



ALTER TABLE "public"."routes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shop_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shop_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stream_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stream_tips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."streaming_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_configurations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_executions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_holdings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_management" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_garages" ON "public"."garages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members"
  WHERE (("garage_members"."garage_id" = "garages"."id") AND ("garage_members"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."user_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_certifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_content_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_engagement" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_market_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_probability_zones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_sales_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_timeline_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."verified_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_analysis_contributions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_analysis_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_processing_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vin_processing_jobs" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "nuke_user";



GRANT ALL ON FUNCTION "public"."analyze_market_trends"() TO "anon";
GRANT ALL ON FUNCTION "public"."analyze_market_trends"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."analyze_market_trends"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_content_relevance"("p_content_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_content_relevance"("p_content_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_content_relevance"("p_content_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") TO "service_role";



GRANT ALL ON TABLE "public"."explore_content" TO "anon";
GRANT ALL ON TABLE "public"."explore_content" TO "authenticated";
GRANT ALL ON TABLE "public"."explore_content" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."explore_content" TO "nuke_user";



GRANT ALL ON FUNCTION "public"."get_personalized_feed"("p_user_id" "uuid", "p_limit" integer, "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_personalized_feed"("p_user_id" "uuid", "p_limit" integer, "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_personalized_feed"("p_user_id" "uuid", "p_limit" integer, "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_marketplace_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_marketplace_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_marketplace_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_garage"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_garage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_garage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_shop_member_updates"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_shop_member_updates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_shop_member_updates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_shop_updates"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_shop_updates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_shop_updates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."safely_add_column"("schema_name" "text", "table_name" "text", "column_name" "text", "column_type" "text", "default_value" "text", "nullable" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."safely_add_column"("schema_name" "text", "table_name" "text", "column_name" "text", "column_type" "text", "default_value" "text", "nullable" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."safely_add_column"("schema_name" "text", "table_name" "text", "column_name" "text", "column_type" "text", "default_value" "text", "nullable" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."safely_create_enum_type"("type_name" "text", "enum_values" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."safely_create_enum_type"("type_name" "text", "enum_values" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."safely_create_enum_type"("type_name" "text", "enum_values" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."safely_update_column_values"("schema_name" "text", "table_name" "text", "column_name" "text", "new_value" "text", "condition" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."safely_update_column_values"("schema_name" "text", "table_name" "text", "column_name" "text", "new_value" "text", "condition" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safely_update_column_values"("schema_name" "text", "table_name" "text", "column_name" "text", "new_value" "text", "condition" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_vehicle_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_vehicle_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_vehicle_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_feed_item_relevance"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_feed_item_relevance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_feed_item_relevance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_preferences_on_interaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_preferences_on_interaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_preferences_on_interaction"() TO "service_role";



GRANT ALL ON TABLE "public"."agent_actions" TO "anon";
GRANT ALL ON TABLE "public"."agent_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_actions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."agent_actions" TO "nuke_user";



GRANT ALL ON TABLE "public"."ai_agents" TO "anon";
GRANT ALL ON TABLE "public"."ai_agents" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_agents" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_agents" TO "nuke_user";



GRANT ALL ON TABLE "public"."ai_explanations" TO "anon";
GRANT ALL ON TABLE "public"."ai_explanations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_explanations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."ai_explanations" TO "nuke_user";



GRANT ALL ON TABLE "public"."algorithm_preferences" TO "anon";
GRANT ALL ON TABLE "public"."algorithm_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."algorithm_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."algorithm_preferences" TO "nuke_user";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."assets" TO "nuke_user";



GRANT ALL ON TABLE "public"."auction_bids" TO "anon";
GRANT ALL ON TABLE "public"."auction_bids" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_bids" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auction_bids" TO "nuke_user";



GRANT ALL ON TABLE "public"."auction_comments" TO "anon";
GRANT ALL ON TABLE "public"."auction_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auction_comments" TO "nuke_user";



GRANT ALL ON TABLE "public"."auctions" TO "anon";
GRANT ALL ON TABLE "public"."auctions" TO "authenticated";
GRANT ALL ON TABLE "public"."auctions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auctions" TO "nuke_user";



GRANT ALL ON TABLE "public"."automotive_locations" TO "anon";
GRANT ALL ON TABLE "public"."automotive_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."automotive_locations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."automotive_locations" TO "nuke_user";



GRANT ALL ON TABLE "public"."captures" TO "anon";
GRANT ALL ON TABLE "public"."captures" TO "authenticated";
GRANT ALL ON TABLE "public"."captures" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."captures" TO "nuke_user";



GRANT ALL ON TABLE "public"."certifications" TO "anon";
GRANT ALL ON TABLE "public"."certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."certifications" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."certifications" TO "nuke_user";



GRANT ALL ON TABLE "public"."content_analytics" TO "anon";
GRANT ALL ON TABLE "public"."content_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."content_analytics" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."content_analytics" TO "nuke_user";



GRANT ALL ON TABLE "public"."content_interactions" TO "anon";
GRANT ALL ON TABLE "public"."content_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."content_interactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."content_interactions" TO "nuke_user";



GRANT ALL ON TABLE "public"."content_schedules" TO "anon";
GRANT ALL ON TABLE "public"."content_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."content_schedules" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."content_schedules" TO "nuke_user";



GRANT ALL ON TABLE "public"."dao_proposals" TO "anon";
GRANT ALL ON TABLE "public"."dao_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."dao_proposals" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."dao_proposals" TO "nuke_user";



GRANT ALL ON TABLE "public"."dao_votes" TO "anon";
GRANT ALL ON TABLE "public"."dao_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."dao_votes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."dao_votes" TO "nuke_user";



GRANT ALL ON TABLE "public"."derivatives" TO "anon";
GRANT ALL ON TABLE "public"."derivatives" TO "authenticated";
GRANT ALL ON TABLE "public"."derivatives" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."derivatives" TO "nuke_user";



GRANT ALL ON TABLE "public"."development_goals" TO "anon";
GRANT ALL ON TABLE "public"."development_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."development_goals" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."development_goals" TO "nuke_user";



GRANT ALL ON TABLE "public"."discovered_vehicles" TO "anon";
GRANT ALL ON TABLE "public"."discovered_vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."discovered_vehicles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."discovered_vehicles" TO "nuke_user";



GRANT ALL ON TABLE "public"."engagement_metrics" TO "anon";
GRANT ALL ON TABLE "public"."engagement_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_metrics" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."engagement_metrics" TO "nuke_user";



GRANT ALL ON TABLE "public"."feed_interactions" TO "anon";
GRANT ALL ON TABLE "public"."feed_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_interactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."feed_interactions" TO "nuke_user";



GRANT ALL ON TABLE "public"."feed_items" TO "anon";
GRANT ALL ON TABLE "public"."feed_items" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."feed_items" TO "nuke_user";



GRANT ALL ON TABLE "public"."garage_members" TO "anon";
GRANT ALL ON TABLE "public"."garage_members" TO "authenticated";
GRANT ALL ON TABLE "public"."garage_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."garage_members" TO "nuke_user";



GRANT ALL ON TABLE "public"."garages" TO "anon";
GRANT ALL ON TABLE "public"."garages" TO "authenticated";
GRANT ALL ON TABLE "public"."garages" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."garages" TO "nuke_user";



GRANT ALL ON TABLE "public"."governance_proposals" TO "anon";
GRANT ALL ON TABLE "public"."governance_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_proposals" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."governance_proposals" TO "nuke_user";



GRANT ALL ON TABLE "public"."inventory_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."inventory_items" TO "nuke_user";



GRANT ALL ON TABLE "public"."live_streams" TO "anon";
GRANT ALL ON TABLE "public"."live_streams" TO "authenticated";
GRANT ALL ON TABLE "public"."live_streams" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."live_streams" TO "nuke_user";



GRANT ALL ON TABLE "public"."marketplace_comments" TO "anon";
GRANT ALL ON TABLE "public"."marketplace_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."marketplace_comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."marketplace_comments" TO "nuke_user";



GRANT ALL ON TABLE "public"."marketplace_listings" TO "anon";
GRANT ALL ON TABLE "public"."marketplace_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."marketplace_listings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."marketplace_listings" TO "nuke_user";



GRANT ALL ON TABLE "public"."marketplace_preferences" TO "anon";
GRANT ALL ON TABLE "public"."marketplace_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."marketplace_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."marketplace_preferences" TO "nuke_user";



GRANT ALL ON TABLE "public"."marketplace_saved_listings" TO "anon";
GRANT ALL ON TABLE "public"."marketplace_saved_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."marketplace_saved_listings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."marketplace_saved_listings" TO "nuke_user";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."profiles" TO "nuke_user";



GRANT ALL ON TABLE "public"."project_collaborators" TO "anon";
GRANT ALL ON TABLE "public"."project_collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."project_collaborators" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."project_collaborators" TO "nuke_user";



GRANT ALL ON TABLE "public"."project_tasks" TO "anon";
GRANT ALL ON TABLE "public"."project_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."project_tasks" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."project_tasks" TO "nuke_user";



GRANT ALL ON TABLE "public"."project_updates" TO "anon";
GRANT ALL ON TABLE "public"."project_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_updates" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."project_updates" TO "nuke_user";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."projects" TO "nuke_user";



GRANT ALL ON TABLE "public"."proposal_votes" TO "anon";
GRANT ALL ON TABLE "public"."proposal_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_votes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."proposal_votes" TO "nuke_user";



GRANT ALL ON TABLE "public"."realtime_video_segments" TO "anon";
GRANT ALL ON TABLE "public"."realtime_video_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."realtime_video_segments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."realtime_video_segments" TO "nuke_user";



GRANT ALL ON TABLE "public"."routes" TO "anon";
GRANT ALL ON TABLE "public"."routes" TO "authenticated";
GRANT ALL ON TABLE "public"."routes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."routes" TO "nuke_user";



GRANT ALL ON TABLE "public"."service_tickets" TO "anon";
GRANT ALL ON TABLE "public"."service_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."service_tickets" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."service_tickets" TO "nuke_user";



GRANT ALL ON TABLE "public"."shop_invitations" TO "anon";
GRANT ALL ON TABLE "public"."shop_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_invitations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shop_invitations" TO "nuke_user";



GRANT ALL ON TABLE "public"."shop_members" TO "anon";
GRANT ALL ON TABLE "public"."shop_members" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shop_members" TO "nuke_user";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shops" TO "nuke_user";



GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."skills" TO "nuke_user";



GRANT ALL ON TABLE "public"."stream_comments" TO "anon";
GRANT ALL ON TABLE "public"."stream_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."stream_comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."stream_comments" TO "nuke_user";



GRANT ALL ON TABLE "public"."stream_tips" TO "anon";
GRANT ALL ON TABLE "public"."stream_tips" TO "authenticated";
GRANT ALL ON TABLE "public"."stream_tips" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."stream_tips" TO "nuke_user";



GRANT ALL ON TABLE "public"."streaming_sessions" TO "anon";
GRANT ALL ON TABLE "public"."streaming_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."streaming_sessions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."streaming_sessions" TO "nuke_user";



GRANT ALL ON TABLE "public"."studio_configurations" TO "anon";
GRANT ALL ON TABLE "public"."studio_configurations" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_configurations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."studio_configurations" TO "nuke_user";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."suppliers" TO "nuke_user";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."team_members" TO "nuke_user";



GRANT ALL ON TABLE "public"."test_cases" TO "anon";
GRANT ALL ON TABLE "public"."test_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."test_cases" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."test_cases" TO "nuke_user";



GRANT ALL ON TABLE "public"."test_executions" TO "anon";
GRANT ALL ON TABLE "public"."test_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."test_executions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."test_executions" TO "nuke_user";



GRANT ALL ON TABLE "public"."token_analytics" TO "anon";
GRANT ALL ON TABLE "public"."token_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."token_analytics" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."token_analytics" TO "nuke_user";



GRANT ALL ON TABLE "public"."token_holdings" TO "anon";
GRANT ALL ON TABLE "public"."token_holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."token_holdings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."token_holdings" TO "nuke_user";



GRANT ALL ON TABLE "public"."token_management" TO "anon";
GRANT ALL ON TABLE "public"."token_management" TO "authenticated";
GRANT ALL ON TABLE "public"."token_management" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."token_management" TO "nuke_user";



GRANT ALL ON TABLE "public"."token_transactions" TO "anon";
GRANT ALL ON TABLE "public"."token_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."token_transactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."token_transactions" TO "nuke_user";



GRANT ALL ON TABLE "public"."tokens" TO "anon";
GRANT ALL ON TABLE "public"."tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."tokens" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tokens" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_achievements" TO "anon";
GRANT ALL ON TABLE "public"."user_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_achievements" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_achievements" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_certifications" TO "anon";
GRANT ALL ON TABLE "public"."user_certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."user_certifications" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_certifications" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_content_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_content_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_content_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_content_preferences" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_interactions" TO "anon";
GRANT ALL ON TABLE "public"."user_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_interactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_interactions" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_preferences" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_roles" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_sessions" TO "anon";
GRANT ALL ON TABLE "public"."user_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_sessions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_sessions" TO "nuke_user";



GRANT ALL ON TABLE "public"."user_skills" TO "anon";
GRANT ALL ON TABLE "public"."user_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."user_skills" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_skills" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_engagement" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_engagement" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_engagement" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_engagement" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_history" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_history" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_history" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_history" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_images" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_images" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_images" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_images" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_issues" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_issues" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_issues" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_market_data" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_market_data" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_market_data" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_market_data" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_probability_zones" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_probability_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_probability_zones" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_probability_zones" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_sales_data" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_sales_data" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_sales_data" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_sales_data" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_timeline_events" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_timeline_events" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_timeline_events" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_timeline_events" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicle_tokens" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_tokens" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicle_tokens" TO "nuke_user";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vehicles" TO "nuke_user";



GRANT ALL ON TABLE "public"."verified_locations" TO "anon";
GRANT ALL ON TABLE "public"."verified_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."verified_locations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."verified_locations" TO "nuke_user";



GRANT ALL ON TABLE "public"."video_analysis_contributions" TO "anon";
GRANT ALL ON TABLE "public"."video_analysis_contributions" TO "authenticated";
GRANT ALL ON TABLE "public"."video_analysis_contributions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."video_analysis_contributions" TO "nuke_user";



GRANT ALL ON TABLE "public"."video_analysis_results" TO "anon";
GRANT ALL ON TABLE "public"."video_analysis_results" TO "authenticated";
GRANT ALL ON TABLE "public"."video_analysis_results" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."video_analysis_results" TO "nuke_user";



GRANT ALL ON TABLE "public"."video_processing_jobs" TO "anon";
GRANT ALL ON TABLE "public"."video_processing_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."video_processing_jobs" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."video_processing_jobs" TO "nuke_user";



GRANT ALL ON TABLE "public"."vin_processing_jobs" TO "anon";
GRANT ALL ON TABLE "public"."vin_processing_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."vin_processing_jobs" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."vin_processing_jobs" TO "nuke_user";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT USAGE ON SEQUENCES  TO "nuke_user";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES  TO "nuke_user";






RESET ALL;
