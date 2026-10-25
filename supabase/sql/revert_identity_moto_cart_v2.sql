-- Revert identity v2 backlog runs (2026-10-25): retire, never delete.
-- identity_moto_v2_backlog_20261025: 37,234 motorcycle rows (spot 129/130 = 99.2%)
-- identity_cart_v2_backlog_20261025:  3,076 cart_utility rows (fresh spot 105/110 = 95.5%)
-- trailer_rv v2 not applied (93.6% on fresh 110).
set local statement_timeout = '50s';
update vehicle_identity_evidence
   set retired_at = now()
 where run_id in ('identity_moto_v2_backlog_20261025','identity_cart_v2_backlog_20261025')
   and retired_at is null;
