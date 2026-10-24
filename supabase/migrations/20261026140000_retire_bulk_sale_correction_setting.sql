-- Retire the session-settable nuke.bulk_sale_correction GUC: any role could set_config it and switch off the sale
-- guards. Every reader now asks sale_correction_context_ok(vehicle), a cited context row (txid, vehicle, run id,
-- source ref) that only SECURITY DEFINER writers can register. Caller audit 2026-10-24 (live pg_proc + repo):
--   setters: correct_vehicle_sale_provenance_batch, merge_into_primary_batch (both now register context instead);
--   readers: vehicles_guard_sale_fields, enforce_vehicle_sale_date_retraction, guard_vehicle_sale_price,
--            mark_comp_estimates_stale (all switched); no edge function or script sets the GUC.
--   correction callers: correct_vehicle_sale_provenance, sync_vehicle_sale_price_from_verified_event,
--            project_bat_result_to_vehicle, record_vehicle_event_no_sale -> run id from source.run_id / row run_id /
--            p_reason / row reason (each carries at least one) + source.ref (already required).
--   supabase/sql test fixtures carry their own historical copies (\ir old migrations); unaffected.
set lock_timeout = '5s';

create or replace function public.sale_correction_context_ok(p_vehicle uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from sale_correction_context c
                  where c.txid = txid_current() and c.vehicle_id = p_vehicle
                    and nullif(c.run_id, '') is not null and nullif(c.source_ref, '') is not null)
$$;

-- merge_into_primary_batch is not SECURITY DEFINER; it registers through this, which only service_role/owner may run
create or replace function public.register_sale_correction_context(p_vehicle uuid, p_run_id text, p_source_ref text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(p_run_id, '') is null or nullif(p_source_ref, '') is null then
    raise exception 'register_sale_correction_context: run id and source ref are both required (vehicle %)', p_vehicle;
  end if;
  insert into sale_correction_context (txid, vehicle_id, run_id, source_ref) values (txid_current(), p_vehicle, p_run_id, p_source_ref);
end $$;
revoke all on function public.register_sale_correction_context(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_sale_correction_context(uuid, text, text) to service_role;

create or replace function public.vehicles_guard_sale_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.sale_price is not null and new.sale_price is null then
    if sale_correction_context_ok(new.id) then
      if new.sale_price_usd is not null and coalesce(new.sale_price_currency, 'USD') <> 'USD' then
        raise exception 'sale correction may not null sale_price while keeping sale_price_usd (vehicle %)', new.id
          using errcode = '23514';
      end if;
      return new;
    end if;
    new.sale_price := old.sale_price;
    new.sale_date := old.sale_date;
    new.sale_status := old.sale_status;
  end if;
  return new;
end $$;


CREATE OR REPLACE FUNCTION public.enforce_vehicle_sale_date_retraction()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_day     text := to_char(NEW.sale_date, 'YYYY-MM-DD');
  v_entries jsonb := OLD.provenance_metadata -> 'sale_provenance_corrections';
  v_written jsonb;
  v_lock_at bigint;
  v_lift_at bigint;
  v_meta    jsonb;
  v_hits    jsonb;
BEGIN
  IF v_day IS NULL OR jsonb_typeof(v_entries) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  -- Position of the latest write-clock retraction of this day, and of the latest entry that set this day.
  SELECT max(t.i) FILTER (
           WHERE t.e -> 'corrected' = 'null'::jsonb
             AND left(t.e ->> 'original', 10) = v_day
             AND concat_ws(' ', t.e -> 'source' ->> 'basis', t.e -> 'source' ->> 'type',
                                t.e -> 'source' ->> 'finding', t.e ->> 'reason')
                 ~* 'write[ _-]?(clock|time)|ingest[ _-]?stamp'),
         max(t.i) FILTER (WHERE left(t.e ->> 'corrected', 10) = v_day)
    INTO v_lock_at, v_lift_at
  FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(e, i)
  WHERE t.e ->> 'field' = 'sale_date';

  IF v_lock_at IS NULL OR v_lock_at < coalesce(v_lift_at, 0) THEN
    RETURN NEW;
  END IF;

  -- The sanctioned writer re-asserting this day passes: it runs under its transaction-local flag and appends its own
  -- cited audit entry for this day in the same row write.
  IF sale_correction_context_ok(NEW.id) THEN
    v_written := NEW.provenance_metadata -> 'sale_provenance_corrections';
    IF jsonb_typeof(v_written) = 'array' AND jsonb_array_length(v_written) > jsonb_array_length(v_entries) THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_written) WITH ORDINALITY AS w(e, i)
                 WHERE w.i > jsonb_array_length(v_entries)
                   AND w.e ->> 'field' = 'sale_date'
                   AND left(w.e ->> 'corrected', 10) = v_day) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Refused: the column keeps its value, the attempt is recorded, the rest of the row lands.
  NEW.sale_date := OLD.sale_date;
  v_meta := CASE WHEN jsonb_typeof(NEW.provenance_metadata) = 'object' THEN NEW.provenance_metadata
                 ELSE OLD.provenance_metadata END;
  IF NOT (v_meta ? 'sale_provenance_corrections') THEN
    v_meta := v_meta || jsonb_build_object('sale_provenance_corrections', v_entries);
  END IF;
  v_hits := CASE WHEN jsonb_typeof(v_meta -> 'sale_date_lock_hits') = 'array'
                 THEN v_meta -> 'sale_date_lock_hits' ELSE '[]'::jsonb END;
  WHILE jsonb_array_length(v_hits) >= 20 LOOP
    v_hits := v_hits - 0;
  END LOOP;
  NEW.provenance_metadata := v_meta || jsonb_build_object('sale_date_lock_hits', v_hits || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'blocked_day', v_day,
      'kept', OLD.sale_date,
      'retraction_asserted_by', v_entries -> (v_lock_at::int - 1) ->> 'asserted_by',
      'app_writer', nullif(current_setting('app.writer', true), ''),
      'db_role', current_user::text,
      'session_role', session_user::text,
      'trigger_depth', pg_trigger_depth())));
  RETURN NEW;
END
$function$
;


