-- BaT gallery hygiene repair RPC v2
-- Fixes: "first 50-65 images are wrong" caused by old contaminated batches having early positions,
-- plus duplicate rows mapping to the same canonical URL.
--
-- v2 behavior:
-- - For BaT imports, the ONLY visible `bat_import` images are those matching vehicles.origin_metadata.image_urls.
-- - Dedupe canonical matches (keep earliest created row per canonical URL).
-- - Any other `bat_import` image rows are marked is_duplicate=true (never deleted) and position cleared.
-- - Positions are set exactly to canonical order and primary is reset to canonical position 0.

CREATE OR REPLACE FUNCTION public.repair_bat_vehicle_gallery_images(p_vehicle_id uuid, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  canon_count int := 0;
  keep_count int := 0;
  hide_count int := 0;
  deduped_count int := 0;
  updated_positions int := 0;
  marked_duplicates int := 0;
  cleared_primaries int := 0;
  set_primary int := 0;
  primary_image_id uuid := null;
  v_primary_image_url text := null;
BEGIN
  -- Canonical list: vehicles.origin_metadata.image_urls (strict uploads only, noise filtered)
  WITH canon AS (
    SELECT
      public.normalize_bat_image_url(elem.value) AS url,
      (elem.ordinality - 1)::int AS pos
    FROM public.vehicles v,
         jsonb_array_elements_text(v.origin_metadata->'image_urls') WITH ORDINALITY AS elem(value, ordinality)
    WHERE v.id = p_vehicle_id
      AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
  ),
  canon_set AS (
    SELECT url, pos
    FROM canon
    WHERE url IS NOT NULL
      AND url LIKE '%bringatrailer.com/wp-content/uploads/%'
      AND public.is_bat_noise_url(url) = false
  )
  SELECT count(*) INTO canon_count FROM canon_set;

  IF canon_count < 10 THEN
    RETURN jsonb_build_object(
      'success', true,
      'vehicle_id', p_vehicle_id,
      'dry_run', p_dry_run,
      'skipped', true,
      'reason', 'canonical_too_small_or_missing',
      'canonical_count', canon_count
    );
  END IF;

  -- Build "best row per canonical URL" (dedupe). We only consider visible, non-document rows.
  WITH canon AS (
    SELECT
      public.normalize_bat_image_url(elem.value) AS url,
      (elem.ordinality - 1)::int AS pos
    FROM public.vehicles v,
         jsonb_array_elements_text(v.origin_metadata->'image_urls') WITH ORDINALITY AS elem(value, ordinality)
    WHERE v.id = p_vehicle_id
      AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
  ),
  canon_set AS (
    SELECT url, pos
    FROM canon
    WHERE url IS NOT NULL
      AND url LIKE '%bringatrailer.com/wp-content/uploads/%'
      AND public.is_bat_noise_url(url) = false
  ),
  imgs AS (
    SELECT
      vi.id,
      vi.created_at,
      vi.source,
      vi.is_primary,
      public.normalize_bat_image_url(
        coalesce(
          nullif(vi.source_url,''),
          nullif(vi.exif_data->>'original_url',''),
          nullif(vi.image_url,'')
        )
      ) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  matches AS (
    SELECT
      cs.url,
      cs.pos,
      i.id,
      i.created_at
    FROM canon_set cs
    JOIN imgs i
      ON i.orig_url = cs.url
  ),
  best_per_url AS (
    SELECT DISTINCT ON (url)
      url, pos, id
    FROM matches
    ORDER BY url, created_at ASC, id ASC
  ),
  all_keep AS (
    SELECT id, pos FROM best_per_url
  ),
  to_hide AS (
    -- STRICT: hide any visible `bat_import` images not in the keep set.
    SELECT i.id
    FROM public.vehicle_images i
    WHERE i.vehicle_id = p_vehicle_id
      AND coalesce(i.is_document,false) = false
      AND coalesce(i.is_duplicate,false) = false
      AND i.source = 'bat_import'
      AND NOT EXISTS (SELECT 1 FROM all_keep k WHERE k.id = i.id)
  )
  SELECT
    (SELECT count(*) FROM all_keep),
    (SELECT count(*) FROM to_hide),
    (SELECT count(*) FROM matches) - (SELECT count(*) FROM all_keep)
  INTO keep_count, hide_count, deduped_count;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'vehicle_id', p_vehicle_id,
      'dry_run', true,
      'skipped', false,
      'canonical_count', canon_count,
      'keep_count', keep_count,
      'hide_count', hide_count,
      'deduped_count', deduped_count
    );
  END IF;

  -- 1) Mark contaminated/extra `bat_import` rows as duplicate and clear ordering fields.
  WITH canon AS (
    SELECT
      public.normalize_bat_image_url(elem.value) AS url,
      (elem.ordinality - 1)::int AS pos
    FROM public.vehicles v,
         jsonb_array_elements_text(v.origin_metadata->'image_urls') WITH ORDINALITY AS elem(value, ordinality)
    WHERE v.id = p_vehicle_id
      AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
  ),
  canon_set AS (
    SELECT url, pos
    FROM canon
    WHERE url IS NOT NULL
      AND url LIKE '%bringatrailer.com/wp-content/uploads/%'
      AND public.is_bat_noise_url(url) = false
  ),
  imgs AS (
    SELECT
      vi.id,
      vi.created_at,
      public.normalize_bat_image_url(
        coalesce(
          nullif(vi.source_url,''),
          nullif(vi.exif_data->>'original_url',''),
          nullif(vi.image_url,'')
        )
      ) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  matches AS (
    SELECT
      cs.url,
      cs.pos,
      i.id,
      i.created_at
    FROM canon_set cs
    JOIN imgs i
      ON i.orig_url = cs.url
  ),
  best_per_url AS (
    SELECT DISTINCT ON (url)
      url, pos, id
    FROM matches
    ORDER BY url, created_at ASC, id ASC
  ),
  all_keep AS (
    SELECT id, pos FROM best_per_url
  ),
  to_hide AS (
    SELECT i.id
    FROM public.vehicle_images i
    WHERE i.vehicle_id = p_vehicle_id
      AND coalesce(i.is_document,false) = false
      AND coalesce(i.is_duplicate,false) = false
      AND i.source = 'bat_import'
      AND NOT EXISTS (SELECT 1 FROM all_keep k WHERE k.id = i.id)
  )
  UPDATE public.vehicle_images vi
  SET is_duplicate = true,
      is_primary = false,
      position = null
  FROM to_hide th
  WHERE vi.id = th.id;
  GET DIAGNOSTICS marked_duplicates = ROW_COUNT;

  -- 2) Apply canonical positions to kept rows only.
  WITH canon AS (
    SELECT
      public.normalize_bat_image_url(elem.value) AS url,
      (elem.ordinality - 1)::int AS pos
    FROM public.vehicles v,
         jsonb_array_elements_text(v.origin_metadata->'image_urls') WITH ORDINALITY AS elem(value, ordinality)
    WHERE v.id = p_vehicle_id
      AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
  ),
  canon_set AS (
    SELECT url, pos
    FROM canon
    WHERE url IS NOT NULL
      AND url LIKE '%bringatrailer.com/wp-content/uploads/%'
      AND public.is_bat_noise_url(url) = false
  ),
  imgs AS (
    SELECT
      vi.id,
      vi.created_at,
      public.normalize_bat_image_url(
        coalesce(
          nullif(vi.source_url,''),
          nullif(vi.exif_data->>'original_url',''),
          nullif(vi.image_url,'')
        )
      ) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  matches AS (
    SELECT
      cs.url,
      cs.pos,
      i.id,
      i.created_at
    FROM canon_set cs
    JOIN imgs i
      ON i.orig_url = cs.url
  ),
  best_per_url AS (
    SELECT DISTINCT ON (url)
      url, pos, id
    FROM matches
    ORDER BY url, created_at ASC, id ASC
  )
  UPDATE public.vehicle_images vi
  SET position = b.pos
  FROM best_per_url b
  WHERE vi.id = b.id
    AND (vi.position IS DISTINCT FROM b.pos);
  GET DIAGNOSTICS updated_positions = ROW_COUNT;

  -- 3) Reset primary to canonical position 0 (kept).
  SELECT vi.id, vi.image_url
  INTO primary_image_id, v_primary_image_url
  FROM public.vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND coalesce(vi.is_document,false) = false
    AND coalesce(vi.is_duplicate,false) = false
    AND vi.source = 'bat_import'
    AND vi.position = 0
  ORDER BY vi.created_at ASC, vi.id ASC
  LIMIT 1;

  IF primary_image_id IS NOT NULL THEN
    UPDATE public.vehicle_images
    SET is_primary = false
    WHERE vehicle_id = p_vehicle_id
      AND coalesce(is_document,false) = false
      AND coalesce(is_duplicate,false) = false
      AND coalesce(is_primary,false) = true
      AND id <> primary_image_id;
    GET DIAGNOSTICS cleared_primaries = ROW_COUNT;

    UPDATE public.vehicle_images
    SET is_primary = true
    WHERE id = primary_image_id
      AND coalesce(is_duplicate,false) = false
      AND coalesce(is_document,false) = false
      AND coalesce(is_primary,false) = false;
    GET DIAGNOSTICS set_primary = ROW_COUNT;

    UPDATE public.vehicles
    SET primary_image_url = v_primary_image_url,
        image_url = coalesce(image_url, v_primary_image_url)
    WHERE id = p_vehicle_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vehicle_id', p_vehicle_id,
    'dry_run', false,
    'skipped', false,
    'canonical_count', canon_count,
    'keep_count', keep_count,
    'hide_count', hide_count,
    'deduped_count', deduped_count,
    'updated_positions', updated_positions,
    'marked_duplicates', marked_duplicates,
    'cleared_primaries', cleared_primaries,
    'set_primary', set_primary,
    'primary_image_id', primary_image_id,
    'primary_image_url', v_primary_image_url
  );
END;
$function$;


