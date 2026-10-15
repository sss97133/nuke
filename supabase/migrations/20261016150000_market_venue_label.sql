-- One name per auction house, read from a vehicle's own source fields: market_venue_label(auction_source,
-- canonical_platform).
--
-- MEASURED 2026-10-15 13:3xZ (read-only, prod). mv_treemap_outcomes (20261014063000) names a sale's house with a CASE
-- over lower(auction_source) that matches spelled-out names ('cars & bids', 'rm sotheby''s', 'sbx cars') and has no
-- Barrett-Jackson branch. vehicles.auction_source mostly holds slugs (cars_and_bids, barrett-jackson, rm-sothebys,
-- sbx-cars, broad_arrow), and some rows carry the house only in canonical_platform. 37,688 of 286,610 confirmed sales
-- with an amount have no house (source_name null). A sample of 1,500 of them: cars_and_bids 955, barrett-jackson 238
-- (+77 with only canonical_platform barrett-jackson), rm-sothebys 125, neither field set 84, other venues 21. So Cars &
-- Bids, Barrett-Jackson and RM Sotheby's count zero on the map, and mv_family_sales (the family sales chart, which
-- already has 'Barrett-Jackson' and 'Cars & Bids' venues) holds no row for any of them.
--
-- CHANGE: an IMMUTABLE SQL function (no SET clause, so it inlines into a fold) that strips a source string to [a-z0-9]
-- and maps it to the labels the map and FamilySalesChart already use, adding 'Barrett-Jackson'. The two-argument form
-- reads auction_source first and canonical_platform second. Every spelling the map's CASE matches today maps to the
-- same label, so no sale changes house; sales with no house gain one. Nothing reads it yet: the map's fold adopts it
-- when its chain is rebuilt (mv_treemap_outcomes and its six dependent views). Additive and reversible (DROP FUNCTION).
-- Contract: supabase/sql/test_market_venue_label.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_venue_label(p_source text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE regexp_replace(lower(p_source), '[^a-z0-9]', '', 'g')
    WHEN 'bat' THEN 'Bring a Trailer'
    WHEN 'bringatrailer' THEN 'Bring a Trailer'
    WHEN 'gooding' THEN 'Gooding & Co'
    WHEN 'goodingco' THEN 'Gooding & Co'
    WHEN 'goodingcompany' THEN 'Gooding & Co'
    WHEN 'goodingandcompany' THEN 'Gooding & Co'
    WHEN 'rmsothebys' THEN 'RM Sotheby''s'
    WHEN 'carsandbids' THEN 'Cars & Bids'
    WHEN 'carsbids' THEN 'Cars & Bids'
    WHEN 'mecum' THEN 'Mecum'
    WHEN 'mecumauctions' THEN 'Mecum'
    WHEN 'barrettjackson' THEN 'Barrett-Jackson'
    WHEN 'bonhams' THEN 'Bonhams'
    WHEN 'broadarrow' THEN 'Broad Arrow'
    WHEN 'broadarrowauctions' THEN 'Broad Arrow'
    WHEN 'collectingcars' THEN 'Collecting Cars'
    WHEN 'sbxcars' THEN 'SBX Cars'
    WHEN 'pcarmarket' THEN 'PCarMarket'
    WHEN 'classiccom' THEN 'Classic.com'
  END
$function$;

CREATE OR REPLACE FUNCTION public.market_venue_label(p_auction_source text, p_canonical_platform text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(public.market_venue_label(p_auction_source), public.market_venue_label(p_canonical_platform))
$function$;

COMMENT ON FUNCTION public.market_venue_label(text) IS
  'Auction house label for one source string (any spelling: slug, snake, spaced). Null when it names no house the market map lists.';
COMMENT ON FUNCTION public.market_venue_label(text, text) IS
  'Auction house label for a vehicle: auction_source first, then canonical_platform. Null when neither names a house.';

COMMIT;
