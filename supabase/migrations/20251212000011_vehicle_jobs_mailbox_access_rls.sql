-- Allow vehicle_jobs + vehicle_job_holds access via mailbox_access_keys
-- Goal: mailbox-first workflow: if you can write to the vehicle mailbox, you can create/update jobs/holds.
-- This keeps "agent writes" consistent with the mailbox permissions model.
--
-- Safe: drops/recreates only the RLS policies for these tables (does not change schema).

begin;

-- Ensure RLS is enabled (idempotent)
alter table if exists public.vehicle_jobs enable row level security;
alter table if exists public.vehicle_job_holds enable row level security;

-- ---------------------------------------------------------------------------
-- vehicle_jobs: add mailbox-based access in addition to legacy vehicle access.
-- ---------------------------------------------------------------------------
drop policy if exists "vehicle_jobs_select_access" on public.vehicle_jobs;
drop policy if exists "vehicle_jobs_insert_access" on public.vehicle_jobs;
drop policy if exists "vehicle_jobs_update_access" on public.vehicle_jobs;
drop policy if exists "vehicle_jobs_delete_access" on public.vehicle_jobs;

create policy "vehicle_jobs_select_access" on public.vehicle_jobs
  for select
  using (
    exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_jobs.vehicle_id
        and (
          -- Existing access paths (uploaded_by/user_id/approved ownership verification)
          v.uploaded_by = auth.uid()
          or v.user_id = auth.uid()
          or exists (
            select 1
            from public.ownership_verifications ov
            where ov.vehicle_id = v.id
              and ov.user_id = auth.uid()
              and ov.status = 'approved'
          )
          -- Mailbox-based access path
          or exists (
            select 1
            from public.vehicle_mailboxes vm
            join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
            where vm.vehicle_id = v.id
              and mak.user_id = auth.uid()
              and mak.permission_level in ('read_write', 'read_only', 'filtered')
              and (mak.expires_at is null or mak.expires_at > now())
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
          or exists (
            select 1
            from public.vehicle_mailboxes vm
            join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
            where vm.vehicle_id = v.id
              and mak.user_id = auth.uid()
              and mak.permission_level in ('read_write', 'write_only')
              and (mak.expires_at is null or mak.expires_at > now())
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
          or exists (
            select 1
            from public.vehicle_mailboxes vm
            join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
            where vm.vehicle_id = v.id
              and mak.user_id = auth.uid()
              and mak.permission_level in ('read_write', 'write_only')
              and (mak.expires_at is null or mak.expires_at > now())
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
          or exists (
            select 1
            from public.vehicle_mailboxes vm
            join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
            where vm.vehicle_id = v.id
              and mak.user_id = auth.uid()
              and mak.permission_level in ('read_write', 'write_only')
              and (mak.expires_at is null or mak.expires_at > now())
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
          or exists (
            select 1
            from public.vehicle_mailboxes vm
            join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
            where vm.vehicle_id = v.id
              and mak.user_id = auth.uid()
              and mak.permission_level in ('read_write', 'write_only')
              and (mak.expires_at is null or mak.expires_at > now())
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- vehicle_job_holds: accessible if you can access the job (same mailbox rule).
-- ---------------------------------------------------------------------------
drop policy if exists "vehicle_job_holds_select_access" on public.vehicle_job_holds;
drop policy if exists "vehicle_job_holds_insert_access" on public.vehicle_job_holds;
drop policy if exists "vehicle_job_holds_update_access" on public.vehicle_job_holds;
drop policy if exists "vehicle_job_holds_delete_access" on public.vehicle_job_holds;

create policy "vehicle_job_holds_select_access" on public.vehicle_job_holds
  for select
  using (
    exists (
      select 1
      from public.vehicle_jobs j
      where j.id = vehicle_job_holds.job_id
        and exists (
          select 1
          from public.vehicle_mailboxes vm
          join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
          where vm.vehicle_id = j.vehicle_id
            and mak.user_id = auth.uid()
            and mak.permission_level in ('read_write', 'read_only', 'filtered')
            and (mak.expires_at is null or mak.expires_at > now())
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
          from public.vehicle_mailboxes vm
          join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
          where vm.vehicle_id = j.vehicle_id
            and mak.user_id = auth.uid()
            and mak.permission_level in ('read_write', 'write_only')
            and (mak.expires_at is null or mak.expires_at > now())
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
          from public.vehicle_mailboxes vm
          join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
          where vm.vehicle_id = j.vehicle_id
            and mak.user_id = auth.uid()
            and mak.permission_level in ('read_write', 'write_only')
            and (mak.expires_at is null or mak.expires_at > now())
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
          from public.vehicle_mailboxes vm
          join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
          where vm.vehicle_id = j.vehicle_id
            and mak.user_id = auth.uid()
            and mak.permission_level in ('read_write', 'write_only')
            and (mak.expires_at is null or mak.expires_at > now())
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
          from public.vehicle_mailboxes vm
          join public.mailbox_access_keys mak on mak.mailbox_id = vm.id
          where vm.vehicle_id = j.vehicle_id
            and mak.user_id = auth.uid()
            and mak.permission_level in ('read_write', 'write_only')
            and (mak.expires_at is null or mak.expires_at > now())
        )
    )
  );

commit;


