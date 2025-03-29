-- Migration: fix_lint_errors
-- Fixes SQL errors identified by supabase db lint in functions pulled from remote.

-- Fix: analyze_market_trends
--  - Use DATE_TRUNC('week', sale_date) in LAG OVER clause ORDER BY
--  - Remove outer WHERE clause from UPDATE
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

-- Fix: calculate_content_relevance
--  - Remove unused variables: type_match, location_match
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

-- Fix: column_exists
--  - Drop and recreate with prefixed parameter names (p_*) to avoid ambiguity for linter.
DROP FUNCTION IF EXISTS "public"."column_exists"(text, text, text); -- Drop existing function by signature

CREATE OR REPLACE FUNCTION "public"."column_exists"("p_schema_name" "text", "p_table_name" "text", "p_column_name" "text") RETURNS boolean -- Prefixed params
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
