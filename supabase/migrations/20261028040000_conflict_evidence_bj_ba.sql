-- Conflict evidence v3: Barrett-Jackson stage-lot resolver, Broad Arrow Europe fee rows,
-- Broad Arrow estimate-as-price marker.
-- Revert (no hard delete):
--   update platform_fee_schedule set valid_to = valid_from, notes = notes || ' | closed by revert' where platform='broad_arrow' and notes like 'ba_eu_v1:%';
--   drop function public.resolve_bj_conflicts_from_stage_v1(text,boolean);
--   drop function public.mark_ba_estimate_as_price_v1(text,jsonb);
--   data runs are reverted with revert_price_basis_run_v2(run) plus the per-run revert SQL in the PR body.

-- Broad Arrow UK/Switzerland/Europe conditions of sale, Wayback capture 2025-10-09:
-- motor cars 15% (plus VAT on the premium) of the first 250,000 of hammer, 12.5% (plus VAT) above;
-- other lots 25% (plus VAT). Published results include the premium but exclude VAT (31 of 37 2025 CHF/EUR
-- conflicts fit 15%/12.5% without VAT).
insert into platform_fee_schedule (platform, role, fee_kind, rate, tier_floor, currency, lot_class, sale_type, valid_from, valid_to, source_url, cited_on, history_verified, published_price_basis, notes)
select 'broad_arrow','buyer','percent', r.rate, r.floor, c.cur, r.cls, 'any', '2025-01-01'::timestamptz, null, 'https://web.archive.org/web/20251009120440/https://bid.broadarrowauctions.com/conditions-of-sale', '2026-10-24', false, 'gross_incl_premium',
  'ba_eu_v1: '||r.note||' VAT is charged on the premium and is not part of published prices.'
from (values ('EUR'),('CHF')) c(cur),
     (values (0.15::numeric,0::numeric,'car','motor cars: 15% of the first 250,000 of hammer.'),
             (0.125,250000,'car','motor cars: 12.5% of hammer above 250,000.'),
             (0.25,0,'non_car','non-motor-car lots: 25%.')) r(rate,floor,cls,note)
where not exists (select 1 from platform_fee_schedule f where f.platform='broad_arrow' and f.currency=c.cur and f.lot_class=r.cls and f.tier_floor=r.floor);

