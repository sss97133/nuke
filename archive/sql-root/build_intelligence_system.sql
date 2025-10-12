-- Build Intelligence System
-- Tracks actual user activity patterns to determine real build status
-- Not based on user claims, but on actual contribution patterns

-- Enhanced timeline events with granular tracking
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS activity_type TEXT;
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50;
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS automated_tags TEXT[] DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS manual_tags TEXT[] DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS photo_analysis JSONB DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS receipt_data JSONB DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS parts_mentioned TEXT[] DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS tools_mentioned TEXT[] DEFAULT '{}';
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS labor_hours DECIMAL;
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS cost_estimate DECIMAL;

-- Build activity patterns table
CREATE TABLE IF NOT EXISTS build_activity_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Activity frequency metrics
    total_events INTEGER DEFAULT 0,
    events_last_7_days INTEGER DEFAULT 0,
    events_last_30_days INTEGER DEFAULT 0,
    events_last_90_days INTEGER DEFAULT 0,

    -- Content richness metrics
    photos_uploaded INTEGER DEFAULT 0,
    receipts_uploaded INTEGER DEFAULT 0,
    parts_documented INTEGER DEFAULT 0,
    tools_documented INTEGER DEFAULT 0,
    labor_hours_logged DECIMAL DEFAULT 0,
    money_spent_documented DECIMAL DEFAULT 0,

    -- Build stage indicators
    current_build_stage TEXT DEFAULT 'planning', -- planning, disassembly, sourcing, assembly, tuning, complete
    progress_confidence DECIMAL DEFAULT 0.0 CHECK (progress_confidence >= 0.0 AND progress_confidence <= 1.0),
    stagnation_risk DECIMAL DEFAULT 0.0 CHECK (stagnation_risk >= 0.0 AND stagnation_risk <= 1.0),
    completion_estimate DECIMAL DEFAULT 0.0 CHECK (completion_estimate >= 0.0 AND completion_estimate <= 1.0),

    -- Activity pattern classification
    activity_classification TEXT DEFAULT 'unknown', -- active, moderate, stagnant, abandoned, completed
    last_meaningful_activity TIMESTAMPTZ,
    average_days_between_activities DECIMAL,
    activity_trend TEXT DEFAULT 'stable', -- increasing, stable, decreasing, stopped

    -- Data quality scores
    documentation_quality_score INTEGER DEFAULT 0 CHECK (documentation_quality_score >= 0 AND documentation_quality_score <= 100),
    photo_quality_score INTEGER DEFAULT 0 CHECK (photo_quality_score >= 0 AND photo_quality_score <= 100),
    data_completeness_score INTEGER DEFAULT 0 CHECK (data_completeness_score >= 0 AND data_completeness_score <= 100),

    -- Automated insights
    detected_issues TEXT[] DEFAULT '{}',
    recommended_actions TEXT[] DEFAULT '{}',
    build_health_score INTEGER DEFAULT 0 CHECK (build_health_score >= 0 AND build_health_score <= 100),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(vehicle_id, user_id)
);

-- Parts and tools tracking with context
CREATE TABLE IF NOT EXISTS build_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    timeline_event_id UUID REFERENCES timeline_events(id),

    component_type TEXT NOT NULL, -- part, tool, consumable, service
    component_name TEXT NOT NULL,
    brand TEXT,
    part_number TEXT,
    quantity INTEGER DEFAULT 1,
    unit_cost DECIMAL,
    total_cost DECIMAL,

    -- Context tracking
    installation_status TEXT DEFAULT 'ordered', -- ordered, received, installed, needs_replacement
    usage_frequency TEXT, -- daily, weekly, project_only, one_time
    condition_rating INTEGER CHECK (condition_rating >= 1 AND condition_rating <= 10),

    -- Documentation
    receipt_url TEXT,
    installation_photos TEXT[],
    notes TEXT,

    -- Automated detection from photos/receipts
    detected_from_photo BOOLEAN DEFAULT FALSE,
    detected_from_receipt BOOLEAN DEFAULT FALSE,
    confidence_level DECIMAL DEFAULT 0.0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photo analysis and automated tagging
CREATE TABLE IF NOT EXISTS photo_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timeline_event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,

    -- AWS Rekognition results
    detected_objects JSONB DEFAULT '{}',
    detected_text JSONB DEFAULT '{}',
    detected_faces JSONB DEFAULT '{}',
    detected_scenes JSONB DEFAULT '{}',

    -- Automotive-specific detection
    vehicle_parts_detected TEXT[] DEFAULT '{}',
    tools_detected TEXT[] DEFAULT '{}',
    brands_detected TEXT[] DEFAULT '{}',
    work_stage_indicators TEXT[] DEFAULT '{}',

    -- Build stage classification
    suggested_build_stage TEXT,
    stage_confidence DECIMAL DEFAULT 0.0,

    -- Quality metrics
    image_quality_score INTEGER DEFAULT 0,
    documentation_value INTEGER DEFAULT 0, -- how useful this photo is for build documentation

    -- Manual overrides
    manual_tags TEXT[] DEFAULT '{}',
    user_verified BOOLEAN DEFAULT FALSE,

    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Build intelligence functions

