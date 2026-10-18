-- is_garbage_make: a title descriptor is not a make; upsert_live_auction_vehicles fills a placeholder's missing
-- or garbage make from its parsed identity. Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY: 8 auction_live BaT rows and 61 settled ones read make "Coyote-Powered" / "LS3-Powered" / "38-Years-Owned," /
-- "Modified" / "Pair" / "Euro" — the first word of a BaT title whose decoration precedes the year. Measured over
-- the 264,669 archived BaT titles, the tokens before the year are: 53,863 "…-Mile", 14,604 "…-Powered",
-- 9,453 "…-Owned", 5,845 "Modified", 3,550 "Original-Owner", 2,210 "Supercharged", 1,849 "Euro", 1,824 "One-Owner",
-- 1,228 "…-Kilometer", 524 "Turbocharged", 427 "Fuel-Injected", 273 "Restored", 255 "Custom", 248 "Japanese-Market",
-- 208 "JDM", 50 "…-Swapped". Barrett-Jackson's path wrote "Custom" as a make 202 times. None of these shapes is a
-- make: 0 of the 152 canonical_makes match them.
--
-- THE PATH: trg_sanitize_make already refuses a make that is not a make (digits, no letters, one char, a year)
-- into data_quality_flags.make_rejected and NULLs the column; is_garbage_make() is that one definition, used only
-- by sanitize_vehicle_make (no index, constraint or other function depends on it — checked 2026-09-27). The
-- descriptor shapes join it, so no writer on any platform can land one again; the rejected value stays in
-- data_quality_flags.make_rejected_value. Then the writer that made a placeholder fills the gap:
-- upsert_live_auction_vehicles rewrites make/model on conflict when the stored make is NULL, garbage or a naive
-- split token and the parsed identity carries a real make — the rule 20260927110000 introduced, widened by the
-- two new shapes; everything else in the function is byte-identical to that migration. Settled rows:
-- extract-bat-core replaces a missing or polluted identity on re-read from the page's own Make link
-- (makeIsPolluted, the same shapes); the re-read pass is the fix path for the 61.
-- Nothing is deleted. SCHEMA_LAW §1 searched: is_garbage_make, sanitize_vehicle_make, canonical_makes,
-- auto_correct_vehicle_cascading (corrects model only). §7 CI-applied.
SET statement_timeout = '30s';
SET lock_timeout = '10s';   -- CREATE OR REPLACE waits on nothing long; if a vehicles write holds the function, fail fast and rerun

CREATE OR REPLACE FUNCTION public.is_garbage_make(m text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN m IS NULL THEN false
    ELSE (
      btrim(m) ~ '^[0-9]'          -- starts with a digit: "12", "427", "2004", "02", "1161"
      OR btrim(m) !~ '[A-Za-z]'    -- no letters at all: "", ".", "-", "'83", "–1967"
      OR char_length(btrim(m)) = 1 -- single char: "C", "T", "V", "K"
      OR btrim(m) ~ '^(19|20)[0-9]{2}$' -- year-shaped (explicit; subset of the digit rule)
      -- BaT title decoration read as a make (2026-09-27): "Coyote-Powered", "38-Years-Owned,", "44k-Mile", "Modified", "Pair"
      OR lower(btrim(m)) ~ '-(powered|owned|mile|miles|kilometer|kilometers|swapped|built|driven|equipped)[,:]?$'
      OR lower(btrim(m)) ~ '^(modified|custom|supercharged|turbocharged|restored|backdated|lifted|euro|jdm|japanese-market|no-reserve|one-owner|original-owner|single-family-owned|fuel-injected|pair|set|lot|group)[,:]?$'
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_live_auction_vehicles(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  INSERT INTO vehicles AS v (
    listing_url, title, year, make, model, auction_status, sale_status, auction_end_date, high_bid,
    primary_image_url, platform_source, origin_metadata, is_public, updated_at
  )
  SELECT DISTINCT ON (r->>'listing_url')
    r->>'listing_url',
    r->>'title',
    nullif(r->>'year','')::int,
    r->>'make',
    r->>'model',
    coalesce(r->>'auction_status','active'),
    coalesce(r->>'sale_status','auction_live'),
    r->>'auction_end_date',
    nullif(r->>'sale_price','')::int,          -- the payload calls BaT's current bid 'sale_price'; it is a bid
    nullif(r->>'primary_image_url',''),
    r->>'platform_source',
    coalesce(r->'origin_metadata','{}'::jsonb),
    (nullif(r->>'year','') IS NOT NULL),       -- real cars have a year; signs/parts don't
    coalesce(nullif(r->>'updated_at','')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) r
  WHERE coalesce(r->>'listing_url','') <> ''
  ORDER BY r->>'listing_url', coalesce(nullif(r->>'updated_at','')::timestamptz, now()) DESC
  ON CONFLICT (listing_url) WHERE (deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '')
  DO UPDATE SET
    auction_status = excluded.auction_status,
    sale_status = excluded.sale_status,
    auction_end_date = excluded.auction_end_date,
    high_bid = excluded.high_bid,
    sale_price = CASE WHEN v.sale_status = 'auction_live' THEN NULL ELSE v.sale_price END,
    primary_image_url = coalesce(excluded.primary_image_url, v.primary_image_url),
    -- a missing make, a garbage make (is_garbage_make: digits, a year, a title descriptor such as
    -- 'Coyote-Powered') or a naive title split ('Aston' / 'Martin V12 …') stored by the old sync is replaced by
    -- the parsed identity the payload now carries when that is a real make; a real make is never rewritten
    -- (2026-09-27, extends 20260927110000)
    make = CASE WHEN (v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
                 AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make THEN excluded.make ELSE v.make END,
    model = CASE WHEN (v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
                  AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make THEN excluded.model ELSE v.model END,
    origin_metadata = excluded.origin_metadata,
    updated_at = excluded.updated_at
  -- touch a row only when something a reader sees changed: every write runs the vehicles trigger chain
  WHERE v.sale_status IS DISTINCT FROM excluded.sale_status
     OR v.auction_status IS DISTINCT FROM excluded.auction_status
     OR v.auction_end_date IS DISTINCT FROM excluded.auction_end_date
     OR v.high_bid IS DISTINCT FROM excluded.high_bid
     OR (v.sale_status = 'auction_live' AND v.sale_price IS NOT NULL)
     OR (v.primary_image_url IS NULL AND excluded.primary_image_url IS NOT NULL)
     OR ((v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
         AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

-- Live verification (after the next sync run, 15 min):
--   select is_garbage_make('Coyote-Powered'), is_garbage_make('38-Years-Owned,'), is_garbage_make('Pair'), is_garbage_make('Ford');  -- t t t f
--   select make, count(*) from vehicles where sale_status = 'auction_live' and platform_source = 'bringatrailer'
--     and (is_garbage_make(make) or make in ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC')) group by 1;  -- → 0 rows
--   (8 live rows read a descriptor make at 22:00Z on 2026-09-27; each is rewritten by its own writer or NULLed with
--    data_quality_flags.make_rejected — never left standing as a make)
