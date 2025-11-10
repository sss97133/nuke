-- Fix Circular Dependency Between vehicle_documents and timeline_events
-- Created: November 1, 2025
--
-- PROBLEM: vehicle_documents.timeline_event_id references timeline_events.id
--          BUT timeline_events.documentation_urls[] contains document URLs
--          This creates a chicken-and-egg problem where you can't insert either first
--
-- SOLUTION: Remove the circular foreign key and create a link table instead

-- Step 1 & 2: Remove circular FK columns if they still exist
DO $$
BEGIN
  IF to_regclass('public.vehicle_documents') IS NULL THEN
    RAISE NOTICE 'Skipping vehicle_documents cleanup: table not found.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_documents'
      AND column_name = 'timeline_event_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.vehicle_documents DROP COLUMN timeline_event_id CASCADE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_documents'
      AND column_name = 'timeline_event_created'
  ) THEN
    EXECUTE 'ALTER TABLE public.vehicle_documents DROP COLUMN timeline_event_created';
  END IF;
END
$$;

-- Step 3: Link table between timeline events and documents
CREATE TABLE IF NOT EXISTS public.timeline_event_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.timeline_events(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.vehicle_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, document_id)
);

-- Step 4: Indexes
CREATE INDEX IF NOT EXISTS idx_timeline_event_documents_event 
  ON public.timeline_event_documents(event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_documents_document 
  ON public.timeline_event_documents(document_id);

-- Step 5 & 6: RLS alignment with vehicle/timeline permissions
DO $$
BEGIN
  IF to_regclass('public.timeline_event_documents') IS NULL THEN
    RAISE NOTICE 'Skipping timeline_event_documents RLS setup: table not found.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.timeline_event_documents ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS "Users can view timeline_event_documents for vehicles they can view" ON public.timeline_event_documents';
  EXECUTE 'DROP POLICY IF EXISTS "Users can create timeline_event_documents for their vehicles" ON public.timeline_event_documents';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete timeline_event_documents for their vehicles" ON public.timeline_event_documents';

  EXECUTE '
    CREATE POLICY "Users can view timeline_event_documents for vehicles they can view" 
      ON public.timeline_event_documents FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.timeline_events te
          JOIN public.vehicles v ON te.vehicle_id = v.id
          WHERE te.id = timeline_event_documents.event_id
            AND (
              COALESCE(v.is_public, true) = true
              OR v.user_id = auth.uid()
              OR v.owner_id = auth.uid()
            )
        )
      )';

  EXECUTE '
    CREATE POLICY "Users can create timeline_event_documents for their vehicles" 
      ON public.timeline_event_documents FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.timeline_events te
          JOIN public.vehicles v ON te.vehicle_id = v.id
          WHERE te.id = timeline_event_documents.event_id
            AND (
              v.user_id = auth.uid()
              OR v.owner_id = auth.uid()
            )
        )
      )';

  EXECUTE '
    CREATE POLICY "Users can delete timeline_event_documents for their vehicles" 
      ON public.timeline_event_documents FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.timeline_events te
          JOIN public.vehicles v ON te.vehicle_id = v.id
          WHERE te.id = timeline_event_documents.event_id
            AND (
              v.user_id = auth.uid()
              OR v.owner_id = auth.uid()
            )
        )
      )';
END
$$;

-- Step 8: Helper to fetch documents for an event
CREATE OR REPLACE FUNCTION public.get_event_documents(p_event_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_type TEXT,
  file_url TEXT,
  vendor_name TEXT,
  amount NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vd.id,
    vd.document_type,
    vd.file_url,
    vd.vendor_name,
    vd.amount
  FROM public.vehicle_documents vd
  JOIN public.timeline_event_documents ted ON vd.id = ted.document_id
  WHERE ted.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Step 9: Helper to fetch events for a document
CREATE OR REPLACE FUNCTION public.get_document_events(p_document_id UUID)
RETURNS TABLE (
  event_id UUID,
  event_type TEXT,
  event_date DATE,
  title TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    te.id,
    te.event_type,
    te.event_date,
    te.title
  FROM public.timeline_events te
  JOIN public.timeline_event_documents ted ON te.id = ted.event_id
  WHERE ted.document_id = p_document_id;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Success! Circular dependency is now broken.
-- New flow:
-- 1. Insert into vehicle_documents → get document_id
-- 2. Insert into timeline_events → get event_id  
-- 3. Insert into timeline_event_documents (event_id, document_id) → link them

