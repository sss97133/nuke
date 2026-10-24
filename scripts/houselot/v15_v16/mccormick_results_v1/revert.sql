-- never hard-delete: retire the staging table (rename), it stays queryable
alter table if exists public.mccormick_results_stage_v1_20261024 rename to retired_mccormick_results_stage_v1_20261024;
