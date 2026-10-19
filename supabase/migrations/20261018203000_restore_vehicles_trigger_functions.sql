-- Restore seven public.vehicles trigger functions to their pre-2026-10-17 bodies.
--
-- During the Cars & Bids backfill (2026-10-17 23:50Z to 2026-10-18 01:16Z) these were replaced by hand on
-- prod with "fast path" and skip-flag variants. Two of the changes broke or bypassed writes:
--   * auto_collect_field_evidence() wrote field_evidence columns that do not exist, so from 23:54:40Z to
--     01:36Z every vehicles UPDATE that changed vin/year/make/model/drivetrain/transmission/engine_type/
--     series/trim failed with 42703. It was restored by hand at 01:36Z; this file records that body.
--   * trigger_update_vehicle_status() and mark_comp_estimates_stale() returned early whenever
--     app.skip_completion_enqueue = '1', which the derived-queue drains set on every writeback.
-- The other four (search vector, canonical taxonomy, canonical columns, visibility lock) got short-circuits
-- that were not exact equivalents (the canonical-columns one dropped the URL-derived mecum platform check).
-- Every body below is the definition prod ran before 2026-10-17 23:50Z.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.auto_collect_field_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_field TEXT;
  v_new_value TEXT;
  v_source TEXT := 'system_update';