CREATE OR REPLACE FUNCTION public.guard_vehicle_sale_price()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- A NULL or non-positive sale_price claims nothing.
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN
    RETURN NEW;
  END IF;

  -- A status says money moved (the 'status' basis in vehicle_sale_basis()).
  IF NEW.sale_status = 'sold' OR NEW.auction_outcome = 'sold' THEN
    RETURN NEW;
  END IF;

  -- The correction chokepoint runs under this transaction-local flag (see 20260927020100).
  IF sale_correction_context_ok(NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Legacy rows (247,954 priced-without-status on 2026-09-27): every other column stays writable;
  -- the price itself may only change with a status, or through the chokepoint.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE    = 'check_violation',
    CONSTRAINT = 'vehicles_sale_price_requires_sold_status',
    TABLE      = 'vehicles',
    COLUMN     = 'sale_price',
    MESSAGE    = format('vehicles.sale_price = %s refused for %s: no sold status (sale_status = %L, auction_outcome = %L)',
                        NEW.sale_price, NEW.id, NEW.sale_status, NEW.auction_outcome),
    DETAIL     = 'A price alone is a bid, an ask or an estimate, never a sale (vehicle_sale_basis, 2026-09-27).',
    HINT       = 'Write a quote to asking_price and a bid to high_bid / winning_bid. Write a sale with sale_status = ''sold'' or auction_outcome = ''sold'' in the same statement. Supersede a wrong sale value through correct_vehicle_sale_provenance_batch(), never by overwriting it.';
END;
$function$
;


CREATE OR REPLACE FUNCTION public.mark_comp_estimates_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Bulk sale corrections mark estimates stale once, at the end of the pass (see
  -- correct_vehicle_sale_provenance_batch). Per-row fan-out here would be 500 writes/vehicle.
  IF sale_correction_context_ok(NEW.id) THEN
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
$function$
;


CREATE OR REPLACE FUNCTION public.merge_into_primary_batch(primary_ids uuid[], dup_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_pairs INT := 0;
  n_images INT := 0;
  n_obs INT := 0;
  n_obs_superseded INT := 0;
  n_auction_events INT := 0;
  n_comments INT := 0;
  n_obs_disc INT := 0;
  n_vehicle_events INT := 0;
  n_timeline INT := 0;
  n_vin_conflicts INT := 0;
  n_identity_filled INT := 0;
  n_vins_carried INT := 0;
  v_dups uuid[];
  v_primaries uuid[];
  v_pair record;
  n_carried INT := 0;
BEGIN
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  PERFORM set_config('app.skip_image_count_trigger', '1', true);

  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_pairs (
    primary_id uuid NOT NULL,
    dup_id uuid NOT NULL PRIMARY KEY,
    pre_status text,
    proposal_id uuid,
    vin_conflict boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  TRUNCATE _batch_merge_pairs;
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_superseded (dup_id uuid NOT NULL, id uuid NOT NULL, by_id uuid NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_superseded;
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_before (id uuid PRIMARY KEY, f jsonb NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_before;
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_carry (dup_id uuid PRIMARY KEY, carry jsonb NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_carry;

  -- Filter valid pairs + enforce Gate 2 + SKIP LOCKED so concurrent maintenance jobs never block us.
  -- Owned = user_id, owner_id or uploaded_by set, or an active owner / co_owner permission (see merge_into_primary).
  WITH locked_p AS (
    SELECT id, status, user_id, owner_id, uploaded_by, vin, year
    FROM vehicles
    WHERE id = ANY(primary_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  ),
  locked_d AS (
    SELECT id, status, user_id, owner_id, uploaded_by, vin, year
    FROM vehicles
    WHERE id = ANY(dup_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  )
  INSERT INTO _batch_merge_pairs (primary_id, dup_id, pre_status, vin_conflict)
  SELECT DISTINCT ON (t.d) t.p, t.d, vd.status,
         nullif(upper(btrim(vp.vin)), '') IS NOT NULL AND nullif(upper(btrim(vd.vin)), '') IS NOT NULL
           AND upper(btrim(vp.vin)) <> upper(btrim(vd.vin))
           -- 2026-10-23: a shared listing URL does not make a 1963 TR3B and a 1969 T120R one vehicle; model years
           -- more than 1 apart are two vehicles (measured: 184 of 37,856 URL merges did this). Skipped like a VIN conflict.
           OR (vp.year IS NOT NULL AND vd.year IS NOT NULL AND abs(vp.year - vd.year) > 1)
  FROM unnest(primary_ids, dup_ids) AS t(p, d)
  JOIN locked_p vp ON vp.id = t.p
  JOIN locked_d vd ON vd.id = t.d
  WHERE t.p <> t.d
    -- Two different owners are two vehicles' owners: never merged here (an owner column set on both rows and different).
    AND NOT ((vp.user_id IS NOT NULL AND vd.user_id IS NOT NULL AND vp.user_id <> vd.user_id)
          OR (vp.owner_id IS NOT NULL AND vd.owner_id IS NOT NULL AND vp.owner_id <> vd.owner_id))
    AND (
      (vp.user_id IS NULL AND vp.owner_id IS NULL AND vp.uploaded_by IS NULL
       AND vd.user_id IS NULL AND vd.owner_id IS NULL AND vd.uploaded_by IS NULL
       AND NOT EXISTS (SELECT 1 FROM vehicle_user_permissions x
                        WHERE x.vehicle_id IN (t.p, t.d) AND x.is_active AND x.role IN ('owner', 'co_owner')))
      OR EXISTS (
        SELECT 1 FROM vehicle_merge_proposals vmp
        WHERE ((vmp.primary_vehicle_id = t.p AND vmp.duplicate_vehicle_id = t.d)
            OR (vmp.primary_vehicle_id = t.d AND vmp.duplicate_vehicle_id = t.p))
          AND vmp.status = 'approved' AND vmp.reviewed_by IS NOT NULL
      )
    );

  -- Two different VINs are two vehicles, whatever URL they share: never merged here.
  DELETE FROM _batch_merge_pairs WHERE vin_conflict;
  GET DIAGNOSTICS n_vin_conflicts = ROW_COUNT;
  SELECT count(*) INTO n_pairs FROM _batch_merge_pairs;
  IF n_pairs = 0 THEN
    RETURN jsonb_build_object('merged_count', 0, 'merged_dup_ids', '[]'::jsonb, 'vin_conflicts_skipped', n_vin_conflicts);
  END IF;

  -- cited context for each survivor: this merge run, sourced to the duplicate row it absorbs (replaces the GUC)
  PERFORM register_sale_correction_context(primary_id, 'merge_into_primary_batch/' || txid_current(), 'vehicles/' || dup_id)
    FROM _batch_merge_pairs;

  SELECT array_agg(dup_id), array_agg(DISTINCT primary_id)
    INTO v_dups, v_primaries
    FROM _batch_merge_pairs;

  -- Upsert vehicle_merge_proposals for all pairs
  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id, duplicate_vehicle_id,
    match_type, confidence_score, status, detected_by, detected_at, merged_at, pre_merge_dup_status
  )
  SELECT primary_id, dup_id, 'exact_listing_url', 100, 'merged', 'dedup-worker', NOW(), NOW(), pre_status
  FROM _batch_merge_pairs
  ON CONFLICT (primary_vehicle_id, duplicate_vehicle_id) DO UPDATE
    SET status = 'merged', merged_at = NOW(), pre_merge_dup_status = EXCLUDED.pre_merge_dup_status;

  -- 1. vehicle_images: move non-conflicting images; clear is_primary if primary already has a primary image
  UPDATE vehicle_images d
     SET vehicle_id = bmp.primary_id,
         merged_from_vehicle_id = bmp.dup_id,
         is_primary = CASE
           WHEN d.is_primary = true AND EXISTS (
             SELECT 1 FROM vehicle_images p
             WHERE p.vehicle_id = bmp.primary_id AND p.is_primary = true
               AND COALESCE(p.is_document, false) = false AND COALESCE(p.is_duplicate, false) = false
           ) THEN false
           ELSE d.is_primary
         END
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups)
     AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false
       AND EXISTS (
         SELECT 1 FROM vehicle_images p
         WHERE p.vehicle_id = bmp.primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false
       )
     )
     -- A photo with no file_hash is still the same photo when the survivor already holds its source image_url (a re-posted
     -- listing re-uses its photos), or when a sibling duplicate in this batch with a smaller id carries it: it stays on the
     -- duplicate, kept, like a file_hash collision (2026-10-20: five Craigslist re-posts of one car would otherwise leave
     -- the survivor with five copies of each of its 20 photos).
     AND NOT (
       d.file_hash IS NULL AND COALESCE(d.image_url, '') <> '' AND COALESCE(d.is_superseded, false) = false
       AND (
         EXISTS (
           SELECT 1 FROM vehicle_images p
           WHERE p.vehicle_id = bmp.primary_id AND p.image_url = d.image_url AND COALESCE(p.is_superseded, false) = false
         )
         OR EXISTS (
           SELECT 1 FROM _batch_merge_pairs b2
           JOIN vehicle_images d2 ON d2.vehicle_id = b2.dup_id
           WHERE b2.primary_id = bmp.primary_id AND b2.dup_id <> bmp.dup_id
             AND d2.image_url = d.image_url AND d2.file_hash IS NULL AND COALESCE(d2.is_superseded, false) = false
             AND d2.id < d.id
         )
       )
     );
  GET DIAGNOSTICS n_images = ROW_COUNT;

  -- 2. vehicle_observations: supersede duplicate observations sharing (source_id, source_identifier, kind) with primary, then move all
  WITH hits AS (
    SELECT d.id, bmp.dup_id,
           (SELECT p.id FROM vehicle_observations p
             WHERE p.vehicle_id = bmp.primary_id AND p.source_id = d.source_id
               AND p.source_identifier = d.source_identifier AND p.kind = d.kind
             ORDER BY p.observed_at DESC NULLS LAST, p.id LIMIT 1) AS by_id
    FROM vehicle_observations d
    JOIN _batch_merge_pairs bmp ON bmp.dup_id = d.vehicle_id
    WHERE d.vehicle_id = ANY(v_dups) AND d.is_superseded IS NOT TRUE
  ), sup AS (
    UPDATE vehicle_observations o
       SET is_superseded = true, superseded_by = h.by_id, superseded_at = now()
      FROM hits h
     WHERE o.id = h.id AND h.by_id IS NOT NULL
    RETURNING h.dup_id, o.id, h.by_id
  )
  INSERT INTO _batch_merge_superseded (dup_id, id, by_id) SELECT dup_id, id, by_id FROM sup;
  GET DIAGNOSTICS n_obs_superseded = ROW_COUNT;

  UPDATE vehicle_observations d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND d.source_vin IS NULL
     AND d.source_vin_taxonomy_revision_id IS NULL
     AND d.extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
     AND d.source_vehicle_event_id IS NULL
     AND d.source_observation_id IS NULL
     AND d.source_comment_id IS NULL
     AND d.source_snapshot_id IS NULL;
  GET DIAGNOSTICS n_obs = ROW_COUNT;

  -- 3. auction_events
  UPDATE auction_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.source_url IS NOT NULL
       AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_url = d.source_url)
     );
  GET DIAGNOSTICS n_auction_events = ROW_COUNT;

  -- 4. auction_comments
  UPDATE auction_comments d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.content_hash IS NOT NULL
       AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = bmp.primary_id AND p.content_hash = d.content_hash)
     );
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  -- 5. observation_discoveries
  UPDATE observation_discoveries d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id;
  GET DIAGNOSTICS n_obs_disc = ROW_COUNT;

  -- 6. vehicle_events
  UPDATE vehicle_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       (d.source_listing_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id
       ))
       OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (
         SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL
       ))
     );
  GET DIAGNOSTICS n_vehicle_events = ROW_COUNT;

  -- 7. timeline_events
  UPDATE timeline_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.event_type IN ('photo_session', 'batch_image_upload')
       AND EXISTS (
         SELECT 1 FROM timeline_events p
         WHERE p.vehicle_id = bmp.primary_id
           AND p.event_type IN ('photo_session', 'batch_image_upload')
           AND p.event_date IS NOT DISTINCT FROM d.event_date
           AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')
       )
     );
  GET DIAGNOSTICS n_timeline = ROW_COUNT;

  -- 8. Soft-delete the duplicates first so unique partial indexes on active rows are freed
  UPDATE vehicles v
     SET merged_into_vehicle_id = bmp.primary_id,
         status = 'merged',
         deleted_at = NOW(),
         image_count = 0,
         has_photos = false
    FROM _batch_merge_pairs bmp
   WHERE v.id = ANY(v_dups) AND v.id = bmp.dup_id;

  -- The survivor columns steps 9-11 may fill, before they run (the journal records what was filled).
  INSERT INTO _batch_merge_before (id, f)
  SELECT v.id, jsonb_build_object(
           'listing_url', v.listing_url, 'discovery_url', v.discovery_url, 'primary_image_url', v.primary_image_url,
           'sale_date', v.sale_date, 'color', v.color, 'interior_color', v.interior_color, 'transmission', v.transmission,
           'description', v.description, 'vin', v.vin, 'year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
           'series', v.series, 'generation', v.generation, 'body_style', v.body_style, 'engine_size', v.engine_size,
           'engine_type', v.engine_type, 'drivetrain', v.drivetrain, 'fuel_type', v.fuel_type)
    FROM vehicles v WHERE v.id = ANY(v_primaries);

  -- 9. Copy missing URL/image/date fields + recount image_count once on primary
  UPDATE vehicles vp
     SET listing_url = COALESCE(vp.listing_url, CASE
           WHEN vd.listing_url IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vehicles v2 WHERE v2.listing_url = vd.listing_url AND v2.deleted_at IS NULL AND v2.id <> vp.id
           ) THEN vd.listing_url
           ELSE NULL
         END),
         primary_image_url = COALESCE(vp.primary_image_url, vd.primary_image_url),
         sale_date = COALESCE(vp.sale_date, vd.sale_date),
         color = COALESCE(vp.color, vd.color),
         interior_color = COALESCE(vp.interior_color, vd.interior_color),
         transmission = COALESCE(vp.transmission, vd.transmission),
         description = COALESCE(vp.description, vd.description),
         image_count = (
           SELECT count(*) FROM vehicle_images i
           WHERE i.vehicle_id = vp.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE
         ),
         has_photos = EXISTS (
           SELECT 1 FROM vehicle_images i WHERE i.vehicle_id = vp.id LIMIT 1
         )
    FROM _batch_merge_pairs bmp
    JOIN vehicles vd ON vd.id = bmp.dup_id
   WHERE vp.id = ANY(v_primaries) AND vp.id = bmp.primary_id;

  -- discovery_url is filled only on a primary that has none: naming it in the UPDATE above fired
  -- vehicles_canonicalize_discovery_url on every primary, which rewrote a www. URL onto the duplicate's
  -- canonical URL and failed vehicles_discovery_url_unique (Gooding/B-J www pairs, 2026-10-19).
  UPDATE vehicles vp
     SET discovery_url = CASE
           WHEN vd.discovery_url IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vehicles v2 WHERE v2.discovery_url = vd.discovery_url AND v2.id <> vp.id
           ) THEN vd.discovery_url
           ELSE NULL
         END
    FROM _batch_merge_pairs bmp
    JOIN vehicles vd ON vd.id = bmp.dup_id
   WHERE vp.id = ANY(v_primaries) AND vp.id = bmp.primary_id AND vp.discovery_url IS NULL;

  -- 10. Identity the survivor lacks, from its first duplicate, only on rows that gain a value (so the UPDATE OF
  --     year/make/model triggers fire only there).
  UPDATE vehicles vp
     SET year = COALESCE(vp.year, s.year), make = COALESCE(vp.make, s.make), model = COALESCE(vp.model, s.model),
         trim = COALESCE(vp.trim, s.trim), series = COALESCE(vp.series, s.series), generation = COALESCE(vp.generation, s.generation),
         body_style = COALESCE(vp.body_style, s.body_style), engine_size = COALESCE(vp.engine_size, s.engine_size),
         engine_type = COALESCE(vp.engine_type, s.engine_type), drivetrain = COALESCE(vp.drivetrain, s.drivetrain),
         fuel_type = COALESCE(vp.fuel_type, s.fuel_type)
    FROM (SELECT DISTINCT ON (bmp.primary_id) bmp.primary_id, vd.year, vd.make, vd.model, vd.trim, vd.series, vd.generation,
                 vd.body_style, vd.engine_size, vd.engine_type, vd.drivetrain, vd.fuel_type
            FROM _batch_merge_pairs bmp JOIN vehicles vd ON vd.id = bmp.dup_id
           ORDER BY bmp.primary_id, bmp.dup_id) s
   WHERE vp.id = s.primary_id
     AND ((vp.year IS NULL AND s.year IS NOT NULL) OR (vp.make IS NULL AND s.make IS NOT NULL)
       OR (vp.model IS NULL AND s.model IS NOT NULL) OR (vp.trim IS NULL AND s.trim IS NOT NULL)
       OR (vp.series IS NULL AND s.series IS NOT NULL) OR (vp.generation IS NULL AND s.generation IS NOT NULL)
       OR (vp.body_style IS NULL AND s.body_style IS NOT NULL) OR (vp.engine_size IS NULL AND s.engine_size IS NOT NULL)
       OR (vp.engine_type IS NULL AND s.engine_type IS NOT NULL) OR (vp.drivetrain IS NULL AND s.drivetrain IS NOT NULL)
       OR (vp.fuel_type IS NULL AND s.fuel_type IS NOT NULL));
  GET DIAGNOSTICS n_identity_filled = ROW_COUNT;

  -- 11. The duplicate's VIN, when the survivor has none. Step 8 freed it (merged rows own no VIN). Only a VIN that one survivor
  --     in this batch would take, that no other live vehicle holds, from a duplicate whose year and make do not contradict it.
  WITH c AS (
    SELECT bmp.primary_id, upper(btrim(vd.vin)) AS vin
      FROM _batch_merge_pairs bmp
      JOIN vehicles vd ON vd.id = bmp.dup_id
      JOIN vehicles vp ON vp.id = bmp.primary_id
     WHERE nullif(btrim(vp.vin), '') IS NULL AND nullif(btrim(vd.vin), '') IS NOT NULL
       AND (vp.year IS NULL OR vd.year IS NULL OR vp.year = vd.year)
       AND (vp.make IS NULL OR vd.make IS NULL OR lower(vp.make) = lower(vd.make))
  ), one AS (
    SELECT primary_id, min(vin) AS vin FROM c GROUP BY primary_id HAVING count(DISTINCT vin) = 1
  ), free AS (
    SELECT o.primary_id, o.vin FROM one o
     WHERE (SELECT count(*) FROM one o2 WHERE o2.vin = o.vin) = 1
       AND NOT EXISTS (SELECT 1 FROM vehicles x
                        WHERE upper(btrim(x.vin)) = o.vin AND x.id <> o.primary_id AND x.status IS DISTINCT FROM 'merged')
  )
  UPDATE vehicles vp SET vin = f.vin FROM free f WHERE vp.id = f.primary_id;
  GET DIAGNOSTICS n_vins_carried = ROW_COUNT;

  -- 11b. Records about the car or its people follow each pair (see merge_carry_children). One pair at a time, so two duplicates of one
  --      survivor never collide with each other; collisions stay on the duplicate; a failed table is recorded, never failing the batch.
  FOR v_pair IN SELECT primary_id, dup_id FROM _batch_merge_pairs ORDER BY dup_id LOOP
    INSERT INTO _batch_merge_carry (dup_id, carry) VALUES (v_pair.dup_id, public.merge_carry_children(v_pair.primary_id, v_pair.dup_id));
  END LOOP;
  SELECT COALESCE(sum((SELECT count(*) FROM jsonb_each(c.carry -> 'carried') x, jsonb_array_elements(x.value))), 0)::int
    INTO n_carried FROM _batch_merge_carry c;

  -- 12. Journal per pair: the supersessions it recorded and the survivor columns it filled (unmerge_vehicle reverses both).
  WITH after AS (
    SELECT v.id, jsonb_build_object(
             'listing_url', v.listing_url, 'discovery_url', v.discovery_url, 'primary_image_url', v.primary_image_url,
             'sale_date', v.sale_date, 'color', v.color, 'interior_color', v.interior_color, 'transmission', v.transmission,
             'description', v.description, 'vin', v.vin, 'year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
             'series', v.series, 'generation', v.generation, 'body_style', v.body_style, 'engine_size', v.engine_size,
             'engine_type', v.engine_type, 'drivetrain', v.drivetrain, 'fuel_type', v.fuel_type) AS f
      FROM vehicles v WHERE v.id = ANY(v_primaries)
  ), filled AS (
    SELECT a.id AS primary_id, k.key, k.value
      FROM after a JOIN _batch_merge_before b ON b.id = a.id, jsonb_each(a.f) k
     WHERE k.value <> 'null'::jsonb AND (b.f -> k.key) IN ('null'::jsonb, '""'::jsonb)
  ), owner AS (
    SELECT DISTINCT ON (f.primary_id, f.key) bmp.dup_id, f.key, f.value
      FROM filled f
      JOIN _batch_merge_pairs bmp ON bmp.primary_id = f.primary_id
      JOIN vehicles vd ON vd.id = bmp.dup_id
     ORDER BY f.primary_id, f.key, (to_jsonb(vd) -> f.key = f.value) DESC NULLS LAST, bmp.dup_id
  )
  UPDATE vehicle_merge_proposals vmp
     SET merge_journal = jsonb_build_object(
           'method', 'merge_into_primary_batch',
           'observations_superseded', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'by', s.by_id))
                                                  FROM _batch_merge_superseded s WHERE s.dup_id = bmp.dup_id), '[]'::jsonb),
           'survivor_filled', COALESCE((SELECT jsonb_object_agg(o.key, o.value) FROM owner o WHERE o.dup_id = bmp.dup_id), '{}'::jsonb),
           'carry', COALESCE((SELECT c.carry FROM _batch_merge_carry c WHERE c.dup_id = bmp.dup_id), '{}'::jsonb))
    FROM _batch_merge_pairs bmp
   WHERE vmp.primary_vehicle_id = bmp.primary_id AND vmp.duplicate_vehicle_id = bmp.dup_id;

  RETURN jsonb_build_object(
    'merged_count', n_pairs,
    'images_moved', n_images,
    'observations_moved', n_obs,
    'observations_superseded', n_obs_superseded,
    'events_moved', n_auction_events,
    'comments_moved', n_comments,
    'obs_disc_moved', n_obs_disc,
    'vehicle_events_moved', n_vehicle_events,
    'timeline_events_moved', n_timeline,
    'vin_conflicts_skipped', n_vin_conflicts,
    'identity_filled', n_identity_filled,
    'vins_carried', n_vins_carried,
    'carried_rows', n_carried,
    'merged_dup_ids', COALESCE(to_jsonb(v_dups), '[]'::jsonb)
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'sale_price','sale_status','auction_outcome','reserve_status','high_bid','winning_bid',
    'bat_sold_price','sold_price','sale_date','bat_sale_date','auction_end_date','bat_buyer',
    'canonical_platform','msrp','msrp_source','listing_kind','year','make','model','bat_auction_url',
    'asking_price','interior_color','color','bat_seller','seller_name',
    'discovery_url','auction_source','normalized_model','normalized_series','sale_price_currency'];
  c_numeric CONSTANT text[] := ARRAY['sale_price','high_bid','winning_bid','bat_sold_price','sold_price','msrp','year','asking_price'];
  c_date    CONSTANT text[] := ARRAY['sale_date','bat_sale_date'];
  v_row      jsonb;
  v_source   jsonb;
  v_id       uuid;
  v_veh      vehicles%ROWTYPE;
  v_field    text;
  v_spec     jsonb;
  v_orig     text;
  v_new      text;
  v_same     boolean;
  v_set      jsonb;
  v_audit    jsonb;
  v_vehicles int := 0;
  v_fields   int := 0;
  v_noop     int := 0;
  v_skipped  int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
  v_fx       record;
  v_fx_hit   boolean;
  v_fx_usd   numeric;
  v_fx_rate  numeric;
  v_fx_fdate date;
  v_fx_src   text;
  v_fx_prov  text;
  v_fx_keep  text;
  v_fx_amt   numeric;
  v_fx_date  date;
  v_fx_cur   text;
  v_evd      date;
  v_superseded jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: p_rows must be a JSON array';
  END IF;


  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_source := v_row -> 'source';
    -- owner testimony: a live observation of this vehicle, cited by id (who said it lives on that row)
    IF v_source ->> 'type' = 'owner_observation' THEN
      IF (v_source ->> 'observation_id') IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehicle_observations o
           WHERE o.id = (v_source ->> 'observation_id')::uuid
             AND o.vehicle_id = v_id
             AND coalesce(o.is_superseded, false) = false) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: owner_observation % is not a live observation of vehicle %',
          v_source ->> 'observation_id', v_id;
      END IF;
      v_source := v_source || jsonb_build_object('ref', 'vehicle_observations/' || (v_source ->> 'observation_id'));
    END IF;
    IF v_source IS NULL OR v_source = '{}'::jsonb OR (v_source ->> 'ref') IS NULL THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no source document with a ref -- corrections must be cited, never guessed', v_id;
    END IF;
    IF v_row -> 'corrections' IS NULL OR jsonb_typeof(v_row -> 'corrections') <> 'object' THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no corrections object', v_id;
    END IF;

    -- the guard's bypass: a cited correction registers (txid, vehicle, run id, source ref) before it writes;
    -- vehicles_guard_sale_fields lets a sale-field clear through only for a registered row
    INSERT INTO sale_correction_context (txid, vehicle_id, run_id, source_ref)
    VALUES (txid_current(), v_id, NULLIF(COALESCE(NULLIF(v_source ->> 'run_id', ''), NULLIF(v_row ->> 'run_id', ''), NULLIF(p_reason, ''), v_row ->> 'reason'), ''), v_source ->> 'ref');
    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    -- keep the provider already recorded on the vehicle; only an explicit per-row "fx_rerate": true lets the
    -- preference table choose again (so a re-correction never silently swaps an ECB rate for a BoE one)
    v_fx_keep := CASE WHEN COALESCE((v_row ->> 'fx_rerate')::boolean, false) THEN NULL ELSE v_veh.sale_price_fx_provider END;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(v_id);
      CONTINUE;
    END IF;

    -- a verified event only moves the vehicle's sale when it is the vehicle's latest sale by sale date
    -- (2026-10-24: an older verified event overwrote a newer BaT sale). Superseded rows are reported, not written.
    IF v_source ->> 'type' = 'verified_vehicle_event'
       AND (v_row -> 'corrections') ?| ARRAY['sale_price', 'sale_date', 'sale_status'] THEN
      SELECT (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::date INTO v_evd
      FROM vehicle_events e
      WHERE e.id = (v_source ->> 'event_id')::uuid AND e.vehicle_id = v_id;
      IF v_evd IS NULL
         OR v_veh.sale_date > v_evd
         OR EXISTS (SELECT 1 FROM vehicle_events e
                    WHERE e.vehicle_id = v_id AND e.id <> (v_source ->> 'event_id')::uuid
                      AND e.price_verification = 'verified' AND e.event_status = 'sold' AND e.final_price > 0
                      AND coalesce(e.sale_truth_role, '') <> 'duplicate'
                      AND (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::date > v_evd) THEN
        v_superseded := v_superseded || jsonb_build_array(jsonb_build_object(
          'vehicle_id', v_id, 'event_id', v_source ->> 'event_id', 'event_date', v_evd, 'vehicle_sale_date', v_veh.sale_date));
        CONTINUE;
      END IF;
    END IF;

    v_set := '{}'::jsonb;
    v_audit := '[]'::jsonb;

    FOR v_field, v_spec IN SELECT key, value FROM jsonb_each(v_row -> 'corrections') LOOP
      -- a JSON null spec is "no proposal for this field" (2026-09-27 incident); clearing a column is
      -- said explicitly as {"value": null}. Anything else that is not an object is a caller bug.
      IF v_spec IS NULL OR jsonb_typeof(v_spec) = 'null' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_spec) <> 'object' THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % field % spec must be an object {value, expected?}, got %', v_id, v_field, jsonb_typeof(v_spec);
      END IF;
      IF NOT (v_field = ANY (c_allowed)) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: unsupported field % (supported: %)', v_field, array_to_string(c_allowed, ', ');
      END IF;

      v_orig := CASE v_field
        WHEN 'sale_price'         THEN v_veh.sale_price::text
        WHEN 'sale_status'        THEN v_veh.sale_status
        WHEN 'auction_outcome'    THEN v_veh.auction_outcome
        WHEN 'reserve_status'     THEN v_veh.reserve_status
        WHEN 'high_bid'           THEN v_veh.high_bid::text
        WHEN 'winning_bid'        THEN v_veh.winning_bid::text
        WHEN 'bat_sold_price'     THEN v_veh.bat_sold_price::text
        WHEN 'sold_price'         THEN v_veh.sold_price::text
        WHEN 'sale_date'          THEN v_veh.sale_date::text
        WHEN 'bat_sale_date'      THEN v_veh.bat_sale_date::text
        WHEN 'auction_end_date'   THEN v_veh.auction_end_date
        WHEN 'bat_buyer'          THEN v_veh.bat_buyer
        WHEN 'canonical_platform' THEN v_veh.canonical_platform
        WHEN 'msrp'               THEN v_veh.msrp::text
        WHEN 'msrp_source'        THEN v_veh.msrp_source
        WHEN 'listing_kind'       THEN v_veh.listing_kind
        WHEN 'year'               THEN v_veh.year::text
        WHEN 'make'               THEN v_veh.make
        WHEN 'model'              THEN v_veh.model
        WHEN 'bat_auction_url'    THEN v_veh.bat_auction_url
        WHEN 'asking_price'       THEN v_veh.asking_price::text
        WHEN 'interior_color'     THEN v_veh.interior_color
        WHEN 'color'              THEN v_veh.color
        WHEN 'bat_seller'         THEN v_veh.bat_seller
        WHEN 'seller_name'        THEN v_veh.seller_name
        WHEN 'discovery_url'      THEN v_veh.discovery_url
        WHEN 'auction_source'     THEN v_veh.auction_source
        WHEN 'normalized_model'   THEN v_veh.normalized_model
        WHEN 'normalized_series'  THEN v_veh.normalized_series
        WHEN 'sale_price_currency' THEN v_veh.sale_price_currency
      END;
      v_new := v_spec ->> 'value';

      -- typed no-op / expectation checks (25000 = 25000.00; 2024-03-01 = 2024-03-01)
      v_same := CASE
        WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM v_new::numeric
        WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM v_new::date
        ELSE v_orig IS NOT DISTINCT FROM v_new END;
      IF v_same THEN
        v_noop := v_noop + 1;
        CONTINUE;
      END IF;

      IF v_spec ? 'expected' THEN
        IF NOT (CASE
          WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM (v_spec ->> 'expected')::numeric
          WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM (v_spec ->> 'expected')::date
          ELSE v_orig IS NOT DISTINCT FROM (v_spec ->> 'expected') END) THEN
          v_stale := v_stale || jsonb_build_array(jsonb_build_object(
            'vehicle_id', v_id, 'field', v_field, 'live', v_orig, 'expected', v_spec ->> 'expected', 'proposed', v_new));
          CONTINUE;
        END IF;
      END IF;

      v_set := v_set || jsonb_build_object(v_field, v_new);
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'field', v_field,
        'original', v_orig,
        'corrected', v_new,
        'source', v_source,
        'reason', COALESCE(v_row ->> 'reason', p_reason),
        'asserted_by', p_asserted_by,
        'asserted_at', now()));
    END LOOP;

    IF v_set = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    -- sale currency + USD resolved BEFORE the write and set in the same UPDATE as the amount, so the NOT VALID
    -- check vehicles_sale_price_usd_required holds even when trg_vehicles_sale_currency_guard labels the row
    -- non-USD (it labels a NULL currency from the vehicle_events price the new amount matches; mirrored here).
    v_fx_hit := v_set ?| ARRAY['sale_price', 'sale_date', 'sale_price_currency'];
    v_fx_usd := NULL; v_fx_rate := NULL; v_fx_fdate := NULL; v_fx_src := NULL; v_fx_prov := NULL;
    IF v_fx_hit THEN
      v_fx_amt  := CASE WHEN v_set ? 'sale_price' THEN (v_set ->> 'sale_price')::integer ELSE v_veh.sale_price END;
      v_fx_date := CASE WHEN v_set ? 'sale_date'  THEN (v_set ->> 'sale_date')::date     ELSE v_veh.sale_date END;
      v_fx_cur  := CASE WHEN v_set ? 'sale_price_currency' THEN upper(v_set ->> 'sale_price_currency') ELSE v_veh.sale_price_currency END;
      IF v_fx_cur IS NULL AND v_fx_amt > 0 THEN
        SELECT CASE WHEN count(DISTINCT upper(coalesce(e.currency_code, '?'))) = 1
                     AND min(upper(e.currency_code)) IS NOT NULL AND min(upper(e.currency_code)) <> 'USD'
                    THEN min(upper(e.currency_code)) END
          INTO v_fx_cur
          FROM vehicle_events e
         WHERE e.vehicle_id = v_id AND (e.final_price = v_fx_amt OR e.hammer_price = v_fx_amt);
      END IF;
      -- the vehicle's recorded provider when it has one (v_fx_keep), else the preferred provider for the currency
      SELECT x.amount_usd, x.fx_rate, x.fx_date, x.fx_source, x.fx_provider INTO v_fx_usd, v_fx_rate, v_fx_fdate, v_fx_src, v_fx_prov
        FROM vehicle_sale_price_fx_usd_preferred(v_fx_amt, v_fx_cur, v_fx_date, v_fx_keep) x;
    END IF;

    -- one UPDATE per vehicle: every trigger on vehicles fires once, not once per field
    UPDATE vehicles SET
      sale_price         = CASE WHEN v_set ? 'sale_price'         THEN (v_set ->> 'sale_price')::integer      ELSE sale_price END,
      sale_status        = CASE WHEN v_set ? 'sale_status'        THEN  v_set ->> 'sale_status'                ELSE sale_status END,
      auction_outcome    = CASE WHEN v_set ? 'auction_outcome'    THEN  v_set ->> 'auction_outcome'            ELSE auction_outcome END,
      reserve_status     = CASE WHEN v_set ? 'reserve_status'     THEN  v_set ->> 'reserve_status'             ELSE reserve_status END,
      high_bid           = CASE WHEN v_set ? 'high_bid'           THEN (v_set ->> 'high_bid')::integer        ELSE high_bid END,
      winning_bid        = CASE WHEN v_set ? 'winning_bid'        THEN (v_set ->> 'winning_bid')::integer     ELSE winning_bid END,
      bat_sold_price     = CASE WHEN v_set ? 'bat_sold_price'     THEN (v_set ->> 'bat_sold_price')::numeric  ELSE bat_sold_price END,
      sold_price         = CASE WHEN v_set ? 'sold_price'         THEN (v_set ->> 'sold_price')::integer      ELSE sold_price END,
      sale_date          = CASE WHEN v_set ? 'sale_date'          THEN (v_set ->> 'sale_date')::date          ELSE sale_date END,
      bat_sale_date      = CASE WHEN v_set ? 'bat_sale_date'      THEN (v_set ->> 'bat_sale_date')::date      ELSE bat_sale_date END,
      auction_end_date   = CASE WHEN v_set ? 'auction_end_date'   THEN  v_set ->> 'auction_end_date'           ELSE auction_end_date END,
      bat_buyer          = CASE WHEN v_set ? 'bat_buyer'          THEN  v_set ->> 'bat_buyer'                  ELSE bat_buyer END,
      bat_seller         = CASE WHEN v_set ? 'bat_seller'         THEN  v_set ->> 'bat_seller'                 ELSE bat_seller END,
      seller_name        = CASE WHEN v_set ? 'seller_name'        THEN  v_set ->> 'seller_name'                ELSE seller_name END,
      canonical_platform = CASE WHEN v_set ? 'canonical_platform' THEN  v_set ->> 'canonical_platform'         ELSE canonical_platform END,
      platform_source    = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_source ->> 'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END,
      msrp               = CASE WHEN v_set ? 'msrp'               THEN (v_set ->> 'msrp')::numeric            ELSE msrp END,
      msrp_source        = CASE WHEN v_set ? 'msrp_source'        THEN  v_set ->> 'msrp_source'                ELSE msrp_source END,
      listing_kind       = CASE WHEN v_set ? 'listing_kind'       THEN  v_set ->> 'listing_kind'               ELSE listing_kind END,
      asking_price       = CASE WHEN v_set ? 'asking_price'       THEN (v_set ->> 'asking_price')::numeric    ELSE asking_price END,
      interior_color     = CASE WHEN v_set ? 'interior_color'     THEN  v_set ->> 'interior_color'             ELSE interior_color END,
      color              = CASE WHEN v_set ? 'color'              THEN  v_set ->> 'color'                      ELSE color END,
      sale_price_currency  = CASE WHEN v_fx_hit THEN v_fx_cur ELSE sale_price_currency END,
      sale_price_usd       = CASE WHEN v_fx_hit THEN v_fx_usd ELSE sale_price_usd END,
      sale_price_fx_rate   = CASE WHEN v_fx_hit THEN v_fx_rate ELSE sale_price_fx_rate END,
      sale_price_fx_date   = CASE WHEN v_fx_hit THEN v_fx_fdate ELSE sale_price_fx_date END,
      sale_price_fx_source = CASE WHEN v_fx_hit THEN v_fx_src ELSE sale_price_fx_source END,
      sale_price_fx_provider = CASE WHEN v_fx_hit THEN v_fx_prov ELSE sale_price_fx_provider END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'sale_provenance_corrections',
          COALESCE(provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb) || v_audit)
    WHERE id = v_id;

    -- sale currency: sale_price is the native amount in sale_price_currency (NULL = legacy USD). Whenever the
    -- amount, date or currency moves, sale_price_usd and its fx citation are re-derived from fx_rates at the
    -- sale-date rate, in the same statement as the currency so vehicles_sale_price_usd_required always holds.
    IF v_set ?| ARRAY['sale_price', 'sale_date', 'sale_price_currency'] THEN
      SELECT vv.sale_price, vv.sale_date,
             CASE WHEN v_set ? 'sale_price_currency' THEN upper(v_set ->> 'sale_price_currency') ELSE vv.sale_price_currency END
        INTO v_fx_amt, v_fx_date, v_fx_cur
      FROM vehicles vv WHERE vv.id = v_id;
      SELECT * INTO v_fx FROM vehicle_sale_price_fx_usd_preferred(v_fx_amt, v_fx_cur, v_fx_date, v_fx_keep);
      UPDATE vehicles SET
        sale_price_currency  = v_fx_cur,
        sale_price_usd       = v_fx.amount_usd,
        sale_price_fx_rate   = v_fx.fx_rate,
        sale_price_fx_date   = v_fx.fx_date,
        sale_price_fx_source = v_fx.fx_source,
        sale_price_fx_provider = v_fx.fx_provider
      WHERE id = v_id
        AND (sale_price_currency, sale_price_usd, sale_price_fx_rate, sale_price_fx_date, sale_price_fx_source, sale_price_fx_provider)
            IS DISTINCT FROM (v_fx_cur, v_fx.amount_usd, v_fx.fx_rate, v_fx.fx_date, v_fx.fx_source, v_fx.fx_provider);
    END IF;

    -- identity / link columns in their own statement, only when one of them is corrected: triggers declared
    -- UPDATE OF year/make/model (duplicate detection, auto services, VIN checks) then fire for identity moves
    -- only, never for an ordinary sale correction (which lists none of these columns)
    IF v_set ?| ARRAY['year', 'make', 'model'] THEN
      UPDATE vehicles SET
        year  = CASE WHEN v_set ? 'year'  THEN (v_set ->> 'year')::integer ELSE year END,
        make  = CASE WHEN v_set ? 'make'  THEN  v_set ->> 'make'  ELSE make END,
        model = CASE WHEN v_set ? 'model' THEN  v_set ->> 'model' ELSE model END
      WHERE id = v_id;
    END IF;
    IF v_set ? 'bat_auction_url' THEN
      UPDATE vehicles SET bat_auction_url = v_set ->> 'bat_auction_url' WHERE id = v_id;
    END IF;
    -- the other car's link and venue, laid over a lot row (2026-10-15 hybrid rows), corrected like bat_auction_url
    IF v_set ?| ARRAY['discovery_url', 'auction_source'] THEN
      UPDATE vehicles SET
        discovery_url  = CASE WHEN v_set ? 'discovery_url'  THEN v_set ->> 'discovery_url'  ELSE discovery_url END,
        auction_source = CASE WHEN v_set ? 'auction_source' THEN v_set ->> 'auction_source' ELSE auction_source END
      WHERE id = v_id;
    END IF;
    -- after the identity statement: auto_normalize_vehicle_model (BEFORE UPDATE OF model, make, year) keeps the old
    -- normalized model when the corrected model has no canonical match, so a cited value is written here, where that
    -- trigger does not fire
    IF v_set ?| ARRAY['normalized_model', 'normalized_series'] THEN
      UPDATE vehicles SET
        normalized_model  = CASE WHEN v_set ? 'normalized_model'  THEN v_set ->> 'normalized_model'  ELSE normalized_model END,
        normalized_series = CASE WHEN v_set ? 'normalized_series' THEN v_set ->> 'normalized_series' ELSE normalized_series END
      WHERE id = v_id;
    END IF;

    v_vehicles := v_vehicles + 1;
    v_fields := v_fields + jsonb_array_length(v_audit);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'vehicles_corrected', v_vehicles,
    'fields_corrected', v_fields,
    'fields_noop', v_noop,
    'fields_skipped_null_spec', v_skipped,
    'stale', v_stale,
    'missing', v_missing,
    'superseded', v_superseded,
    'asserted_by', p_asserted_by);
END;
$function$
;
