DO $$
DECLARE
  orphaned_count INTEGER;
  total_images INTEGER;
  remaining_orphaned INTEGER;
  total_events INTEGER;
  backfill_events INTEGER;
BEGIN
  IF to_regclass('public.vehicle_images') IS NULL THEN
    RAISE NOTICE 'Skipping backfill: table public.vehicle_images does not exist.';
    RETURN;
  END IF;

  IF to_regclass('public.vehicle_timeline_events') IS NULL THEN
    RAISE NOTICE 'Skipping backfill: table public.vehicle_timeline_events does not exist.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO total_images FROM public.vehicle_images;
  SELECT COUNT(*) INTO orphaned_count FROM public.vehicle_images WHERE timeline_event_id IS NULL;

  RAISE NOTICE 'Total images: %', total_images;
  RAISE NOTICE 'Orphaned images (no timeline link): %', orphaned_count;
  IF total_images > 0 THEN
    RAISE NOTICE 'Percentage orphaned: %', ROUND((orphaned_count::NUMERIC / total_images::NUMERIC) * 100, 2);
  ELSE
    RAISE NOTICE 'Percentage orphaned: 0';
  END IF;

  -- Strategy 1: Link images to existing 'photo_added' events by date match
  UPDATE public.vehicle_images vi
  SET timeline_event_id = (
    SELECT vte.id
    FROM public.vehicle_timeline_events vte
    WHERE vte.vehicle_id = vi.vehicle_id
      AND vte.event_type = 'photo_added'
      AND DATE(vte.event_date) = DATE(COALESCE(vi.taken_at, vi.created_at))
      AND COALESCE(vte.image_urls, ARRAY[]::text[]) @> ARRAY[vi.image_url]
    ORDER BY vte.created_at DESC
    LIMIT 1
  )
  WHERE vi.timeline_event_id IS NULL
    AND vi.vehicle_id IS NOT NULL
    AND vi.image_url IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.vehicle_timeline_events vte
      WHERE vte.vehicle_id = vi.vehicle_id
        AND vte.event_type = 'photo_added'
        AND DATE(vte.event_date) = DATE(COALESCE(vi.taken_at, vi.created_at))
        AND COALESCE(vte.image_urls, ARRAY[]::text[]) @> ARRAY[vi.image_url]
    );

  -- Strategy 2: For remaining images, create new 'photo_session' events when they do not already exist
WITH orphaned_images AS (
    SELECT 
      vi.vehicle_id,
      DATE(COALESCE(vi.taken_at, vi.created_at)) AS photo_date,
      vi.user_id,
      ARRAY_AGG(vi.image_url ORDER BY vi.created_at) AS image_urls,
      COUNT(*) AS image_count,
      MIN(vi.created_at) AS first_upload,
      MAX(vi.created_at) AS last_upload
    FROM public.vehicle_images vi
    WHERE vi.timeline_event_id IS NULL
      AND vi.vehicle_id IS NOT NULL
      AND vi.image_url IS NOT NULL
    GROUP BY vi.vehicle_id, DATE(COALESCE(vi.taken_at, vi.created_at)), vi.user_id
),
updated_vehicle_uploaders AS (
  UPDATE public.vehicles v
  SET uploaded_by = COALESCE(v.uploaded_by, oi.user_id, v.user_id, v.owner_id)
  FROM orphaned_images oi
  WHERE v.id = oi.vehicle_id
    AND v.uploaded_by IS NULL
    AND COALESCE(oi.user_id, v.user_id, v.owner_id) IS NOT NULL
  RETURNING v.id
),
inserted_events AS (
  INSERT INTO public.vehicle_timeline_events (
      vehicle_id,
      user_id,
      event_type,
      source,
      event_date,
      title,
      description,
      image_urls,
      metadata
    )
    SELECT 
      oi.vehicle_id,
      COALESCE(
        oi.user_id,
        v.uploaded_by,
        v.user_id,
        v.owner_id
      ) AS event_user_id,
      'photo_session',
      'backfill_orphaned_images',
      oi.photo_date,
      CASE 
        WHEN oi.image_count = 1 THEN 'Photo Added'
        ELSE 'Photo Session (' || oi.image_count || ' photos)'
      END,
      CASE 
        WHEN oi.image_count = 1 THEN 'Orphaned image linked to timeline'
        ELSE oi.image_count || ' orphaned images grouped into session'
      END,
      oi.image_urls,
      jsonb_build_object(
        'backfill', TRUE,
        'backfill_date', NOW(),
        'backfill_reason', 'Missing timeline_event_id on images',
        'photo_count', oi.image_count,
        'upload_span', jsonb_build_object(
          'first', oi.first_upload,
          'last', oi.last_upload
        )
      )
    FROM orphaned_images oi
    LEFT JOIN updated_vehicle_uploaders u ON u.id = oi.vehicle_id
    JOIN public.vehicles v ON v.id = oi.vehicle_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.vehicle_timeline_events existing
      WHERE existing.vehicle_id = oi.vehicle_id
        AND existing.event_type = 'photo_session'
        AND existing.source = 'backfill_orphaned_images'
        AND DATE(existing.event_date) = oi.photo_date
    )
    AND COALESCE(
          oi.user_id,
          v.uploaded_by,
          v.user_id,
          v.owner_id
        ) IS NOT NULL
    RETURNING id, vehicle_id, event_date, image_urls
  )
  UPDATE public.vehicle_images vi
  SET timeline_event_id = inserted_events.id
  FROM inserted_events
  WHERE vi.vehicle_id = inserted_events.vehicle_id
    AND DATE(COALESCE(vi.taken_at, vi.created_at)) = DATE(inserted_events.event_date)
    AND vi.image_url = ANY(inserted_events.image_urls)
    AND vi.timeline_event_id IS NULL;

  -- Ensure timeline events include URLs for all linked images
  UPDATE public.vehicle_timeline_events vte
  SET image_urls = (
    SELECT ARRAY(
      SELECT DISTINCT url
      FROM (
        SELECT unnest(COALESCE(vte.image_urls, ARRAY[]::text[])) AS url
        UNION ALL
        SELECT vi.image_url
        FROM public.vehicle_images vi
        WHERE vi.timeline_event_id = vte.id
          AND vi.image_url IS NOT NULL
      ) combined
      WHERE url IS NOT NULL
      ORDER BY url
    )
  )
  WHERE vte.event_type IN ('photo_added', 'photo_session')
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_images vi
      WHERE vi.timeline_event_id = vte.id
        AND vi.image_url IS NOT NULL
        AND NOT (COALESCE(vte.image_urls, ARRAY[]::text[]) @> ARRAY[vi.image_url])
    );

  SELECT COUNT(*) INTO remaining_orphaned FROM public.vehicle_images WHERE timeline_event_id IS NULL;
  SELECT COUNT(*) INTO total_events FROM public.vehicle_timeline_events;
  SELECT COUNT(*) INTO backfill_events FROM public.vehicle_timeline_events WHERE metadata->>'backfill' = 'true';

  RAISE NOTICE '=== BACKFILL COMPLETE ===';
  RAISE NOTICE 'Remaining orphaned images: %', remaining_orphaned;
  RAISE NOTICE 'Total timeline events: %', total_events;
  RAISE NOTICE 'Events created by backfill: %', backfill_events;

  IF remaining_orphaned = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All images now linked to timeline events!';
  ELSE
    RAISE WARNING '⚠️  Still have % orphaned images - may need manual review', remaining_orphaned;
  END IF;
END
$$;

