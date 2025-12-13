-- Work orders: publish/availability gating + visibility
-- Goal: allow "draft" work orders to exist without becoming part of the vehicle timeline
-- until explicitly made available (published).
-- Safe to run multiple times.

begin;

alter table if exists public.work_orders
  add column if not exists is_published boolean not null default false;

alter table if exists public.work_orders
  add column if not exists published_at timestamptz;

alter table if exists public.work_orders
  add column if not exists published_by uuid references auth.users(id) on delete set null;

alter table if exists public.work_orders
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private','invited','marketplace'));

create index if not exists idx_work_orders_published_at on public.work_orders(published_at desc);
create index if not exists idx_work_orders_is_published on public.work_orders(is_published);

commit;


