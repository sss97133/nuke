-- upsert_live_auction_vehicles: a placeholder row's naive make/model split is rewritten by its own writer.
-- Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY (lead's check, 20:04Z): 51 auction_live rows still read make 'Aston' / 'Alfa' / 'Land' / 'Rolls' …
-- with the rest of the make at the head of model — sync-live-auctions' old title split. 913e8a50c gives
-- the sync the reader's URL-slug parser, but this RPC only sets make/model on INSERT; its DO UPDATE
-- never rewrites them, so those rows keep the split until settlement replaces the row's identity.
--
-- THE PATH: these rows are the sync's own machine-written placeholders (platform_source = the sync's
-- platform; no testimony behind make/model but the title the sync itself read), so the writer that made
-- them corrects them, on its next 15-minute run, through the same RPC — no raw UPDATE, and the vehicles
-- trigger chain (trg_sanitize_make, trg_auto_normalize_model, canonical taxonomy) re-runs on the row.
--
-- THE RULE: rewrite make/model on conflict only when the stored make is EXACTLY a naive-split token —
-- the first word of a multi-word make in the parser's table (batParser.multiWordMakes: Alfa, Mercedes,
-- Land, Aston, Rolls, Austin, De, AM, El, AC) — and the incoming make differs. A row whose make is a
-- real make is never touched; a row that ended (absent from the live list) is not in the payload and is
-- not touched here. Everything else in the function is byte-identical to prod's live body (read 20:06Z).
--
-- SCHEMA_LAW §4: a projection corrected by its writer from the same source; nothing deleted. §7 CI.

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
    -- a naive title split ('Aston' / 'Martin V12 …') stored by the old sync is replaced by the parsed
    -- identity the payload now carries; a real make is never rewritten (2026-09-27)
    make = CASE WHEN v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC')
                 AND excluded.make IS NOT NULL AND excluded.make <> v.make THEN excluded.make ELSE v.make END,
    model = CASE WHEN v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC')
                  AND excluded.make IS NOT NULL AND excluded.make <> v.make THEN excluded.model ELSE v.model END,
    origin_metadata = excluded.origin_metadata,
    updated_at = excluded.updated_at
  -- touch a row only when something a reader sees changed: every write runs the vehicles trigger chain
  WHERE v.sale_status IS DISTINCT FROM excluded.sale_status
     OR v.auction_status IS DISTINCT FROM excluded.auction_status
     OR v.auction_end_date IS DISTINCT FROM excluded.auction_end_date
     OR v.high_bid IS DISTINCT FROM excluded.high_bid
     OR (v.sale_status = 'auction_live' AND v.sale_price IS NOT NULL)
     OR (v.primary_image_url IS NULL AND excluded.primary_image_url IS NOT NULL)
     OR (v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC')
         AND excluded.make IS NOT NULL AND excluded.make <> v.make);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

-- Live verification (after the next sync run):
--   select make, count(*) from vehicles where sale_status = 'auction_live' and platform_source = 'bringatrailer'
--     and make in ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC') group by 1;  -- → 0 rows
