-- Class 3 ingest gate (FLAG-ONLY). Stops the sale_date-pollution class from growing.
--
-- The 2026-01/02 auction ingest defaulted sale_date to the ingest day (now()) over
-- sales that really happened years earlier — 17,948 Barrett-Jackson rows, plus BaT /
-- pcarmarket / cars-and-bids. The correction chokepoint
-- (correct_vehicle_sale_provenance) healed the backlog; this trigger keeps it healed
-- by FLAGGING new arrivals that show the same signature.
--
-- FLAG-ONLY, by design (Skylar's decision 2026-07-08): this trigger NEVER mutates or
-- rejects the incoming row. It only appends an advisory key to data_quality_flags so
-- the pollution is visible to QA and to the next correction pass. It does not touch
-- sale_date, canonical_platform, or any other column.
--
-- Signature detected: sale_date within 3 days of now() (an ingest-day stamp) AND the
-- source URL's FIRST path segment (the auction event slug) embeds an OLDER year than
-- the stamped sale_date. First-segment-only extraction is deliberate: it catches the
-- Barrett-Jackson event slug (barrett-jackson.com/scottsdale-2009/...) and the
-- 2020-fall-auction slug, while NOT firing on the vehicle's model year, which lives in
-- a later path segment (bringatrailer.com/listing/1966-ford-mustang, carsandbids.com/
-- auctions/<id>/2020-bmw). That keeps false positives near zero.
--
-- No conflict with trg_resolve_canonical_columns: that trigger resolves
-- canonical_platform / canonical_outcome / canonical_sold_price from source columns
-- and does not read or write sale_date or data_quality_flags. Both are BEFORE
-- INSERT/UPDATE; this one is order-independent because it reads only NEW.sale_date and
-- NEW.{listing_url,discovery_url,...} (which the resolve trigger leaves untouched) and
-- writes only NEW.data_quality_flags.

CREATE OR REPLACE FUNCTION public.flag_sale_date_ingest_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_url      text;
  v_slug     text;
  v_url_year int;
BEGIN
  -- only consider rows carrying a sale_date that looks like an ingest-day stamp
  IF NEW.sale_date IS NULL
     OR NEW.sale_date < (now()::date - 3)
     OR NEW.sale_date > (now()::date + 3) THEN
    RETURN NEW;
  END IF;

  v_url := COALESCE(NEW.listing_url, NEW.discovery_url, NEW.platform_url, NEW.bat_auction_url);
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- first path segment after the domain = the auction event slug
  v_slug := (regexp_match(v_url, '^https?://[^/]+/([^/?#]+)'))[1];
  IF v_slug IS NULL THEN
    RETURN NEW;
  END IF;

  v_url_year := (regexp_match(v_slug, '((?:19|20)\d\d)'))[1]::int;

  IF v_url_year IS NOT NULL
     AND v_url_year < extract(year FROM NEW.sale_date)::int THEN
    NEW.data_quality_flags := COALESCE(NEW.data_quality_flags, '{}'::jsonb)
      || jsonb_build_object(
           'sale_date_ingest_stamp_suspect',
           jsonb_build_object(
             'flagged_at',      now(),
             'stamped_sale_date', NEW.sale_date,
             'url_event_year',  v_url_year,
             'event_slug',      v_slug,
             'detector',        'flag_sale_date_ingest_stamp',
             'remedy',          'correct_vehicle_sale_provenance'));
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_flag_sale_date_ingest_stamp ON public.vehicles;
CREATE TRIGGER trg_flag_sale_date_ingest_stamp
  BEFORE INSERT OR UPDATE OF sale_date, listing_url, discovery_url ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_sale_date_ingest_stamp();

COMMENT ON FUNCTION public.flag_sale_date_ingest_stamp() IS
  'Class 3 ingest gate, FLAG-ONLY. Appends data_quality_flags.sale_date_ingest_stamp_suspect when an incoming sale_date is within 3 days of now() AND the source URL first-path-segment (auction event slug) embeds an older year. Never mutates/rejects the row. Does not touch sale_date or canonical_platform; no conflict with trg_resolve_canonical_columns. Remedy path: correct_vehicle_sale_provenance.';
