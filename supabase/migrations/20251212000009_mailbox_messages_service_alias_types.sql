-- Mailbox: allow service_* message_type aliases alongside work_* terms
-- Goal: keep language flexible ("work" and "service" are both valid), without reintroducing "job" wording.
-- Safe: drops/recreates the message_type CHECK constraint.

begin;

-- Prefer explicit money language for anything that interacts with cash/holds.
-- This is specifically the "owner already put up funds" credibility signal.
-- Canonical: funds_committed
-- Backwards compatible: accept and map older variants.
update public.mailbox_messages
   set message_type = 'funds_committed'
 where message_type in ('funds_hold', 'payment_hold');

alter table if exists public.mailbox_messages
  drop constraint if exists mailbox_messages_message_type_check;

alter table public.mailbox_messages
  add constraint mailbox_messages_message_type_check
  check (message_type in (
    -- Existing system notifications
    'duplicate_detected',
    'ownership_transfer',
    'service_reminder',
    'insurance_claim',
    'recall_notice',
    'registration_due',
    'inspection_due',
    'system_alert',

    -- Human + inbox workflow
    'comment',
    'user_message',

    -- Work workflow (canonical wording used across the repo)
    'work_request',
    'work_order',
    'quote',
    'acceptance',
    'status_update',
    'work_completed',
    'receipt',
    'funds_committed',

    -- Service aliases (allowed synonyms)
    'service_request',
    'service_order',
    'service_completed',

    -- Money aliases (allowed synonyms)
    'funds_hold',
    'payment_hold'
  ));

commit;