-- Revert: drop function public.resolve_bj_conflicts_from_stage_v1(text, boolean);
-- Resolves Barrett-Jackson convention conflicts with cited lot-page evidence staged in bj_results_stage_v1_20261024
-- (one row per barrett-jackson.com lot, read from the BJ results API; price_usd is the published premium-inclusive price).
-- Match: lot URL item id = stage item_id, or same VIN + same model year; the cited price must equal the stored price
-- and identify exactly one sold, non-cancelled lot. Sale year must agree unless the stored date is a recovered
-- placeholder (sold_at_precision month_placeholder/unknown/null), in which case the lot's own date is the only dated evidence.
-- Writes an observed_page observation (gross = cited price, hammer = gross through the cited BJ schedule in force on the
-- lot's run date), supersedes the conflict (never deletes), and enqueues a re-derive.
create or replace function public.resolve_bj_conflicts_from_stage_v1(p_run_id text, p_dry boolean default true)
returns table(conflict_id bigint, event_id uuid, item_id text, how text, outcome text, gross numeric, hammer numeric)
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_ids bigint[]; v_h numeric; v_n int; v_s record;
begin
  for r in
    select o.id cid, o.event_id eid, o.stored_price sp, e.source_platform pf, e.source_url u, e.sold_at, e.sold_at_precision prec,
           v.year vy, upper(regexp_replace(v.vin, '[^A-Za-z0-9]', '', 'g')) vin,
           substring(e.source_url from 'barrett-jackson\.com/.*-([0-9]+)/?$') suf
      from price_basis_observation o join vehicle_events e on e.id = o.event_id left join vehicles v on v.id = e.vehicle_id
     where o.kind = 'convention_conflict' and o.superseded_at is null and o.tbl = 'vehicle_events'
       and e.source_platform in ('barrettjackson', 'barrett-jackson')
  loop
    conflict_id := r.cid; event_id := r.eid; item_id := null; how := null; gross := null; hammer := null;
    if r.u ~* '(bringatrailer|mecum)\.com' then outcome := 'platform_url_mismatch'; return next; continue; end if;
    select count(distinct s.item_id), min(s.item_id), min(case when s.item_id = r.suf then 'item' else 'vin' end)
      into v_n, item_id, how
      from bj_results_stage_v1_20261024 s
     where (s.item_id = r.suf or (length(r.vin) >= 6 and upper(regexp_replace(s.vin, '[^A-Za-z0-9]', '', 'g')) = r.vin and s.year = r.vy))
       and s.price_usd = r.sp and s.is_sold and not coalesce(s.is_canceled, false);
    if v_n = 0 then
      outcome := case when exists (select 1 from bj_results_stage_v1_20261024 s where s.item_id = r.suf
                         or (length(r.vin) >= 6 and upper(regexp_replace(s.vin, '[^A-Za-z0-9]', '', 'g')) = r.vin))
                      then 'stage_lot_price_differs' else 'no_stage_lot' end;
      item_id := null; how := null; return next; continue;
    elsif v_n > 1 then outcome := 'multiple_lots'; item_id := null; return next; continue;
    end if;
    select * into v_s from bj_results_stage_v1_20261024 s where s.item_id = resolve_bj_conflicts_from_stage_v1.item_id;
    if coalesce(r.prec, 'unknown') not in ('month_placeholder', 'unknown')
       and extract(year from r.sold_at) is distinct from extract(year from v_s.run_datetime) then
      outcome := 'sale_year_differs'; return next; continue;
    end if;
    v_ids := fee_schedule_buyer_ids(r.pf, 'USD', v_s.run_datetime::timestamptz, case when v_s.is_charity then 'charity' else 'car' end, 'any');
    if v_ids is null then outcome := 'no_schedule'; return next; continue; end if;
    v_h := fee_schedule_hammer_from_gross(v_ids, v_s.price_usd);
    gross := v_s.price_usd; hammer := v_h; outcome := case when v_s.is_charity then 'resolved_charity' else 'resolved' end;
    if not p_dry then
      insert into price_basis_observation (tbl, event_id, kind, observed_basis, observed_hammer, observed_gross, currency, stored_price, evidence, source_url, observed_on, rule, run_id)
      values ('vehicle_events', r.eid, 'observed_page', 'gross_incl_premium', v_h, v_s.price_usd, 'USD', r.sp,
              format('bj_stage_lot_v1: Barrett-Jackson lot %s (item %s, %s, lot %s, run %s) publishes sold price %s premium-inclusive, equal to stored %s; matched by %s. Hammer %s from platform_fee_schedule:%s at the lot date. Stage row %s read %s (%s). Supersedes conflict %s.',
                     v_s.title, v_s.item_id, v_s.event_slug, v_s.lot_number, v_s.run_datetime::date, v_s.price_usd, r.sp, how, v_h,
                     array_to_string(v_ids, ','), v_s.api_url, v_s.read_at::date, v_s.run_id, r.cid),
              v_s.lot_url, current_date, 'bj_stage_lot_v1', p_run_id)
      on conflict on constraint price_basis_observation_tbl_event_id_rule_key do nothing;
      update price_basis_observation set superseded_at = now() where id = r.cid;
      insert into price_basis_backfill_queue_v3 (tbl, id, run_id) values ('vehicle_events', r.eid, p_run_id) on conflict do nothing;
    end if;
    return next;
  end loop;
end $$;
revoke execute on function public.resolve_bj_conflicts_from_stage_v1(text, boolean) from public, anon, authenticated;

-- Broad Arrow estimate-as-price: orphan-backfill-v1 copied vehicles.asking_price (set by extract-broad-arrow
-- to the estimate HIGH) into vehicle_events.final_price for lots whose page shows only "Estimate:".
-- p_rows: [{eid, u, est_lo, est_hi, checked}] read from each lot page (no "Sold Price:" shown).
-- Only fills price_kind when it is null (never overwrites) and flags final_price as suspect.
create or replace function public.mark_ba_estimate_as_price_v1(p_run_id text, p_rows jsonb)
returns table(event_id uuid, outcome text)
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_e record;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(eid uuid, u text, est_lo numeric, est_hi numeric, checked date) loop
    event_id := r.eid;
    select e.* into v_e from vehicle_events e where e.id = r.eid and e.source_platform = 'broad_arrow';
    if not found then outcome := 'not_found'; return next; continue; end if;
    if v_e.final_price is distinct from r.est_hi then outcome := 'price_not_estimate_high'; return next; continue; end if;
    if v_e.price_kind is not null and v_e.price_kind <> 'estimate' then outcome := 'price_kind_set_' || v_e.price_kind; return next; continue; end if;
    update vehicle_events set price_kind = 'estimate',
           price_kind_source = format('ba_estimate_as_price_v1 %s: page shows Estimate %s-%s and no Sold Price (%s)', p_run_id, r.est_lo, r.est_hi, r.u),
           source_suspect = (select array_agg(distinct s) from unnest(coalesce(source_suspect, '{}') || array['final_price']) s),
           source_suspect_reason = coalesce(source_suspect_reason || '; ', '') || 'final_price equals page estimate high (ba_estimate_as_price_v1)',
           source_suspect_run_id = coalesce(source_suspect_run_id, p_run_id)
     where id = r.eid;
    insert into price_basis_observation (tbl, event_id, kind, observed_status, currency, stored_price, evidence, source_url, observed_on, rule, run_id)
    values ('vehicle_events', r.eid, 'observed_page_status', 'estimate', v_e.currency_code, v_e.final_price,
            format('ba_estimate_as_price_v1: lot page shows "Estimate: %s - %s" and no "Sold Price:"; stored price %s equals the estimate high (copied from vehicles.asking_price by orphan-backfill-v1). Read %s.', r.est_lo, r.est_hi, v_e.final_price, r.checked),
            r.u, r.checked, 'ba_estimate_as_price_v1', p_run_id)
    on conflict on constraint price_basis_observation_tbl_event_id_rule_key do nothing;
    update price_basis_observation o set superseded_at = now()
     where o.event_id = r.eid and o.kind = 'convention_conflict' and o.superseded_at is null;
    insert into price_basis_backfill_queue_v3 (tbl, id, run_id) values ('vehicle_events', r.eid, p_run_id) on conflict do nothing;
    outcome := 'marked'; return next;
  end loop;
end $$;
revoke execute on function public.mark_ba_estimate_as_price_v1(text, jsonb) from public, anon, authenticated;
