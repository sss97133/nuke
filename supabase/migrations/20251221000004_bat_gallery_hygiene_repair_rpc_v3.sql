-- BaT gallery hygiene repair RPC v3
-- Adds a "partial cleanup" mode when canonical URLs are missing/small:
-- - Hide obvious BaT UI assets (countries flags / themes / svg / assets) from bat_import rows
-- - Reset primary off of UI assets to the first non-duplicate, non-document image
-- This ensures the feed never shows flags/icons even if origin_metadata.image_urls isn't available yet.

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
  partial boolean := false;
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

  -- If canonical is missing/small: do partial cleanup (hide obvious UI assets + reset primary).
  IF canon_count < 10 THEN
    partial := true;

    -- Hide UI assets (safe even without canonical)
    IF NOT p_dry_run THEN
      UPDATE public.vehicle_images vi
      SET
        is_duplicate = true,
        is_primary = false,
        position = null
      WHERE vi.vehicle_id = p_vehicle_id
        AND coalesce(vi.is_document,false) = false
        AND coalesce(vi.is_duplicate,false) = false
        AND vi.source = 'bat_import'
        AND (
          lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%/countries/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%/wp-content/themes/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%assets/img/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%.svg%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%.pdf%'
        );
      GET DIAGNOSTICS marked_duplicates = ROW_COUNT;
    ELSE
      SELECT count(*)
      INTO marked_duplicates
      FROM public.vehicle_images vi
      WHERE vi.vehicle_id = p_vehicle_id
        AND coalesce(vi.is_document,false) = false
        AND coalesce(vi.is_duplicate,false) = false
        AND vi.source = 'bat_import'
        AND (
          lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%/countries/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%/wp-content/themes/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%assets/img/%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%.svg%'
          OR lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) LIKE '%.pdf%'
        );
    END IF;

    -- Reset primary to first non-duplicate, non-document image (avoid UI assets)
    SELECT vi.id, vi.image_url
    INTO primary_image_id, v_primary_image_url
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND coalesce(vi.is_document,false) = false
      AND coalesce(vi.is_duplicate,false) = false
      AND (
        lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) NOT LIKE '%/countries/%'
        AND lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) NOT LIKE '%/wp-content/themes/%'
        AND lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) NOT LIKE '%assets/img/%'
        AND lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) NOT LIKE '%.svg%'
        AND lower(coalesce(nullif(vi.source_url,''), nullif(vi.exif_data->>'original_url',''), nullif(vi.image_url,''))) NOT LIKE '%.pdf%'
      )
    ORDER BY vi.position ASC NULLS LAST, vi.created_at ASC, vi.id ASC
    LIMIT 1;

    IF primary_image_id IS NOT NULL THEN
      IF NOT p_dry_run THEN
        UPDATE public.vehicle_images
        SET is_primary = false
        WHERE vehicle_id = p_vehicle_id
          AND coalesce(is_document,false) = false
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
            image_url = coalesce(v_primary_image_url, image_url)
        WHERE id = p_vehicle_id;
      ELSE
        set_primary := 1;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'vehicle_id', p_vehicle_id,
      'dry_run', p_dry_run,
      'skipped', false,
      'partial', true,
      'reason', 'canonical_too_small_or_missing_partial_cleanup',
      'canonical_count', canon_count,
      'marked_duplicates', marked_duplicates,
      'cleared_primaries', cleared_primaries,
      'set_primary', set_primary,
      'primary_image_id', primary_image_id,
      'primary_image_url', v_primary_image_url
    );
  END IF;

  -- ===== Strict canonical repair (v2 behavior) =====

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
      'partial', false,
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
        image_url = coalesce(v_primary_image_url, image_url)
    WHERE id = p_vehicle_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vehicle_id', p_vehicle_id,
    'dry_run', false,
    'skipped', false,
    'partial', false,
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


