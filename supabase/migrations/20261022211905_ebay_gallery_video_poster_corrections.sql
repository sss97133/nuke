-- Supersede cited eBay video posters through the existing image correction writer.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.supersede_junk_listing_images(p_vehicle_ids uuid[], p_apply boolean DEFAULT false,
  p_archive_probes jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int := COALESCE(cardinality(p_vehicle_ids), 0);
  v_junk_rows int;
  v_other_ids uuid[];
  v_other_rows int;
  v_unsaved_ids uuid[];
  v_unsaved_rows int;
  v_unsaved_receipts jsonb;
  v_video_ids uuid[];
  v_video_receipts jsonb;
  v_excluded_ids uuid[];
  v_more int;
  v_superseded int := 0;
  v_junk_primary int := 0;
  v_nominated int := 0;
  v_cleared int := 0;
  v_no_image uuid[] := '{}';
  v_prior text;
  v_res jsonb;
  v_vehicles jsonb := '[]';
  v_still_junk int;
  r record;
BEGIN
  IF v_n = 0 THEN RAISE EXCEPTION 'p_vehicle_ids is empty'; END IF;
  IF v_n > 100 THEN RAISE EXCEPTION 'at most 100 vehicles per call (got %)', v_n; END IF;
  IF p_archive_probes IS NOT NULL AND jsonb_typeof(p_archive_probes) <> 'array' THEN
    RAISE EXCEPTION 'p_archive_probes must be a jsonb array of {image_id, answer, probed_at, method}';
  END IF;

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

  -- eBay archive captures whose cover the archive did not save (caller's probe), none of whose photos it was found to hold.
  WITH answers AS (
    SELECT vi.vehicle_id, public.ebay_archive_photo_capture(vi.image_url) AS capture, e->>'answer' AS answer, e AS receipt
      FROM jsonb_array_elements(COALESCE(p_archive_probes, '[]'::jsonb)) e
      JOIN vehicle_images vi ON vi.id = (e->>'image_id')::uuid
     WHERE vi.vehicle_id = ANY(p_vehicle_ids) AND public.ebay_archive_photo_capture(vi.image_url) IS NOT NULL
  ), unsaved AS (
    SELECT DISTINCT ON (vehicle_id, capture) vehicle_id, capture, receipt
      FROM answers a
     WHERE answer = 'not_archived'
       AND NOT EXISTS (SELECT 1 FROM answers h WHERE h.vehicle_id = a.vehicle_id AND h.capture = a.capture AND h.answer = 'held')
     ORDER BY vehicle_id, capture
  )
  SELECT COALESCE(array_agg(vi.id), '{}'), count(*), COALESCE(jsonb_object_agg(vi.id::text, u.receipt), '{}'::jsonb)
    INTO v_unsaved_ids, v_unsaved_rows, v_unsaved_receipts
    FROM unsaved u
    JOIN vehicle_images vi ON vi.vehicle_id = u.vehicle_id AND public.ebay_archive_photo_capture(vi.image_url) = u.capture
   WHERE COALESCE(vi.is_superseded, false) = false;

  -- Also accept cited poster findings from retained current-item galleries.
  IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_archive_probes, '[]'::jsonb)) e
       WHERE e->>'answer' = 'video_poster') > 100 THEN
    RAISE EXCEPTION 'at most 100 probe receipts per call';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT vi.id), '{}'), COALESCE(jsonb_object_agg(vi.id::text, e), '{}'::jsonb)
    INTO v_video_ids, v_video_receipts
    FROM jsonb_array_elements(COALESCE(p_archive_probes, '[]'::jsonb)) e
    JOIN vehicle_images vi ON vi.id = (e->>'image_id')::uuid
    JOIN listing_page_snapshots s ON s.id = (e->>'snapshot_id')::uuid
   WHERE e->>'answer' = 'video_poster' AND vi.vehicle_id = ANY(p_vehicle_ids)
     AND vi.source = 'ebay_motors' AND s.platform = 'ebay_motors' AND s.http_status = 200
     AND s.html_sha256 = e->>'html_sha256'
     AND e->>'gallery_label' ~ '^Video [0-9]+ of [0-9]+$'
     AND e->>'method' = 'ebay_item_gallery_labels_v1'
     AND substring(vi.image_url FROM '^https://i\.ebayimg\.com/images/g/([^/]+)/') = e->>'image_key'
     AND EXISTS (SELECT 1 FROM vehicle_events ve WHERE ve.vehicle_id = vi.vehicle_id AND ve.source_url = s.listing_url);
  IF cardinality(v_video_ids) <> (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_archive_probes, '[]'::jsonb)) e WHERE e->>'answer' = 'video_poster') THEN
    RAISE EXCEPTION 'video-poster receipts must match their vehicle, capture hash, image key and gallery label';
  END IF;
  v_excluded_ids := v_unsaved_ids || v_video_ids;

  v_prior := current_setting('app.skip_image_count_trigger', true);
  IF p_apply THEN
    PERFORM set_config('app.skip_image_count_trigger', '1', true);
    UPDATE vehicle_images
       SET is_superseded = true, superseded_at = COALESCE(superseded_at, now()), is_primary = false
     WHERE vehicle_id = ANY(p_vehicle_ids) AND COALESCE(is_superseded, false) = false
       AND (public.is_junk_listing_image_url(image_url) OR id = ANY(v_other_ids));
    GET DIAGNOSTICS v_superseded = ROW_COUNT;
    UPDATE vehicle_images vi
       SET is_superseded = true, superseded_at = COALESCE(vi.superseded_at, now()), is_primary = false,
           ai_scan_metadata = COALESCE(vi.ai_scan_metadata, '{}'::jsonb) || jsonb_build_object('supersession', jsonb_build_object(
             'reason', 'archive_did_not_save_photo', 'probe', v_unsaved_receipts -> (vi.id::text),
             'by', 'supersede_junk_listing_images', 'at', now()))
     WHERE vi.id = ANY(v_unsaved_ids) AND COALESCE(vi.is_superseded, false) = false;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_superseded := v_superseded + v_more;
    UPDATE vehicle_images vi
       SET is_superseded = true, superseded_at = COALESCE(vi.superseded_at, now()), is_primary = false,
           ai_scan_metadata = COALESCE(vi.ai_scan_metadata, '{}'::jsonb) || jsonb_build_object('supersession', jsonb_build_object(
             'reason', 'listing_video_poster', 'probe', v_video_receipts -> (vi.id::text),
             'by', 'supersede_junk_listing_images', 'at', now()))
     WHERE vi.id = ANY(v_video_ids) AND COALESCE(vi.is_superseded, false) = false;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    v_superseded := v_superseded + v_more;
  END IF;

  FOR r IN
    SELECT v.id AS vehicle_id, c.id AS image_id,
           EXISTS (SELECT 1 FROM vehicle_images o WHERE o.id = ANY(v_excluded_ids) AND o.vehicle_id = v.id
                     AND o.image_url = v.primary_image_url) AS unsaved_cover
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
           AND NOT (vi.id = ANY(v_excluded_ids))
           AND NOT (vi.image_url ~* '^https?://media\.carsandbids\.com/cdn-cgi/image/'
                    AND vi.image_url !~* '/cdn-cgi/image/width=2080[,/]')
         ORDER BY (vi.image_url ~* '/cdn-cgi/image/width=2080[,/]') DESC, COALESCE(vi.is_primary, false) DESC,
                  vi.position ASC NULLS LAST, vi.created_at ASC, vi.id
         LIMIT 1
      ) c ON true
     WHERE v.id = ANY(p_vehicle_ids)
       AND (public.is_junk_listing_image_url(v.primary_image_url)
            OR EXISTS (SELECT 1 FROM vehicle_images o
                        WHERE (o.id = ANY(v_other_ids) OR o.id = ANY(v_excluded_ids))
                          AND o.vehicle_id = v.id AND o.image_url = v.primary_image_url))
     ORDER BY v.id
  LOOP
    v_junk_primary := v_junk_primary + 1;
    IF r.image_id IS NULL THEN
      IF r.unsaved_cover THEN
        -- a dead archive link is not kept as the cover: with no other photo the cover is cleared
        v_cleared := v_cleared + 1;
        IF p_apply THEN
          v_res := public.recompute_vehicle_primary_image(r.vehicle_id);
          v_vehicles := v_vehicles || jsonb_build_object('vehicle_id', r.vehicle_id, 'nominee', NULL,
            'tier', v_res->>'tier', 'reason', v_res->>'reason');
        END IF;
      ELSE
        v_no_image := v_no_image || r.vehicle_id;
      END IF;
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
                      WHERE (o.id = ANY(v_other_ids) OR o.id = ANY(v_excluded_ids))
                        AND o.vehicle_id = v.id AND o.image_url = v.primary_image_url));

  RETURN CASE WHEN cardinality(v_video_ids) > 0 THEN jsonb_build_object('video_poster_rows', cardinality(v_video_ids)) ELSE '{}'::jsonb END || jsonb_build_object('apply', p_apply, 'vehicles', v_n,
    'tally', jsonb_build_object('junk_rows', v_junk_rows, 'other_lot_rows', v_other_rows, 'archive_unsaved_rows', v_unsaved_rows,
                                'superseded', v_superseded, 'junk_primary', v_junk_primary, 'nominated', v_nominated,
                                'cleared', v_cleared, 'no_usable_image', cardinality(v_no_image), 'junk_primary_after', v_still_junk),
    'no_usable_image', to_jsonb(v_no_image), 'repaired', v_vehicles);
END $function$;

COMMENT ON FUNCTION public.supersede_junk_listing_images(uuid[], boolean, jsonb) IS
  'Supersede listing furniture, other-lot cards, unsaved archive photos and cited eBay video posters. '
  'The legacy p_archive_probes parameter accepts video_poster receipts with image_id, snapshot_id, '
  'html_sha256, image_key, gallery_label and method ebay_item_gallery_labels_v1. The image, vehicle, '
  'own listing capture, hash and explicit Video label must match. Preserves rows and proof; dry-run '
  'by default, at most 100 vehicles and 100 video-poster receipts; existing service-role grants unchanged.';
COMMIT;
