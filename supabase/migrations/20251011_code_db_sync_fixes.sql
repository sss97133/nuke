-- Code/DB sync fixes: base timeline table usage + missing tables
-- Created: 2025-10-11

BEGIN;

-- 1) Fix bad FK: timeline_event_comments.event_id must reference base table, not view
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'timeline_event_comments'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    -- Try to drop FK on event_id if it points to view
    BEGIN
      ALTER TABLE public.timeline_event_comments
        DROP CONSTRAINT IF EXISTS timeline_event_comments_event_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      -- ignore
    END;
  END IF;
END $$;

ALTER TABLE public.timeline_event_comments
  ADD CONSTRAINT timeline_event_comments_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.timeline_events(id) ON DELETE CASCADE;

-- Ensure vehicle_id exists for comments (idempotent)
ALTER TABLE public.timeline_event_comments
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE;

-- Attempt to backfill vehicle_id for existing rows where possible
UPDATE public.timeline_event_comments tec
SET vehicle_id = te.vehicle_id
FROM public.timeline_events te
WHERE tec.event_id = te.id AND tec.vehicle_id IS NULL;

-- 2) Create image_tags table used by ProImageViewer
CREATE TABLE IF NOT EXISTS public.image_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  x_position numeric(5,2) CHECK (x_position >= 0 AND x_position <= 100),
  y_position numeric(5,2) CHECK (y_position >= 0 AND y_position <= 100),
  tag_text text NOT NULL,
  tag_type text,
  trust_score numeric(4,2),
  verification_status text,
  created_by uuid REFERENCES auth.users(id),
  source text,
  confidence numeric(5,2),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.image_tags
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.image_tags
  ALTER COLUMN created_at SET DEFAULT now();

-- RLS
ALTER TABLE public.image_tags ENABLE ROW LEVEL SECURITY;
-- Public read (images are public); tighten later if needed
DROP POLICY IF EXISTS image_tags_select_all ON public.image_tags;
CREATE POLICY image_tags_select_all ON public.image_tags
  FOR SELECT USING (true);
-- Authenticated users can insert their own tags
DROP POLICY IF EXISTS image_tags_insert_own ON public.image_tags;
CREATE POLICY image_tags_insert_own ON public.image_tags
  FOR INSERT WITH CHECK (auth.uid()::text = created_by::text);
-- Owners can update/delete their tags
DROP POLICY IF EXISTS image_tags_update_own ON public.image_tags;
CREATE POLICY image_tags_update_own ON public.image_tags
  FOR UPDATE USING (auth.uid()::text = created_by::text);
DROP POLICY IF EXISTS image_tags_delete_own ON public.image_tags;
CREATE POLICY image_tags_delete_own ON public.image_tags
  FOR DELETE USING (auth.uid()::text = created_by::text);

CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON public.image_tags(image_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'image_tags' AND indexname = 'idx_image_tags_created_at'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_image_tags_created_at';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'image_tags' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_image_tags_created_at ON public.image_tags(created_at DESC)';
  END IF;
END $$;

-- 3) Create vehicle_listing_archives table for full listing preservation
CREATE TABLE IF NOT EXISTS public.vehicle_listing_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  source_platform text,              -- e.g., 'bring_a_trailer'
  source_url text,
  listing_status text,               -- 'active','sold','removed','archived'
  final_sale_price numeric(12,2),
  sale_date date,
  html_content text,                 -- full HTML snapshot (optional)
  description_text text,
  images jsonb DEFAULT '[]'::jsonb,  -- array of image URLs/paths
  metadata jsonb DEFAULT '{}'::jsonb,
  scraped_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.vehicle_listing_archives ENABLE ROW LEVEL SECURITY;
-- Public read for now (listings are public provenance); revisit if needed
DROP POLICY IF EXISTS vehicle_listing_archives_select_all ON public.vehicle_listing_archives;
CREATE POLICY vehicle_listing_archives_select_all ON public.vehicle_listing_archives
  FOR SELECT USING (true);
-- Only vehicle owners can insert archive rows
DROP POLICY IF EXISTS vehicle_listing_archives_insert_owner ON public.vehicle_listing_archives;
CREATE POLICY vehicle_listing_archives_insert_owner ON public.vehicle_listing_archives
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id::text = vehicle_id::text AND v.user_id::text = auth.uid()::text
    )
  );

CREATE INDEX IF NOT EXISTS idx_listing_archives_vehicle ON public.vehicle_listing_archives(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_listing_archives_platform ON public.vehicle_listing_archives(source_platform);
CREATE INDEX IF NOT EXISTS idx_listing_archives_sale_date ON public.vehicle_listing_archives(sale_date);

COMMIT;
