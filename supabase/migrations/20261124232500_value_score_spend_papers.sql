-- compute_vehicle_value: the documented-spend term reads the spend fold (vehicle_spend_lines, 20261124224500) as a count of
-- papers, and value_breakdown carries documented_spend present/none and spend_papers instead of receipts_total.
--
-- WHY. vehicles.value_score and vehicles.value_breakdown are readable logged out (column grants to anon). The term was
-- LEAST(15, receipts_total / 5000 * 15) with receipts_total written into value_breakdown, so a dollar figure, and from
-- the score with the other public terms a dollar band, was public. Measured 2026-11-25 (ta-packet): 0 of 25 vehicles
-- with receipts carry receipts_total > 0, because the processing_status filter misses 'completed' and the sum read only
-- scope_type = 'vehicle' receipts, not receipt_vehicle_links. Fixing that filter alone would have opened the leak.
--
-- WHAT. One point per counted paper on the car, at most 15 (the term's old cap). Every other term is unchanged. The
-- cars that hold spend rows are queued on vehicle_value_recompute_queue, which drain_vehicle_derived_queues drains.
-- Revert: supabase/sql/revert_20261124232500_value_score_spend_papers.sql (the definition before, from production).
-- Contract: supabase/sql/test_value_score_spend_papers.sql (PG17).
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
  spend_papers int := 0;
  spend_net numeric := 0;
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

  -- vehicle_spend_papers_v1: documented spend from the spend fold (vehicle_spend_lines), as a count of papers. No dollar
  -- figure enters the score or value_breakdown, both of which logged-out visitors read.
  select count(distinct s.receipt_id), coalesce(sum(s.amount), 0) into spend_papers, spend_net
    from public.vehicle_spend_lines s where s.vehicle_id = p_vehicle_id;

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
  score := score + LEAST(15, spend_papers);
  if verified_owner then score := score + 10; end if;
  score := score + LEAST(5, contrib_count);
  if public_flag then score := score + 5; end if;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  update public.vehicles set value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'documented_spend', case when spend_net > 0 then 'present' else 'none' end,
      'spend_papers', spend_papers,
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  where id = p_vehicle_id;

  return score;
end $function$;
INSERT INTO public.vehicle_value_recompute_queue (vehicle_id)
SELECT DISTINCT s.vehicle_id FROM public.vehicle_spend_lines s
ON CONFLICT (vehicle_id) DO NOTHING;
COMMIT;