BEGIN
  -- For each changed field, create evidence
  IF TG_OP = 'UPDATE' THEN
    -- Check common fields
    FOR v_field IN SELECT unnest(ARRAY['vin', 'year', 'make', 'model', 'drivetrain', 'transmission', 'engine_type', 'series', 'trim']) LOOP
      v_new_value := (to_jsonb(NEW) ->> v_field);

      IF (to_jsonb(OLD) ->> v_field) IS DISTINCT FROM v_new_value AND v_new_value IS NOT NULL THEN
        -- Create evidence record
        INSERT INTO field_evidence (
          vehicle_id,
          field_name,
          proposed_value,
          source_type,
          source_confidence,
          status,
          assigned_by
        ) VALUES (
          NEW.id,
          v_field,
          v_new_value,
          v_source,
          60, -- Medium confidence for system updates
          'accepted',
          'system_trigger'
        )
        ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;

        -- Update provenance
        INSERT INTO vehicle_field_provenance (
          vehicle_id,
          field_name,
          current_value,
          total_confidence,
          primary_source,
          updated_at
        ) VALUES (
          NEW.id,
          v_field,
          v_new_value,
          60,
          v_source,
          NOW()
        )
        ON CONFLICT (vehicle_id, field_name)
        DO UPDATE SET
          current_value = EXCLUDED.current_value,
          total_confidence = EXCLUDED.total_confidence,
          primary_source = EXCLUDED.primary_source,
          updated_at = NOW();
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_vehicle_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Try to recalculate data completeness, but don't fail if function missing
    BEGIN
        PERFORM public.calculate_vehicle_data_completeness(NEW.id);
    EXCEPTION WHEN undefined_function THEN
        -- Function doesn't exist, skip
        NULL;
    END;

    -- Update last activity
    INSERT INTO public.vehicle_status_metadata (vehicle_id, last_activity_at, updated_at)
    VALUES (NEW.id, NOW(), NOW())
    ON CONFLICT (vehicle_id)
    DO UPDATE SET
        last_activity_at = NOW(),
        updated_at = NOW();

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_comp_estimates_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Bulk sale corrections mark estimates stale once, at the end of the pass (see
  -- correct_vehicle_sale_provenance_batch). Per-row fan-out here would be 500 writes/vehicle.
  IF current_setting('nuke.bulk_sale_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Only fire if a price field actually changed
  IF (
    COALESCE(NEW.sale_price, 0) != COALESCE(OLD.sale_price, 0) OR
    COALESCE(NEW.winning_bid, 0) != COALESCE(OLD.winning_bid, 0) OR
    COALESCE(NEW.asking_price, 0) != COALESCE(OLD.asking_price, 0)
  ) AND NEW.make IS NOT NULL AND NEW.year IS NOT NULL THEN
    -- Mark estimates stale for vehicles with same make and similar year range
    -- Limit to 500 to prevent runaway updates
    UPDATE nuke_estimates
    SET is_stale = true
    WHERE is_stale = false
      AND vehicle_id IN (
        SELECT v.id
        FROM vehicles v
        WHERE v.make = NEW.make
          AND v.year BETWEEN NEW.year - 5 AND NEW.year + 5
          AND v.id != NEW.id
        LIMIT 500
      );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicles_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector :=
    -- Weight A (highest): Primary identifiers
    setweight(to_tsvector('english', coalesce(NEW.year::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.make, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.model, '')), 'A') ||
    -- Weight B (high): Descriptive
    setweight(to_tsvector('english', coalesce(NEW.color, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    -- Weight C (medium): Additional context
    setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.modification_details, '')), 'C') ||
    -- VIN uses simple config (no stemming for alphanumeric)
    setweight(to_tsvector('simple', coalesce(NEW.vin, '')), 'A');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_vehicle_canonical_taxonomy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb;
BEGIN
 r:=public.derive_vehicle_taxonomy(NEW.vin,NEW.body_style);
 NEW.canonical_body_style:=r->>'canonical_body_style';
 NEW.canonical_vehicle_type:=r->>'canonical_vehicle_type';
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_vehicle_visibility_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hits jsonb;
BEGIN
  IF (OLD.provenance_metadata ? 'visibility_locked_by_correction')
     AND NEW.is_public IS DISTINCT FROM OLD.is_public
     AND current_setting('app.writer', true) IS DISTINCT FROM 'set_vehicle_visibility' THEN
    NEW.is_public := OLD.is_public;
    v_hits := CASE WHEN jsonb_typeof(NEW.provenance_metadata -> 'visibility_lock_hits') = 'array'
                   THEN NEW.provenance_metadata -> 'visibility_lock_hits' ELSE '[]'::jsonb END;
    IF jsonb_array_length(v_hits) >= 20 THEN v_hits := v_hits - 0; END IF;
    NEW.provenance_metadata := coalesce(NEW.provenance_metadata, '{}'::jsonb) || jsonb_build_object('visibility_lock_hits',
      v_hits || jsonb_build_object('at', now(), 'app_writer', nullif(current_setting('app.writer', true), ''),
                                   'db_role', current_user::text));
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.trg_resolve_canonical_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  raw_source TEXT;
  best_price NUMERIC;
  price_type TEXT;
  sale_basis TEXT;
BEGIN
  -- 1. canonical_platform: resolve from first non-null source column
  raw_source := COALESCE(NEW.source, NEW.listing_source, NEW.discovery_source, NEW.auction_source);
  IF raw_source IS NOT NULL THEN
    NEW.canonical_platform := resolve_platform_slug(raw_source);
  ELSE
    NEW.canonical_platform := 'unknown';
  END IF;

  -- 2. canonical_outcome: a consummated sale is a STATUS, or (pre-2026-09-27 rows only) the
  --    platform's own sale marker. A price alone is a bid, an ask or an estimate
  --    (2026-09-27: 30,612 unsold BaT lots, 4,612 Mecum bid-goes-on lots, 6,155 Cars & Bids
  --    reserve-not-met lots and 82 RM Sotheby's low estimates were all sitting in sale_price).
  sale_basis := vehicle_sale_basis(NEW.sale_status, NEW.auction_outcome, NEW.canonical_platform,
                                   NEW.listing_url, NEW.discovery_url, NEW.sale_price::numeric,
                                   NEW.notes, NEW.import_metadata, NEW.created_at);
  IF sale_basis IS NOT NULL THEN
    NEW.canonical_outcome := 'sold';
  ELSIF NEW.sale_status IN ('not_sold', 'unsold', 'bid_to') OR NEW.reserve_status = 'reserve_not_met'
        OR NEW.auction_outcome IN ('reserve_not_met', 'no_sale') THEN
    NEW.canonical_outcome := 'reserve_not_met';
  ELSIF NEW.sale_status IN ('auction_live', 'upcoming') THEN
    NEW.canonical_outcome := 'active';
  ELSIF NEW.sale_status = 'for_sale' OR (COALESCE(NEW.asking_price, 0) > 0 AND COALESCE(NEW.sale_status, 'available') NOT IN ('ended')) THEN
    NEW.canonical_outcome := 'for_sale';
  ELSIF NEW.sale_status = 'ended' THEN
    NEW.canonical_outcome := 'ended';
  ELSIF NEW.sale_status = 'available' AND (COALESCE(NEW.high_bid, 0) > 0 OR COALESCE(NEW.winning_bid, 0) > 0) THEN
    -- Has bids but no sale price → auction ended without clear outcome
    NEW.canonical_outcome := 'ended';
  ELSE
    NEW.canonical_outcome := 'unknown';
  END IF;

  -- 3. canonical_sold_price: context-aware price resolution
  CASE NEW.canonical_outcome
    WHEN 'sold' THEN
      -- Transaction price priority: sale_price > winning_bid > bat_sold_price > sold_price > high_bid > price
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'for_sale' THEN
      -- Asking price priority
      best_price := COALESCE(
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'reserve_not_met' THEN
      -- Highest bid reached
      best_price := COALESCE(
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    ELSE
      -- Best available
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
  END CASE;

  NEW.canonical_sold_price := best_price;

  RETURN NEW;
END;
$function$;
