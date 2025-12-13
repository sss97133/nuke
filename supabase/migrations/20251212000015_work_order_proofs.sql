-- Work Order Proofs (MVP)
-- Stores proof artifacts (before/after photos, timelapse links, receipts) attached to a work order.
-- Safe to run multiple times.

begin;

create table if not exists public.work_order_proofs (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,

  proof_type text not null check (proof_type in (
    'before_photos',
    'after_photos',
    'timelapse',
    'receipt',
    'note',
    'other'
  )),

  urls text[] not null default array[]::text[],
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_work_order_proofs_work_order_id on public.work_order_proofs(work_order_id);
create index if not exists idx_work_order_proofs_vehicle_id on public.work_order_proofs(vehicle_id);
create index if not exists idx_work_order_proofs_created_at on public.work_order_proofs(created_at desc);

alter table public.work_order_proofs enable row level security;

-- Customer can read proofs for their work orders
drop policy if exists "work_order_proofs_select_customer" on public.work_order_proofs;
create policy "work_order_proofs_select_customer" on public.work_order_proofs
  for select using (
    exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_proofs.work_order_id
        and wo.customer_id = auth.uid()
    )
  );

-- Business members can read proofs for work orders routed to their org
do $$
begin
  if to_regclass('public.business_user_roles') is not null then
    drop policy if exists "work_order_proofs_select_business_member" on public.work_order_proofs;
    create policy "work_order_proofs_select_business_member" on public.work_order_proofs
      for select using (
        exists (
          select 1
          from public.work_orders wo
          where wo.id = work_order_proofs.work_order_id
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

-- Contributors/techs can insert proofs if they have active vehicle_user_permissions
drop policy if exists "work_order_proofs_insert_contributor" on public.work_order_proofs;
create policy "work_order_proofs_insert_contributor" on public.work_order_proofs
  for insert with check (
    auth.uid() = uploaded_by
    and exists (
      select 1
      from public.work_orders wo
      where wo.id = work_order_proofs.work_order_id
        and wo.vehicle_id = work_order_proofs.vehicle_id
        and (
          wo.customer_id = auth.uid()
          or exists (
            select 1
            from public.vehicle_user_permissions vup
            where vup.vehicle_id = wo.vehicle_id
              and vup.user_id = auth.uid()
              and coalesce(vup.is_active, true) = true
              and (vup.expires_at is null or vup.expires_at > now())
          )
        )
    )
  );

commit;


