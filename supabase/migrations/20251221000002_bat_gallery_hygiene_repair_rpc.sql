-- BaT gallery hygiene repair RPC
-- Goal: for BaT-imported vehicles, enforce canonical gallery ordering from vehicles.origin_metadata.image_urls,
-- hide contaminated BaT-domain images (site chrome / other listings), and reset primary image.
--
-- Canonical source of truth for BaT gallery images: vehicles.origin_metadata.image_urls
-- (populated from BaT `#bat_listing_page_photo_gallery[data-gallery-items]`).

CREATE OR REPLACE FUNCTION public.normalize_bat_image_url(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    lower(
      regexp_replace(
        split_part(split_part(coalesce(p_url, ''), '#', 1), '?', 1),
        '-scaled\\.',
        '.',
        'g'
      )
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.is_bat_noise_url(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_url, '') = '' OR
    p_url ilike '%/wp-content/themes/%' OR
    p_url ilike '%/countries/%' OR
    p_url ilike '%.svg%' OR
    p_url ilike '%/assets/img/%' OR
    p_url ilike '%qotw%' OR
    p_url ilike '%winner-template%' OR
    p_url ilike '%weekly-weird%' OR
    p_url ilike '%mile-marker%' OR
    p_url ilike '%podcast%' OR
    p_url ilike '%merch%' OR
    p_url ilike '%thumbnail-template%' OR
    p_url ilike '%site-post-%' OR
    p_url ilike '%screenshot-%';
$$;

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

  -- Map current images to canonical set using the original URL when available.
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
      vi.vehicle_id,
      vi.image_url,
      vi.is_primary,
      public.normalize_bat_image_url(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  to_keep AS (
    SELECT i.id, cs.pos
    FROM imgs i
    JOIN canon_set cs
      ON cs.url = i.orig_url
  ),
  to_hide AS (
    -- Strict: hide any BaT-domain image that is not in the canonical set.
    SELECT i.id
    FROM imgs i
    LEFT JOIN canon_set cs
      ON cs.url = i.orig_url
    WHERE cs.url IS NULL
      AND i.orig_url LIKE '%bringatrailer.com/%'
  )
  SELECT
    (SELECT count(*) FROM to_keep),
    (SELECT count(*) FROM to_hide)
  INTO keep_count, hide_count;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'vehicle_id', p_vehicle_id,
      'dry_run', true,
      'skipped', false,
      'canonical_count', canon_count,
      'keep_count', keep_count,
      'hide_count', hide_count
    );
  END IF;

  -- 1) Apply canonical positions
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
      public.normalize_bat_image_url(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  to_keep AS (
    SELECT i.id, cs.pos
    FROM imgs i
    JOIN canon_set cs
      ON cs.url = i.orig_url
  )
  UPDATE public.vehicle_images vi
  SET position = tk.pos
  FROM to_keep tk
  WHERE vi.id = tk.id
    AND (vi.position IS DISTINCT FROM tk.pos);
  GET DIAGNOSTICS updated_positions = ROW_COUNT;

  -- 2) Hide non-canonical BaT-domain images (never delete; reversible)
  WITH canon AS (
    SELECT
      public.normalize_bat_image_url(elem.value) AS url
    FROM public.vehicles v,
         jsonb_array_elements_text(v.origin_metadata->'image_urls') AS elem(value)
    WHERE v.id = p_vehicle_id
      AND jsonb_typeof(v.origin_metadata->'image_urls') = 'array'
  ),
  canon_set AS (
    SELECT url
    FROM canon
    WHERE url IS NOT NULL
      AND url LIKE '%bringatrailer.com/wp-content/uploads/%'
      AND public.is_bat_noise_url(url) = false
  ),
  imgs AS (
    SELECT
      vi.id,
      vi.is_primary,
      public.normalize_bat_image_url(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) AS orig_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
  ),
  to_hide AS (
    SELECT i.id
    FROM imgs i
    LEFT JOIN canon_set cs
      ON cs.url = i.orig_url
    WHERE cs.url IS NULL
      AND i.orig_url LIKE '%bringatrailer.com/%'
  )
  UPDATE public.vehicle_images vi
  SET is_duplicate = true,
      is_primary = false
  FROM to_hide th
  WHERE vi.id = th.id;
  GET DIAGNOSTICS marked_duplicates = ROW_COUNT;

  -- 3) Reset primary to the canonical position 0 image (if present)
  SELECT vi.id, vi.image_url
  INTO primary_image_id, v_primary_image_url
  FROM public.vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND coalesce(vi.is_document,false) = false
    AND coalesce(vi.is_duplicate,false) = false
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

    -- Best-effort update vehicles primary image columns for faster feeds (if present)
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
    'updated_positions', updated_positions,
    'marked_duplicates', marked_duplicates,
    'cleared_primaries', cleared_primaries,
    'set_primary', set_primary,
    'primary_image_id', primary_image_id,
    'primary_image_url', v_primary_image_url
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.normalize_bat_image_url(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_bat_noise_url(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_bat_vehicle_gallery_images(uuid, boolean) TO authenticated;


