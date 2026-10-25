-- Root cause: legacy convention_conflict rows (rule round_price_convention_conflict_v1, written by
-- price_basis_inferred_v1) tested stored prices against a FLAT premium (e.g. 12%) and were never re-tested
-- after tiered, cited schedules were added (e.g. Gooding 12% to $250k + 10% above, platform_fee_schedule 55,56).
-- This adds a re-check that tests each active conflict against the cited schedule set derive_price_components_v3 uses.
-- Also adds the missing Gooding London (GBP) buyer schedule: flat 12.5%, 2022-2024.
-- Revert (no hard delete): update platform_fee_schedule set valid_to = valid_from, notes = notes || ' | closed by revert' where platform='gooding' and currency='GBP' and notes like 'gooding_v1_gbp:%'; drop function public.recheck_convention_conflicts_v1(text,integer,boolean); drop function public.fee_schedule_buyer_ids(text,text,timestamptz,text,text);

create or replace function public.fee_schedule_buyer_ids(p_platform text, p_currency text, p_at timestamptz, p_lot_class text, p_sale_type text)
returns bigint[] language plpgsql stable set search_path to 'public' as $$
declare v_cur text := upper(coalesce(p_currency,'USD')); v_st text := coalesce(p_sale_type,'unknown'); pick record; ids bigint[];
begin
  -- same schedule-set choice as derive_price_components_v3: exact sale type, then exact lot class, then newest valid_from
  select f.lot_class, f.valid_from, f.sale_type into pick from platform_fee_schedule f
   where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class in (p_lot_class,'any')
     and f.sale_type in (v_st,'any')
     and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
   order by (f.sale_type = v_st) desc, (f.lot_class = p_lot_class) desc, f.valid_from desc nulls last limit 1;
  if not found then return null; end if;
  select array_agg(f.id order by f.tier_floor) into ids from platform_fee_schedule f
   where f.platform = p_platform and f.role = 'buyer' and upper(f.currency) = v_cur and f.lot_class = pick.lot_class
     and f.sale_type = pick.sale_type and f.valid_from is not distinct from pick.valid_from;
  return ids;
end $$;

create or replace function public.recheck_convention_conflicts_v1(p_run_id text, p_limit integer default 2000, p_dry boolean default true)
returns table(event_id uuid, conflict_id bigint, ids bigint[], stored numeric, hammer numeric, outcome text)
language plpgsql set search_path to 'public' as $$
-- Bid-increment roundness test (same arithmetic standard as conflict_pattern_resolution_v3): a hammer is an
-- increment when it is a multiple of $5,000 at or above $250k, $1,000 at or above $100k, $250 below.
-- schedule_fit: hammer derived through the cited schedule is an increment AND the stored price itself is not one
--   (so it cannot be a hammer reported as the price) -> pattern_resolution gross_incl_premium, conflict superseded.
-- ambiguous_round_both / no_fit / no_schedule / not_sale: left flagged.
declare r record; v_ids bigint[]; v_h numeric; v_out text; v_src text;
  function_step constant text := 'increment: 5000 >=250k, 1000 >=100k, 250 below';
begin
  if p_run_id is null then raise exception 'run id required'; end if;
  for r in
    select c.id cid, c.event_id eid, e.final_price p, e.source_platform pf, coalesce(e.sold_at,e.ended_at) at, e.currency_code cur,
           e.sale_type st, e.price_kind pk, e.charity_lot ch,
           coalesce(case when e.charity_lot then 'charity' end,
                    (select m.lot_class from platform_lot_category_class m where m.platform = e.source_platform and m.lot_category = e.lot_category), 'car') lc
      from price_basis_observation c join vehicle_events e on e.id = c.event_id
     where c.tbl = 'vehicle_events' and c.kind = 'convention_conflict' and c.superseded_at is null
     order by c.id limit p_limit
  loop
    v_ids := null; v_h := null;
    if coalesce(r.pk,'sale') <> 'sale' or r.p is null or r.p <= 0 then v_out := 'not_sale';
    else
      v_ids := fee_schedule_buyer_ids(r.pf, r.cur, r.at, r.lc, r.st);
      if v_ids is null then v_out := 'no_schedule';
      else
        v_h := fee_schedule_hammer_from_gross(v_ids, r.p);
        if v_h is null then v_out := 'no_fit';
        elsif mod(v_h, case when v_h >= 250000 then 5000 when v_h >= 100000 then 1000 else 250 end) <> 0 then v_out := 'no_fit';
        elsif mod(r.p, case when r.p >= 250000 then 5000 when r.p >= 100000 then 1000 else 250 end) = 0 then v_out := 'ambiguous_round_both';
        else v_out := 'schedule_fit'; end if;
      end if;
    end if;
    if not p_dry and v_out = 'schedule_fit' then
      select string_agg(distinct f.source_url, ' ') into v_src from platform_fee_schedule f where f.id = any(v_ids);
      insert into price_basis_observation (tbl, event_id, kind, observed_basis, observed_hammer, observed_gross, currency, stored_price, evidence, source_url, observed_on, rule, run_id)
      values ('vehicle_events', r.eid, 'pattern_resolution', 'gross_incl_premium', v_h, r.p, upper(coalesce(r.cur,'USD')), r.p,
              format('schedule_tier_recheck_v1: stored %s through cited schedule platform_fee_schedule:%s gives hammer %s (%s); stored itself is not an increment, so it is premium-inclusive. Supersedes legacy flat-rate conflict %s.',
                     r.p, array_to_string(v_ids, ','), v_h, function_step, r.cid),
              v_src, current_date, 'schedule_tier_recheck_v1', p_run_id)
      on conflict on constraint price_basis_observation_tbl_event_id_rule_key do nothing;
      update price_basis_observation set superseded_at = now() where id = r.cid;
      insert into price_basis_backfill_queue_v3 (tbl, id, run_id) values ('vehicle_events', r.eid, p_run_id);
    end if;
    event_id := r.eid; conflict_id := r.cid; ids := v_ids; stored := r.p; hammer := v_h; outcome := v_out; return next;
  end loop;
end $$;

revoke all on function public.recheck_convention_conflicts_v1(text,integer,boolean) from public, anon, authenticated;
revoke all on function public.fee_schedule_buyer_ids(text,text,timestamptz,text,text) from public, anon, authenticated;

insert into public.platform_fee_schedule (platform, role, fee_kind, rate, currency, published_price_basis, valid_from, valid_to, source_url, notes, tier_floor, lot_class, cited_on, history_verified, sale_type)
select 'gooding','buyer','percent',0.125,'GBP','gross_incl_premium','2022-01-01','2025-01-01',
  'https://k500.com/story-item/goodings-22m-2022-hampton-court-auction',
  'gooding_v1_gbp: London (Hampton Court) vehicle lots flat 12.5% buyer premium ("Gooding levied a flat 12.5% across the board", K500 2022-09-03; e.g. GBP 7,762,500 gross = 6,900,000 net x 1.125). 2023 London published results (classic-car-auctions.info/european/2023-gooding-london-sale-auction-results/, "results including premium") all fit 12.5% (2,531,250 = 2,250,000 x 1.125). 2024 by arithmetic only.',
  0,'any','2026-10-24',false,'any'
where not exists (select 1 from public.platform_fee_schedule where platform='gooding' and currency='GBP');
