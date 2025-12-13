-- Ownership effective date from title (issue/print date)
-- Use the title's issue/print date as a conservative, evidence-based ownership start date.
-- This is NOT necessarily the deal date, but it anchors a credible timeframe.

begin;

create or replace function public.safe_parse_date(p_text text)
returns date
language plpgsql
immutable
as $$
declare
  v date;
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;

  begin
    v := p_text::date;
    return v;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public.get_ownership_effective_date(p_vehicle_id uuid, p_verification_id uuid)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue_text text;
  v_issue date;
  v_vehicle_title_issue date;
  v_approved date;
begin
  -- Preferred: issue date captured on the verification itself (OCR output)
  select (ov.extracted_data->>'issue_date')
    into v_issue_text
  from public.ownership_verifications ov
  where ov.id = p_verification_id
    and ov.vehicle_id = p_vehicle_id;

  v_issue := public.safe_parse_date(v_issue_text);
  if v_issue is not null then
    return v_issue;
  end if;

  -- Fallback: latest title doc extraction (if available)
  begin
    select max(public.safe_parse_date(vtd.issue_date::text))
      into v_vehicle_title_issue
    from public.vehicle_title_documents vtd
    where vtd.vehicle_id = p_vehicle_id;
  exception when undefined_table then
    v_vehicle_title_issue := null;
  end;

  if v_vehicle_title_issue is not null then
    return v_vehicle_title_issue;
  end if;

  -- Fallback: approval timestamp (review action date)
  select ov.approved_at::date
    into v_approved
  from public.ownership_verifications ov
  where ov.id = p_verification_id;

  return coalesce(v_approved, current_date);
end;
$$;

-- Patch approve_ownership_verification to use the evidence-based effective date
create or replace function public.approve_ownership_verification(
  p_verification_id uuid,
  p_reviewer_id uuid,
  p_review_notes text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification ownership_verifications%rowtype;
  v_existing_owner_id uuid;
  v_existing_ownership_id uuid;
  v_new_ownership_id uuid;
  v_effective_date date;
begin
  select * into v_verification
  from public.ownership_verifications
  where id = p_verification_id;

  if not found then
    raise exception 'Verification not found';
  end if;

  if v_verification.status = 'approved' then
    raise exception 'Verification already approved';
  end if;

  v_effective_date := public.get_ownership_effective_date(v_verification.vehicle_id, p_verification_id);

  -- Check existing current owner
  select owner_profile_id, id
    into v_existing_owner_id, v_existing_ownership_id
  from public.vehicle_ownerships
  where vehicle_id = v_verification.vehicle_id
    and is_current = true
    and owner_profile_id != v_verification.user_id
  order by start_date desc nulls last
  limit 1;

  if v_existing_owner_id is not null then
    update public.vehicle_ownerships
       set is_current = false,
           end_date = coalesce(end_date, v_effective_date),
           updated_at = now()
     where id = v_existing_ownership_id;

    insert into public.ownership_transfers (
      vehicle_id,
      from_owner_id,
      to_owner_id,
      transfer_date,
      source,
      price,
      proof_event_id,
      metadata
    ) values (
      v_verification.vehicle_id,
      v_existing_owner_id,
      v_verification.user_id,
      v_effective_date,
      'title_verification',
      null,
      null,
      jsonb_build_object(
        'verification_id', p_verification_id,
        'reviewer_id', p_reviewer_id,
        'effective_date_source', 'title_issue_date_or_fallback'
      )
    );
  end if;

  update public.ownership_verifications
     set status = 'approved',
         human_reviewer_id = p_reviewer_id,
         human_review_notes = p_review_notes,
         human_reviewed_at = now(),
         approved_at = now(),
         updated_at = now()
   where id = p_verification_id;

  select id into v_new_ownership_id
  from public.vehicle_ownerships
  where vehicle_id = v_verification.vehicle_id
    and owner_profile_id = v_verification.user_id
  limit 1;

  if v_new_ownership_id is not null then
    update public.vehicle_ownerships
       set is_current = true,
           start_date = coalesce(start_date, v_effective_date),
           end_date = null,
           verification_id = p_verification_id,
           proof_event_id = null,
           updated_at = now()
     where id = v_new_ownership_id;
  else
    insert into public.vehicle_ownerships (
      vehicle_id,
      owner_profile_id,
      role,
      is_current,
      start_date,
      verification_id,
      proof_event_id
    ) values (
      v_verification.vehicle_id,
      v_verification.user_id,
      'owner',
      true,
      v_effective_date,
      p_verification_id,
      null
    )
    returning id into v_new_ownership_id;
  end if;

  insert into public.verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) values (
    p_verification_id, 'approved', p_reviewer_id, 'reviewer',
    jsonb_build_object(
      'review_notes', p_review_notes,
      'ownership_id', v_new_ownership_id,
      'previous_owner_id', v_existing_owner_id,
      'effective_date', v_effective_date,
      'effective_date_source', 'title_issue_date_or_fallback'
    )
  );

  if exists (select 1 from information_schema.tables where table_name = 'verification_queue') then
    update public.verification_queue
       set queue_status = 'completed', completed_at = now()
     where verification_id = p_verification_id;
  end if;

  return true;
end;
$$;

comment on function public.get_ownership_effective_date is
  'Returns evidence-based ownership start date preferring title issue/print date from ownership_verifications.extracted_data, then vehicle_title_documents.issue_date, then approval date.';

commit;


