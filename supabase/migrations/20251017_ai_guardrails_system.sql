-- AI Guardrails System for Mobile Capture
-- Implements user-specific AI processing boundaries and preferences

-- Create enum types for guardrail settings
CREATE TYPE user_profession AS ENUM ('mechanic', 'dealer', 'enthusiast', 'collector', 'other');
CREATE TYPE part_id_level AS ENUM ('none', 'basic', 'intermediate', 'expert');
CREATE TYPE filing_structure AS ENUM ('by_vehicle', 'by_date', 'by_type', 'by_project');
CREATE TYPE privacy_mode AS ENUM ('none', 'blur_plates', 'full');

-- Extend user_profiles with AI guardrail preferences
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS profession user_profession DEFAULT 'enthusiast',
ADD COLUMN IF NOT EXISTS expertise_areas TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS business_license TEXT,
ADD COLUMN IF NOT EXISTS dealer_license TEXT; -- For dealer profiles like DLR000053625

-- Create table for user AI guardrails
CREATE TABLE IF NOT EXISTS user_ai_guardrails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Personal guardrails
    typical_work_scenarios TEXT[] DEFAULT '{}',
    preferred_filing_structure filing_structure DEFAULT 'by_vehicle',
    privacy_mode privacy_mode DEFAULT 'none',
    blur_license_plates BOOLEAN DEFAULT FALSE,
    encrypt_vins BOOLEAN DEFAULT FALSE,
    redact_customer_info BOOLEAN DEFAULT FALSE,
    
    -- Domain guardrails
    part_identification_level part_id_level DEFAULT 'basic',
    include_part_numbers BOOLEAN DEFAULT FALSE,
    cross_reference_catalogs BOOLEAN DEFAULT FALSE,
    estimate_condition BOOLEAN DEFAULT FALSE,
    work_stage_detection BOOLEAN DEFAULT TRUE,
    problem_diagnosis BOOLEAN DEFAULT FALSE,
    progress_tracking BOOLEAN DEFAULT TRUE,
    make_cost_estimates BOOLEAN DEFAULT FALSE,
    suggest_next_steps BOOLEAN DEFAULT FALSE,
    identify_safety_concerns BOOLEAN DEFAULT TRUE,
    
    -- Organizational guardrails
    detect_vin_in_image BOOLEAN DEFAULT TRUE,
    match_recent_context BOOLEAN DEFAULT TRUE,
    use_gps_location BOOLEAN DEFAULT FALSE,
    analyze_visible_vehicles BOOLEAN DEFAULT TRUE,
    categorize_by_work_type BOOLEAN DEFAULT TRUE,
    categorize_by_component BOOLEAN DEFAULT TRUE,
    categorize_by_angle BOOLEAN DEFAULT FALSE,
    categorize_by_quality BOOLEAN DEFAULT FALSE,
    auto_create_timeline_events BOOLEAN DEFAULT TRUE,
    batch_similar_photos BOOLEAN DEFAULT TRUE,
    extract_work_narrative BOOLEAN DEFAULT FALSE,
    
    -- Learning metrics
    feedback_count INTEGER DEFAULT 0,
    last_feedback_at TIMESTAMPTZ,
    filing_accuracy_score DECIMAL(3,2) DEFAULT 0.5, -- 0.00 to 1.00
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_user_guardrails UNIQUE (user_id)
);

-- Create table for capture contexts
CREATE TABLE IF NOT EXISTS capture_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Recent activity tracking
    last_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    last_category TEXT,
    last_work_type TEXT,
    last_capture_at TIMESTAMPTZ,
    
    -- Session tracking
    active_work_session_id UUID,
    capture_count INTEGER DEFAULT 0,
    
    -- Location data (optional)
    last_location POINT,
    last_location_name TEXT,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_user_context UNIQUE (user_id)
);

-- Create table for offline capture queue
CREATE TABLE IF NOT EXISTS offline_capture_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- File data
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    capture_timestamp TIMESTAMPTZ NOT NULL,
    
    -- Processing data
    ai_result JSONB,
    processing_context JSONB,
    processing_attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_offline_queue_user_status (user_id, status)
);

