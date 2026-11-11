-- outbound_messages: the outbox behind supabase/functions/_shared/outbound.ts, the one gate every email, SMS,
-- WhatsApp and iMessage to a person passes through. In internal_only mode (the default) a message to a recipient
-- not on OUTBOUND_ALLOWLIST is not sent; the gate writes the row here with status 'held'. A human approves one
-- exact message by setting its row to 'approved'; releaseApproved() then sends it as stored.
--
-- Checked 2026-11-11 before minting: no existing table holds a held/approved message for email or SMS.
-- imessage_outbound is an iMessage-only queue the local bridge drains (chat id + text, no subject, no approval
-- state); agent_messages is the inter-agent inbox; notification_events carries no recipient or body. The gate still
-- queues allowed iMessages into imessage_outbound.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'imessage')),
  recipient        text NOT NULL,
  subject          text,
  body             text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL CHECK (status IN ('held', 'approved', 'rejected', 'sent', 'suppressed', 'failed')),
  reason           text,
  calling_function text NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('off', 'internal_only', 'live')),
  content_sha256   text NOT NULL,
  provider_id      text,
  approved_by      uuid,
  approved_at      timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.outbound_messages IS
  'Outbox of the outbound gate (_shared/outbound.ts). One row per message the gate did not send (held, suppressed) or released after a human approved it. Grain: one message to one recipient. Writer: the gate, with the service key. Private: recipients and bodies.';

CREATE INDEX IF NOT EXISTS outbound_messages_status_created_idx ON public.outbound_messages (status, created_at DESC);

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_messages FROM anon, authenticated;
-- No policies: only the service role reads or writes.
