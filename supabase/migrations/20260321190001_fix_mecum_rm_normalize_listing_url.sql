-- Fix Mecum and RM Sotheby's URL normalization
-- Mecum: extract lot number only (not full slug) to prevent false-positive dupes
-- RM: include auction event code to prevent cross-event lot ID collisions

CREATE OR REPLACE FUNCTION normalize_listing_url(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  listing_id text;
  event_code text;
BEGIN
  IF url IS NULL OR url = '' THEN
    RETURN NULL;
  END IF;

  -- JamesEdition: extract numeric listing ID (7+ digits)
  IF url ILIKE '%jamesedition.com%' THEN
    listing_id := (regexp_match(url, '(\d{7,})'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'jamesedition:' || listing_id;
    END IF;
  END IF;

  -- RM Sotheby's: include auction event code
  -- Auction: /auctions/{event}/lots/{lot_slug}
  IF url ILIKE '%rmsothebys.com%/auctions/%/lots/%' THEN
    event_code := (regexp_match(url, '/auctions/([^/]+)/lots/'))[1];
    listing_id := (regexp_match(url, '/lots/(r\d+-[^/]+)'))[1];
    IF event_code IS NOT NULL AND listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || lower(event_code) || ':' || listing_id;
    END IF;
  END IF;

  -- RM private sales: /ps00/inventory/{lot_slug}
  IF url ILIKE '%rmsothebys.com%/ps%/inventory/%' THEN
    event_code := (regexp_match(url, '/(ps\d+)/inventory/'))[1];
    listing_id := (regexp_match(url, '/inventory/(r\d+-[^/]+)'))[1];
    IF event_code IS NOT NULL AND listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || lower(event_code) || ':' || listing_id;
    END IF;
  END IF;

  -- RM fallback: lot slug only
  IF url ILIKE '%rmsothebys.com%' THEN
    listing_id := (regexp_match(url, '/(r\d+-[^/]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || listing_id;
    END IF;
  END IF;

  -- BaT: extract listing slug
  IF url ILIKE '%bringatrailer.com/listing/%' THEN
    listing_id := (regexp_match(url, '/listing/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'bat:' || listing_id;
    END IF;
  END IF;

  -- Cars & Bids
  IF url ILIKE '%carsandbids.com/auctions/%' THEN
    listing_id := (regexp_match(url, '/auctions/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'carsandbids:' || listing_id;
    END IF;
  END IF;

  -- Barrett-Jackson: use path after domain
  IF url ILIKE '%barrett-jackson.com%' THEN
    listing_id := (regexp_match(url, 'barrett-jackson\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'barrett-jackson:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Mecum: extract lot number from /lots/{lot_id}/{slug}
  IF url ILIKE '%mecum.com/lots/%' THEN
    listing_id := (regexp_match(url, '/lots/(\d+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'mecum:' || listing_id;
    END IF;
  END IF;

  -- Mecum fallback: non-lot pages
  IF url ILIKE '%mecum.com%' THEN
    listing_id := (regexp_match(url, 'mecum\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'mecum:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Collecting Cars
  IF url ILIKE '%collectingcars.com%' THEN
    listing_id := (regexp_match(url, 'collectingcars\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'collectingcars:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Gooding
  IF url ILIKE '%goodingco.com%' THEN
    listing_id := (regexp_match(url, 'goodingco\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'gooding:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- eBay Motors
  IF url ILIKE '%ebay.com/itm/%' THEN
    listing_id := (regexp_match(url, '/itm/(\d+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'ebay:' || listing_id;
    END IF;
  END IF;

  -- Hagerty Marketplace
  IF url ILIKE '%hagerty.com/marketplace/%' THEN
    listing_id := (regexp_match(url, '/marketplace/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'hagerty:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Hemmings
  IF url ILIKE '%hemmings.com/classifieds/%' THEN
    listing_id := (regexp_match(url, '/classifieds/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'hemmings:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Bonhams
  IF url ILIKE '%bonhams.com%' THEN
    listing_id := (regexp_match(url, 'bonhams\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'bonhams:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Broad Arrow
  IF url ILIKE '%broadarrowauctions.com%' THEN
    listing_id := (regexp_match(url, 'broadarrowauctions\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'broadarrow:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Fallback: strip trailing slash, query params, appended titles
  RETURN regexp_replace(
    regexp_replace(
      regexp_replace(url, '\s*"[^"]*"?\s*$', ''),
      '\?.*$', ''),
    '/$', '');
END;
$$;

COMMENT ON FUNCTION normalize_listing_url IS 'Extracts canonical listing ID from URL for entity resolution. Returns platform:id format for known platforms. Fixed 2026-03-21: Mecum uses lot number only, RM includes auction event code.';
