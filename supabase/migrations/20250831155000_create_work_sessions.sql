-- Create work_sessions table first (required by user_activities)
CREATE TABLE IF NOT EXISTS work_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL,
    confidence_score DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    image_count INTEGER NOT NULL DEFAULT 0,
    work_description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_work_sessions_user_id ON work_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_vehicle_id ON work_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_date ON work_sessions(session_date);

-- Add RLS policies
ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own work sessions"
ON work_sessions FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own work sessions"
ON work_sessions FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own work sessions"
ON work_sessions FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own work sessions"
ON work_sessions FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_work_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_work_sessions_updated_at
    BEFORE UPDATE ON work_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_work_sessions_updated_at();
