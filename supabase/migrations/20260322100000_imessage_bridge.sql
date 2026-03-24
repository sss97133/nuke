-- iMessage Bridge — conversation state for the owner's iMessage interface to Nuke.
-- See docs/imessage-bridge-architecture.md for the full strategic rationale.
--
-- This table stores conversation state for the local iMessage bridge daemon
-- (scripts/imessage-bridge.mjs) which polls ~/Library/Messages/chat.db and
-- routes messages through the imessage-router edge function.

CREATE TABLE IF NOT EXISTS imessage_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_identifier TEXT UNIQUE NOT NULL,       -- "+17029304818" or "user@icloud.com"

  -- Vehicle context
  active_vehicle_id UUID REFERENCES vehicles(id),
  active_vehicle_name TEXT,                   -- cached display name e.g. "1977 K5 Chevrolet Blazer"

  -- Conversation window (last 20 messages for LLM context)
  recent_messages JSONB DEFAULT '[]'::jsonb,
  context JSONB DEFAULT '{}'::jsonb,          -- search state, pending results, etc.

  -- Pending approval (tapback-driven)
  pending_action_type TEXT,                   -- 'approve_post', 'confirm_import', etc.
  pending_action_data JSONB,                  -- data to execute on approval
  pending_action_message_guid TEXT,           -- which sent message to watch for tapback on

  -- Bridge cursor
  last_processed_rowid BIGINT DEFAULT 0,

  -- Stats
  last_message_at TIMESTAMPTZ,
  messages_received INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  photos_received INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Column comments
COMMENT ON TABLE imessage_conversations IS 'Conversation state for the iMessage bridge. One row per chat. Owned by imessage-router edge function.';
COMMENT ON COLUMN imessage_conversations.chat_identifier IS 'The iMessage handle — phone number (+1...) or Apple ID email. Matches chat.chat_identifier in Messages.app SQLite DB.';
COMMENT ON COLUMN imessage_conversations.last_processed_rowid IS 'ROWID cursor in ~/Library/Messages/chat.db. Bridge resumes polling from this position after restart.';
COMMENT ON COLUMN imessage_conversations.pending_action_message_guid IS 'The guid of the outbound message awaiting a tapback reaction. Tapback liked=approve, disliked=deny.';
COMMENT ON COLUMN imessage_conversations.recent_messages IS 'Rolling window of last 20 messages [{role,text,ts}] passed to LLM for conversational context.';

-- Register iMessage as an observation source with maximum trust (owner direct input)
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('imessage', 'iMessage', 'owner', 1.0, ARRAY['media', 'condition', 'specification', 'ownership', 'work_record', 'sighting']::observation_kind[])
ON CONFLICT (slug) DO NOTHING;
