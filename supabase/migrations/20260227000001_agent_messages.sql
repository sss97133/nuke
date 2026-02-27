-- Agent messaging system — inter-agent inbox
-- Agents communicate via DB (internal) or Resend (founder email)

CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID DEFAULT gen_random_uuid(),
  reply_to_id UUID REFERENCES agent_messages(id),

  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,

  from_email TEXT,
  to_email TEXT,

  subject TEXT NOT NULL,
  body TEXT NOT NULL,

  sent_via TEXT DEFAULT 'internal',
  resend_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_to_role ON agent_messages(to_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_unread ON agent_messages(to_role) WHERE read_at IS NULL;

-- Service role full access, no RLS needed (internal system table)
ALTER TABLE agent_messages DISABLE ROW LEVEL SECURITY;
GRANT ALL ON agent_messages TO service_role;
GRANT ALL ON agent_messages TO postgres;

COMMENT ON TABLE agent_messages IS 'Inter-agent email inbox. Agents check on startup, send via agent-email edge function.';