-- Function to analyze build activity patterns
CREATE OR REPLACE FUNCTION analyze_build_patterns(target_vehicle_id UUID)
RETURNS VOID AS $$
DECLARE
    pattern_record build_activity_patterns%ROWTYPE;
    event_count INTEGER;
    recent_events INTEGER;
    last_event TIMESTAMPTZ;
    avg_days DECIMAL;
    photo_count INTEGER;
    receipt_count INTEGER;
    total_cost DECIMAL;
    activity_class TEXT;
    stagnation_score DECIMAL;
    health_score INTEGER;
BEGIN
    -- Get basic event statistics
    SELECT COUNT(*), MAX(created_at) INTO event_count, last_event
    FROM timeline_events
    WHERE vehicle_id = target_vehicle_id;

    -- Get recent activity
    SELECT COUNT(*) INTO recent_events
    FROM timeline_events
    WHERE vehicle_id = target_vehicle_id
    AND created_at >= NOW() - INTERVAL '30 days';

    -- Calculate average days between activities
    WITH event_gaps AS (
        SELECT
            EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) / 86400 as gap_days
        FROM timeline_events
        WHERE vehicle_id = target_vehicle_id
        AND created_at >= NOW() - INTERVAL '1 year'
    )
    SELECT AVG(gap_days) INTO avg_days FROM event_gaps WHERE gap_days IS NOT NULL;

    -- Count photos and receipts
    SELECT
        COUNT(*) FILTER (WHERE array_length(image_urls, 1) > 0),
        COUNT(*) FILTER (WHERE receipt_data IS NOT NULL AND receipt_data != '{}')
    INTO photo_count, receipt_count
    FROM timeline_events
    WHERE vehicle_id = target_vehicle_id;

    -- Calculate total documented costs
    SELECT COALESCE(SUM(total_cost), 0) INTO total_cost
    FROM build_components
    WHERE vehicle_id = target_vehicle_id;

    -- Determine activity classification
    IF recent_events = 0 AND (last_event IS NULL OR last_event < NOW() - INTERVAL '90 days') THEN
        activity_class := 'abandoned';
        stagnation_score := 0.9;
    ELSIF recent_events = 0 AND last_event < NOW() - INTERVAL '60 days' THEN
        activity_class := 'stagnant';
        stagnation_score := 0.7;
    ELSIF recent_events >= 1 AND recent_events < 3 THEN
        activity_class := 'moderate';
        stagnation_score := 0.3;
    ELSIF recent_events >= 3 THEN
        activity_class := 'active';
        stagnation_score := 0.1;
    ELSE
        activity_class := 'unknown';
        stagnation_score := 0.5;
    END IF;

    -- Calculate health score (0-100)
    health_score := LEAST(100, GREATEST(0,
        (recent_events * 20) +
        (CASE WHEN photo_count > 0 THEN 20 ELSE 0 END) +
        (CASE WHEN receipt_count > 0 THEN 20 ELSE 0 END) +
        (CASE WHEN total_cost > 0 THEN 20 ELSE 0 END) +
        (CASE WHEN avg_days IS NOT NULL AND avg_days < 30 THEN 20 ELSE 0 END)
    ));

    -- Insert or update pattern record
    INSERT INTO build_activity_patterns (
        vehicle_id,
        user_id,
        total_events,
        events_last_30_days,
        photos_uploaded,
        receipts_uploaded,
        money_spent_documented,
        activity_classification,
        last_meaningful_activity,
        average_days_between_activities,
        stagnation_risk,
        build_health_score,
        updated_at
    )
    SELECT
        target_vehicle_id,
        v.created_by,
        event_count,
        recent_events,
        photo_count,
        receipt_count,
        total_cost,
        activity_class,
        last_event,
        avg_days,
        stagnation_score,
        health_score,
        NOW()
    FROM vehicles v WHERE v.id = target_vehicle_id
    ON CONFLICT (vehicle_id, user_id) DO UPDATE SET
        total_events = EXCLUDED.total_events,
        events_last_30_days = EXCLUDED.events_last_30_days,
        photos_uploaded = EXCLUDED.photos_uploaded,
        receipts_uploaded = EXCLUDED.receipts_uploaded,
        money_spent_documented = EXCLUDED.money_spent_documented,
        activity_classification = EXCLUDED.activity_classification,
        last_meaningful_activity = EXCLUDED.last_meaningful_activity,
        average_days_between_activities = EXCLUDED.average_days_between_activities,
        stagnation_risk = EXCLUDED.stagnation_risk,
        build_health_score = EXCLUDED.build_health_score,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to find stagnant builds based on actual data
