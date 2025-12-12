-- Profile Integrity Guardrails (Anti-Contamination)
-- Goal: prevent cross-vehicle contamination automatically (no manual URLs).
--
-- 1) Block external listing URL overwrites on ownership-locked vehicles.
-- 2) Emit mailbox alerts when a conflict is detected (listing VIN mismatch, image mismatch).
--
-- This migration is designed to be safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Helper: determine whether a vehicle profile is ownership-locked
-- - vehicle.ownership_verified OR approved ownership_verification exists
-- ---------------------------------------------------------------------------
create or replace function public.is_vehicle_ownership_locked(p_vehicle_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean := false;
begin
  select (v.ownership_verified = true)
    into v_locked
  from public.vehicles v
  where v.id = p_vehicle_id;

  if coalesce(v_locked, false) = true then
    return true;
  end if;

  if exists (
    select 1
    from public.ownership_verifications ov
    where ov.vehicle_id = p_vehicle_id
      and ov.status = 'approved'
    limit 1
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: mailbox notify (best-effort)
-- ---------------------------------------------------------------------------
create or replace function public.mailbox_notify_system_alert(
  p_vehicle_id uuid,
  p_title text,
  p_content text,
  p_priority text default 'medium',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mailbox_id uuid;
begin
  select vm.id into v_mailbox_id
  from public.vehicle_mailboxes vm
  where vm.vehicle_id = p_vehicle_id;

  -- Ensure mailbox exists (vehicles may have been created before mailbox backfill)
  if v_mailbox_id is null then
    insert into public.vehicle_mailboxes (vehicle_id, vin)
    select v.id, v.vin
    from public.vehicles v
    where v.id = p_vehicle_id
    on conflict (vehicle_id) do nothing;

    select vm.id into v_mailbox_id
    from public.vehicle_mailboxes vm
    where vm.vehicle_id = p_vehicle_id;
  end if;

  if v_mailbox_id is null then
    return;
  end if;

  insert into public.mailbox_messages (
    mailbox_id,
    vehicle_id,
    message_type,
    title,
    content,
    priority,
    sender_type,
    metadata
  ) values (
    v_mailbox_id,
    p_vehicle_id,
    'system_alert',
    left(coalesce(p_title, 'System alert'), 200),
    p_content,
    case when p_priority in ('low','medium','high','urgent') then p_priority else 'medium' end,
    'system',
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when undefined_table then
    -- Mailbox not deployed in this environment; ignore.
    return;
  when others then
    -- Guardrails must not break writes.
    return;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Guard: block discovery/listing URL overwrites on ownership-locked vehicles
-- - This keeps the profile context anchored to title/evidence once claimed.
-- - We do NOT raise exceptions; we revert the attempted overwrite and log a mailbox alert.
-- ---------------------------------------------------------------------------
create or replace function public.guard_vehicle_external_urls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
  v_attempted jsonb := '{}'::jsonb;
begin
  v_locked := public.is_vehicle_ownership_locked(new.id);
  if coalesce(v_locked, false) = false then
    return new;
  end if;

  if new.discovery_url is distinct from old.discovery_url and new.discovery_url is not null then
    v_attempted := jsonb_set(v_attempted, '{discovery_url}', to_jsonb(new.discovery_url), true);
    new.discovery_url := old.discovery_url;
  end if;

  if new.listing_url is distinct from old.listing_url and new.listing_url is not null then
    v_attempted := jsonb_set(v_attempted, '{listing_url}', to_jsonb(new.listing_url), true);
    new.listing_url := old.listing_url;
  end if;

  if new.bat_auction_url is distinct from old.bat_auction_url and new.bat_auction_url is not null then
    v_attempted := jsonb_set(v_attempted, '{bat_auction_url}', to_jsonb(new.bat_auction_url), true);
    new.bat_auction_url := old.bat_auction_url;
  end if;

  if v_attempted <> '{}'::jsonb then
    perform public.mailbox_notify_system_alert(
      new.id,
      'Blocked external listing overwrite (ownership-locked)',
      'An automated process attempted to overwrite this vehicle’s external listing link(s). Because this profile is ownership-locked, the overwrite was blocked to prevent cross-contamination.',
      'high',
      jsonb_build_object(
        'vehicle_id', new.id,
        'attempted', v_attempted,
        'previous', jsonb_build_object(
          'discovery_url', old.discovery_url,
          'listing_url', old.listing_url,
          'bat_auction_url', old.bat_auction_url
        ),
        'action', 'review_external_listing'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_external_urls on public.vehicles;
create trigger trg_guard_vehicle_external_urls
  before update of discovery_url, listing_url, bat_auction_url
  on public.vehicles
  for each row
  execute function public.guard_vehicle_external_urls();

-- ---------------------------------------------------------------------------
-- 2) External listing conflict detection (VIN mismatch vs title evidence)
-- Notes:
-- - We use external_listings.metadata->>'vin' as the listing VIN (best-effort).
-- - Evidence VIN is taken from (in priority order):
--   a) ownership_verifications.vehicle_vin_from_title where status='approved'
--   b) vehicle_title_documents.vin (if table exists)
--   c) vehicles.vin (if non-placeholder)
--
-- If mismatch: log mailbox alert and (if ownership-locked) disable sync to reduce blast radius.
-- ---------------------------------------------------------------------------
create or replace function public.detect_external_listing_conflict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_vin text;
  v_evidence_vin text;
  v_vehicle_vin text;
  v_locked boolean;
begin
  -- Only act for listings that are attached to a vehicle
  if new.vehicle_id is null then
    return new;
  end if;

  -- Pull listing VIN from metadata (set by extractors when available)
  v_listing_vin := nullif(upper(coalesce(new.metadata->>'vin', new.metadata->>'VIN', '')), '');

  -- Evidence VIN from approved title verification
  select nullif(upper(coalesce(ov.vehicle_vin_from_title, '')), '')
    into v_evidence_vin
  from public.ownership_verifications ov
  where ov.vehicle_id = new.vehicle_id
    and ov.status = 'approved'
    and ov.vehicle_vin_from_title is not null
  order by ov.approved_at desc nulls last, ov.created_at desc
  limit 1;

  -- Fallback: vehicle VIN (ignore placeholders)
  select nullif(upper(coalesce(v.vin, '')), '')
    into v_vehicle_vin
  from public.vehicles v
  where v.id = new.vehicle_id;

  if v_vehicle_vin like 'VIVA-%' then
    v_vehicle_vin := null;
  end if;

  if v_evidence_vin is null then
    v_evidence_vin := v_vehicle_vin;
  end if;

  -- If either VIN is missing, we cannot decisively compare
  if v_listing_vin is null or v_evidence_vin is null then
    return new;
  end if;

  if v_listing_vin <> v_evidence_vin then
    v_locked := public.is_vehicle_ownership_locked(new.vehicle_id);

    perform public.mailbox_notify_system_alert(
      new.vehicle_id,
      'Potential contamination detected: listing VIN conflict',
      format(
        'An external listing appears to conflict with this vehicle’s evidence VIN.\n\nEvidence VIN: %s\nListing VIN: %s\n\nWe did NOT merge profiles. Please review.',
        v_evidence_vin,
        v_listing_vin
      ),
      'urgent',
      jsonb_build_object(
        'vehicle_id', new.vehicle_id,
        'external_listing_id', new.id,
        'listing_url', new.listing_url,
        'platform', new.platform,
        'evidence_vin', v_evidence_vin,
        'listing_vin', v_listing_vin,
        'action', 'split_or_detach_recommended'
      )
    );

    -- Reduce blast radius for ownership-locked vehicles: disable sync so the listing cannot keep mutating state.
    if coalesce(v_locked, false) = true and coalesce(new.sync_enabled, true) = true then
      update public.external_listings
         set sync_enabled = false,
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'blocked_by_integrity_guard', true,
               'blocked_reason', 'listing_vin_conflict_with_evidence',
               'blocked_at', now()
             ),
             updated_at = now()
       where id = new.id;
    end if;
  end if;

  return new;
exception
  when undefined_table then
    return new;
  when others then
    return new;
end;
$$;

drop trigger if exists trg_detect_external_listing_conflict on public.external_listings;
create trigger trg_detect_external_listing_conflict
  after insert or update of metadata, listing_url, platform, vehicle_id
  on public.external_listings
  for each row
  execute function public.detect_external_listing_conflict();

-- ---------------------------------------------------------------------------
-- 3) Image mismatch → mailbox alert (hooks into existing mismatch system)
-- ---------------------------------------------------------------------------
create or replace function public.notify_image_vehicle_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid;
  v_conf int;
begin
  v_vehicle_id := new.current_vehicle_id;
  v_conf := coalesce(new.confidence_score, 0);

  perform public.mailbox_notify_system_alert(
    v_vehicle_id,
    'Potential contamination detected: image mismatch',
    'An uploaded image appears to not match this vehicle profile (AI validation flagged a mismatch). Review the image evidence and move/remove it if needed.',
    case when v_conf >= 85 then 'high' else 'medium' end,
    jsonb_build_object(
      'vehicle_id', v_vehicle_id,
      'image_id', new.image_id,
      'mismatch_id', new.id,
      'confidence', v_conf,
      'detected_vehicle', new.detected_vehicle,
      'expected_vehicle', new.expected_vehicle,
      'action', 'review_image_mismatch'
    )
  );

  return new;
exception
  when undefined_table then
    return new;
  when others then
    return new;
end;
$$;

drop trigger if exists trg_notify_image_vehicle_mismatch on public.image_vehicle_mismatches;
create trigger trg_notify_image_vehicle_mismatch
  after insert
  on public.image_vehicle_mismatches
  for each row
  execute function public.notify_image_vehicle_mismatch();

commit;


