-- Revert fx_boc_cad_v1_20261024: additive table only; rename out of the way (no data deleted).
alter table if exists public.fx_boc_cad_usd_v1_20261024 rename to retired_fx_boc_cad_usd_v1_20261024;
