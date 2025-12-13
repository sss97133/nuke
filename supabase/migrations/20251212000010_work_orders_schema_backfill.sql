-- Backfill/ensure work_orders table exists for service/work request workflow
-- Used by UI components (WorkOrderRequestForm) and by mailbox AI drafting.
-- Safe to run multiple times.

begin;

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),

  -- Where the request is routed (nullable for early "draft" before matching)
  -- NOTE: in some local/dev schemas the businesses system may not exist yet.
  -- We keep this as a plain UUID and add the FK constraint only when businesses exists.
  organization_id uuid,

  -- Who requested it
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,

  -- What it is
  vehicle_id uuid references public.vehicles(id) on delete set null,
  title text not null,
  description text not null,
  urgency text default 'normal' check (urgency in ('low','normal','high','emergency')),

  -- Attachments
  images text[] default array[]::text[],

  -- Estimates + actuals (optional)
  estimated_hours numeric,
  estimated_labor_cost numeric,
  actual_hours numeric,

  -- Source + workflow
  request_source text default 'mailbox' check (request_source in ('web','sms','phone','email','mailbox','system')),
  status text default 'draft' check (status in ('draft','pending','quoted','approved','scheduled','in_progress','completed','paid','cancelled')),

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_orders_vehicle_id on public.work_orders(vehicle_id);
create index if not exists idx_work_orders_org_id on public.work_orders(organization_id);
create index if not exists idx_work_orders_customer_id on public.work_orders(customer_id);
create index if not exists idx_work_orders_status on public.work_orders(status);
create index if not exists idx_work_orders_created_at on public.work_orders(created_at desc);

-- best-effort updated_at trigger
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column') then
    drop trigger if exists trg_work_orders_updated_at on public.work_orders;
    create trigger trg_work_orders_updated_at
      before update on public.work_orders
      for each row execute function update_updated_at_column();
  end if;
end $$;

-- RLS
alter table public.work_orders enable row level security;

-- Customers can view their own requests
drop policy if exists "work_orders_select_customer" on public.work_orders;
create policy "work_orders_select_customer" on public.work_orders
  for select using (auth.uid() = customer_id);

-- Business members can view requests routed to their org
-- NOTE: uses business_user_roles (businesses system) rather than legacy organizations.
do $$
begin
  if to_regclass('public.business_user_roles') is not null then
    drop policy if exists "work_orders_select_business_member" on public.work_orders;
    create policy "work_orders_select_business_member" on public.work_orders
      for select using (
        organization_id is not null and exists (
          select 1
          from public.business_user_roles bur
          where bur.business_id = work_orders.organization_id
            and bur.user_id = auth.uid()
            and bur.status = 'active'
        )
      );
  end if;
end $$;

-- Customers can insert their own work orders
drop policy if exists "work_orders_insert_customer" on public.work_orders;
create policy "work_orders_insert_customer" on public.work_orders
  for insert with check (auth.uid() = customer_id);

-- Customers can update their drafts/pending requests
drop policy if exists "work_orders_update_customer_draft" on public.work_orders;
create policy "work_orders_update_customer_draft" on public.work_orders
  for update using (
    auth.uid() = customer_id and status in ('draft','pending')
  )
  with check (
    auth.uid() = customer_id and status in ('draft','pending')
  );

-- Business members can update requests routed to their org
do $$
begin
  if to_regclass('public.business_user_roles') is not null then
    drop policy if exists "work_orders_update_business_member" on public.work_orders;
    create policy "work_orders_update_business_member" on public.work_orders
      for update using (
        organization_id is not null and exists (
          select 1
          from public.business_user_roles bur
          where bur.business_id = work_orders.organization_id
            and bur.user_id = auth.uid()
            and bur.status = 'active'
        )
      )
      with check (
        organization_id is not null and exists (
          select 1
          from public.business_user_roles bur
          where bur.business_id = work_orders.organization_id
            and bur.user_id = auth.uid()
            and bur.status = 'active'
        )
      );
  end if;
end $$;

-- Best-effort FK to businesses if the table exists (keeps prod constraints while allowing local bootstrap)
do $$
begin
  if to_regclass('public.businesses') is not null then
    if not exists (
      select 1 from pg_constraint
      where conname = 'work_orders_organization_id_fkey'
        and conrelid = 'public.work_orders'::regclass
    ) then
      alter table public.work_orders
        add constraint work_orders_organization_id_fkey
        foreign key (organization_id) references public.businesses(id) on delete set null;
    end if;
  end if;
end $$;

commit;


