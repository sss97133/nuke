-- Revert 20261024090000_price_basis_tiers_observations.
-- 1) restore derived columns of every v2 run from its backup (exact), 2) drop v2 objects.
select cron.unschedule(jobid) from cron.job where jobname like 'price_basis_backfill_v2%';
select public.revert_price_basis_run_v2(r) from (select distinct run_id r from public.price_basis_backup_v2) x;
drop function if exists public.revert_price_basis_run_v2(text);
drop function if exists public.backfill_price_basis_batch_v2(text, text, int);
drop function if exists public.derive_price_components_v2(text, uuid, text, numeric, timestamptz, text, text);
drop function if exists public.fee_schedule_hammer_from_gross(bigint[], numeric);
drop function if exists public.fee_schedule_premium(bigint[], numeric);
drop view if exists public.price_basis_conflicts;
do $$ declare t text; begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format('alter table public.%I drop column if exists fx_to_usd, drop column if exists fx_to_usd_source, drop column if exists price_basis_conflict', t);
  end loop;
end $$;
-- backups/observations are kept as archive tables rather than dropped (rename instead of delete)
alter table if exists public.price_basis_backup_v2 rename to price_basis_backup_v2_reverted;
alter table if exists public.price_basis_observation rename to price_basis_observation_reverted;
drop table if exists public.price_basis_backfill_queue_v2;
-- restore the original v1 derivation (before the columns go)
create or replace function public.derive_price_components(p_platform text, p_price numeric, p_at timestamptz)
returns table (price_basis public.price_basis_t, hammer_price numeric, hammer_price_source text, hammer_price_confidence text,
  buyer_premium_amount numeric, buyer_premium_rate numeric, buyer_premium_source text, buyer_premium_confidence text,
  gross_price numeric, gross_price_source text, gross_price_confidence text,
  seller_fee_amount numeric, seller_fee_source text, seller_fee_confidence text,
  net_to_owner numeric, net_to_owner_source text, net_to_owner_confidence text)
language plpgsql stable set search_path = public as $$
declare b platform_fee_schedule; s platform_fee_schedule; v_conf text; v_bsrc text; v_ssrc text;
begin
  if p_price is null or p_price <= 0 then return; end if;
  select * into b from platform_fee_schedule f where f.platform = p_platform and f.role = 'buyer'
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if not found then
    price_basis := 'unknown'; return next; return;
  end if;
  v_conf := case when p_at is null then 'schedule_current_sale_undated' else 'schedule_dated' end;
  v_bsrc := 'platform_fee_schedule:' || b.id || ' ' || b.source_url;
  price_basis := b.published_price_basis;
  buyer_premium_rate := b.rate; buyer_premium_source := v_bsrc;
  if b.published_price_basis = 'hammer' then
    hammer_price := p_price; hammer_price_source := 'legacy price column (platform publishes hammer)'; hammer_price_confidence := 'reported';
    buyer_premium_amount := round(p_price * b.rate);
    if b.min_amount is not null then buyer_premium_amount := greatest(buyer_premium_amount, b.min_amount); end if;
    if b.cap_amount is not null then buyer_premium_amount := least(buyer_premium_amount, b.cap_amount); end if;
    buyer_premium_confidence := v_conf;
    gross_price := hammer_price + buyer_premium_amount; gross_price_source := v_bsrc; gross_price_confidence := v_conf;
  else
    gross_price := p_price; gross_price_source := 'legacy price column (platform publishes premium-inclusive)'; gross_price_confidence := 'reported';
    hammer_price := round(p_price / (1 + b.rate)); hammer_price_source := v_bsrc;
    hammer_price_confidence := case when b.cap_amount is null and b.min_amount is null then 'derived_from_gross' else 'derived_from_gross_cap_ignored' end;
    buyer_premium_amount := p_price - hammer_price; buyer_premium_confidence := hammer_price_confidence;
  end if;
  select * into s from platform_fee_schedule f where f.platform = p_platform and f.role = 'seller'
    and (p_at is null and f.valid_to is null or (f.valid_from is null or f.valid_from <= p_at) and (f.valid_to is null or p_at < f.valid_to))
    order by f.valid_from desc nulls last limit 1;
  if found then
    v_ssrc := 'platform_fee_schedule:' || s.id || ' ' || s.source_url;
    seller_fee_amount := case when s.fee_kind = 'flat' then s.flat_amount
      else least(greatest(round(hammer_price * s.rate), coalesce(s.min_amount, 0)), coalesce(s.cap_amount, 'Infinity'::numeric)) end;
    seller_fee_source := v_ssrc; seller_fee_confidence := 'schedule_current_not_dated';
    net_to_owner := hammer_price - seller_fee_amount; net_to_owner_source := v_ssrc;
    net_to_owner_confidence := 'schedule_current_not_dated';
  end if;
  return next;
end $$;
delete from public.platform_fee_schedule where cited_on = '2026-10-23' and (platform in ('gooding','bonhams') or currency <> 'USD' or lot_class <> 'any');
alter table public.platform_fee_schedule drop column if exists tier_floor, drop column if exists lot_class, drop column if exists cited_on, drop column if exists history_verified;
