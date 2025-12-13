-- Work Order Quotes (MVP)
-- Quotes are attached to work_orders and mirrored into the vehicle mailbox as `quote` messages.
-- This migration is safe to run multiple times.

begin;

create table if not exists public.work_order_quotes (
  id uuid primary key default gen_random_uuid(),

  work_order_id uuid not null references public.work_orders(id) on delete cascade,

  -- Who produced the quote (optional for MVP; can be customer-authored notes)
  -- NOTE: businesses table may not exist in minimal/local schemas; add FK constraint only when available.
  business_id uuid,
  created_by uuid references auth.users(id) on delete set null,

  -- Quote numbers
  amount_cents integer not null,
  currency text not null default 'USD',
  estimated_hours numeric,
  labor_cents integer,
  parts_cents integer,

  -- Freeform
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  status text not null default 'sent'
    check (status in ('draft','sent','accepted','rejected','withdrawn')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_order_quotes_work_order_id on public.work_order_quotes(work_order_id);
create index if not exists idx_work_order_quotes_status on public.work_order_quotes(status);
create index if not exists idx_work_order_quotes_created_at on public.work_order_quotes(created_at desc);

-- best-effort updated_at trigger
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column') then
    drop trigger if exists trg_work_order_quotes_updated_at on public.work_order_quotes;
    create trigger trg_work_order_quotes_updated_at
      before update on public.work_order_quotes
      for each row execute function update_updated_at_column();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.work_order_quotes enable row level security;

-- Customers can view quotes for their own work orders
drop policy if exists "work_order_quotes_select_customer" on public.work_order_quotes;
create policy "work_order_quotes_select_customer" on public.work_order_quotes
  for select using (
    exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_quotes.work_order_id
        and wo.customer_id = auth.uid()
    )
  );

-- Business members can view quotes for work orders routed to their org
do $$
begin
  if to_regclass('public.business_user_roles') is not null then
    drop policy if exists "work_order_quotes_select_business_member" on public.work_order_quotes;
    create policy "work_order_quotes_select_business_member" on public.work_order_quotes
      for select using (
        exists (
          select 1
          from public.work_orders wo
          where wo.id = work_order_quotes.work_order_id
            and wo.organization_id is not null
            and exists (
              select 1
              from public.business_user_roles bur
              where bur.business_id = wo.organization_id
                and bur.user_id = auth.uid()
                and bur.status = 'active'
            )
        )
      );
  end if;
end $$;

-- Customers can insert quotes as notes for their own work orders (MVP)
drop policy if exists "work_order_quotes_insert_customer" on public.work_order_quotes;
create policy "work_order_quotes_insert_customer" on public.work_order_quotes
  for insert with check (
    auth.uid() = created_by
    and exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_quotes.work_order_id
        and wo.customer_id = auth.uid()
    )
  );

-- Business members can insert quotes for work orders routed to their org
do $$
begin
  if to_regclass('public.business_user_roles') is not null then
    drop policy if exists "work_order_quotes_insert_business_member" on public.work_order_quotes;
    create policy "work_order_quotes_insert_business_member" on public.work_order_quotes
      for insert with check (
        auth.uid() = created_by
        and exists (
          select 1
          from public.work_orders wo
          where wo.id = work_order_quotes.work_order_id
            and wo.organization_id is not null
            and exists (
              select 1
              from public.business_user_roles bur
              where bur.business_id = wo.organization_id
                and bur.user_id = auth.uid()
                and bur.status = 'active'
            )
        )
      );
  end if;
end $$;

-- Best-effort FK to businesses if the table exists
do $$
begin
  if to_regclass('public.businesses') is not null then
    if not exists (
      select 1 from pg_constraint
      where conname = 'work_order_quotes_business_id_fkey'
        and conrelid = 'public.work_order_quotes'::regclass
    ) then
      alter table public.work_order_quotes
        add constraint work_order_quotes_business_id_fkey
        foreign key (business_id) references public.businesses(id) on delete set null;
    end if;
  end if;
end $$;

-- Customer can accept/reject quotes for their work orders
drop policy if exists "work_order_quotes_update_customer" on public.work_order_quotes;
create policy "work_order_quotes_update_customer" on public.work_order_quotes
  for update using (
    exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_quotes.work_order_id
        and wo.customer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_quotes.work_order_id
        and wo.customer_id = auth.uid()
    )
  );

commit;


