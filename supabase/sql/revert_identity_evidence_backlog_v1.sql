-- Revert identity_lex_v1 backlog run (2026-10-25): retire, never delete.
-- 138,634 rows: truck_utility 125,227 / tractor 9,535 / memorabilia 3,872.
-- Spot-check precision (hand, n=225): truck_utility 100%, memorabilia 96.3%, tractor 96%.
-- Not applied (<95%): car, motorcycle, cart_utility, trailer_rv, boat, aircraft.
set local statement_timeout = '50s';
update vehicle_identity_evidence
   set retired_at = now()
 where run_id = 'identity_lex_v1_backlog_20261025'
   and retired_at is null;
-- If the 50s limit is hit, run repeatedly with: and id in (select id ... limit 20000)
