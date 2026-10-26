-- Revert: lex_v2 anchored-rule restore (2026-10-25), 16,455 truck_utility rows, extractor identity_lex_v2.
-- Optional: add  and 'lex_v2_rule:V2_num' = any(issues)  to revert one rule class. No COMMIT.
set local statement_timeout = '55s';
update vehicle_identity_evidence set retired_at = now()
 where run_id = 'identity_lex_v2_restore_20261025' and retired_at is null;
insert into vehicle_category_change_log(run_id, phase, counts)
select 'identity_lex_v2_restore_20261025', 'revert', jsonb_build_object('active', count(*))
  from vehicle_identity_evidence where run_id = 'identity_lex_v2_restore_20261025' and retired_at is null;
