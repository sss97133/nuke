-- Listing photos that are page furniture, not the car: supersede them, and give each vehicle whose cover is one of
-- them a real photo of its own.
--
-- Cause. extract-cars-and-bids-core took the 148x126 sidebar thumbnails of other auctions as gallery photos and the
-- first of them as the cover; extract-bonhams did the same with web-assets, country flags, 230/650-wide "more lots"
-- cards and SVG icons. #1878 (766b67f9a, deployed 2026-10-18 01:39Z) filters them at extraction
-- (isCabThumbUrl, isBonhamsJunkImageUrl); the rows already written stayed.
--
-- Measured 2026-10-18 02:10Z over the 5,232 Cars & Bids, Bonhams and PCarMarket vehicles in mv_family_sales whose cover
-- was junk on 2026-10-17 22:40Z: 4,615 still have a junk primary_image_url, and their live vehicle_images rows hold
-- 59,208 junk rows. 4,470 of the 4,615 hold a usable photo of their own (all 2,560 Cars & Bids ones hold the
-- width=2080 hero); 145 Bonhams vehicles hold none.
--
-- 1. is_junk_listing_image_url(url): isCabThumbUrl and isBonhamsJunkImageUrl as #1878 wrote them, plus the Cars & Bids
--    sell-page-decoration asset. Immutable.
-- 2. supersede_junk_listing_images(p_vehicle_ids, p_apply): the writer, at most 100 vehicles per call, dry run unless
--    p_apply. Every live junk row of those vehicles is superseded (is_superseded, superseded_at, is_primary false);
--    nothing is deleted and no image_url changes. For each vehicle whose primary_image_url is junk it nominates the
--    best remaining row as is_primary and lets recompute_vehicle_primary_image() set the cover, so the cover rule
--    stays the one sanctioned picker. Nominee order: the Cars & Bids width=2080 hero, the row already primary, then
--    gallery position. Cars & Bids rows at other cdn widths (768, 542, 356x260, 180) are not nominated: 768 and
--    356x260 are cards for other auctions on the same page. A vehicle with no usable row keeps its cover and is
--    reported in no_usable_image. app.skip_image_count_trigger is set while it writes (transaction-local, restored
--    after), so trg_sync_vehicle_primary_image does not recompute once per superseded row, which made the 2026-10-17
--    run time out; the writer calls the recompute itself, once per repaired vehicle. The image-count and has-photos
--    triggers that also read the setting fire on vehicle_id and is_duplicate, which it does not change.
--    A rerun is a no-op. service_role only.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_junk_listing_image_url(p_url text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT p_url ~* '/cdn-cgi/image/[^/]*(width=(80|148|160|320)[,/]|height=126[,/])'
      OR p_url ~* 'web-assets|/flags/|width%3D230|width%3D650|[?&]w=(16|24|32|48|64)\y|\.svg([?#]|$)'
      OR p_url ~* 'sell-page-decoration'
$$;

COMMENT ON FUNCTION public.is_junk_listing_image_url(text) IS
  'Listing page furniture, not a photo of the car: Cars & Bids sidebar thumbnails (isCabThumbUrl) and Bonhams '
  'web-assets, flags, 230/650-wide cards and SVGs (isBonhamsJunkImageUrl), as #1878 filters them at extraction.';

CREATE OR REPLACE FUNCTION public.supersede_junk_listing_images(p_vehicle_ids uuid[], p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int := COALESCE(cardinality(p_vehicle_ids), 0);
  v_junk_rows int;
  v_superseded int := 0;
  v_junk_primary int := 0;
  v_nominated int := 0;
  v_no_image uuid[] := '{}';
  v_prior text;
  v_res jsonb;
  v_vehicles jsonb := '[]';
  v_still_junk int;
  r record;
BEGIN
  IF v_n = 0 THEN RAISE EXCEPTION 'p_vehicle_ids is empty'; END IF;
  IF v_n > 100 THEN RAISE EXCEPTION 'at most 100 vehicles per call (got %)', v_n; END IF;

  SELECT count(*) INTO v_junk_rows
    FROM vehicle_images
   WHERE vehicle_id = ANY(p_vehicle_ids) AND COALESCE(is_superseded, false) = false
     AND public.is_junk_listing_image_url(image_url);

  v_prior := current_setting('app.skip_image_count_trigger', true);
  IF p_apply THEN
    PERFORM set_config('app.skip_image_count_trigger', '1', true);
    UPDATE vehicle_images
       SET is_superseded = true, superseded_at = COALESCE(superseded_at, now()), is_primary = false
     WHERE vehicle_id = ANY(p_vehicle_ids) AND COALESCE(is_superseded, false) = false
       AND public.is_junk_listing_image_url(image_url);
    GET DIAGNOSTICS v_superseded = ROW_COUNT;
  END IF;

  FOR r IN
    SELECT v.id AS vehicle_id, c.id AS image_id
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT vi.id
          FROM vehicle_images vi
         WHERE vi.vehicle_id = v.id
           AND COALESCE(vi.is_superseded, false) = false AND COALESCE(vi.is_duplicate, false) = false
           AND COALESCE(vi.is_sensitive, false) = false
           AND COALESCE(vi.vision_gate_status::text, 'approved') NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed')
           AND COALESCE(vi.image_vehicle_match_status, 'pending') NOT IN ('mismatch', 'unrelated')
           AND vi.image_url IS NOT NULL AND vi.image_url <> ''
           AND NOT public.is_junk_listing_image_url(vi.image_url)
           AND NOT (vi.image_url ~* '^https?://media\.carsandbids\.com/cdn-cgi/image/'
                    AND vi.image_url !~* '/cdn-cgi/image/width=2080[,/]')
         ORDER BY (vi.image_url ~* '/cdn-cgi/image/width=2080[,/]') DESC, COALESCE(vi.is_primary, false) DESC,
                  vi.position ASC NULLS LAST, vi.created_at ASC, vi.id
         LIMIT 1
      ) c ON true
     WHERE v.id = ANY(p_vehicle_ids) AND public.is_junk_listing_image_url(v.primary_image_url)
     ORDER BY v.id
  LOOP
    v_junk_primary := v_junk_primary + 1;
    IF r.image_id IS NULL THEN
      v_no_image := v_no_image || r.vehicle_id;
      CONTINUE;
    END IF;
    v_nominated := v_nominated + 1;
    IF p_apply THEN
      UPDATE vehicle_images SET is_primary = true WHERE id = r.image_id AND COALESCE(is_primary, false) = false;
      v_res := public.recompute_vehicle_primary_image(r.vehicle_id);
      v_vehicles := v_vehicles || jsonb_build_object('vehicle_id', r.vehicle_id, 'nominee', r.image_id,
        'tier', v_res->>'tier', 'chosen_image_id', v_res->>'chosen_image_id');
    END IF;
  END LOOP;
  PERFORM set_config('app.skip_image_count_trigger', COALESCE(v_prior, ''), true);

  SELECT count(*) INTO v_still_junk
    FROM vehicles WHERE id = ANY(p_vehicle_ids) AND public.is_junk_listing_image_url(primary_image_url);

  RETURN jsonb_build_object('apply', p_apply, 'vehicles', v_n,
    'tally', jsonb_build_object('junk_rows', v_junk_rows, 'superseded', v_superseded, 'junk_primary', v_junk_primary,
                                'nominated', v_nominated, 'no_usable_image', cardinality(v_no_image),
                                'junk_primary_after', v_still_junk),
    'no_usable_image', to_jsonb(v_no_image), 'repaired', v_vehicles);
END $function$;

REVOKE ALL ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) TO service_role;

COMMENT ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) IS
  'Supersede listing page furniture (is_junk_listing_image_url) on up to 100 vehicles and, where the cover is junk, '
  'nominate the best remaining photo and recompute the cover. Dry run unless p_apply; a vehicle with no usable photo '
  'keeps its cover and is listed. Fed by scripts/photos/supersede-junk-listing-images.mjs.';

COMMIT;
