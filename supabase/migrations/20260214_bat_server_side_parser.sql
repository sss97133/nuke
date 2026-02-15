-- Server-side BaT HTML parser: parses archived HTML inside PostgreSQL
-- so we never transfer 100-500KB HTML blobs over the network.
-- Processes ONE vehicle at a time to stay within statement timeout.
--
-- Usage: SELECT parse_bat_archive_fill('some-uuid');
-- Returns: number of fields updated (0 if nothing to do)

CREATE OR REPLACE FUNCTION parse_bat_archive_fill(p_vehicle_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '30s'
AS $fn$
DECLARE
  v_html            TEXT;
  v_listing_url     TEXT;
  v_win             TEXT;       -- essentials window (first 50k chars)
  v_title_raw       TEXT;
  v_match           TEXT[];
  v_fields_updated  INTEGER := 0;
  v_detail_block    TEXT;
  v_item            TEXT;
  v_item_clean      TEXT;
  v_bid_table       TEXT;
  v_tmp             TEXT;
  v_tmp_int         INTEGER;
  v_desc_block      TEXT;
  v_scope           TEXT;       -- for reserve detection
  -- Extracted fields
  v_vin             TEXT;
  v_mileage         INTEGER;
  v_sale_price      INTEGER;
  v_description     TEXT;
  v_color           TEXT;
  v_interior_color  TEXT;
  v_transmission    TEXT;
  v_drivetrain      TEXT;
  v_engine_size     TEXT;
  v_location        TEXT;
  v_listing_title   TEXT;
  v_bat_listing_title TEXT;
  v_body_style      TEXT;
  v_sale_date       DATE;
  v_auction_end_date TEXT;
  v_reserve_status  TEXT;
  v_bat_seller      TEXT;
  v_bat_lot_number  TEXT;
  v_bat_bids        INTEGER;
  v_bat_comments    INTEGER;
  v_bat_views       INTEGER;
  v_bat_watchers    INTEGER;
  v_primary_image_url TEXT;
  v_gallery_json    TEXT;
  v_gallery_item    JSONB;
  v_gallery_arr     JSONB;
  v_price_int       INTEGER;
  v_lower_title     TEXT;
  i                 INTEGER;
  -- quote char for regex patterns
  q                 TEXT := chr(39);  -- single quote character
BEGIN
  -- ---------------------------------------------------------------
  -- Step 1: Get the vehicle listing URL
  -- ---------------------------------------------------------------
  SELECT listing_url INTO v_listing_url
  FROM vehicles WHERE id = p_vehicle_id;

  IF v_listing_url IS NULL THEN RETURN 0; END IF;

  -- ---------------------------------------------------------------
  -- Step 2: Get the most recent archived HTML for this listing
  -- ---------------------------------------------------------------
  SELECT html INTO v_html
  FROM listing_page_snapshots
  WHERE platform = 'bat'
    AND success = true
    AND html IS NOT NULL
    AND listing_url IN (v_listing_url, v_listing_url || '/')
  ORDER BY fetched_at DESC
  LIMIT 1;

  IF v_html IS NULL OR length(v_html) < 500 THEN RETURN 0; END IF;

  -- Essentials window: first 50k chars covers all structured data
  v_win := left(v_html, 50000);

  -- ---------------------------------------------------------------
  -- EXTRACTION: og:title
  -- BaT uses double-quotes for meta attributes, so match "content"
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html,
    '<meta[^>]*property="og:title"[^>]*content="([^"]+)"', 'i');
  IF v_match IS NULL THEN
    -- Fallback: content before property
    v_match := regexp_match(v_html,
      '<meta[^>]*content="([^"]+)"[^>]*property="og:title"', 'i');
  END IF;
  IF v_match IS NULL THEN
    -- Fallback: <title> tag
    v_match := regexp_match(v_html, '<title[^>]*>([^<]+)</title>', 'i');
  END IF;
  IF v_match IS NOT NULL THEN
    v_title_raw := trim(v_match[1]);
    -- Clean title: remove "| Bring a Trailer" and "for sale on BaT Auctions..."
    v_listing_title := regexp_replace(v_title_raw, '\s*\|\s*Bring a Trailer.*$', '');
    v_listing_title := regexp_replace(v_listing_title, '\s+for sale on BaT Auctions.*$', '', 'i');
    v_listing_title := left(trim(v_listing_title), 500);
    v_bat_listing_title := v_listing_title;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Description
  -- Try post-excerpt div, then post-content div, then og:description
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html,
    '<div[^>]*class="[^"]*post-excerpt[^"]*"[^>]*>([\s\S]*?)</div>', 'i');
  IF v_match IS NOT NULL THEN
    v_desc_block := regexp_replace(v_match[1], '<[^>]+>', ' ', 'g');
    v_desc_block := regexp_replace(v_desc_block, '\s+', ' ', 'g');
    v_desc_block := trim(v_desc_block);
    IF length(v_desc_block) > 40 THEN
      v_description := left(v_desc_block, 2000);
    END IF;
  END IF;

  IF v_description IS NULL THEN
    v_match := regexp_match(v_html,
      '<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)</div>', 'i');
    IF v_match IS NOT NULL THEN
      v_desc_block := regexp_replace(v_match[1], '<[^>]+>', ' ', 'g');
      v_desc_block := regexp_replace(v_desc_block, '\s+', ' ', 'g');
      v_desc_block := trim(v_desc_block);
      IF length(v_desc_block) > 40 THEN
        v_description := left(v_desc_block, 2000);
      END IF;
    END IF;
  END IF;

  IF v_description IS NULL THEN
    v_match := regexp_match(v_html,
      '<meta[^>]*property="og:description"[^>]*content="([^"]+)"', 'i');
    IF v_match IS NULL THEN
      v_match := regexp_match(v_html,
        '<meta[^>]*content="([^"]+)"[^>]*property="og:description"', 'i');
    END IF;
    IF v_match IS NOT NULL THEN
      v_desc_block := regexp_replace(v_match[1], '<[^>]+>', ' ', 'g');
      v_desc_block := regexp_replace(v_desc_block, '\s+', ' ', 'g');
      v_desc_block := trim(v_desc_block);
      IF length(v_desc_block) > 40 THEN
        v_description := left(v_desc_block, 2000);
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Seller (from essentials)
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_win,
    '<strong>Seller</strong>:\s*<a[^>]*>([^<]+)</a>', 'i');
  IF v_match IS NOT NULL THEN
    v_bat_seller := regexp_replace(trim(v_match[1]), '<[^>]+>', ' ', 'g');
    v_bat_seller := regexp_replace(v_bat_seller, '\s+', ' ', 'g');
    v_bat_seller := trim(v_bat_seller);
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Location (from essentials)
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_win,
    '<strong>Location</strong>:\s*<a[^>]*>([^<]+)</a>', 'i');
  IF v_match IS NOT NULL THEN
    v_location := regexp_replace(trim(v_match[1]), '<[^>]+>', ' ', 'g');
    v_location := regexp_replace(v_location, '\s+', ' ', 'g');
    v_location := trim(v_location);
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Lot number (from essentials)
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_win,
    '<strong>Lot</strong>\s*#([0-9,]+)', 'i');
  IF v_match IS NOT NULL THEN
    v_bat_lot_number := replace(v_match[1], ',', '');
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Reserve status
  -- ---------------------------------------------------------------
  v_scope := regexp_replace(v_win, '<[^>]+>', ' ', 'g');
  v_scope := regexp_replace(v_scope, '\s+', ' ', 'g');
  v_scope := v_scope || ' ' || COALESCE(v_title_raw, '');

  IF v_scope ~* 'no-reserve' OR v_scope ~* '\mNo Reserve\M' THEN
    v_reserve_status := 'no_reserve';
  ELSIF v_scope ~* '\mReserve Not Met\M' THEN
    v_reserve_status := 'reserve_not_met';
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Auction end date (from data-ends="TIMESTAMP")
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html, 'data-ends="(\d+)"', 'i');
  IF v_match IS NOT NULL THEN
    v_tmp := v_match[1];
    BEGIN
      v_tmp_int := v_tmp::BIGINT;
      IF v_tmp_int > 0 THEN
        v_sale_date := to_timestamp(v_tmp_int)::DATE;
        v_auction_end_date := to_char(to_timestamp(v_tmp_int), 'YYYY-MM-DD');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Sale price from title ("sold for $XX,XXX")
  -- ---------------------------------------------------------------
  IF v_title_raw IS NOT NULL THEN
    v_match := regexp_match(v_title_raw, '\msold\s+for\s+\$?\s*([0-9,]+)', 'i');
    IF v_match IS NOT NULL THEN
      BEGIN
        v_price_int := replace(v_match[1], ',', '')::INTEGER;
        IF v_price_int > 100 AND v_price_int < 100000000 THEN
          v_sale_price := v_price_int;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Sale price from bid stats table (fallback)
  -- ---------------------------------------------------------------
  IF v_sale_price IS NULL THEN
    v_match := regexp_match(v_html,
      '<table[^>]*id="listing-bid"[^>]*>([\s\S]*?)</table>', 'i');
    IF v_match IS NOT NULL THEN
      v_bid_table := v_match[1];
      IF v_bid_table !~* 'Reserve Not Met' THEN
        v_match := regexp_match(v_bid_table,
          'Sold.*?<strong>\s*(?:USD\s*)?\$?\s*([0-9,.]+)', 'i');
        IF v_match IS NOT NULL THEN
          BEGIN
            v_price_int := split_part(replace(v_match[1], ',', ''), '.', 1)::INTEGER;
            IF v_price_int > 100 AND v_price_int < 100000000 THEN
              v_sale_price := v_price_int;
            END IF;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Bid count (count "type":"bat-bid" occurrences)
  -- ---------------------------------------------------------------
  v_tmp := '"type":"bat-bid"';
  IF v_html LIKE '%' || v_tmp || '%' THEN
    v_bat_bids := (length(v_html) - length(replace(v_html, v_tmp, '')))
                  / length(v_tmp);
    IF v_bat_bids <= 0 THEN v_bat_bids := NULL; END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Comment count
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html,
    '<span class="info-value">(\d+)</span>\s*<span class="info-label">Comments</span>', 'i');
  IF v_match IS NOT NULL THEN
    BEGIN v_bat_comments := v_match[1]::INTEGER;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: View count
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html, 'data-stats-item="views">([0-9,]+)', 'i');
  IF v_match IS NOT NULL THEN
    BEGIN v_bat_views := replace(v_match[1], ',', '')::INTEGER;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Watcher count
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html, 'data-stats-item="watchers">([0-9,]+)', 'i');
  IF v_match IS NOT NULL THEN
    BEGIN v_bat_watchers := replace(v_match[1], ',', '')::INTEGER;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Listing Details <ul> block
  -- (VIN, mileage, color, interior, transmission, drivetrain, engine)
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_win,
    '<strong>Listing Details</strong>[\s\S]*?<ul>([\s\S]*?)</ul>', 'i');
  IF v_match IS NOT NULL THEN
    v_detail_block := v_match[1];

    -- Iterate over each <li> item using regexp_matches (set-returning)
    FOR v_match IN
      SELECT regexp_matches(v_detail_block, '<li[^>]*>([\s\S]*?)</li>', 'gi')
    LOOP
      v_item := v_match[1];
      v_item_clean := regexp_replace(v_item, '<[^>]+>', ' ', 'g');
      v_item_clean := regexp_replace(v_item_clean, '\s+', ' ', 'g');
      v_item_clean := trim(v_item_clean);

      IF v_item_clean = '' OR v_item_clean IS NULL THEN CONTINUE; END IF;

      -- === VIN ===
      IF v_vin IS NULL THEN
        v_match := regexp_match(v_item_clean,
          '^(?:VIN|Chassis)\s*:\s*([A-HJ-NPR-Z0-9]{4,17})\y', 'i');
        IF v_match IS NOT NULL THEN
          v_vin := upper(v_match[1]);
        END IF;
      END IF;

      -- === Mileage ===
      IF v_mileage IS NULL THEN
        v_match := regexp_match(v_item_clean, '\m([0-9,]+)\s*Miles?\M', 'i');
        IF v_match IS NOT NULL THEN
          BEGIN
            v_tmp_int := replace(v_match[1], ',', '')::INTEGER;
            IF v_tmp_int > 0 AND v_tmp_int < 10000000 THEN
              v_mileage := v_tmp_int;
            END IF;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
        -- Fallback: "XXk Miles"
        IF v_mileage IS NULL THEN
          v_match := regexp_match(v_item_clean, '\m(\d+(?:\.\d+)?)\s*k\s*Miles?\M', 'i');
          IF v_match IS NOT NULL THEN
            BEGIN
              v_tmp_int := round(v_match[1]::NUMERIC * 1000)::INTEGER;
              IF v_tmp_int > 0 AND v_tmp_int < 10000000 THEN
                v_mileage := v_tmp_int;
              END IF;
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END IF;
        END IF;
      END IF;

      -- === Transmission ===
      IF v_transmission IS NULL THEN
        IF length(v_item_clean) <= 80
           AND v_item_clean !~* 'miles|paint|upholstery|chassis|vin|engine'
           AND (v_item_clean ~* 'transmission|transaxle|gearbox|cvt|dct'
                OR (v_item_clean ~* '\m(manual|automatic)\M'
                    AND v_item_clean ~* '\d{1,2}-speed'))
        THEN
          v_transmission := v_item_clean;
        END IF;
      END IF;

      -- === Drivetrain ===
      IF v_drivetrain IS NULL THEN
        v_match := regexp_match(v_item_clean, '\m(AWD|4WD|RWD|FWD|4x4)\M', 'i');
        IF v_match IS NOT NULL THEN
          v_drivetrain := upper(v_match[1]);
          IF v_drivetrain = '4X4' THEN v_drivetrain := '4WD'; END IF;
        ELSE
          IF v_item_clean ~* 'rear-wheel drive' THEN v_drivetrain := 'RWD';
          ELSIF v_item_clean ~* 'front-wheel drive' THEN v_drivetrain := 'FWD';
          ELSIF v_item_clean ~* 'all-wheel drive' THEN v_drivetrain := 'AWD';
          ELSIF v_item_clean ~* 'four-wheel drive' THEN v_drivetrain := '4WD';
          END IF;
        END IF;
      END IF;

      -- === Engine size ===
      IF v_engine_size IS NULL THEN
        IF (v_item_clean ~* '\d+(?:\.\d+)?-?\s*Liter|\d+(?:\.\d+)?\s*L\M|V\d\M'
            OR v_item_clean ~* '[0-9,]{3,5}\s*cc|cubic\s+inch|flat[-\s]?(four|six)')
           AND v_item_clean !~* 'exhaust|wheels|brakes'
        THEN
          v_engine_size := v_item_clean;
        END IF;
      END IF;

      -- === Color (exterior) ===
      IF v_color IS NULL THEN
        v_match := regexp_match(v_item_clean, '^(.+?)\s+Paint\M', 'i');
        IF v_match IS NOT NULL THEN
          v_color := trim(v_match[1]);
        END IF;
        IF v_color IS NULL THEN
          v_match := regexp_match(v_item_clean,
            '\m(?:Finished|Repainted)\s+in\s+(.{2,60})', 'i');
          IF v_match IS NOT NULL THEN
            v_color := trim(v_match[1]);
          END IF;
        END IF;
      END IF;

      -- === Interior color ===
      IF v_interior_color IS NULL THEN
        v_match := regexp_match(v_item_clean, '^(.+?)\s+Upholstery\M', 'i');
        IF v_match IS NOT NULL THEN
          v_interior_color := trim(v_match[1]);
        END IF;
      END IF;

    END LOOP;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Body style from title
  -- ---------------------------------------------------------------
  IF v_body_style IS NULL AND v_listing_title IS NOT NULL THEN
    v_lower_title := lower(v_listing_title);
    IF v_lower_title ~ '\mcoupe\M'                         THEN v_body_style := 'Coupe';
    ELSIF v_lower_title ~ '\mconvertible\M|\mcabriolet\M'  THEN v_body_style := 'Convertible';
    ELSIF v_lower_title ~ '\mroadster\M'                   THEN v_body_style := 'Roadster';
    ELSIF v_lower_title ~ '\msedan\M'                      THEN v_body_style := 'Sedan';
    ELSIF v_lower_title ~ '\mwagon\M'                      THEN v_body_style := 'Wagon';
    ELSIF v_lower_title ~ '\mhatchback\M'                  THEN v_body_style := 'Hatchback';
    ELSIF v_lower_title ~ '\mpickup\M|\mtruck\M'           THEN v_body_style := 'Truck';
    ELSIF v_lower_title ~ '\mfastback\M'                   THEN v_body_style := 'Fastback';
    ELSIF v_lower_title ~ '\msuv\M'                        THEN v_body_style := 'SUV';
    ELSIF v_lower_title ~ '\mvan\M'                        THEN v_body_style := 'Van';
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Primary image URL from gallery JSON
  -- ---------------------------------------------------------------
  v_match := regexp_match(v_html,
    'data-gallery-items="([\s\S]*?)"\s', 'i');
  IF v_match IS NOT NULL THEN
    v_gallery_json := v_match[1];
    -- Decode HTML entities
    v_gallery_json := replace(v_gallery_json, '&quot;', '"');
    v_gallery_json := replace(v_gallery_json, '&#038;', '&');
    v_gallery_json := replace(v_gallery_json, '&amp;', '&');
    BEGIN
      v_gallery_arr := v_gallery_json::JSONB;
      IF jsonb_typeof(v_gallery_arr) = 'array' AND jsonb_array_length(v_gallery_arr) > 0 THEN
        FOR i IN 0..jsonb_array_length(v_gallery_arr)-1 LOOP
          v_gallery_item := v_gallery_arr->i;
          v_tmp := COALESCE(
            v_gallery_item->'full'->>'url',
            v_gallery_item->'original'->>'url'
          );
          IF v_tmp IS NOT NULL AND v_tmp LIKE '%bringatrailer.com/wp-content/uploads/%' THEN
            v_primary_image_url := split_part(split_part(v_tmp, '?', 1), '#', 1);
            EXIT;
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- JSON parse failed, skip gallery
    END;
  END IF;

  -- ---------------------------------------------------------------
  -- EXTRACTION: Colors from description (fallback)
  -- ---------------------------------------------------------------
  IF v_color IS NULL AND v_description IS NOT NULL THEN
    v_match := regexp_match(v_description,
      '\mfinished\s+in\s+([A-Za-z][A-Za-z\s/\-]{2,50}?)(?=\s+(?:over|with|and)\M|[.,;]|$)', 'i');
    IF v_match IS NULL THEN
      v_match := regexp_match(v_description,
        '\mrepainted\s+in\s+([A-Za-z][A-Za-z\s/\-]{2,50}?)(?=\s+(?:over|with|and)\M|[.,;]|$)', 'i');
    END IF;
    IF v_match IS NOT NULL AND length(trim(v_match[1])) BETWEEN 2 AND 60 THEN
      v_color := trim(v_match[1]);
    END IF;
  END IF;

  IF v_interior_color IS NULL AND v_description IS NOT NULL THEN
    v_match := regexp_match(v_description,
      '\mover\s+(?:a\s+)?([A-Za-z][A-Za-z\s/\-]{2,40}?)\s+(?:leather|vinyl|cloth|interior)\M', 'i');
    IF v_match IS NULL THEN
      v_match := regexp_match(v_description,
        '\m([A-Za-z][A-Za-z\s/\-]{2,40}?)\s+(?:leather|vinyl|cloth)\s+interior\M', 'i');
    END IF;
    IF v_match IS NOT NULL AND length(trim(v_match[1])) BETWEEN 2 AND 60 THEN
      v_interior_color := trim(v_match[1]);
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- Step 3: UPDATE with COALESCE fill-only-if-empty
  -- ---------------------------------------------------------------
  BEGIN
    UPDATE vehicles SET
      -- Text columns: fill only if currently NULL or empty string
      listing_title      = COALESCE(NULLIF(listing_title, ''),      v_listing_title),
      bat_listing_title  = COALESCE(NULLIF(bat_listing_title, ''),  v_bat_listing_title),
      description        = COALESCE(NULLIF(description, ''),        v_description),
      vin                = COALESCE(NULLIF(vin, ''),                v_vin),
      color              = COALESCE(NULLIF(color, ''),              v_color),
      interior_color     = COALESCE(NULLIF(interior_color, ''),     v_interior_color),
      transmission       = COALESCE(NULLIF(transmission, ''),       v_transmission),
      drivetrain         = COALESCE(NULLIF(drivetrain, ''),         v_drivetrain),
      engine_size        = COALESCE(NULLIF(engine_size, ''),        v_engine_size),
      location           = COALESCE(NULLIF(location, ''),           v_location),
      bat_seller         = COALESCE(NULLIF(bat_seller, ''),         v_bat_seller),
      bat_lot_number     = COALESCE(NULLIF(bat_lot_number, ''),     v_bat_lot_number),
      reserve_status     = COALESCE(NULLIF(reserve_status, ''),     v_reserve_status),
      body_style         = COALESCE(NULLIF(body_style, ''),         v_body_style),
      primary_image_url  = COALESCE(NULLIF(primary_image_url, ''),  v_primary_image_url),
      auction_end_date   = COALESCE(NULLIF(auction_end_date, ''),   v_auction_end_date),
      -- Integer columns: fill only if currently NULL
      sale_price         = COALESCE(sale_price,     v_sale_price),
      mileage            = COALESCE(mileage,        v_mileage),
      bat_bids           = COALESCE(bat_bids,       v_bat_bids),
      bat_comments       = COALESCE(bat_comments,   v_bat_comments),
      bat_views          = COALESCE(bat_views,       v_bat_views),
      bat_watchers       = COALESCE(bat_watchers,   v_bat_watchers),
      -- Date columns: fill only if currently NULL
      sale_date          = COALESCE(sale_date,      v_sale_date),
      bat_sale_date      = COALESCE(bat_sale_date,  v_sale_date),
      -- Metadata
      updated_at         = now()
    WHERE id = p_vehicle_id;

    -- Count how many fields were actually extracted (non-null)
    v_fields_updated := 0;
    IF v_listing_title     IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_description       IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_vin               IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_color             IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_interior_color    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_transmission      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_drivetrain        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_engine_size       IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_location          IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_seller        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_lot_number    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_reserve_status    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_body_style        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_sale_price        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_mileage           IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_sale_date         IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_bids          IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_comments      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_views         IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_bat_watchers      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
    IF v_primary_image_url IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;

    RETURN v_fields_updated;

  EXCEPTION WHEN unique_violation THEN
    -- VIN collision: retry UPDATE without the VIN field
    BEGIN
      UPDATE vehicles SET
        listing_title      = COALESCE(NULLIF(listing_title, ''),      v_listing_title),
        bat_listing_title  = COALESCE(NULLIF(bat_listing_title, ''),  v_bat_listing_title),
        description        = COALESCE(NULLIF(description, ''),        v_description),
        -- Skip VIN to avoid unique constraint violation
        color              = COALESCE(NULLIF(color, ''),              v_color),
        interior_color     = COALESCE(NULLIF(interior_color, ''),     v_interior_color),
        transmission       = COALESCE(NULLIF(transmission, ''),       v_transmission),
        drivetrain         = COALESCE(NULLIF(drivetrain, ''),         v_drivetrain),
        engine_size        = COALESCE(NULLIF(engine_size, ''),        v_engine_size),
        location           = COALESCE(NULLIF(location, ''),           v_location),
        bat_seller         = COALESCE(NULLIF(bat_seller, ''),         v_bat_seller),
        bat_lot_number     = COALESCE(NULLIF(bat_lot_number, ''),     v_bat_lot_number),
        reserve_status     = COALESCE(NULLIF(reserve_status, ''),     v_reserve_status),
        body_style         = COALESCE(NULLIF(body_style, ''),         v_body_style),
        primary_image_url  = COALESCE(NULLIF(primary_image_url, ''),  v_primary_image_url),
        auction_end_date   = COALESCE(NULLIF(auction_end_date, ''),   v_auction_end_date),
        sale_price         = COALESCE(sale_price,     v_sale_price),
        mileage            = COALESCE(mileage,        v_mileage),
        bat_bids           = COALESCE(bat_bids,       v_bat_bids),
        bat_comments       = COALESCE(bat_comments,   v_bat_comments),
        bat_views          = COALESCE(bat_views,       v_bat_views),
        bat_watchers       = COALESCE(bat_watchers,   v_bat_watchers),
        sale_date          = COALESCE(sale_date,      v_sale_date),
        bat_sale_date      = COALESCE(bat_sale_date,  v_sale_date),
        updated_at         = now()
      WHERE id = p_vehicle_id;

      -- Count without VIN
      v_fields_updated := 0;
      IF v_listing_title     IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_description       IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_color             IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_interior_color    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_transmission      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_drivetrain        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_engine_size       IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_location          IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_seller        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_lot_number    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_reserve_status    IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_body_style        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_sale_price        IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_mileage           IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_sale_date         IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_bids          IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_comments      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_views         IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_bat_watchers      IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;
      IF v_primary_image_url IS NOT NULL THEN v_fields_updated := v_fields_updated + 1; END IF;

      RETURN v_fields_updated;

    EXCEPTION WHEN OTHERS THEN
      RETURN -1;
    END;
  END;
END;
$fn$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION parse_bat_archive_fill(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION parse_bat_archive_fill(UUID) TO authenticated;

COMMENT ON FUNCTION parse_bat_archive_fill(UUID) IS
  'Server-side BaT HTML parser. Reads archived HTML from listing_page_snapshots, '
  'extracts vehicle fields using regexp_match(), and updates the vehicle with '
  'COALESCE fill-only-if-empty pattern. Returns number of fields extracted. '
  'Processes ONE vehicle per call to stay within statement timeout.';
