-- Cars & Bids rows that are other lots' photos: let supersede_junk_listing_images supersede them too.
--
-- Cause. Earlier extract-cars-and-bids-core runs stored every media URL on a lot page. Besides the lot's gallery, a page
-- carries the ending-soon, similar-auctions and new-listings rails: links to other auctions, each with a 768 or 356x260
-- card and 148x126 thumbnails. #1889 (20261018210000) supersedes the 148x126 thumbnails as page furniture and never
-- nominates the cards as covers, but the cards stayed as live gallery rows of the wrong vehicle.
--
-- Which rows are the lot's own is decided by identity, not render width. A render is
-- media.carsandbids.com/cdn-cgi/image/<options>/<hash>/photos/[<folder>/]<set>-<photo>...; one listing's gallery shares
-- the 8-character set id, other lots carry their own (the hash is shared across lots; seller-named files have no set id).
-- Width alone is wrong: measured 2026-10-18 on 300 Cars & Bids vehicles, 217 live 768 rows came from the auction index
-- with no page capture, one per vehicle and 125 of them the cover, and they are the lot's own card.
--
-- 1. cab_photo_key(url), cab_photo_set(url): the render-independent photo path and the set id. Immutable.
-- 2. is_other_lot_listing_image(url, gallery_urls): a Cars & Bids /photos/ render that is not a gallery render
--    (width 2080 or 542) and shares neither photo key nor set id with any of the capture's gallery photos. An empty or
--    NULL gallery answers false: without the lot's gallery nothing is judged another lot's. Immutable.
-- 3. supersede_junk_listing_images: also supersedes those rows. A capture is the lot page named in
--    exif_data.source_url, or, for rows written without it, the insert batch (vehicle and created_at): the rows one
--    page scan wrote share one created_at with that page's gallery rows, while an index card is a batch of its own
--    with no gallery. The tally gains other_lot_rows (other-lot rows not already counted as junk); superseded counts
--    both. A cover that is an other-lot row is repaired like a junk cover. Everything else is unchanged: nothing is
--    deleted, no image_url changes, at most 100 vehicles per call, dry run unless p_apply, a rerun is a no-op,
--    service_role only.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cab_photo_key(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT split_part(regexp_replace(p_url, '^.*/cdn-cgi/image/[^/]*/', ''), '?', 1)
$$;

CREATE OR REPLACE FUNCTION public.cab_photo_set(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT substring(p_url from '/photos/(?:[a-z]+/)?([A-Za-z0-9_-]{8})-')
$$;

CREATE OR REPLACE FUNCTION public.is_other_lot_listing_image(p_url text, p_gallery_urls text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    p_url ~* '^https?://media\.carsandbids\.com/cdn-cgi/image/[^/]*/[^/]+/photos/'
    AND p_url !~* '/cdn-cgi/image/width=(2080|542),'
    AND cardinality(p_gallery_urls) > 0
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_gallery_urls) g
       WHERE public.cab_photo_key(g) = public.cab_photo_key(p_url)
          OR public.cab_photo_set(g) = public.cab_photo_set(p_url)),
    false)
$$;

COMMENT ON FUNCTION public.cab_photo_key(text) IS
  'Cars & Bids photo path without the cdn render options or query: the same photo at any width.';
COMMENT ON FUNCTION public.cab_photo_set(text) IS
  'Cars & Bids photo-set id (8 characters before the photo id), shared by one listing''s gallery; NULL for seller-named files.';
COMMENT ON FUNCTION public.is_other_lot_listing_image(text, text[]) IS
  'A Cars & Bids photo render that shares neither photo nor set id with the gallery of the page it was captured from: '
  'a card for another lot. False without a gallery.';

