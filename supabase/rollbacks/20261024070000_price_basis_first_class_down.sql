-- Revert 20261024070000_price_basis_first_class. Legacy price columns were never written, so nothing to restore.
select cron.unschedule(jobid) from cron.job where jobname = 'price_basis_backfill_v1';
drop function if exists public.get_comps_combined(public.price_basis_t,text,text,integer,integer,numeric,numeric,uuid,integer);
drop function if exists public.get_comps_scored(public.price_basis_t,text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer);
drop function if exists public.get_auction_comps(public.price_basis_t,text,text,integer,integer,numeric,numeric,uuid,integer);
drop function if exists public.get_model_price_history(public.price_basis_t,text,text,integer,integer,integer);
comment on function public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer) is null;
comment on function public.get_comps_combined(text,text,integer,integer,numeric,numeric,uuid,integer) is null;
comment on function public.get_auction_comps(text,text,integer,integer,numeric,numeric,uuid,integer) is null;
comment on function public.get_model_price_history(text,text,integer,integer,integer) is null;
drop function if exists public.backfill_price_basis_batch(text, text, int);
drop function if exists public.derive_price_components(text, numeric, timestamptz);
drop table if exists public.price_basis_backfill_queue;
do $$ declare t text; begin
  foreach t in array array['vehicle_events','auction_events'] loop
    execute format('alter table public.%I drop column if exists price_basis, drop column if exists hammer_price, drop column if exists hammer_price_source, drop column if exists hammer_price_confidence, drop column if exists buyer_premium_amount, drop column if exists buyer_premium_rate, drop column if exists buyer_premium_source, drop column if exists buyer_premium_confidence, drop column if exists gross_price, drop column if exists gross_price_source, drop column if exists gross_price_confidence, drop column if exists seller_fee_amount, drop column if exists seller_fee_source, drop column if exists seller_fee_confidence, drop column if exists net_to_owner, drop column if exists net_to_owner_source, drop column if exists net_to_owner_confidence, drop column if exists price_basis_run_id', t);
  end loop;
end $$;
drop table if exists public.platform_fee_schedule;
drop type if exists public.price_basis_t;
