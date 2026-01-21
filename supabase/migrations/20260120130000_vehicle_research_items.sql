-- Vehicle Research Items
-- Stores undated research claims, questions, sources, and notes.

BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_research_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  item_type TEXT NOT NULL CHECK (item_type IN ('source', 'note', 'question', 'claim', 'event')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),

  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  source_type TEXT,
  event_date DATE,
  date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN ('day', 'month', 'year', 'unknown')),
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  tags TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_research_items_vehicle ON vehicle_research_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_research_items_status ON vehicle_research_items(status) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_research_items_source
  ON vehicle_research_items(vehicle_id, source_url)
  WHERE source_url IS NOT NULL;

ALTER TABLE vehicle_research_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_research_items'
      AND policyname = 'vehicle_research_items_read'
  ) THEN
    CREATE POLICY vehicle_research_items_read
      ON vehicle_research_items
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_research_items'
      AND policyname = 'vehicle_research_items_write_owner_or_contributor'
  ) THEN
    CREATE POLICY vehicle_research_items_write_owner_or_contributor
      ON vehicle_research_items
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.vehicles v
          WHERE v.id = vehicle_id
            AND (
              v.user_id = auth.uid()
              OR EXISTS (
                SELECT 1
                FROM public.vehicle_contributors vc
                WHERE vc.vehicle_id = vehicle_id
                  AND vc.user_id = auth.uid()
              )
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_research_items'
      AND policyname = 'vehicle_research_items_update_owner_or_contributor'
  ) THEN
    CREATE POLICY vehicle_research_items_update_owner_or_contributor
      ON vehicle_research_items
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1
          FROM public.vehicles v
          WHERE v.id = vehicle_id
            AND (
              v.user_id = auth.uid()
              OR EXISTS (
                SELECT 1
                FROM public.vehicle_contributors vc
                WHERE vc.vehicle_id = vehicle_id
                  AND vc.user_id = auth.uid()
              )
            )
        )
      );
  END IF;
END $$;

COMMIT;
