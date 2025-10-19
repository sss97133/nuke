-- Add AI settings to user profiles for guardrails configuration
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS ai_settings JSONB DEFAULT '{
  "personal": {
    "profession": "enthusiast",
    "expertise_areas": [],
    "typical_work_scenarios": ["personal_project"],
    "preferred_filing_structure": "by_vehicle",
    "privacy_settings": {
      "blur_license_plates": false,
      "encrypt_vins": false,
      "redact_customer_info": false
    }
  },
  "domain": {
    "part_identification": {
      "level": "basic",
      "include_part_numbers": false,
      "cross_reference_catalogs": false,
      "estimate_condition": false
    },
    "work_stage_detection": true,
    "problem_diagnosis": false,
    "progress_tracking": true,
    "make_cost_estimates": false,
    "suggest_next_steps": false,
    "identify_safety_concerns": true
  },
  "organizational": {
    "filing_triggers": {
      "detect_vin_in_image": true,
      "match_recent_context": true,
      "use_gps_location": false,
      "analyze_visible_vehicles": true
    },
    "auto_categorization": {
      "by_work_type": true,
      "by_component": true,
      "by_angle": false,
      "by_quality": false
    },
    "timeline_creation": {
      "auto_create_events": true,
      "batch_similar_photos": true,
      "extract_work_narrative": false
    }
  }
}';

-- Create a function to update AI settings based on profession
CREATE OR REPLACE FUNCTION update_ai_settings_for_profession()
RETURNS TRIGGER AS $$
BEGIN
  -- Update AI settings when profession changes
  IF NEW.profession IS DISTINCT FROM OLD.profession THEN
    CASE NEW.profession
      WHEN 'mechanic' THEN
        NEW.ai_settings = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(NEW.ai_settings, '{}'::jsonb),
              '{personal,profession}', '"mechanic"'
            ),
            '{domain,part_identification}', '{"level": "expert", "include_part_numbers": true, "cross_reference_catalogs": true, "estimate_condition": true}'::jsonb
          ),
          '{domain,problem_diagnosis}', 'true'::jsonb
        );
      WHEN 'dealer' THEN
        NEW.ai_settings = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(NEW.ai_settings, '{}'::jsonb),
              '{personal,profession}', '"dealer"'
            ),
            '{organizational,auto_categorization}', '{"by_work_type": true, "by_component": true, "by_angle": true, "by_quality": true}'::jsonb
          ),
          '{domain,part_identification,estimate_condition}', 'true'::jsonb
        );
      WHEN 'collector' THEN
        NEW.ai_settings = jsonb_set(
          jsonb_set(
            COALESCE(NEW.ai_settings, '{}'::jsonb),
            '{personal,profession}', '"collector"'
          ),
          '{personal,preferred_filing_structure}', '"by_date"'
        );
      ELSE
        -- Default enthusiast settings
        NEW.ai_settings = jsonb_set(
          COALESCE(NEW.ai_settings, '{}'::jsonb),
          '{personal,profession}', '"enthusiast"'
        );
    END CASE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for profession changes
CREATE TRIGGER update_ai_settings_on_profession_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  WHEN (NEW.profession IS DISTINCT FROM OLD.profession)
  EXECUTE FUNCTION update_ai_settings_for_profession();

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_ai_settings ON user_profiles USING gin(ai_settings);

-- Create a view for user AI preferences
CREATE OR REPLACE VIEW user_ai_preferences AS
SELECT 
  up.user_id,
  up.display_name,
  up.profession,
  up.ai_settings->'personal'->'profession' as ai_profession,
  up.ai_settings->'personal'->'preferred_filing_structure' as filing_preference,
  up.ai_settings->'domain'->'part_identification'->>'level' as part_id_level,
  up.ai_settings->'organizational'->'filing_triggers'->>'match_recent_context' = 'true' as uses_recent_context,
  up.ai_settings->'organizational'->'filing_triggers'->>'detect_vin_in_image' = 'true' as auto_detect_vin
FROM user_profiles up;

-- Grant access
GRANT SELECT ON user_ai_preferences TO authenticated;