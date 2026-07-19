-- instagram_deletion_requests — Meta compliance: persist the confirmation code that
-- instagram-connect returns from its /data-deletion (and /deauth) webhooks so that
-- nuke.ag/privacy#ig-deletion-<code> can render a human-readable deletion status.
-- Before this table the code was generated and returned to Meta but never stored —
-- the status URL had nothing to look up (TOOLBOX item 2d, 2026-07-19).
-- Deletion is synchronous inside the webhook (revoke + purge complete before the
-- code is returned), so a persisted row always describes a COMPLETED request.
-- Service-role only: RLS enabled, no policies. Public reads go through the
-- instagram-connect GET /deletion-status route, which returns minimal fields.

create table if not exists public.instagram_deletion_requests (
  confirmation_code   text primary key,
  ig_user_id          text not null,
  route               text not null check (route in ('deauth', 'data-deletion')),
  connections_revoked integer not null default 0,
  requested_at        timestamptz not null default now()
);

comment on table public.instagram_deletion_requests is
  'Meta deauth/data-deletion webhook receipts (instagram-connect). Row = completed revoke+purge; confirmation_code is the lookup key for nuke.ag/privacy#ig-deletion-<code>.';

alter table public.instagram_deletion_requests enable row level security;
