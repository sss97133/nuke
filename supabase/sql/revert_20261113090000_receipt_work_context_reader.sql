-- Revert 20261113090000_receipt_work_context_reader: the reader is the only object it created; nothing was written.
DROP FUNCTION IF EXISTS public.get_vehicle_receipt_work_context(uuid, date);
