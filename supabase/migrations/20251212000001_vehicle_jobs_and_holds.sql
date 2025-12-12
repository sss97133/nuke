-- Vehicle Jobs + Funding Holds (MVP)
-- Turns "things I need done" into structured job listings attached to a vehicle
-- with optional funding hold indicator (no payment processor integration in this migration).
--
-- IMPORTANT:
-- - Jobs are vehicle records. They should also be mirrored into timeline_events in app logic.
-- - This migration is safe to run multiple times (IF NOT EXISTS + shims).

begin;

-- ---------------------------------------------------------------------------
-- Shims: ensure columns we rely on exist on vehicles for access control
-- ---------------------------------------------------------------------------
alter table if exists public.vehicles
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Core: vehicle_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_jobs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,

  -- Job listing
  title text not null,
  description text,
  desired_completion_date date,
  desired_start_date date,
  estimated_hours numeric,

  -- Where / how
  location_preference text not null default 'either'
    check (location_preference in ('on_site', 'drop_off', 'either')),

  -- Money
  budget_cents integer,
  currency text not null default 'USD',
  allow_hold boolean not null default false,
  funding_status text not null default 'none'
    check (funding_status in ('none', 'requested', 'held', 'released', 'failed')),

  -- Workflow
  status text not null default 'draft'
    check (status in ('draft', 'listed', 'assigned', 'in_progress', 'completed', 'cancelled')),
  visibility text not null default 'private'
    check (visibility in ('private', 'invited', 'marketplace')),

  -- Flexible payload for agent-derived context
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_jobs_vehicle_id on public.vehicle_jobs(vehicle_id);
create index if not exists idx_vehicle_jobs_status on public.vehicle_jobs(status);
create index if not exists idx_vehicle_jobs_created_at on public.vehicle_jobs(created_at desc);
create index if not exists idx_vehicle_jobs_funding_status on public.vehicle_jobs(funding_status);

-- ---------------------------------------------------------------------------
-- Funding holds (DB indicator only; payment integration handled elsewhere)
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_job_holds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.vehicle_jobs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,

  amount_cents integer not null,
  currency text not null default 'USD',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'released', 'cancelled', 'failed')),

  -- Optional external payment provider references
  provider text,
  provider_reference text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_job_holds_job_id on public.vehicle_job_holds(job_id);
create index if not exists idx_vehicle_job_holds_status on public.vehicle_job_holds(status);

-- ---------------------------------------------------------------------------
-- updated_at triggers (best-effort; only if the helper function exists)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column') then
    drop trigger if exists trg_vehicle_jobs_updated_at on public.vehicle_jobs;
    create trigger trg_vehicle_jobs_updated_at
      before update on public.vehicle_jobs
      for each row execute function update_updated_at_column();

    drop trigger if exists trg_vehicle_job_holds_updated_at on public.vehicle_job_holds;
    create trigger trg_vehicle_job_holds_updated_at
      before update on public.vehicle_job_holds
      for each row execute function update_updated_at_column();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.vehicle_jobs enable row level security;
alter table public.vehicle_job_holds enable row level security;

-- Helper predicate (inline): user can access vehicle if they uploaded it, own it (legacy user_id),
-- or have an approved ownership verification.
create policy "vehicle_jobs_select_access" on public.vehicle_jobs
  for select
  using (
    exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
        )
    )
  );

create policy "vehicle_jobs_insert_access" on public.vehicle_jobs
  for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
        )
    )
  );

create policy "vehicle_jobs_update_access" on public.vehicle_jobs
  for update
  using (
    exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
        )
    )
  );

create policy "vehicle_jobs_delete_access" on public.vehicle_jobs
  for delete
  using (
    exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
        )
    )
  );

-- Holds are accessible if you can access the job
create policy "vehicle_job_holds_select_access" on public.vehicle_job_holds
  for select
  using (
    exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicles v
          where v.id = j.vehicle_id
            and (
              v.uploaded_by = auth.uid()
              or v.user_id = auth.uid()
              or exists (
                select 1
                from public.ownership_verifications ov
                where ov.vehicle_id = v.id
                  and ov.user_id = auth.uid()
                  and ov.status = 'approved'
              )
            )
        )
    )
  );

create policy "vehicle_job_holds_insert_access" on public.vehicle_job_holds
  for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicles v
          where v.id = j.vehicle_id
            and (
              v.uploaded_by = auth.uid()
              or v.user_id = auth.uid()
              or exists (
                select 1
                from public.ownership_verifications ov
                where ov.vehicle_id = v.id
                  and ov.user_id = auth.uid()
                  and ov.status = 'approved'
              )
            )
        )
    )
  );

create policy "vehicle_job_holds_update_access" on public.vehicle_job_holds
  for update
  using (
    exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicles v
          where v.id = j.vehicle_id
            and (
              v.uploaded_by = auth.uid()
              or v.user_id = auth.uid()
              or exists (
                select 1
                from public.ownership_verifications ov
                where ov.vehicle_id = v.id
                  and ov.user_id = auth.uid()
                  and ov.status = 'approved'
              )
            )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicles v
          where v.id = j.vehicle_id
            and (
              v.uploaded_by = auth.uid()
              or v.user_id = auth.uid()
              or exists (
                select 1
                from public.ownership_verifications ov
                where ov.vehicle_id = v.id
                  and ov.user_id = auth.uid()
                  and ov.status = 'approved'
              )
            )
        )
    )
  );

create policy "vehicle_job_holds_delete_access" on public.vehicle_job_holds
  for delete
  using (
    exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicles v
          where v.id = j.vehicle_id
            and (
              v.uploaded_by = auth.uid()
              or v.user_id = auth.uid()
              or exists (
                select 1
                from public.ownership_verifications ov
                where ov.vehicle_id = v.id
                  and ov.user_id = auth.uid()
                  and ov.status = 'approved'
              )
            )
        )
    )
  );

commit;


