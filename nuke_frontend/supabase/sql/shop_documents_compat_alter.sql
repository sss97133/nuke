BEGIN;

-- Add visibility column if missing to support public document reads
ALTER TABLE public.shop_documents
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'admin_only';

COMMIT;
