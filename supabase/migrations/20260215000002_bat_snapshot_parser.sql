-- RPC: Given an array of listing URLs, return matched vehicle IDs + data
-- Used by bat-snapshot-parser edge function for batch URL matching
CREATE OR REPLACE FUNCTION match_vehicles_by_urls(urls text[])
RETURNS TABLE(
  listing_url text,
  vehicle_id uuid,
  vin text,
  mileage integer,
  engine_type text,
  transmission text,
  color text,
  interior_color text,
  sale_price integer,
  origin_metadata jsonb
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (u.url)
    u.url as listing_url,
    v.id as vehicle_id,
    v.vin,
    v.mileage,
    v.engine_type,
    v.transmission,
    v.color,
    v.interior_color,
    v.sale_price,
    v.origin_metadata
  FROM unnest(urls) AS u(url)
  JOIN vehicles v ON (
    v.listing_url = rtrim(u.url, '/')
    OR v.listing_url = u.url
  )
  WHERE v.deleted_at IS NULL
  ORDER BY u.url, v.created_at DESC;
$$;

-- All-SQL BaT snapshot parser — everything stays server-side
-- Parses HTML with regexp, matches to vehicles, updates fields, marks snapshots
-- Skips VIN updates to avoid detect_vehicle_duplicates trigger overhead
CREATE OR REPLACE FUNCTION parse_bat_snapshots_bulk(batch_size int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  snap record;
  v_id uuid;
  v_rec record;
  parsed_count int := 0;
  matched_count int := 0;
  updated_count int := 0;
  fields_count int := 0;
  chassis_raw text;
  chassis_clean text;
  vin_valid boolean;
  mileage_raw text;
  mileage_val int;
  mileage_unit text;
  engine_val text;
  transmission_val text;
  exterior_color_val text;
  interior_val text;
  location_raw text;
  location_city text;
  location_state text;
  location_zip text;
  sale_match text[];
  sale_price_val int;
  sale_date_val text;
  sale_status_val text;
  sale_currency_val text;
  views_val int;
  watchers_val int;
  comment_count_val int;
  no_reserve boolean;
  lot_number_val text;
  party_type_val text;
  item_title_val text;
  details_block text;
  li_text text;
  li_items text[];
  f_count int;
  parsed_data jsonb;
BEGIN
  SET LOCAL statement_timeout = '600s';

  FOR snap IN
    SELECT id, listing_url, html, metadata
    FROM listing_page_snapshots
    WHERE platform = 'bat' AND success = true
      AND (metadata->>'parsed_at') IS NULL
    ORDER BY fetched_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    IF snap.html IS NULL OR length(snap.html) < 100 THEN
      UPDATE listing_page_snapshots SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'parsed_at', now()::text, 'vehicle_matched', false, 'skip_reason', 'no_html'
      ) WHERE id = snap.id;
      CONTINUE;
    END IF;

    parsed_count := parsed_count + 1;
    chassis_raw := NULL; chassis_clean := NULL; vin_valid := false;
    mileage_val := NULL; mileage_unit := NULL;
    engine_val := NULL; transmission_val := NULL;
    exterior_color_val := NULL; interior_val := NULL;
    location_raw := NULL; location_city := NULL; location_state := NULL; location_zip := NULL;
    sale_price_val := NULL; sale_date_val := NULL; sale_status_val := NULL; sale_currency_val := NULL;
    views_val := NULL; watchers_val := NULL; comment_count_val := NULL;
    no_reserve := false; lot_number_val := NULL; party_type_val := NULL; item_title_val := NULL;

    -- CHASSIS/VIN
    chassis_raw := (regexp_match(snap.html, 'Chassis:?\s*(?:<[^>]*>)*\s*([A-Za-z0-9*-]+(?:\s[A-Za-z0-9*-]+)*)', 'i'))[1];
    IF chassis_raw IS NOT NULL THEN
      chassis_clean := upper(regexp_replace(trim(chassis_raw), '\s+', '', 'g'));
      vin_valid := chassis_clean ~ '^[A-HJ-NPR-Z0-9]{17}$';
    END IF;

    -- LISTING DETAILS <li> items
    details_block := (regexp_match(snap.html, 'Listing Details</strong>\s*<ul>(.*?)</ul>', 's'))[1];
    IF details_block IS NOT NULL THEN
      FOR li_text IN
        SELECT regexp_replace(m[1], '<[^>]+>', '', 'g')
        FROM regexp_matches(details_block, '<li>(.*?)</li>', 'gs') AS m
      LOOP
        li_text := trim(li_text);
        IF li_text ~* '^Chassis:' AND chassis_clean IS NULL THEN
          chassis_clean := upper(regexp_replace(regexp_replace(li_text, 'Chassis:\s*', '', 'i'), '\s+', '', 'g'));
          vin_valid := chassis_clean ~ '^[A-HJ-NPR-Z0-9]{17}$';
          CONTINUE;
        END IF;
        IF mileage_val IS NULL AND li_text ~* '[\d,]+k?\s*(Miles?\s*(?:Shown|Indicated)?|Kilometers?|TMU)' THEN
          mileage_raw := NULLIF((regexp_match(li_text, '([\d,]+)k?\s*(Miles?|Kilometers?|TMU)', 'i'))[1], '');
          IF mileage_raw IS NOT NULL THEN
            BEGIN
              mileage_val := replace(mileage_raw, ',', '')::int;
              IF li_text ~* 'kilometer' THEN mileage_unit := 'kilometers'; mileage_val := round(mileage_val * 0.621371)::int;
              ELSIF li_text ~* 'tmu' THEN mileage_unit := 'TMU';
              ELSE mileage_unit := 'miles'; END IF;
            EXCEPTION WHEN OTHERS THEN mileage_val := NULL; END;
          END IF;
          CONTINUE;
        END IF;
        IF exterior_color_val IS NULL AND li_text ~* 'exterior' THEN
          exterior_color_val := trim(regexp_replace(li_text, 'exterior', '', 'i')); CONTINUE;
        END IF;
        IF interior_val IS NULL AND li_text ~* '(interior|upholster)' THEN interior_val := li_text; CONTINUE; END IF;
        IF interior_val IS NULL AND li_text ~* '(leather|cloth|alcantara|vinyl|suede)\s' AND li_text !~* '(liter|ci|cc|V\d)' THEN
          interior_val := li_text; CONTINUE;
        END IF;
        IF engine_val IS NULL AND li_text ~* '(\d+[\.\d]*[-\s]*(liter|L\y)|\d+ci\y|\d+cc\y|(inline|flat|V)[-\s]*\d|turbo|supercharg)' THEN
          engine_val := li_text; CONTINUE;
        END IF;
        IF transmission_val IS NULL AND li_text ~* '(manual|automatic|speed|CVT|DCT|PDK|tiptronic|sequential|gearbox|transmission)' THEN
          transmission_val := li_text; CONTINUE;
        END IF;
        IF li_text ~* 'no reserve' THEN no_reserve := true; CONTINUE; END IF;
      END LOOP;
    END IF;

    -- LOCATION
    location_raw := (regexp_match(snap.html, 'Location:\s*<a[^>]*>([^<]+)</a>', 'i'))[1];
    IF location_raw IS NOT NULL THEN
      location_raw := trim(location_raw);
      location_city := (regexp_match(location_raw, '^(.+?),\s*(\w[\w\s]*?)\s*(\d{5})?$'))[1];
      location_state := (regexp_match(location_raw, '^(.+?),\s*(\w[\w\s]*?)\s*(\d{5})?$'))[2];
      location_zip := (regexp_match(location_raw, '^(.+?),\s*(\w[\w\s]*?)\s*(\d{5})?$'))[3];
    END IF;

    party_type_val := regexp_replace((regexp_match(snap.html, 'Private Party or Dealer:\s*(.*?)(?:<|$)', 'i'))[1], '<[^>]+>', '', 'g');
    IF party_type_val IS NOT NULL THEN party_type_val := trim(party_type_val); END IF;
    lot_number_val := (regexp_match(snap.html, 'Lot</strong>\s*#?(\d+)', 'i'))[1];

    BEGIN views_val := NULLIF(replace(COALESCE((regexp_match(snap.html, 'data-stats-item="views"[^>]*>([\d,]+)\s*views', 'i'))[1], ''), ',', ''), '')::int;
    EXCEPTION WHEN OTHERS THEN views_val := NULL; END;
    BEGIN watchers_val := NULLIF(replace(COALESCE((regexp_match(snap.html, 'data-stats-item="watchers"[^>]*>([\d,]+)\s*watchers', 'i'))[1], ''), ',', ''), '')::int;
    EXCEPTION WHEN OTHERS THEN watchers_val := NULL; END;
    BEGIN comment_count_val := NULLIF(COALESCE((regexp_match(snap.html, 'comments_header_html[^>]*>.*?class="info-value"[^>]*>(\d+)', 's'))[1], ''), '')::int;
    EXCEPTION WHEN OTHERS THEN comment_count_val := NULL; END;

    BEGIN
      sale_match := regexp_match(snap.html, 'Sold\s+for\s+<strong>(\w+)\s*\$?([\d,]+)</strong>\s*<span[^>]*>on\s+(\d+/\d+/\d+)', 'i');
      IF sale_match IS NOT NULL THEN
        sale_currency_val := sale_match[1]; sale_price_val := NULLIF(replace(sale_match[2], ',', ''), '')::int;
        sale_date_val := sale_match[3]; sale_status_val := 'sold';
      ELSE
        sale_match := regexp_match(snap.html, 'Bid\s+to\s+<strong>(\w+)\s*\$?([\d,]+)</strong>\s*<span[^>]*>on\s+(\d+/\d+/\d+)', 'i');
        IF sale_match IS NOT NULL THEN
          sale_currency_val := sale_match[1]; sale_price_val := NULLIF(replace(sale_match[2], ',', ''), '')::int;
          sale_date_val := sale_match[3]; sale_status_val := 'bid_to';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN sale_price_val := NULL; END;

    IF snap.html ~* 'status-unsold|Reserve Not Met' AND sale_status_val IS NULL THEN sale_status_val := 'unsold'; END IF;
    item_title_val := (regexp_match(snap.html, 'data-item-title="([^"]+)"'))[1];

    parsed_data := jsonb_build_object(
      'chassis', chassis_clean, 'vin_valid', vin_valid,
      'mileage', mileage_val, 'mileage_unit', mileage_unit,
      'engine', engine_val, 'transmission', transmission_val,
      'exterior_color', exterior_color_val, 'interior', interior_val,
      'location', location_raw, 'location_city', location_city,
      'location_state', location_state, 'location_zip', location_zip,
      'party_type', party_type_val, 'lot_number', lot_number_val,
      'views', views_val, 'watchers', watchers_val, 'comment_count', comment_count_val,
      'sale_price', sale_price_val, 'sale_currency', sale_currency_val,
      'sale_date', sale_date_val, 'sale_status', sale_status_val,
      'no_reserve', no_reserve, 'item_title', item_title_val,
      'parsed_at', now()::text, 'snapshot_id', snap.id::text
    );

    -- MATCH TO VEHICLE
    SELECT id, vin, mileage, engine_type, transmission, color, interior_color, sale_price
    INTO v_rec FROM vehicles
    WHERE listing_url = rtrim(snap.listing_url, '/') AND deleted_at IS NULL LIMIT 1;
    IF v_rec.id IS NULL THEN
      SELECT id, vin, mileage, engine_type, transmission, color, interior_color, sale_price
      INTO v_rec FROM vehicles
      WHERE listing_url = snap.listing_url AND deleted_at IS NULL LIMIT 1;
    END IF;
    v_id := v_rec.id;

    IF v_id IS NOT NULL THEN
      matched_count := matched_count + 1;
      f_count := 0;
      -- Single UPDATE — skip VIN to avoid detect_vehicle_duplicates trigger
      UPDATE vehicles SET
        mileage = CASE WHEN mileage_val IS NOT NULL AND v_rec.mileage IS NULL THEN mileage_val ELSE vehicles.mileage END,
        engine_type = CASE WHEN engine_val IS NOT NULL AND v_rec.engine_type IS NULL THEN engine_val ELSE vehicles.engine_type END,
        transmission = CASE WHEN transmission_val IS NOT NULL AND v_rec.transmission IS NULL THEN transmission_val ELSE vehicles.transmission END,
        color = CASE WHEN exterior_color_val IS NOT NULL AND v_rec.color IS NULL THEN exterior_color_val ELSE vehicles.color END,
        interior_color = CASE WHEN interior_val IS NOT NULL AND v_rec.interior_color IS NULL THEN interior_val ELSE vehicles.interior_color END,
        sale_price = CASE WHEN sale_price_val IS NOT NULL AND sale_status_val = 'sold' AND v_rec.sale_price IS NULL THEN sale_price_val ELSE vehicles.sale_price END,
        origin_metadata = COALESCE(vehicles.origin_metadata, '{}'::jsonb) || jsonb_build_object('bat_snapshot_parsed', parsed_data)
      WHERE id = v_id;
      IF mileage_val IS NOT NULL AND v_rec.mileage IS NULL THEN f_count := f_count + 1; END IF;
      IF engine_val IS NOT NULL AND v_rec.engine_type IS NULL THEN f_count := f_count + 1; END IF;
      IF transmission_val IS NOT NULL AND v_rec.transmission IS NULL THEN f_count := f_count + 1; END IF;
      IF exterior_color_val IS NOT NULL AND v_rec.color IS NULL THEN f_count := f_count + 1; END IF;
      IF interior_val IS NOT NULL AND v_rec.interior_color IS NULL THEN f_count := f_count + 1; END IF;
      IF sale_price_val IS NOT NULL AND sale_status_val = 'sold' AND v_rec.sale_price IS NULL THEN f_count := f_count + 1; END IF;
      IF f_count > 0 THEN updated_count := updated_count + 1; fields_count := fields_count + f_count; END IF;
    END IF;

    -- Mark snapshot as parsed
    UPDATE listing_page_snapshots SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'parsed_at', now()::text, 'chassis', chassis_clean, 'vin_valid', vin_valid,
      'vehicle_matched', v_id IS NOT NULL,
      'vehicle_id', CASE WHEN v_id IS NOT NULL THEN v_id::text ELSE NULL END
    ) WHERE id = snap.id;
  END LOOP;

  RETURN jsonb_build_object('parsed', parsed_count, 'matched', matched_count, 'updated', updated_count, 'fields_enriched', fields_count);
END;
$$;

-- Cron: parse BaT snapshots every minute (300/batch, all server-side SQL)
SELECT cron.schedule(
  'bat-snapshot-parser-continuous',
  '* * * * *',
  $$ SELECT parse_bat_snapshots_bulk(300); $$
);

-- Second parallel job offset by 30s
SELECT cron.schedule(
  'bat-snapshot-parser-continuous-2',
  '* * * * *',
  $$ SELECT pg_sleep(30); SELECT parse_bat_snapshots_bulk(300); $$
);
