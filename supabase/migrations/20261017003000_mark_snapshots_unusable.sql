-- mark_snapshots_unusable: flag retained captures that are not the page they were fetched for.
--
-- Cars & Bids answers a removed auction with its not-found shell and HTTP 200, and the old extractor saved ~60 of those as
-- success = true. A cache that treats every successful snapshot as a valid capture would read a shell as the lot. This is the
-- narrow writer for that correction: it sets success = false and records the reason, never touches the html (the capture is
-- kept), and refuses any snapshot that contains the marker a real page carries (p_must_lack), so a good capture cannot be flagged.
-- Bounded (200 ids, caller statement_timeout 1 ms to 60 s), service_role only, idempotent.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mark_snapshots_unusable(p_ids uuid[], p_reason text, p_must_lack text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_marked int; v_kept int;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'mark_snapshots_unusable: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN RAISE EXCEPTION 'mark_snapshots_unusable: 1 to 200 ids'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN RAISE EXCEPTION 'mark_snapshots_unusable: a reason of at least 10 characters is required'; END IF;
  IF p_must_lack IS NULL OR length(btrim(p_must_lack)) < 3 THEN RAISE EXCEPTION 'mark_snapshots_unusable: p_must_lack (the marker a real page carries) is required'; END IF;

  UPDATE public.listing_page_snapshots s
     SET success = false,
         error_message = left(p_reason, 300),
         metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('unusable', jsonb_build_object('reason', p_reason, 'must_lack', p_must_lack, 'at', now(), 'was_success', s.success))
   WHERE s.id = ANY (p_ids) AND s.success IS TRUE AND coalesce(s.html, '') NOT LIKE '%' || p_must_lack || '%';
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  SELECT count(*) INTO v_kept FROM public.listing_page_snapshots WHERE id = ANY (p_ids) AND success IS TRUE;
  RETURN jsonb_build_object('marked', v_marked, 'left_successful', v_kept);
END $$;

REVOKE ALL ON FUNCTION public.mark_snapshots_unusable(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_snapshots_unusable(uuid[], text, text) TO service_role;
COMMENT ON FUNCTION public.mark_snapshots_unusable(uuid[], text, text) IS 'Sets listing_page_snapshots.success = false (reason in error_message and metadata.unusable, html kept) for up to 200 captures that lack the marker a real page carries. A snapshot containing the marker is never flagged. service_role only.';

COMMIT;
