-- 2026-07-13 — Substrate stabilization "still owed" items (.claude/ISSUES.md 2026-07-08 HIGH):
--   (a) phantom vehicle_edit_audit table, (b) enforce_vin_uniqueness must exclude merged shells.
-- Applied to prod via MCP apply_migration on 2026-07-12; this file is the version-controlled record.
-- All statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE) — safe to re-run.

-- (a) EDIT-PROVENANCE ORGAN REVIVAL -----------------------------------------------------------
-- A LIVE ENABLED trigger on vehicles (vehicle_edit_audit_trigger -> log_vehicle_edit()), an RPC
-- overload, and two helpers (get_user_associations, calculate_edit_confidence) all INSERT into
-- vehicle_edit_audit — which never existed. Every authenticated human title edit raised
-- 42P01 (undefined_table). Second, latent bug: all four functions were secured with
-- SET search_path = '' while referencing tables unqualified, so they were dead at every call.
-- Fix: create the sink table + re-pin search_path to the concrete schema (same security posture,
-- zero body-transcription risk). Gauntlet-tested in a rolled-back txn (authed title edit lands a
-- row; RPC returns an edit id). This COMPLETES a built organ — it does not mint a new capability.

create table if not exists public.vehicle_edit_audit (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  editor_id uuid,
  field_name text not null,
  old_value text,
  new_value text,
  change_type text not null default 'update',
  edit_reason text,
  source text,
  user_associations jsonb,
  confidence_score integer,
  confidence_factors jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_vehicle_edit_audit_vehicle on public.vehicle_edit_audit (vehicle_id, created_at desc);
create index if not exists idx_vehicle_edit_audit_editor  on public.vehicle_edit_audit (editor_id, created_at desc);
-- Writers are SECURITY DEFINER; keep the public surface closed (no policies = service-role only).
alter table public.vehicle_edit_audit enable row level security;

alter function public.log_vehicle_edit()                                        set search_path = public;
alter function public.log_vehicle_edit(uuid,text,text,text,uuid,text,text)       set search_path = public;
alter function public.get_user_associations(uuid,uuid)                           set search_path = public;
alter function public.calculate_edit_confidence(uuid,uuid,text,text)             set search_path = public;

-- (b) VIN UNIQUENESS MUST EXCLUDE MERGED-AWAY SHELLS -----------------------------------------
-- A merged shell (status='merged', holds 0 testimony) must not block the canonical row from
-- carrying the shared VIN. The K5 incident (2026-07-08) required a manual "VIN release" for
-- exactly this. Two enforcement layers exist: this trigger AND two partial unique indexes.
-- The trigger is fixed here. The indexes are swapped to merged-excluding versions (created
-- below); dropping the two old merged-inclusive indexes requires DROP INDEX CONCURRENTLY in a
-- low-traffic window (vehicles carries constant multi-second load) — see the MAINTENANCE note.

create or replace function public.enforce_vin_uniqueness()
returns trigger language plpgsql
as $fn$
declare
  v_norm text;
  v_existing uuid;
begin
  if new.vin is null or length(trim(new.vin)) < 11 then
    return new;
  end if;
  v_norm := upper(trim(new.vin));
  select id into v_existing
    from vehicles
   where upper(trim(vin)) = v_norm
     and id <> new.id
     and status is distinct from 'merged'   -- <-- the fix
   limit 1;
  if v_existing is not null then
    raise exception 'VIN % already exists on vehicle %', v_norm, v_existing
      using errcode = 'unique_violation',
            hint = 'Attach observations to the existing vehicle via ingest-observation, or resolve via merge_proposals.';
  end if;
  return new;
end;
$fn$;

-- Merged-excluding replacements for the two storage-level unique indexes.
-- (Non-concurrent CREATE is safe on a fresh/low-traffic DB; on hot prod they were already built
--  via MCP with IF NOT EXISTS, so this is a no-op there.)
create unique index if not exists vehicles_vin_unique_17char_v2
  on public.vehicles (vin)
  where vin is not null and length(vin) = 17 and status is distinct from 'merged';
create unique index if not exists vehicles_vin_unique_short_v2
  on public.vehicles (vin, make)
  where vin is not null and length(vin) < 17 and status is distinct from 'merged';

-- MAINTENANCE (run in a low-traffic window; cannot live in this migration's implicit txn):
--   set statement_timeout = 0;
--   drop index concurrently if exists public.vehicles_vin_unique_17char;  -- already INVALID as of 2026-07-12
--   drop index concurrently if exists public.vehicles_vin_unique_short;   -- STILL VALID+enforcing: short/classic VINs
--                                                                         -- (e.g. the K5 13-char VIN) remain
--                                                                         -- merged-INCLUSIVE until this drops.
-- Status 2026-07-12: 17-char path effectively merged-excluding (old index auto-invalidated by an
-- interrupted concurrent drop; v2 enforcing). Short/classic path NOT yet — old index still dominates.
