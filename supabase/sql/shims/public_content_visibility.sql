-- Shim for public content visibility migration (idempotent for resets)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_approval_status') THEN
    CREATE TYPE content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_redaction_level') THEN
    CREATE TYPE content_redaction_level AS ENUM ('none','details_hidden','full_blur');
  END IF;
END $$;

ALTER TABLE IF EXISTS vehicle_image_assets
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

ALTER TABLE IF EXISTS vehicle_images
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

ALTER TABLE IF EXISTS vehicle_documents
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