CREATE OR REPLACE FUNCTION public.supersede_junk_listing_images(p_vehicle_ids uuid[], p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int := COALESCE(cardinality(p_vehicle_ids), 0);
  v_junk_rows int;
  v_other_ids uuid[];
  v_other_rows int;
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

  SELECT COALESCE(array_agg(c.id), '{}'), count(*) FILTER (WHERE NOT public.is_junk_listing_image_url(c.image_url))
    INTO v_other_ids, v_other_rows
    FROM (
      WITH cab AS (
        SELECT vi.id, vi.vehicle_id, vi.image_url,
               COALESCE(lower(substring(vi.exif_data->>'source_url' from 'carsandbids\.com/auctions/([A-Za-z0-9]+)')),
                        'batch:' || vi.created_at::text) AS capture
          FROM vehicle_images vi
         WHERE vi.vehicle_id = ANY(p_vehicle_ids) AND COALESCE(vi.is_superseded, false) = false
           AND vi.image_url ~* '^https?://media\.carsandbids\.com/cdn-cgi/image/'
      ), gallery AS (
        SELECT vehicle_id, capture, array_agg(image_url) AS urls
          FROM cab WHERE image_url ~* '/cdn-cgi/image/width=(2080|542),'
         GROUP BY vehicle_id, capture
      )
      SELECT cab.id, cab.image_url
        FROM cab JOIN gallery USING (vehicle_id, capture)
       WHERE public.is_other_lot_listing_image(cab.image_url, gallery.urls)
    ) c;

  v_prior := current_setting('app.skip_image_count_trigger', true);
  IF p_apply THEN
    PERFORM set_config('app.skip_image_count_trigger', '1', true);
    UPDATE vehicle_images
       SET is_superseded = true, superseded_at = COALESCE(superseded_at, now()), is_primary = false
     WHERE vehicle_id = ANY(p_vehicle_ids) AND COALESCE(is_superseded, false) = false
       AND (public.is_junk_listing_image_url(image_url) OR id = ANY(v_other_ids));
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
           AND NOT (vi.id = ANY(v_other_ids))
           AND NOT (vi.image_url ~* '^https?://media\.carsandbids\.com/cdn-cgi/image/'
                    AND vi.image_url !~* '/cdn-cgi/image/width=2080[,/]')
         ORDER BY (vi.image_url ~* '/cdn-cgi/image/width=2080[,/]') DESC, COALESCE(vi.is_primary, false) DESC,
                  vi.position ASC NULLS LAST, vi.created_at ASC, vi.id
         LIMIT 1
      ) c ON true
     WHERE v.id = ANY(p_vehicle_ids)
       AND (public.is_junk_listing_image_url(v.primary_image_url)
            OR EXISTS (SELECT 1 FROM vehicle_images o
                        WHERE o.id = ANY(v_other_ids) AND o.vehicle_id = v.id AND o.image_url = v.primary_image_url))
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
    FROM vehicles v
   WHERE v.id = ANY(p_vehicle_ids)
     AND (public.is_junk_listing_image_url(v.primary_image_url)
          OR EXISTS (SELECT 1 FROM vehicle_images o
                      WHERE o.id = ANY(v_other_ids) AND o.vehicle_id = v.id AND o.image_url = v.primary_image_url));

  RETURN jsonb_build_object('apply', p_apply, 'vehicles', v_n,
    'tally', jsonb_build_object('junk_rows', v_junk_rows, 'other_lot_rows', v_other_rows, 'superseded', v_superseded,
                                'junk_primary', v_junk_primary, 'nominated', v_nominated,
                                'no_usable_image', cardinality(v_no_image), 'junk_primary_after', v_still_junk),
    'no_usable_image', to_jsonb(v_no_image), 'repaired', v_vehicles);
END $function$;

REVOKE ALL ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) TO service_role;

COMMENT ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean) IS
  'Supersede listing page furniture (is_junk_listing_image_url) and Cars & Bids cards for other lots '
  '(is_other_lot_listing_image against the gallery of the same capture) on up to 100 vehicles and, where the cover is '
  'either, nominate the best remaining photo and recompute the cover. Dry run unless p_apply; a vehicle with no usable '
  'photo keeps its cover and is listed. Fed by scripts/photos/supersede-junk-listing-images.mjs.';

COMMIT;
