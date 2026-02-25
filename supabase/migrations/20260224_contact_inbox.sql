-- ============================================================================
-- CONTACT INBOX - Inbound email storage for nuke.ag
-- ============================================================================
-- Receives emails via Resend inbound webhooks to privacy@, legal@,
-- info@, investors@ nuke.ag. Replaces need for external email client.
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Email metadata
  email_id text UNIQUE NOT NULL,        -- Resend email_id
  message_id text,                       -- RFC 822 Message-ID
  from_address text NOT NULL,
  from_name text,
  to_address text NOT NULL,              -- Which nuke.ag address received it
  cc text[],
  subject text NOT NULL DEFAULT '(no subject)',

  -- Content (fetched via Resend API after webhook)
  body_text text,
  body_html text,

  -- Attachments metadata
  attachments jsonb DEFAULT '[]'::jsonb,

  -- Threading
  in_reply_to text,                      -- For conversation tracking
  thread_id text,

  -- Status workflow
  status text NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'replied', 'archived', 'spam')),

  -- Reply tracking
  replied_at timestamptz,
  replied_by uuid REFERENCES auth.users(id),
  reply_resend_id text,                  -- Resend ID of our reply

  -- Metadata
  headers jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Timestamps
  received_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_inbox_status ON contact_inbox(status);
CREATE INDEX IF NOT EXISTS idx_contact_inbox_to ON contact_inbox(to_address);
CREATE INDEX IF NOT EXISTS idx_contact_inbox_received ON contact_inbox(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_inbox_from ON contact_inbox(from_address);

-- RLS
ALTER TABLE contact_inbox ENABLE ROW LEVEL SECURITY;

-- Only authenticated users with admin role can access
-- For now, allow all authenticated users (you can tighten later)
CREATE POLICY "Admins can read contact inbox"
  ON contact_inbox FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update contact inbox"
  ON contact_inbox FOR UPDATE
  TO authenticated
  USING (true);

-- Service role can insert (from edge function)
CREATE POLICY "Service can insert contact inbox"
  ON contact_inbox FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service can update contact inbox"
  ON contact_inbox FOR UPDATE
  TO service_role
  USING (true);

-- View for quick stats
CREATE OR REPLACE VIEW v_inbox_summary AS
SELECT
  to_address,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'unread') as unread,
  COUNT(*) FILTER (WHERE status = 'read') as read,
  COUNT(*) FILTER (WHERE status = 'replied') as replied,
  COUNT(*) FILTER (WHERE status = 'archived') as archived,
  MAX(received_at) as latest_email
FROM contact_inbox
WHERE status != 'spam'
GROUP BY to_address;
