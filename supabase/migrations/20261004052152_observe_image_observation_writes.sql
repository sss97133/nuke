-- C12/C17: live 2026-10-04, all three active tables have no receipt sensor and
-- NULL writers_30d/last_write in v_schema_atlas. Reuse record_write_receipt();
-- never create another ledger or rewrite historical testimony. INSERT only:
-- these receipts measure arrivals, not image processing UPDATEs or correctness.
-- Existing observer failures cannot abort intake; the bounded health check must
-- report missing receipts rather than assume that installing sensors proves flow.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

CREATE TRIGGER trg_write_receipt_ins
AFTER INSERT ON public.vehicle_observations
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();
COMMENT ON TRIGGER trg_write_receipt_ins ON public.vehicle_observations IS
  'C12/C17: observe nonempty log INSERTs with the existing statement receipt ledger. Writer is caller-declared, not authentication. Receipt time is ingest time; testimony and source clocks remain unchanged. Assay: scripts/check-image-observation-health.mjs.';

CREATE TRIGGER trg_write_receipt_ins
AFTER INSERT ON public.observation_witnesses
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();
COMMENT ON TRIGGER trg_write_receipt_ins ON public.observation_witnesses IS
  'C17: observe nonempty witness INSERTs, including atomic derived projection, in the existing receipt ledger. The inherited caller declaration is not independent source or model identity. Assay: scripts/check-image-observation-health.mjs.';

CREATE TRIGGER trg_write_receipt_ins
AFTER INSERT ON public.vehicle_images
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();
COMMENT ON TRIGGER trg_write_receipt_ins ON public.vehicle_images IS
  'C17: observe image INSERT arrivals only through the existing receipt ledger. Does not measure analysis UPDATEs, inference, eligibility or processing completion. Undeclared callers remain undeclared. Assay: scripts/check-image-observation-health.mjs.';
COMMIT;
