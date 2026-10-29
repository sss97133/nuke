-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Retire the staging load (run bj_results_v1_20261024) without deleting: rename tables out of the way.
set local lock_timeout='5s';
alter table public.bj_results_stage_v1_20261024 rename to retired_bj_results_stage_v1_20261024;
alter table public.agg_houselot_v1_20261024_cand9 rename to retired_agg_houselot_v1_20261024_cand9;

