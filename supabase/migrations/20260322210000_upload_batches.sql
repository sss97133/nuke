-- Presigned URL upload batches — tracks bulk upload sessions
-- Used by image-intake prepare_upload/confirm_upload actions

CREATE TABLE upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  source text DEFAULT 'presigned',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'complete', 'failed')),
  total_items int NOT NULL,
  completed_items int DEFAULT 0,
  duplicates_skipped int DEFAULT 0,
  errors int DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_upload_batches_user ON upload_batches(user_id);
CREATE INDEX idx_upload_batches_status ON upload_batches(status) WHERE status != 'complete';

CREATE TABLE upload_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
  item_index int NOT NULL,
  filename text NOT NULL,
  file_hash text,
  file_size bigint,
  storage_path text,
  signed_url text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'uploaded', 'confirmed', 'failed', 'duplicate')),
  vehicle_hint jsonb,
  vehicle_id uuid,
  image_id uuid,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_upload_batch_items_batch ON upload_batch_items(batch_id);
CREATE INDEX idx_upload_batch_items_hash ON upload_batch_items(file_hash) WHERE file_hash IS NOT NULL;

-- Add upload_batch_id to vehicle_images for traceability
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS upload_batch_id uuid;

COMMENT ON TABLE upload_batches IS 'Tracks presigned URL upload sessions. Owned by image-intake edge function.';
COMMENT ON TABLE upload_batch_items IS 'Individual items within an upload batch. Tracks presigned URL generation through confirmation.';
COMMENT ON COLUMN vehicle_images.upload_batch_id IS 'Links to upload_batches for presigned URL uploads. Owned by image-intake.';
