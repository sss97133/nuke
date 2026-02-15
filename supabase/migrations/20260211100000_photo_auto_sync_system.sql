-- Photo Auto-Sync System
-- Enables automatic photo ingestion from Apple Photos, AI classification,
-- vehicle matching, multi-channel clarification, and album management.
BEGIN;

-- ============================================================================
-- 1. SYNC STATE (daemon watermark + health)
-- ============================================================================
CREATE TABLE IF NOT EXISTS photo_sync_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Watermarks
    last_processed_date TIMESTAMPTZ,
    last_processed_uuid TEXT,
    last_poll_at TIMESTAMPTZ,
    last_successful_upload_at TIMESTAMPTZ,

    -- Health
    daemon_version TEXT,
    daemon_started_at TIMESTAMPTZ,
    daemon_hostname TEXT,
    photos_processed_total INTEGER DEFAULT 0,
    photos_uploaded_total INTEGER DEFAULT 0,
    photos_skipped_total INTEGER DEFAULT 0,
    errors_total INTEGER DEFAULT 0,

    -- Config
    poll_interval_seconds INTEGER DEFAULT 60,
    batch_size INTEGER DEFAULT 10,
    auto_create_vehicles BOOLEAN DEFAULT true,
    auto_create_albums BOOLEAN DEFAULT true,
    min_confidence_auto_assign REAL DEFAULT 0.8,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

ALTER TABLE photo_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sync state" ON photo_sync_state
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access to photo_sync_state" ON photo_sync_state
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. PER-PHOTO SYNC TRACKING
-- ============================================================================
CREATE TABLE IF NOT EXISTS photo_sync_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Apple Photos identity
    photos_uuid TEXT NOT NULL,
    photos_filename TEXT,
    photos_date_added TIMESTAMPTZ,
    photos_date_taken TIMESTAMPTZ,
    photos_album_names TEXT[],

    -- Hashes
    file_hash_sha256 TEXT,
    perceptual_hash TEXT,
    difference_hash TEXT,

    -- Sync status
    sync_status TEXT DEFAULT 'detected' CHECK (sync_status IN (
        'detected', 'exporting', 'exported', 'uploading', 'uploaded',
        'classifying', 'classified', 'matching', 'matched',
        'pending_clarification', 'ignored', 'complete', 'error', 'duplicate'
    )),

    -- Classification
    is_automotive BOOLEAN,
    classification_category TEXT,
    classification_confidence REAL,
    vehicle_hints JSONB,

    -- Vehicle assignment
    matched_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    match_confidence REAL,
    match_method TEXT,

    -- Nuke integration
    vehicle_image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
    storage_url TEXT,

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,

    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    exported_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ,
    classified_at TIMESTAMPTZ,
    matched_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    UNIQUE(user_id, photos_uuid)
);

CREATE INDEX idx_photo_sync_items_status ON photo_sync_items(user_id, sync_status);
CREATE INDEX idx_photo_sync_items_hash ON photo_sync_items(file_hash_sha256)
    WHERE file_hash_sha256 IS NOT NULL;
CREATE INDEX idx_photo_sync_items_vehicle ON photo_sync_items(matched_vehicle_id)
    WHERE matched_vehicle_id IS NOT NULL;
CREATE INDEX idx_photo_sync_items_date ON photo_sync_items(photos_date_added DESC);

ALTER TABLE photo_sync_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sync items" ON photo_sync_items
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access to photo_sync_items" ON photo_sync_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 3. CLARIFICATION REQUESTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS clarification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    request_type TEXT NOT NULL CHECK (request_type IN (
        'vehicle_identity', 'new_vs_existing', 'vehicle_assignment',
        'album_confirmation', 'batch_assignment'
    )),

    -- Context
    photo_sync_item_ids UUID[],
    sample_image_urls TEXT[],
    ai_analysis JSONB,
    candidate_vehicles JSONB,

    -- Message sent
    message_text TEXT,
    message_sent_at TIMESTAMPTZ,
    message_channel TEXT,
    message_external_id TEXT,

    -- Response
    response_text TEXT,
    response_received_at TIMESTAMPTZ,
    response_channel TEXT,

    -- Resolution
    resolved_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    resolution TEXT,
    resolved_at TIMESTAMPTZ,

    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'sent', 'replied', 'resolved', 'timeout', 'cancelled'
    )),

    reminder_count INTEGER DEFAULT 0,
    max_reminders INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clarification_user_status ON clarification_requests(user_id, status);

ALTER TABLE clarification_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own clarifications" ON clarification_requests
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access to clarification_requests" ON clarification_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. USER SYNC PREFERENCES
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_sync_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    preferred_channel TEXT DEFAULT 'imessage' CHECK (preferred_channel IN (
        'imessage', 'sms', 'whatsapp', 'telegram', 'none'
    )),
    fallback_channel TEXT DEFAULT 'sms',

    phone_number TEXT,
    imessage_address TEXT,
    telegram_chat_id BIGINT,

    auto_create_vehicles BOOLEAN DEFAULT true,
    auto_create_albums BOOLEAN DEFAULT true,
    auto_assign_confidence REAL DEFAULT 0.8,
    filter_non_automotive BOOLEAN DEFAULT true,

    quiet_start_hour INTEGER DEFAULT 22,
    quiet_end_hour INTEGER DEFAULT 7,
    timezone TEXT DEFAULT 'America/Los_Angeles',

    max_messages_per_hour INTEGER DEFAULT 3,
    max_messages_per_day INTEGER DEFAULT 10,
    batch_clarifications BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

ALTER TABLE user_sync_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sync preferences" ON user_sync_preferences
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access to user_sync_preferences" ON user_sync_preferences
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 5. ALBUM SYNC MAP
-- ============================================================================
CREATE TABLE IF NOT EXISTS album_sync_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    apple_album_id TEXT NOT NULL,
    apple_album_name TEXT,

    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    image_set_id UUID REFERENCES image_sets(id) ON DELETE SET NULL,

    last_synced_at TIMESTAMPTZ,
    photo_count_apple INTEGER DEFAULT 0,
    photo_count_nuke INTEGER DEFAULT 0,
    sync_direction TEXT DEFAULT 'bidirectional',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, apple_album_id)
);

ALTER TABLE album_sync_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own album map" ON album_sync_map
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access to album_sync_map" ON album_sync_map
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. HELPER VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW photo_sync_dashboard AS
SELECT
    pss.user_id,
    pss.last_poll_at,
    pss.photos_processed_total,
    pss.photos_uploaded_total,
    pss.daemon_started_at,
    (SELECT COUNT(*) FROM photo_sync_items psi WHERE psi.user_id = pss.user_id AND psi.sync_status = 'complete') as completed,
    (SELECT COUNT(*) FROM photo_sync_items psi WHERE psi.user_id = pss.user_id AND psi.sync_status = 'pending_clarification') as pending_clarification,
    (SELECT COUNT(*) FROM photo_sync_items psi WHERE psi.user_id = pss.user_id AND psi.sync_status = 'error') as errors,
    (SELECT COUNT(*) FROM photo_sync_items psi WHERE psi.user_id = pss.user_id AND psi.sync_status = 'ignored') as ignored,
    (SELECT COUNT(*) FROM clarification_requests cr WHERE cr.user_id = pss.user_id AND cr.status = 'sent') as pending_questions
FROM photo_sync_state pss;

COMMIT;
