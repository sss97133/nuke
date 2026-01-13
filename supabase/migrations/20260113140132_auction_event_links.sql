-- Auction event links (relist chains, cross-references)
-- Version: 20260113140132
-- Date: 2026-01-13
--
-- Purpose:
-- - Represent multi-auction chains for the same vehicle (BaT relists, etc.)
-- - Keep it queryable: explicit edges between auction_events rows

BEGIN;

CREATE TABLE IF NOT EXISTS public.auction_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  from_auction_event_id UUID NOT NULL REFERENCES public.auction_events(id) ON DELETE CASCADE,
  to_auction_event_id UUID NOT NULL REFERENCES public.auction_events(id) ON DELETE CASCADE,

  -- e.g. 'relist_of', 'previous_sale', 'same_vehicle_reference'
  link_type TEXT NOT NULL,

  -- evidence: {source:'bat', source_url:'...', raw_text:'...', confidence:0.95}
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (from_auction_event_id <> to_auction_event_id)
);

-- Idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_auction_event_links
  ON public.auction_event_links(from_auction_event_id, to_auction_event_id, link_type);

CREATE INDEX IF NOT EXISTS idx_auction_event_links_from
  ON public.auction_event_links(from_auction_event_id);

CREATE INDEX IF NOT EXISTS idx_auction_event_links_to
  ON public.auction_event_links(to_auction_event_id);

-- RLS
ALTER TABLE public.auction_event_links ENABLE ROW LEVEL SECURITY;

-- Public read (chains are public market data)
DROP POLICY IF EXISTS "Public read auction event links" ON public.auction_event_links;
CREATE POLICY "Public read auction event links"
  ON public.auction_event_links
  FOR SELECT
  USING (true);

-- Service role write
DROP POLICY IF EXISTS "Service role write auction event links" ON public.auction_event_links;
CREATE POLICY "Service role write auction event links"
  ON public.auction_event_links
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Explicit grants (RLS still applies)
GRANT SELECT ON public.auction_event_links TO anon, authenticated;

COMMIT;

