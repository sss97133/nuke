-- Revert 20261122032000: drop new folds. Does not restore prior compute_vehicle_grade /
-- get_vehicle_total_invested / compute_vehicle_value bodies (restore those from the prior
-- migration fingerprints if a full rollback is required).
DROP FUNCTION IF EXISTS public.vehicle_replica_accuracy(uuid);
DROP FUNCTION IF EXISTS public.reconcile_identity_field_provenance(uuid, boolean);
DROP FUNCTION IF EXISTS public.identity_source_rank(text);
DROP FUNCTION IF EXISTS public.promote_vehicle_decode_entities(uuid, boolean);
DROP FUNCTION IF EXISTS public.vehicle_documented_spend(uuid);
DROP FUNCTION IF EXISTS public._vehicle_documented_spend_unmasked(uuid);
-- Provenance columns left in place (nullable / defaulted); dropping them risks entity rows.