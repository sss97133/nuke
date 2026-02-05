-- Telegram System Overhaul
-- Bi-directional Claude Code approval flow via Telegram

-- 1. Claude approval requests (pending permissions)
CREATE TABLE IF NOT EXISTS claude_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,  -- Claude Code session ID
    request_id TEXT UNIQUE NOT NULL,  -- Short unique ID for matching
    tool_name TEXT NOT NULL,
    tool_input JSONB NOT NULL DEFAULT '{}',
    description TEXT,  -- Human-readable description
    context JSONB DEFAULT '{}',  -- Additional context (cwd, files, etc)

    -- Telegram tracking
    telegram_message_id BIGINT,  -- Message ID in Telegram
    telegram_chat_id BIGINT,

    -- Status and response
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'error')),
    response_text TEXT,  -- User's detailed response
    response_data JSONB DEFAULT '{}',  -- Structured response
    responded_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',

    -- Indexes
    CONSTRAINT valid_request_id CHECK (request_id ~ '^[a-zA-Z0-9_-]+$')
);

CREATE INDEX idx_approval_requests_pending ON claude_approval_requests(status) WHERE status = 'pending';
CREATE INDEX idx_approval_requests_session ON claude_approval_requests(session_id);
CREATE INDEX idx_approval_requests_request_id ON claude_approval_requests(request_id);
CREATE INDEX idx_approval_requests_created ON claude_approval_requests(created_at DESC);

-- 2. Telegram conversations (multi-turn chat tracking)
CREATE TABLE IF NOT EXISTS telegram_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,

    -- Context
    current_topic TEXT,  -- What we're discussing
    current_vehicle_id UUID REFERENCES vehicles(id),
    active_task_id UUID,  -- Reference to telegram_tasks
    active_approval_id UUID REFERENCES claude_approval_requests(id),

    -- Conversation state
    state TEXT DEFAULT 'idle',  -- idle, awaiting_approval, awaiting_input, processing
    context JSONB DEFAULT '{}',
    history JSONB DEFAULT '[]',  -- Recent messages for context

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(chat_id)
);

CREATE INDEX idx_telegram_conversations_chat ON telegram_conversations(chat_id);
CREATE INDEX idx_telegram_conversations_active ON telegram_conversations(state) WHERE state != 'idle';

-- 3. Telegram tasks (unified task queue)
CREATE TABLE IF NOT EXISTS telegram_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Task info
    task_type TEXT NOT NULL DEFAULT 'query',  -- query, command, approval, notification
    prompt TEXT NOT NULL,
    context JSONB DEFAULT '{}',  -- Session context, vehicle info, etc

    -- Source
    chat_id BIGINT NOT NULL,
    user_id BIGINT,
    reply_to_message_id BIGINT,  -- For threading

    -- Execution
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    assigned_to TEXT,  -- Worker ID or 'claude_api' or 'ollama'
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Result
    result JSONB DEFAULT '{}',
    result_text TEXT,
    error TEXT,

    -- Metadata
    priority INTEGER DEFAULT 0,  -- Higher = more urgent
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Retry handling
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ
);

CREATE INDEX idx_telegram_tasks_pending ON telegram_tasks(status, priority DESC, created_at)
    WHERE status = 'pending';
CREATE INDEX idx_telegram_tasks_chat ON telegram_tasks(chat_id, created_at DESC);
CREATE INDEX idx_telegram_tasks_status ON telegram_tasks(status);

-- 4. Telegram message log (for context and debugging)
CREATE TABLE IF NOT EXISTS telegram_message_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Message details
    message_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    user_id BIGINT,
    username TEXT,

    -- Content
    message_type TEXT DEFAULT 'text',  -- text, photo, document, callback_query
    text TEXT,
    media_file_id TEXT,
    callback_data TEXT,

    -- Direction
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),

    -- References
    reply_to_message_id BIGINT,
    task_id UUID REFERENCES telegram_tasks(id),
    approval_id UUID REFERENCES claude_approval_requests(id),

    -- Metadata
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_payload JSONB  -- Full Telegram payload for debugging
);

CREATE INDEX idx_telegram_message_log_chat ON telegram_message_log(chat_id, received_at DESC);
CREATE INDEX idx_telegram_message_log_task ON telegram_message_log(task_id) WHERE task_id IS NOT NULL;

