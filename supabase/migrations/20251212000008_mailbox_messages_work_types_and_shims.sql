-- Mailbox shims for inbox-style workflow (work requests + receipts)
-- - Align mailbox schema with Edge Function usage (comment/user_message)
-- - Allow vehicles without VINs (VIN may be null during onboarding)
-- - Expand mailbox message types to support work-oriented workflow wording
-- - Add mailbox_messages.vehicle_id for easier joins and agent writes
-- - Backfill mailboxes + basic access keys for existing vehicles
--
-- Safe to run multiple times (IF EXISTS / IF NOT EXISTS shims).

begin;

-- ---------------------------------------------------------------------------
-- vehicle_mailboxes: VIN should be nullable (vehicles can exist pre-VIN)
-- ---------------------------------------------------------------------------
alter table if exists public.vehicle_mailboxes
  alter column vin drop not null;

-- Drop legacy unique constraint on vin (replaced by partial unique index)
alter table if exists public.vehicle_mailboxes
  drop constraint if exists vehicle_mailboxes_vin_key;

create unique index if not exists idx_vehicle_mailboxes_vin_unique
  on public.vehicle_mailboxes(vin)
  where vin is not null;

-- ---------------------------------------------------------------------------
-- mailbox_messages: add vehicle_id + expand message_type enum-like constraint
-- ---------------------------------------------------------------------------
alter table if exists public.mailbox_messages
  add column if not exists vehicle_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mailbox_messages_vehicle_id_fkey'
  ) then
    alter table public.mailbox_messages
      add constraint mailbox_messages_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id) on delete cascade;
  end if;
end $$;

-- Backfill vehicle_id on existing messages (derive from mailbox)
update public.mailbox_messages mm
   set vehicle_id = vm.vehicle_id
  from public.vehicle_mailboxes vm
 where mm.vehicle_id is null
   and mm.mailbox_id = vm.id;

-- If any rows exist with older "job_*" types, map them to "work_*" wording
update public.mailbox_messages
   set message_type = case message_type
     when 'job_request' then 'work_request'
     when 'job_listing' then 'work_order'
     when 'job_completed' then 'work_completed'
     when 'job_hold' then 'funds_hold'
     else message_type
   end
 where message_type in ('job_request', 'job_listing', 'job_completed', 'job_hold');

-- Expand message_type to support inbox-style workflow (work-oriented wording)
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

    -- Work workflow (owner demand -> provider delivery -> proof/receipt)
    'work_request',
    'work_order',
    'quote',
    'acceptance',
    'status_update',
    'work_completed',
    'receipt',
    'funds_committed',
    'funds_hold',
    'payment_hold'
  ));

create index if not exists idx_mailbox_messages_vehicle_created
  on public.mailbox_messages(vehicle_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Backfill: ensure every vehicle has a mailbox (even if vin is null)
-- ---------------------------------------------------------------------------
insert into public.vehicle_mailboxes (vehicle_id, vin)
select v.id, v.vin
  from public.vehicles v
 where not exists (
   select 1 from public.vehicle_mailboxes vm where vm.vehicle_id = v.id
 );

-- Backfill: best-effort access keys for existing vehicles
-- - user_id gets master owner key
-- - uploaded_by gets inherited trusted_party key (if vehicles schema has uploaded_by)
insert into public.mailbox_access_keys (mailbox_id, user_id, key_type, permission_level, relationship_type, granted_by)
select vm.id, v.user_id, 'master', 'read_write', 'owner', v.user_id
  from public.vehicles v
  join public.vehicle_mailboxes vm on vm.vehicle_id = v.id
 where v.user_id is not null
on conflict do nothing;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'uploaded_by'
  ) then
    insert into public.mailbox_access_keys (mailbox_id, user_id, key_type, permission_level, relationship_type, granted_by)
    select vm.id, v.uploaded_by, 'inherited', 'read_write', 'trusted_party', v.uploaded_by
      from public.vehicles v
      join public.vehicle_mailboxes vm on vm.vehicle_id = v.id
     where v.uploaded_by is not null
    on conflict do nothing;
  end if;
end $$;

commit;


