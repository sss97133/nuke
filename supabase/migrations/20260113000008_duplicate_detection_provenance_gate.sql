-- Duplicate detection provenance gate
--
-- Goal:
-- - Prevent "high confidence" duplicate matches when the two profiles originate from incompatible pipelines
--   (e.g., BaT auction profile vs Dropbox/org inventory) unless there's an exact VIN match.
--
-- This does NOT change VIN-exact detection (still 100).
-- It caps confidence for non-VIN matches when provenance is incompatible.

begin;

create or replace function public.detect_vehicle_duplicates(
  p_vehicle_id uuid
)
returns table (
  duplicate_id uuid,
  match_type text,
  confidence integer,
  reasoning text
)
security definer
set search_path = public
language plpgsql
stable
as $$
declare
  v_vehicle record;
  v_candidate record;
  v_match_type text;
  v_confidence integer;
  v_reasoning text;

  v_vehicle_is_bat boolean;
  v_candidate_is_bat boolean;
  v_vehicle_is_dropbox boolean;
  v_candidate_is_dropbox boolean;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found then
    return;
  end if;

  v_vehicle_is_bat := (v_vehicle.bat_auction_url is not null) or (coalesce(v_vehicle.discovery_url, '') ~* 'bringatrailer\\.com');
  v_vehicle_is_dropbox := (coalesce(v_vehicle.profile_origin, '') = 'dropbox_import')
    or (coalesce(v_vehicle.discovery_source, '') ilike '%dropbox%')
    or (coalesce(v_vehicle.origin_metadata->>'origin', '') = 'dropbox_import');

  for v_candidate in
    select v.*
    from public.vehicles v
    where v.id != p_vehicle_id
      and v.year = v_vehicle.year
      and (
        lower(trim(v.make)) = lower(trim(v_vehicle.make))
        or lower(trim(v.make)) like lower(trim(v_vehicle.make)) || '%'
        or lower(trim(v_vehicle.make)) like lower(trim(v.make)) || '%'
      )
      and (
        lower(trim(v.model)) = lower(trim(v_vehicle.model))
        or lower(trim(v.model)) like '%' || lower(trim(v_vehicle.model)) || '%'
        or lower(trim(v_vehicle.model)) like '%' || lower(trim(v.model)) || '%'
      )
      and (
        (v.vin = v_vehicle.vin and v.vin is not null and v.vin != '' and v.vin not like 'VIVA-%')
        or (v.vin = v_vehicle.vin and (v.vin like 'VIVA-%' or v_vehicle.vin like 'VIVA-%'))
        or (
          (v.vin like 'VIVA-%' and v_vehicle.vin is not null and v_vehicle.vin != '' and v_vehicle.vin not like 'VIVA-%')
          or (v_vehicle.vin like 'VIVA-%' and v.vin is not null and v.vin != '' and v.vin not like 'VIVA-%')
        )
        or (
          (v.vin is null and v_vehicle.vin is not null and v_vehicle.vin != '' and v_vehicle.vin not like 'VIVA-%')
          or (v_vehicle.vin is null and v.vin is not null and v.vin != '' and v.vin not like 'VIVA-%')
        )
        or (v.vin is null and v_vehicle.vin is null)
        or (
          (v.vin is null and (v_vehicle.vin is null or v_vehicle.vin = '' or v_vehicle.vin like 'VIVA-%'))
          or (v_vehicle.vin is null and (v.vin is null or v.vin = '' or v.vin like 'VIVA-%'))
        )
      )
  loop
    if v_candidate.vin = v_vehicle.vin and v_candidate.vin is not null and v_candidate.vin != '' and v_candidate.vin not like 'VIVA-%' then
      v_match_type := 'vin_exact';
      v_confidence := 100;
      v_reasoning := 'Exact VIN match';
    elsif (v_candidate.vin like 'VIVA-%' and v_vehicle.vin is not null and v_vehicle.vin != '' and v_vehicle.vin not like 'VIVA-%')
       or (v_vehicle.vin like 'VIVA-%' and v_candidate.vin is not null and v_candidate.vin != '' and v_candidate.vin not like 'VIVA-%') then
      v_match_type := 'year_make_model_one_has_vin';
      v_confidence := 95;
      v_reasoning := 'Same year/make/model, one has real VIN and other has placeholder VIN';
    elsif (v_candidate.vin is null and v_vehicle.vin is not null and v_vehicle.vin != '' and v_vehicle.vin not like 'VIVA-%')
       or (v_vehicle.vin is null and v_candidate.vin is not null and v_candidate.vin != '' and v_candidate.vin not like 'VIVA-%') then
      v_match_type := 'year_make_model_one_has_vin';
      v_confidence := 92;
      v_reasoning := 'Same year/make/model, one has real VIN and other has NULL VIN';
    elsif v_candidate.vin = v_vehicle.vin and (v_candidate.vin like 'VIVA-%' or v_vehicle.vin like 'VIVA-%') then
      v_match_type := 'year_make_model_same_fake_vin';
      v_confidence := 90;
      v_reasoning := 'Same year/make/model and same placeholder VIN';
    elsif v_candidate.vin is null and v_vehicle.vin is null then
      v_match_type := 'year_make_model_no_vin';
      v_confidence := 88;
      v_reasoning := 'Same year/make/model, both have NULL VINs';
    else
      v_match_type := 'year_make_model';
      v_confidence := 85;
      v_reasoning := 'Same year/make/model match';
    end if;

    -- Provenance gate: BaT vs Dropbox/org inventory is an "incompatible source" unless VIN exact.
    v_candidate_is_bat := (v_candidate.bat_auction_url is not null) or (coalesce(v_candidate.discovery_url, '') ~* 'bringatrailer\\.com');
    v_candidate_is_dropbox := (coalesce(v_candidate.profile_origin, '') = 'dropbox_import')
      or (coalesce(v_candidate.discovery_source, '') ilike '%dropbox%')
      or (coalesce(v_candidate.origin_metadata->>'origin', '') = 'dropbox_import');

    if v_match_type <> 'vin_exact' then
      if (v_vehicle_is_bat and v_candidate_is_dropbox) or (v_candidate_is_bat and v_vehicle_is_dropbox) then
        v_confidence := least(v_confidence, 60);
        v_reasoning := v_reasoning || ' (capped: incompatible provenance bat vs dropbox_import)';
      end if;
    end if;

    return query select v_candidate.id, v_match_type, v_confidence, v_reasoning;
  end loop;
end;
$$;

commit;

