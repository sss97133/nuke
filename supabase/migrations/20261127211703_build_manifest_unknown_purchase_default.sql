-- Missing acquisition state is unknown; a default cannot supply negative testimony.
-- Existing rows and explicit caller inputs retain their values.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
ALTER TABLE public.vehicle_build_manifest ALTER COLUMN purchased DROP DEFAULT;
COMMENT ON COLUMN public.vehicle_build_manifest.purchased IS
 'Acquisition state: NULL means unknown. There is no insertion default, so an omitted state remains NULL. Explicit true/false values are recorded claims; this default does not qualify their evidence. Reviewed withdrawals remain guarded by purchase_review_observation_id and retain their private before-image; this schema change rewrites no existing row.';
COMMIT;
