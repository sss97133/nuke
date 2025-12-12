-- Rename vehicle "jobs" tables to "work items" to match product language.
-- Rationale: "job" reads like long-term employment; "work" matches inbox/workflow semantics.
--
-- This migration is designed to be idempotent:
-- - If old tables exist, they are renamed.
-- - If already renamed, it does nothing.

begin;

do $$
begin
  -- Rename base table: vehicle_jobs -> vehicle_work_items
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vehicle_jobs'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vehicle_work_items'
  ) then
    alter table public.vehicle_jobs rename to vehicle_work_items;
  end if;

  -- Rename holds table: vehicle_job_holds -> vehicle_work_item_holds
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vehicle_job_holds'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vehicle_work_item_holds'
  ) then
    alter table public.vehicle_job_holds rename to vehicle_work_item_holds;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Index renames (best-effort; safe if they don't exist)
-- Note: renaming the table keeps indexes working, but names stay old.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class where relname = 'idx_vehicle_jobs_vehicle_id') then
    alter index public.idx_vehicle_jobs_vehicle_id rename to idx_vehicle_work_items_vehicle_id;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_vehicle_jobs_status') then
    alter index public.idx_vehicle_jobs_status rename to idx_vehicle_work_items_status;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_vehicle_jobs_created_at') then
    alter index public.idx_vehicle_jobs_created_at rename to idx_vehicle_work_items_created_at;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_vehicle_jobs_funding_status') then
    alter index public.idx_vehicle_jobs_funding_status rename to idx_vehicle_work_items_funding_status;
  end if;

  if exists (select 1 from pg_class where relname = 'idx_vehicle_job_holds_job_id') then
    alter index public.idx_vehicle_job_holds_job_id rename to idx_vehicle_work_item_holds_work_item_id;
  end if;
  if exists (select 1 from pg_class where relname = 'idx_vehicle_job_holds_status') then
    alter index public.idx_vehicle_job_holds_status rename to idx_vehicle_work_item_holds_status;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Trigger renames (best-effort)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_vehicle_jobs_updated_at') then
    alter trigger trg_vehicle_jobs_updated_at on public.vehicle_work_items rename to trg_vehicle_work_items_updated_at;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_vehicle_job_holds_updated_at') then
    alter trigger trg_vehicle_job_holds_updated_at on public.vehicle_work_item_holds rename to trg_vehicle_work_item_holds_updated_at;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Policy renames (best-effort, clarity only)
-- Policies move with the table rename; we just rename them to match language.
-- ---------------------------------------------------------------------------
do $$
begin
  -- vehicle_jobs_* -> vehicle_work_items_*
  if exists (select 1 from pg_policies where policyname = 'vehicle_jobs_select_access' and tablename = 'vehicle_work_items') then
    alter policy vehicle_jobs_select_access on public.vehicle_work_items rename to vehicle_work_items_select_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_jobs_insert_access' and tablename = 'vehicle_work_items') then
    alter policy vehicle_jobs_insert_access on public.vehicle_work_items rename to vehicle_work_items_insert_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_jobs_update_access' and tablename = 'vehicle_work_items') then
    alter policy vehicle_jobs_update_access on public.vehicle_work_items rename to vehicle_work_items_update_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_jobs_delete_access' and tablename = 'vehicle_work_items') then
    alter policy vehicle_jobs_delete_access on public.vehicle_work_items rename to vehicle_work_items_delete_access;
  end if;

  -- vehicle_job_holds_* -> vehicle_work_item_holds_*
  if exists (select 1 from pg_policies where policyname = 'vehicle_job_holds_select_access' and tablename = 'vehicle_work_item_holds') then
    alter policy vehicle_job_holds_select_access on public.vehicle_work_item_holds rename to vehicle_work_item_holds_select_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_job_holds_insert_access' and tablename = 'vehicle_work_item_holds') then
    alter policy vehicle_job_holds_insert_access on public.vehicle_work_item_holds rename to vehicle_work_item_holds_insert_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_job_holds_update_access' and tablename = 'vehicle_work_item_holds') then
    alter policy vehicle_job_holds_update_access on public.vehicle_work_item_holds rename to vehicle_work_item_holds_update_access;
  end if;
  if exists (select 1 from pg_policies where policyname = 'vehicle_job_holds_delete_access' and tablename = 'vehicle_work_item_holds') then
    alter policy vehicle_job_holds_delete_access on public.vehicle_work_item_holds rename to vehicle_work_item_holds_delete_access;
  end if;
end $$;

commit;


