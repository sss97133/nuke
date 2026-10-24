-- reversible, no hard delete: retire analysis table and fee columns' values
begin; set local statement_timeout='55s';
alter table if exists public.agg_houselot_v17_20261024_gate rename to retired_agg_houselot_v17_20261024_gate;
update public.mccormick_results_stage_v1_20261024 set buyer_fee_pct=null, price_net_usd=null, fee_source_url=null;
commit;
