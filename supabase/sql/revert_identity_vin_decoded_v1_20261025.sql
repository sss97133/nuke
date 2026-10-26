-- Revert: vin_decoded_data gap-fill (2026-10-25): 26,312 truck_utility + 505 motorcycle rows, extractor vin_decoded_v1,
-- plus the 19 decode-conflict flags on identity_lex_v1 car rows. No COMMIT.
set local statement_timeout = '55s';
update vehicle_identity_evidence set retired_at = now()
 where run_id = 'identity_vin_decoded_v1_20261025' and retired_at is null;
update vehicle_identity_evidence
   set conflict = false, conflict_with = null,
       issues = array_remove(issues, 'flag:decode_conflict_vin_decoded_20261025')
 where 'flag:decode_conflict_vin_decoded_20261025' = any(issues);
insert into vehicle_category_change_log(run_id, phase, counts)
select 'identity_vin_decoded_v1_20261025', 'revert', jsonb_build_object('active', count(*))
  from vehicle_identity_evidence where run_id = 'identity_vin_decoded_v1_20261025' and retired_at is null;
