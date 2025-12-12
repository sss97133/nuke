-- Add import_queue_id to vehicles so process-import-queue can persist provenance.
-- This fixes runtime failures where the edge function tries to write import_queue_id
-- but the vehicles table doesn't have the column.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS import_queue_id UUID;

CREATE INDEX IF NOT EXISTS idx_vehicles_import_queue_id
  ON public.vehicles(import_queue_id)
  WHERE import_queue_id IS NOT NULL;