CREATE OR REPLACE FUNCTION find_stagnant_builds(
    model_filter TEXT DEFAULT NULL,
    days_inactive INTEGER DEFAULT 60,
    min_events_required INTEGER DEFAULT 1
)
RETURNS TABLE (
    vehicle_id UUID,
    year INTEGER,
    make TEXT,
    model TEXT,
    last_activity TIMESTAMPTZ,
    days_since_activity INTEGER,
    total_events INTEGER,
    stagnation_risk DECIMAL,
    build_health_score INTEGER,
    detected_issues TEXT[]
) AS $$
BEGIN
    -- Refresh all build patterns first
    PERFORM analyze_build_patterns(v.id) FROM vehicles v;

    RETURN QUERY
    SELECT
        v.id,
        v.year,
        v.make,
        v.model,
        bap.last_meaningful_activity,
        EXTRACT(EPOCH FROM (NOW() - bap.last_meaningful_activity))::INTEGER / 86400,
        bap.total_events,
        bap.stagnation_risk,
        bap.build_health_score,
        bap.detected_issues
    FROM vehicles v
    JOIN build_activity_patterns bap ON v.id = bap.vehicle_id
    WHERE
        (model_filter IS NULL OR v.model ILIKE '%' || model_filter || '%')
        AND bap.total_events >= min_events_required
        AND (
            bap.last_meaningful_activity < NOW() - INTERVAL '1 day' * days_inactive
            OR bap.activity_classification IN ('stagnant', 'abandoned')
        )
    ORDER BY bap.stagnation_risk DESC, bap.last_meaningful_activity ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to find active builds with frequent updates
CREATE OR REPLACE FUNCTION find_active_builds(
    model_filter TEXT DEFAULT NULL,
    min_health_score INTEGER DEFAULT 60
)
RETURNS TABLE (
    vehicle_id UUID,
    year INTEGER,
    make TEXT,
    model TEXT,
    last_activity TIMESTAMPTZ,
    events_last_30_days INTEGER,
    build_health_score INTEGER,
    activity_trend TEXT,
    current_build_stage TEXT
) AS $$
BEGIN
    -- Refresh all build patterns first
    PERFORM analyze_build_patterns(v.id) FROM vehicles v;

    RETURN QUERY
    SELECT
        v.id,
        v.year,
        v.make,
        v.model,
        bap.last_meaningful_activity,
        bap.events_last_30_days,
        bap.build_health_score,
        bap.activity_trend,
        bap.current_build_stage
    FROM vehicles v
    JOIN build_activity_patterns bap ON v.id = bap.vehicle_id
    WHERE
        (model_filter IS NULL OR v.model ILIKE '%' || model_filter || '%')
        AND bap.build_health_score >= min_health_score
        AND bap.activity_classification IN ('active', 'moderate')
        AND bap.events_last_30_days > 0
    ORDER BY bap.build_health_score DESC, bap.events_last_30_days DESC;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update patterns when timeline events change
CREATE OR REPLACE FUNCTION update_build_patterns_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Analyze patterns for affected vehicle
    PERFORM analyze_build_patterns(COALESCE(NEW.vehicle_id, OLD.vehicle_id));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DO $$ BEGIN
    CREATE TRIGGER trigger_update_build_patterns
    AFTER INSERT OR UPDATE OR DELETE ON timeline_events
    FOR EACH ROW EXECUTE FUNCTION update_build_patterns_trigger();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_build_patterns_activity ON build_activity_patterns(activity_classification);
CREATE INDEX IF NOT EXISTS idx_build_patterns_health ON build_activity_patterns(build_health_score DESC);
CREATE INDEX IF NOT EXISTS idx_build_patterns_stagnation ON build_activity_patterns(stagnation_risk DESC);
CREATE INDEX IF NOT EXISTS idx_build_patterns_vehicle ON build_activity_patterns(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_timeline_events_vehicle_date ON timeline_events(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_components_vehicle ON build_components(vehicle_id);

-- Sample data analysis views

-- View for build health dashboard
CREATE OR REPLACE VIEW build_health_dashboard AS
SELECT
    v.year,
    v.make,
    v.model,
    COUNT(*) as total_builds,
    COUNT(*) FILTER (WHERE bap.activity_classification = 'active') as active_builds,
    COUNT(*) FILTER (WHERE bap.activity_classification = 'stagnant') as stagnant_builds,
    COUNT(*) FILTER (WHERE bap.activity_classification = 'abandoned') as abandoned_builds,
    AVG(bap.build_health_score) as avg_health_score,
    AVG(bap.stagnation_risk) as avg_stagnation_risk
FROM vehicles v
LEFT JOIN build_activity_patterns bap ON v.id = bap.vehicle_id
GROUP BY v.year, v.make, v.model
HAVING COUNT(*) > 0
ORDER BY avg_health_score DESC;

COMMIT;