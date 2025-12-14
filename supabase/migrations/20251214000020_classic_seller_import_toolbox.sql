-- Classic.com Seller Import Toolbox
-- Goal:
-- 1) Discover ALL Classic.com sellers (dealers + auction houses) into a queue
-- 2) Index them into `businesses` via Edge Function `index-classic-com-dealer`
-- 3) Track inventory discovery ("seen") so we can detect sold/removed items safely over time
--
-- Notes:
-- - Uses CREATE TABLE IF NOT EXISTS to keep `supabase db reset` safe.
-- - RLS is enabled with public read (consistent with other marketplace data tables).

-- ============================================================================
-- 1) Classic seller discovery / indexing queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.classic_seller_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_url TEXT NOT NULL UNIQUE,
  seller_name TEXT,
  seller_type TEXT CHECK (seller_type IN ('dealer', 'auction_house')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  organization_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classic_seller_queue_status ON public.classic_seller_queue(status, discovered_at);
CREATE INDEX IF NOT EXISTS idx_classic_seller_queue_org ON public.classic_seller_queue(organization_id);

ALTER TABLE public.classic_seller_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view classic seller queue" ON public.classic_seller_queue;
CREATE POLICY "Public can view classic seller queue" ON public.classic_seller_queue
  FOR SELECT USING (true);

-- ============================================================================
-- 2) Inventory sync queue (separate from Classic indexing; enables retries/backoff)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_inventory_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_mode TEXT NOT NULL DEFAULT 'both' CHECK (run_mode IN ('current', 'sold', 'both')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, run_mode)
);

CREATE INDEX IF NOT EXISTS idx_org_inv_sync_status ON public.organization_inventory_sync_queue(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS idx_org_inv_sync_org ON public.organization_inventory_sync_queue(organization_id);

ALTER TABLE public.organization_inventory_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view inventory sync queue" ON public.organization_inventory_sync_queue;
CREATE POLICY "Public can view inventory sync queue" ON public.organization_inventory_sync_queue
  FOR SELECT USING (true);

-- ============================================================================
-- 3) Dealer inventory "seen" tracker (supports disappearance detection + auditing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dealer_inventory_seen (
  dealer_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  listing_url TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_status TEXT NOT NULL DEFAULT 'in_stock' CHECK (last_seen_status IN ('in_stock', 'sold', 'unknown')),
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_seen_source_url TEXT,
  PRIMARY KEY (dealer_id, listing_url)
);

CREATE INDEX IF NOT EXISTS idx_dealer_inventory_seen_dealer ON public.dealer_inventory_seen(dealer_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_dealer_inventory_seen_url ON public.dealer_inventory_seen(listing_url);

ALTER TABLE public.dealer_inventory_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view dealer inventory seen" ON public.dealer_inventory_seen;
CREATE POLICY "Public can view dealer inventory seen" ON public.dealer_inventory_seen
  FOR SELECT USING (true);