-- 5. Helper function to generate short request IDs
CREATE OR REPLACE FUNCTION generate_approval_request_id()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- No I, O, 0, 1 for clarity
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 6. Function to create an approval request
CREATE OR REPLACE FUNCTION create_approval_request(
    p_session_id TEXT,
    p_tool_name TEXT,
    p_tool_input JSONB,
    p_description TEXT DEFAULT NULL,
    p_context JSONB DEFAULT '{}',
    p_chat_id BIGINT DEFAULT NULL,
    p_expires_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(request_id TEXT, id UUID) AS $$
DECLARE
    v_request_id TEXT;
    v_id UUID;
BEGIN
    -- Generate unique request ID
    LOOP
        v_request_id := generate_approval_request_id();
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM claude_approval_requests WHERE claude_approval_requests.request_id = v_request_id
        );
    END LOOP;

    INSERT INTO claude_approval_requests (
        session_id, request_id, tool_name, tool_input, description, context,
        telegram_chat_id, expires_at
    ) VALUES (
        p_session_id, v_request_id, p_tool_name, p_tool_input, p_description, p_context,
        p_chat_id, NOW() + (p_expires_minutes || ' minutes')::interval
    )
    RETURNING claude_approval_requests.id INTO v_id;

    RETURN QUERY SELECT v_request_id, v_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Function to respond to an approval request
CREATE OR REPLACE FUNCTION respond_to_approval(
    p_request_id TEXT,
    p_status TEXT,  -- 'approved' or 'denied'
    p_response_text TEXT DEFAULT NULL,
    p_response_data JSONB DEFAULT '{}'
)
RETURNS TABLE(success BOOLEAN, error TEXT) AS $$
DECLARE
    v_record claude_approval_requests%ROWTYPE;
BEGIN
    -- Find and lock the request
    SELECT * INTO v_record
    FROM claude_approval_requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Request not found';
        RETURN;
    END IF;

    IF v_record.status != 'pending' THEN
        RETURN QUERY SELECT FALSE, 'Request already ' || v_record.status;
        RETURN;
    END IF;

    IF v_record.expires_at < NOW() THEN
        UPDATE claude_approval_requests SET status = 'expired' WHERE id = v_record.id;
        RETURN QUERY SELECT FALSE, 'Request expired';
        RETURN;
    END IF;

    -- Update the request
    UPDATE claude_approval_requests
    SET status = p_status,
        response_text = p_response_text,
        response_data = p_response_data,
        responded_at = NOW()
    WHERE id = v_record.id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to poll for approval response
CREATE OR REPLACE FUNCTION poll_approval_response(p_request_id TEXT)
RETURNS TABLE(
    status TEXT,
    response_text TEXT,
    response_data JSONB,
    expired BOOLEAN
) AS $$
DECLARE
    v_record claude_approval_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_record
    FROM claude_approval_requests
    WHERE request_id = p_request_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::JSONB, FALSE;
        RETURN;
    END IF;

    -- Check expiration
    IF v_record.status = 'pending' AND v_record.expires_at < NOW() THEN
        UPDATE claude_approval_requests SET status = 'expired' WHERE id = v_record.id;
        RETURN QUERY SELECT 'expired'::TEXT, NULL::TEXT, NULL::JSONB, TRUE;
        RETURN;
    END IF;

    RETURN QUERY SELECT v_record.status, v_record.response_text, v_record.response_data, FALSE;
END;
$$ LANGUAGE plpgsql;

-- 9. Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER telegram_conversations_updated_at
    BEFORE UPDATE ON telegram_conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER telegram_tasks_updated_at
    BEFORE UPDATE ON telegram_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 10. Cleanup function for expired requests (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_approvals()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE claude_approval_requests
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL ON claude_approval_requests TO service_role;
GRANT ALL ON telegram_conversations TO service_role;
GRANT ALL ON telegram_tasks TO service_role;
GRANT ALL ON telegram_message_log TO service_role;
GRANT EXECUTE ON FUNCTION create_approval_request TO service_role;
GRANT EXECUTE ON FUNCTION respond_to_approval TO service_role;
GRANT EXECUTE ON FUNCTION poll_approval_response TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_approvals TO service_role;

COMMENT ON TABLE claude_approval_requests IS 'Tracks Claude Code permission requests that need Telegram approval';
COMMENT ON TABLE telegram_conversations IS 'Maintains conversation state for multi-turn Telegram chats';
COMMENT ON TABLE telegram_tasks IS 'Unified task queue for Telegram-triggered work';
COMMENT ON TABLE telegram_message_log IS 'Full message history for context and debugging';
