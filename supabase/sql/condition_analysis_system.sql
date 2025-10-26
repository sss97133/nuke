-- AI Condition Analysis System
-- Stores results of AI-powered condition assessment from images

-- Create table for condition analyses
CREATE TABLE IF NOT EXISTS vehicle_condition_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  overall_condition_score NUMERIC(3,1) CHECK (overall_condition_score >= 1 AND overall_condition_score <= 10),
  rust_severity INTEGER CHECK (rust_severity >= 0 AND rust_severity <= 10),
  paint_quality NUMERIC(3,1) CHECK (paint_quality >= 1 AND paint_quality <= 10),
  body_condition NUMERIC(3,1) CHECK (body_condition >= 1 AND body_condition <= 10),
  interior_condition NUMERIC(3,1) CHECK (interior_condition >= 1 AND interior_condition <= 10),
  modification_quality NUMERIC(3,1) CHECK (modification_quality >= 1 AND modification_quality <= 10),
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  image_count INTEGER DEFAULT 0,
  analyzed_images INTEGER DEFAULT 0,
  condition_summary TEXT,
  base_price NUMERIC,
  condition_multiplier NUMERIC(4,2),
  final_price NUMERIC,
  price_change NUMERIC,
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add condition fields to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ai_condition_score NUMERIC(3,1);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS rust_severity INTEGER DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS condition_confidence INTEGER DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS condition_last_analyzed TIMESTAMP WITH TIME ZONE;

-- Create function to trigger condition analysis when images are added
CREATE OR REPLACE FUNCTION trigger_condition_analysis()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if this is a new image or significant change
  IF TG_OP = 'INSERT' OR 
     (TG_OP = 'UPDATE' AND OLD.image_url IS DISTINCT FROM NEW.image_url) THEN
    
    -- Call condition analysis function asynchronously
    PERFORM net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ai-condition-pricing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := jsonb_build_object(
        'vehicle_id', NEW.vehicle_id::text
      )
    );
    
    -- Log the trigger
    INSERT INTO vehicle_activity_log (vehicle_id, activity_type, details)
    VALUES (NEW.vehicle_id, 'condition_analysis_triggered', 
            jsonb_build_object('image_id', NEW.id, 'trigger_reason', TG_OP));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on vehicle_images
DROP TRIGGER IF EXISTS condition_analysis_trigger ON vehicle_images;
CREATE TRIGGER condition_analysis_trigger
  AFTER INSERT OR UPDATE ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION trigger_condition_analysis();

-- Create function to update vehicle condition stats
CREATE OR REPLACE FUNCTION update_vehicle_condition_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update vehicle with latest condition analysis
  UPDATE vehicles SET
    ai_condition_score = NEW.overall_condition_score,
    rust_severity = NEW.rust_severity,
    condition_confidence = NEW.confidence,
    condition_last_analyzed = NEW.analyzed_at
  WHERE id = NEW.vehicle_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for condition stats
DROP TRIGGER IF EXISTS update_condition_stats_trigger ON vehicle_condition_analyses;
CREATE TRIGGER update_condition_stats_trigger
  AFTER INSERT OR UPDATE ON vehicle_condition_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_condition_stats();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_condition_analyses_vehicle_id ON vehicle_condition_analyses(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_condition_analyses_analyzed_at ON vehicle_condition_analyses(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_condition_analyses_condition_score ON vehicle_condition_analyses(overall_condition_score);

-- Enable RLS
ALTER TABLE vehicle_condition_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view condition analyses for vehicles they can see" ON vehicle_condition_analyses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_condition_analyses.vehicle_id
    )
  );

-- Function to manually trigger condition analysis
CREATE OR REPLACE FUNCTION analyze_vehicle_condition(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Call the Edge Function
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/ai-condition-pricing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'vehicle_id', p_vehicle_id::text
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for condition analysis summary
CREATE OR REPLACE VIEW vehicle_condition_summary AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.ai_condition_score,
  v.rust_severity,
  v.condition_confidence,
  v.condition_last_analyzed,
  vca.paint_quality,
  vca.body_condition,
  vca.interior_condition,
  vca.modification_quality,
  vca.condition_summary,
  vca.base_price,
  vca.condition_multiplier,
  vca.final_price,
  vca.price_change,
  vca.price_change_percent,
  vca.image_count,
  vca.analyzed_images,
  CASE 
    WHEN v.ai_condition_score >= 8.5 THEN 'Excellent'
    WHEN v.ai_condition_score >= 7.5 THEN 'Very Good'
    WHEN v.ai_condition_score >= 6.5 THEN 'Good'
    WHEN v.ai_condition_score >= 5.5 THEN 'Fair'
    WHEN v.ai_condition_score >= 4.0 THEN 'Poor'
    ELSE 'Project'
  END as condition_grade
FROM vehicles v
LEFT JOIN LATERAL (
  SELECT * FROM vehicle_condition_analyses vca
  WHERE vca.vehicle_id = v.id
  ORDER BY vca.analyzed_at DESC
  LIMIT 1
) vca ON true;

-- Function to get condition pricing breakdown
CREATE OR REPLACE FUNCTION get_condition_pricing_breakdown(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  analysis_data RECORD;
  breakdown JSONB;
BEGIN
  -- Get latest condition analysis
  SELECT * INTO analysis_data
  FROM vehicle_condition_analyses
  WHERE vehicle_id = p_vehicle_id
  ORDER BY analyzed_at DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'No condition analysis found',
      'message', 'Upload images to enable AI condition analysis'
    );
  END IF;
  
  -- Build detailed breakdown
  breakdown := jsonb_build_object(
    'overall_condition', jsonb_build_object(
      'score', analysis_data.overall_condition_score,
      'grade', CASE 
        WHEN analysis_data.overall_condition_score >= 8.5 THEN 'Excellent'
        WHEN analysis_data.overall_condition_score >= 7.5 THEN 'Very Good'
        WHEN analysis_data.overall_condition_score >= 6.5 THEN 'Good'
        WHEN analysis_data.overall_condition_score >= 5.5 THEN 'Fair'
        WHEN analysis_data.overall_condition_score >= 4.0 THEN 'Poor'
        ELSE 'Project'
      END,
      'summary', analysis_data.condition_summary
    ),
    'detailed_scores', jsonb_build_object(
      'paint_quality', analysis_data.paint_quality,
      'body_condition', analysis_data.body_condition,
      'interior_condition', analysis_data.interior_condition,
      'modification_quality', analysis_data.modification_quality,
      'rust_severity', analysis_data.rust_severity
    ),
    'pricing_impact', jsonb_build_object(
      'base_price', analysis_data.base_price,
      'condition_multiplier', analysis_data.condition_multiplier,
      'final_price', analysis_data.final_price,
      'price_change', analysis_data.price_change,
      'price_change_percent', ROUND(((analysis_data.final_price - analysis_data.base_price) / analysis_data.base_price * 100)::NUMERIC, 1)
    ),
    'analysis_metadata', jsonb_build_object(
      'confidence', analysis_data.confidence,
      'image_count', analysis_data.image_count,
      'analyzed_images', analysis_data.analyzed_images,
      'analyzed_at', analysis_data.analyzed_at
    )
  );
  
  RETURN breakdown;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '🤖 AI Condition Analysis System installed!';
  RAISE NOTICE 'Vehicle pricing now adjusts based on AI-detected condition from images.';
  RAISE NOTICE 'System automatically analyzes rust, paint, body, interior, and modifications.';
END$$;