-- end_live_auctions_absent(): a lot that left the live page is no longer live.
-- Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY (lead's check of the live board against BaT's live page, 19:38Z): sync-live-auctions upserts
-- the lots present on the page and never touches the ones that left it, so a withdrawn or ended lot
-- keeps sale_status='auction_live' with a future end date until settlement happens to touch it
-- (1960-porsche-356b-coupe-9, 1948-packard-custom-eight-2, 1955-triumph-tr2-13 on that day; 1,264 BaT
-- rows read auction_live at 19:53Z). Both live sources the sync reads (BaT's /auctions/ page, Collecting
-- Cars' Typesense feed) return the complete live set, so absence is a fact, not a gap.
--
-- WHAT IT DOES: for one platform, every live row whose listing_url is not in the list becomes
-- sale_status='ended', auction_status='ended' — no sale claim (sale_price untouched, the bid stays in
-- high_bid), so lock 1 is not involved; the settlement path (bat-closed-lots-sync → drain → reader)
-- records the real result later. A short list never ends anything (< 50 URLs: a partial or failed
-- fetch). Returns the number of rows ended. Only rows the sync itself wrote (platform_source = the
-- platform it passes) are considered.
--
-- SCHEMA_LAW: §4 a status projection moves on evidence (absence from the source's own live list);
-- nothing deleted, nothing priced; §7 CI-applied; EXECUTE for service_role (the sync runs as it).

CREATE OR REPLACE FUNCTION public.end_live_auctions_absent(p_platform text, p_live_urls text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_platform IS NULL OR coalesce(array_length(p_live_urls, 1), 0) < 50 THEN
    RETURN 0;   -- a partial list is not evidence that anything ended
  END IF;

  WITH live AS (
    SELECT DISTINCT rtrim(u, '/') AS u FROM unnest(p_live_urls) AS u
  ), gone AS (
    UPDATE vehicles v
       SET sale_status = 'ended',
           auction_status = 'ended',
           updated_at = now()
     WHERE v.sale_status = 'auction_live'
       AND v.deleted_at IS NULL
       AND v.platform_source = p_platform
       AND NOT EXISTS (SELECT 1 FROM live WHERE live.u = rtrim(coalesce(v.listing_url, ''), '/'))
    RETURNING v.id
  )
  SELECT count(*) INTO v_n FROM gone;

  RETURN v_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.end_live_auctions_absent(text, text[]) TO service_role;

COMMENT ON FUNCTION public.end_live_auctions_absent(text, text[]) IS
  'sync-live-auctions, after a platform''s complete live list: every auction_live row of that platform_source whose listing_url is absent from the list becomes sale_status/auction_status ''ended'' (no sale claim; settlement records the result). Lists under 50 URLs end nothing. 2026-09-27.';

-- Live verification (after the sync runs once):
--   select count(*) from vehicles where sale_status = 'auction_live' and platform_source = 'bringatrailer'
--     and auction_end_date::timestamptz < now();   -- must trend to 0
