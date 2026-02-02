-- Nuke Box Queue Table
-- Stores uploaded images from local scanner for processing

CREATE TABLE IF NOT EXISTS nuke_box_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source tracking
    source_path TEXT,                    -- Original path on user's machine
    storage_path TEXT NOT NULL,          -- Path in Supabase storage
    image_url TEXT NOT NULL,             -- Public URL

    -- Classification from local LLM
    classification JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    vehicle_group TEXT,                  -- Group ID from scanner

    -- Processing state
    processing_status TEXT DEFAULT 'pending',
    priority INT DEFAULT 5,              -- 0 = highest (titles), 5 = normal

    -- Linking results
    matched_vehicle_id UUID REFERENCES vehicles(id),
    created_vehicle_id UUID REFERENCES vehicles(id),
    ownership_verification_id UUID REFERENCES ownership_verifications(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Error tracking
    error_message TEXT,
    retry_count INT DEFAULT 0
);

-- Indexes for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_nuke_box_queue_status
    ON nuke_box_queue(processing_status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_nuke_box_queue_vehicle_group
    ON nuke_box_queue(vehicle_group) WHERE vehicle_group IS NOT NULL;

-- Function to increment device image count
CREATE OR REPLACE FUNCTION increment_device_image_count(fingerprint TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE device_attributions
    SET image_count = COALESCE(image_count, 0) + 1,
        last_seen = NOW()
    WHERE device_fingerprint = fingerprint;
END;
$$ LANGUAGE plpgsql;

-- Add RLS policies
ALTER TABLE nuke_box_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
CREATE POLICY "Service role full access on nuke_box_queue"
    ON nuke_box_queue
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE nuke_box_queue IS 'Queue for processing images uploaded from Nuke Box local scanner';
COMMENT ON COLUMN nuke_box_queue.vehicle_group IS 'Group ID assigned by scanner for images that appear to be of the same vehicle';
COMMENT ON COLUMN nuke_box_queue.priority IS '0=title documents (highest), 1=grouped vehicles, 2=ungrouped vehicles, 5=other';
