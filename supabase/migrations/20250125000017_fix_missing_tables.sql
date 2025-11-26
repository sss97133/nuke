-- ==========================================================================
-- FIX MISSING TABLES AND FUNCTIONS
-- ==========================================================================
-- Purpose: Create missing tables/functions that frontend is trying to query
-- ==========================================================================

-- Create user_ai_providers table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS user_ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'gemini')), -- 'openai', 'anthropic', 'google', 'gemini'
  api_key_encrypted TEXT, -- Encrypted API key
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, provider)
);

-- Add RLS policies
ALTER TABLE user_ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI providers"
  ON user_ai_providers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI providers"
  ON user_ai_providers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI providers"
  ON user_ai_providers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own AI providers"
  ON user_ai_providers FOR DELETE
  USING (auth.uid() = user_id);

-- Create execute_sql RPC function (safe version)
CREATE OR REPLACE FUNCTION execute_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Only allow SELECT queries for safety
  IF NOT (LOWER(TRIM(query)) LIKE 'select%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  -- Execute query and return as JSONB
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION execute_sql(TEXT) TO authenticated;

-- Create vehicle_processing_summary view (placeholder)
CREATE OR REPLACE VIEW vehicle_processing_summary AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  COUNT(DISTINCT vi.id) FILTER (WHERE vi.ai_processing_status = 'complete') as images_processed,
  COUNT(DISTINCT vi.id) as total_images,
  COUNT(DISTINCT iwe.id) as work_extractions,
  COUNT(DISTINCT acd.id) as components_detected,
  CASE 
    WHEN COUNT(DISTINCT vi.id) > 0 THEN
      ROUND(COUNT(DISTINCT vi.id) FILTER (WHERE vi.ai_processing_status = 'complete') * 100.0 / COUNT(DISTINCT vi.id), 2)
    ELSE 0
  END as profile_completeness_score,
  NOW() as created_at
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
LEFT JOIN image_work_extractions iwe ON iwe.vehicle_id = v.id
LEFT JOIN ai_component_detections acd ON acd.vehicle_image_id = vi.id
GROUP BY v.id, v.year, v.make, v.model;

-- Grant select on view
GRANT SELECT ON vehicle_processing_summary TO authenticated;

COMMENT ON TABLE user_ai_providers IS 'Stores user-configured AI provider API keys';
COMMENT ON FUNCTION execute_sql(TEXT) IS 'Safe SQL execution function (SELECT only)';
COMMENT ON VIEW vehicle_processing_summary IS 'Summary view of vehicle processing status';

