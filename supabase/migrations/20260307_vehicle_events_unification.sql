-- ============================================================================
-- vehicle_events unification migration
-- Executed LIVE on 2026-03-07 against production database
-- This file is committed for version control record only
-- ============================================================================
-- Unified bat_listings + external_listings into a single vehicle_events table
-- 170,209 deduplicated records from 297K originals (42.8% were duplicates)
-- Original tables preserved but deprecated
-- ============================================================================

-- Table
CREATE TABLE IF NOT EXISTS public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  source_organization_id uuid REFERENCES public.organizations(id),
  source_platform text NOT NULL,
  source_url text,
  source_listing_id text,
  event_type text NOT NULL DEFAULT 'auction',
  event_status text NOT NULL DEFAULT 'active',
  started_at timestamptz,
  ended_at timestamptz,
  sold_at timestamptz,
  starting_price numeric,
  current_price numeric,
  final_price numeric,
  reserve_price numeric,
  buy_now_price numeric,
  bid_count integer,
  comment_count integer,
  view_count integer,
  watcher_count integer,
  seller_identifier text,
  buyer_identifier text,
  seller_external_identity_id uuid,
  buyer_external_identity_id uuid,
  metadata jsonb,
  extracted_at timestamptz,
  extraction_method text,
  extraction_source text,
  extractor_version text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_events_pkey ON public.vehicle_events USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_events_dedup ON public.vehicle_events USING btree (vehicle_id, source_platform, source_listing_id) WHERE (source_listing_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_events_dedup_url ON public.vehicle_events USING btree (vehicle_id, source_platform, source_url) WHERE (source_url IS NOT NULL AND source_listing_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle ON public.vehicle_events USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_platform ON public.vehicle_events USING btree (source_platform);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_status ON public.vehicle_events USING btree (event_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_type ON public.vehicle_events USING btree (event_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_ended ON public.vehicle_events USING btree (ended_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_source_org ON public.vehicle_events USING btree (source_organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_source_url ON public.vehicle_events USING btree (source_url);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_final_price ON public.vehicle_events USING btree (final_price DESC NULLS LAST) WHERE (final_price IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_created ON public.vehicle_events USING btree (created_at DESC);

-- RLS
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicle_events_public_read ON public.vehicle_events
  FOR SELECT USING (true);

CREATE POLICY vehicle_events_service_write ON public.vehicle_events
  FOR ALL USING (true) WITH CHECK (true);

-- Helper view: most recent event per vehicle (joined with vehicle YMM)
CREATE OR REPLACE VIEW public.vehicle_latest_event AS
SELECT DISTINCT ON (ve.vehicle_id)
  ve.id,
  ve.vehicle_id,
  ve.source_organization_id,
  ve.source_platform,
  ve.source_url,
  ve.source_listing_id,
  ve.event_type,
  ve.event_status,
  ve.started_at,
  ve.ended_at,
  ve.sold_at,
  ve.starting_price,
  ve.current_price,
  ve.final_price,
  ve.reserve_price,
  ve.buy_now_price,
  ve.bid_count,
  ve.comment_count,
  ve.view_count,
  ve.watcher_count,
  ve.seller_identifier,
  ve.buyer_identifier,
  ve.seller_external_identity_id,
  ve.buyer_external_identity_id,
  ve.metadata,
  ve.extracted_at,
  ve.extraction_method,
  ve.extraction_source,
  ve.extractor_version,
  ve.created_at,
  ve.updated_at,
  v.year,
  v.make,
  v.model
FROM vehicle_events ve
JOIN vehicles v ON v.id = ve.vehicle_id
ORDER BY ve.vehicle_id, COALESCE(ve.ended_at, ve.sold_at, ve.started_at, ve.created_at) DESC;

-- Helper view: aggregate stats per vehicle
CREATE OR REPLACE VIEW public.vehicle_event_summary AS
SELECT
  vehicle_id,
  count(*) AS total_events,
  count(CASE WHEN event_status = 'sold' THEN 1 END) AS times_sold,
  count(DISTINCT source_platform) AS platforms_seen,
  array_agg(DISTINCT source_platform ORDER BY source_platform) AS platform_list,
  min(started_at) AS first_event_date,
  max(COALESCE(ended_at, sold_at, started_at)) AS last_event_date,
  max(final_price) AS highest_sale_price,
  min(final_price) FILTER (WHERE final_price > 0) AS lowest_sale_price,
  round(avg(final_price) FILTER (WHERE final_price IS NOT NULL), 2) AS avg_sale_price,
  sum(bid_count) AS total_bids,
  sum(comment_count) AS total_comments,
  sum(view_count) AS total_views
FROM vehicle_events
GROUP BY vehicle_id;
