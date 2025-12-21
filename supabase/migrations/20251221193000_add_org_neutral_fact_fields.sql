-- Add neutral-fact fields to organizations (businesses)
-- Goal: store human-readable, provenance-friendly facts about orgs similar to vehicle profiles.
-- These are intentionally TEXT to keep them flexible and avoid premature taxonomy lock-in.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS inventory_numbers TEXT,
  ADD COLUMN IF NOT EXISTS market_share TEXT,
  ADD COLUMN IF NOT EXISTS branding TEXT,
  ADD COLUMN IF NOT EXISTS labeling TEXT;

COMMENT ON COLUMN public.businesses.inventory_numbers IS 'Human-readable inventory numbers/scale notes (neutral facts). Example: "120 vehicles listed; 18 in-house; 6 lifts".';
COMMENT ON COLUMN public.businesses.market_share IS 'Human-readable market share notes (neutral facts). Example: "8% of AZ restoration shops (as-of 2025-06, source: ...)"';
COMMENT ON COLUMN public.businesses.branding IS 'Human-readable branding notes (neutral facts). Example: correct name, tagline, brand identifiers, domain.';
COMMENT ON COLUMN public.businesses.labeling IS 'Human-readable labeling/classification notes (neutral facts). Example: "auction_house; marketplace; service-first"';


