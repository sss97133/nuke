-- Safer duplicate merge policy (stop risky auto-merges)
--
-- Problem:
-- - The current duplicate detector can return confidence=95 for "same year/make/model AND one has VIN"
-- - This is not a unique identifier and can (and does) merge unrelated vehicles.
--
-- Fix:
-- - Only auto-merge at confidence >= 100 (currently only possible for exact VIN matches).
-- - Keep duplicate detection running (so humans/curation can review), but prevent destructive merges
--   from weak signals like YMM similarity.

begin;

-- 1) Raise threshold in the insert/update trigger (vehicles)
create or replace function public.trigger_check_duplicates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duplicate record;
  v_auto_merge_threshold integer := 100;
begin
  -- If we are already in a vehicle merge process, skip this trigger to prevent recursion
  if current_setting('app.is_merging_vehicles', true) = 'TRUE' then
    return new;
  end if;

  -- Only check if vehicle has year, make, and model
  if new.year is null or new.make is null or new.model is null then
    return new;
  end if;

  -- Find duplicates with high confidence (auto-merge threshold)
  for v_duplicate in
    select *
    from public.detect_vehicle_duplicates(new.id)
    where confidence >= v_auto_merge_threshold
    order by confidence desc
    limit 1
  loop
    -- Keep the NEW vehicle if it has a real VIN, otherwise keep the existing one
    if new.vin is not null and new.vin <> '' and new.vin not like 'VIVA-%' then
      perform public.auto_merge_duplicates_with_notification(
        new.id,
        v_duplicate.duplicate_id,
        v_duplicate.match_type,
        v_duplicate.confidence,
        null
      );
    else
      perform public.auto_merge_duplicates_with_notification(
        v_duplicate.duplicate_id,
        new.id,
        v_duplicate.match_type,
        v_duplicate.confidence,
        null
      );
    end if;
    exit;
  end loop;

  return new;
end;
$$;

-- 2) Raise threshold for the cron batch processor (pg_cron)
create or replace function public.process_duplicate_detection_batch()
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  for v_id in
    select id
    from public.vehicles
    where year is not null and make is not null and model is not null
    order by updated_at desc nulls last
    limit 100
  loop
    begin
      select public.check_and_auto_merge_duplicates(v_id, 100) into v_result;
    exception when others then
      raise warning 'Failed to check duplicates for vehicle %: %', v_id, sqlerrm;
    end;
  end loop;
end;
$$;

commit;

