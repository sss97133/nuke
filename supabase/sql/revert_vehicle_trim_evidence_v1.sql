-- Revert run trim_title_lex_v1_20261025: retire rows (no delete).
update public.vehicle_trim_evidence set retired_at = now()
 where run_id = 'trim_title_lex_v1_20261025' and retired_at is null;