-- Create table for guardrail learning/feedback
CREATE TABLE IF NOT EXISTS guardrail_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Original AI decision
    original_vehicle_id UUID,
    original_category TEXT,
    original_confidence DECIMAL(3,2),
    
    -- User correction
    corrected_vehicle_id UUID,
    corrected_category TEXT,
    correction_type TEXT CHECK (correction_type IN ('vehicle', 'category', 'both')),
    
    -- Context at time of correction
    context_data JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    INDEX idx_feedback_user_created (user_id, created_at DESC)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_guardrails_user ON user_ai_guardrails(user_id);
CREATE INDEX IF NOT EXISTS idx_contexts_user ON capture_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_contexts_vehicle ON capture_contexts(last_vehicle_id);

-- Create function to get user guardrails with defaults
CREATE OR REPLACE FUNCTION get_user_guardrails(p_user_id UUID)
RETURNS TABLE (
    guardrails JSONB
) AS $$
DECLARE
    v_guardrails RECORD;
    v_profile RECORD;
BEGIN
    -- Get user profile
    SELECT * INTO v_profile FROM user_profiles WHERE user_id = p_user_id;
    
    -- Get or create guardrails
    SELECT * INTO v_guardrails FROM user_ai_guardrails WHERE user_id = p_user_id;
    
    IF v_guardrails.id IS NULL THEN
        -- Create default guardrails based on profession
        INSERT INTO user_ai_guardrails (user_id)
        VALUES (p_user_id)
        RETURNING * INTO v_guardrails;
    END IF;
    
    -- Return as structured JSON
    RETURN QUERY
    SELECT jsonb_build_object(
        'personal', jsonb_build_object(
            'profession', COALESCE(v_profile.profession, 'enthusiast'),
            'expertise_areas', COALESCE(v_profile.expertise_areas, '{}'),
            'typical_work_scenarios', v_guardrails.typical_work_scenarios,
            'preferred_filing_structure', v_guardrails.preferred_filing_structure,
            'privacy_settings', jsonb_build_object(
                'blur_license_plates', v_guardrails.blur_license_plates,
                'encrypt_vins', v_guardrails.encrypt_vins,
                'redact_customer_info', v_guardrails.redact_customer_info
            ),
            'business_info', CASE 
                WHEN v_profile.business_name IS NOT NULL THEN
                    jsonb_build_object(
                        'name', v_profile.business_name,
                        'license', v_profile.dealer_license
                    )
                ELSE NULL
            END
        ),
        'domain', jsonb_build_object(
            'part_identification', jsonb_build_object(
                'level', v_guardrails.part_identification_level,
                'include_part_numbers', v_guardrails.include_part_numbers,
                'cross_reference_catalogs', v_guardrails.cross_reference_catalogs,
                'estimate_condition', v_guardrails.estimate_condition
            ),
            'work_stage_detection', v_guardrails.work_stage_detection,
            'problem_diagnosis', v_guardrails.problem_diagnosis,
            'progress_tracking', v_guardrails.progress_tracking,
            'make_cost_estimates', v_guardrails.make_cost_estimates,
            'suggest_next_steps', v_guardrails.suggest_next_steps,
            'identify_safety_concerns', v_guardrails.identify_safety_concerns
        ),
        'organizational', jsonb_build_object(
            'filing_triggers', jsonb_build_object(
                'detect_vin_in_image', v_guardrails.detect_vin_in_image,
                'match_recent_context', v_guardrails.match_recent_context,
                'use_gps_location', v_guardrails.use_gps_location,
                'analyze_visible_vehicles', v_guardrails.analyze_visible_vehicles
            ),
            'auto_categorization', jsonb_build_object(
                'by_work_type', v_guardrails.categorize_by_work_type,
                'by_component', v_guardrails.categorize_by_component,
                'by_angle', v_guardrails.categorize_by_angle,
                'by_quality', v_guardrails.categorize_by_quality
            ),
            'timeline_creation', jsonb_build_object(
                'auto_create_events', v_guardrails.auto_create_timeline_events,
                'batch_similar_photos', v_guardrails.batch_similar_photos,
                'extract_work_narrative', v_guardrails.extract_work_narrative
            )
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Create function to update guardrails from feedback
CREATE OR REPLACE FUNCTION update_guardrails_from_feedback(
    p_user_id UUID,
    p_original_vehicle_id UUID,
    p_corrected_vehicle_id UUID,
    p_original_category TEXT,
    p_corrected_category TEXT
) RETURNS VOID AS $$
DECLARE
    v_correction_type TEXT;
BEGIN
    -- Determine correction type
    IF p_original_vehicle_id != p_corrected_vehicle_id AND p_original_category != p_corrected_category THEN
        v_correction_type := 'both';
    ELSIF p_original_vehicle_id != p_corrected_vehicle_id THEN
        v_correction_type := 'vehicle';
    ELSE
        v_correction_type := 'category';
    END IF;
    
    -- Record feedback
    INSERT INTO guardrail_feedback (
        user_id,
        original_vehicle_id,
        original_category,
        corrected_vehicle_id,
        corrected_category,
        correction_type
    ) VALUES (
        p_user_id,
        p_original_vehicle_id,
        p_original_category,
        p_corrected_vehicle_id,
        p_corrected_category,
        v_correction_type
    );
    
    -- Update guardrails metrics
    UPDATE user_ai_guardrails
    SET 
        feedback_count = feedback_count + 1,
        last_feedback_at = NOW(),
        filing_accuracy_score = CASE
            WHEN feedback_count < 10 THEN filing_accuracy_score
            ELSE (
                SELECT 1.0 - (COUNT(*)::DECIMAL / NULLIF(feedback_count + 1, 0))
                FROM guardrail_feedback
                WHERE user_id = p_user_id
                AND created_at > NOW() - INTERVAL '30 days'
            )
        END,
        updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Create RLS policies
ALTER TABLE user_ai_guardrails ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_capture_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_feedback ENABLE ROW LEVEL SECURITY;

-- Guardrails policies
CREATE POLICY "Users can view own guardrails"
    ON user_ai_guardrails FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own guardrails"
    ON user_ai_guardrails FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own guardrails"
    ON user_ai_guardrails FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Context policies
CREATE POLICY "Users can manage own contexts"
    ON capture_contexts FOR ALL
    USING (auth.uid() = user_id);

-- Offline queue policies
CREATE POLICY "Users can manage own offline queue"
    ON offline_capture_queue FOR ALL
    USING (auth.uid() = user_id);

-- Feedback policies
CREATE POLICY "Users can manage own feedback"
    ON guardrail_feedback FOR ALL
    USING (auth.uid() = user_id);

-- Create triggers for updated_at
CREATE TRIGGER update_guardrails_updated_at
    BEFORE UPDATE ON user_ai_guardrails
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contexts_updated_at
    BEFORE UPDATE ON capture_contexts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON user_ai_guardrails TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON capture_contexts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON offline_capture_queue TO authenticated;
GRANT SELECT, INSERT ON guardrail_feedback TO authenticated;

-- Add sample guardrails for different user types
-- Mechanic profile
INSERT INTO user_ai_guardrails (
    user_id, 
    part_identification_level, 
    include_part_numbers,
    problem_diagnosis,
    suggest_next_steps,
    blur_license_plates
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid, -- Sample mechanic user
    'expert',
    true,
    true,
    true,
    true
) ON CONFLICT (user_id) DO NOTHING;

-- Dealer profile (like Viva! Las Vegas Autos)
INSERT INTO user_ai_guardrails (
    user_id,
    part_identification_level,
    estimate_condition,
    categorize_by_angle,
    categorize_by_quality,
    make_cost_estimates
) VALUES (
    '00000000-0000-0000-0000-000000000002'::uuid, -- Sample dealer user
    'intermediate',
    true,
    true,
    true,
    true
) ON CONFLICT (user_id) DO NOTHING;
