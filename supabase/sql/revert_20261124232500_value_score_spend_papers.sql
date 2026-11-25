-- Revert 20261124232500_value_score_spend_papers: compute_vehicle_value as in production on 2026-11-25, before it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  img_count int := 0;
  approved_img_count int := 0;
  tag_count int := 0;
  recent_events int := 0;
  receipts_total numeric := 0;
  verified_owner boolean := false;
  contrib_count int := 0;
  public_flag boolean := true;
  completeness numeric := 0;
  score numeric := 0;
begin
  -- gallery-eligible photos only (same definition as vehicles.image_count and the public gallery)
  select count(*), count(*) filter (where coalesce(vi.is_approved, true))
    into img_count, approved_img_count
  from public.vehicle_images vi
  where vi.vehicle_id = p_vehicle_id and public.vehicle_image_gallery_eligible(vi);

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='image_tags') then
    select count(*) into tag_count
    from public.image_tags t
    join public.vehicle_images vi on vi.id = t.image_id
    where vi.vehicle_id = p_vehicle_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='timeline_events') then
    select count(*) into recent_events
    from public.timeline_events
    where vehicle_id = p_vehicle_id
      and created_at >= now() - interval '30 days';
  else
    recent_events := 0;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='receipts') then
    select coalesce(sum(total_amount), 0) into receipts_total
    from public.receipts
    where scope_type = 'vehicle' and duplicate_of is null and amount_check in ('verified','plausible')
      and not public.receipt_doc_kind_quoted(document_kind)
      and scope_id::text = p_vehicle_id::text
      and coalesce(processing_status, 'parsed') in ('parsed','validated','saved');
  else
    receipts_total := 0;
  end if;

  select coalesce(is_public, true) into public_flag
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  select (
    (case when (v.make is not null and v.make <> '') then 1 else 0 end) +
    (case when (v.model is not null and v.model <> '') then 1 else 0 end) +
    (case when v.year is not null then 1 else 0 end) +
    (case when (v.vin is not null and v.vin <> '') then 1 else 0 end) +
    (case when (v.color is not null and v.color <> '') then 1 else 0 end) +
    (case when (v.engine_size is not null) then 1 else 0 end) +
    (case when (v.transmission is not null and v.transmission <> '') then 1 else 0 end)
  ) / 7.0
  into completeness
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  score := 0;
  score := score + LEAST(40, COALESCE(ln(GREATEST(2, approved_img_count)) * 20, 0));
  score := score + LEAST(15, (tag_count / 50.0) * 15);
  score := score + LEAST(15, (recent_events / 10.0) * 15);
  score := score + LEAST(15, (receipts_total / 5000.0) * 15);
  if verified_owner then score := score + 10; end if;
  score := score + LEAST(5, contrib_count);
  if public_flag then score := score + 5; end if;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  update public.vehicles set value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'receipts_total', receipts_total,
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  where id = p_vehicle_id;

  return score;
end $function$;
COMMIT;
