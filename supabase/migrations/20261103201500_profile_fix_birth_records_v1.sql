BEGIN;
SET LOCAL lock_timeout = '5s';

-- Birth-record rule: facts already recorded on the vehicle (vehicles.vin, a BaT-acceptance books record) that never reached the
-- identifier / event tables. Generalizes to any vehicle created from books with provenance_metadata.created_from_books.
CREATE OR REPLACE FUNCTION public.profile_fix_birth_records_v1(p_vehicle uuid, p_dry boolean DEFAULT true, p_run uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v record; acts jsonb := '[]'::jsonb; a jsonb; cfb jsonb; eid uuid; iid uuid; reserve numeric; note text; sent text; accepted timestamptz;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE id = p_vehicle;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'vehicle not found'); END IF;

  -- 1. vehicles.vin -> identifier row (same shape the legacy backfill writes)
  -- scope matches the legacy backfill ('pre1981_rules'): modern 17-char VINs are validated elsewhere and are not claims-table rows
  IF v.year < 1981 AND nullif(btrim(v.vin), '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.vehicle_identifiers i WHERE i.vehicle_id = p_vehicle AND i.kind = 'vin' AND i.value_norm = upper(regexp_replace(v.vin, '[^A-Za-z0-9]', '', 'g'))) THEN
    acts := acts || jsonb_build_object('rule', 'vin_identifier_from_column', 'table', 'vehicle_identifiers', 'value', v.vin);
    IF NOT p_dry THEN
      PERFORM public.land_identifier_claims(p_vehicle, jsonb_build_object('identifiers', jsonb_build_array(jsonb_build_object('kind', 'vin', 'value', v.vin, 'confidence', 0.7))),
                                            null, 'identifier-backfill/pre1981_rules', 'legacy_vin_column', null, p_run);
      FOR iid IN SELECT id FROM public.vehicle_identifiers WHERE vehicle_id = p_vehicle AND run_id = p_run AND kind = 'vin' LOOP
        INSERT INTO public.profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        VALUES (p_run, 'vin_identifier_from_column', p_vehicle, 'vehicle_identifiers', iid, null, 'insert', null, to_jsonb(v.vin), jsonb_build_object('source', 'vehicles.vin'));
      END LOOP;
    END IF;
  END IF;

  cfb := v.provenance_metadata->'created_from_books';
  IF cfb IS NOT NULL AND cfb->>'kind' = 'bat_acceptance' THEN
    note := cfb->>'note';
    reserve := nullif(regexp_replace(coalesce((regexp_match(note, 'at an? \$?([0-9][0-9,]*) reserve'))[1], ''), ',', '', 'g'), '')::numeric;
    accepted := coalesce((regexp_match(note, 'accepted the car (\d{4}-\d{2}-\d{2})'))[1]::date::timestamptz, (cfb->>'created_at')::timestamptz);

    -- 2. BaT acceptance -> consignment event (upcoming auction) + sale_status
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id = p_vehicle AND lower(e.source_platform) = 'bat' AND e.source_listing_id = cfb->>'bat_listing_id') THEN
      acts := acts || jsonb_build_object('rule', 'bat_acceptance_event', 'table', 'vehicle_events', 'listing_id', cfb->>'bat_listing_id', 'reserve', reserve);
      IF NOT p_dry THEN
        INSERT INTO public.vehicle_events(vehicle_id, source_platform, source_listing_id, event_type, event_status, reserve_price, started_at, metadata, extraction_method, extraction_source)
        VALUES (p_vehicle, 'bat', cfb->>'bat_listing_id', 'auction', 'upcoming', reserve, accepted,
                jsonb_build_object('kind', 'bat_acceptance', 'ref', cfb->>'ref', 'note', note, 'accepted_on', accepted, 'listing_fee_paid', note ~* 'listing fee paid'),
                'books_provenance', cfb->>'ref')
        RETURNING id INTO eid;
        INSERT INTO public.profile_fix_log(run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
        VALUES (p_run, 'bat_acceptance_event', p_vehicle, 'vehicle_events', eid, null, 'insert', null, jsonb_build_object('status', 'upcoming', 'reserve', reserve), cfb);
      END IF;
    END IF;
    IF v.sale_status IN ('available', 'for_sale', 'discovered') OR v.sale_status IS NULL THEN
      a := public._pf_update(p_run, 'bat_acceptance_sale_status', 'vehicles', p_vehicle, 'sale_status', '"upcoming"', p_vehicle, cfb, p_dry);
      IF a IS NOT NULL THEN acts := acts || a; END IF;
    END IF;

    -- 3. the books note says the car is a clone/tribute: record it (quote = the sentence)
    sent := (regexp_match(note, '([^.]*\m(clone|tribute|recreation|replica)\M[^.]*\.?)', 'i'))[1];
    IF sent IS NOT NULL AND v.is_replica IS NULL THEN
      a := public._pf_update(p_run, 'replica_from_books_note', 'vehicles', p_vehicle, 'is_replica', 'true', p_vehicle, cfb, p_dry);
      IF a IS NOT NULL THEN acts := acts || a; END IF;
      a := public._pf_update(p_run, 'replica_from_books_note', 'vehicles', p_vehicle, 'replica_quote', to_jsonb(btrim(sent)), p_vehicle, cfb, p_dry);
      IF a IS NOT NULL THEN acts := acts || a; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry_run', p_dry, 'vehicle_id', p_vehicle, 'changes', acts);
END $f$;
REVOKE EXECUTE ON FUNCTION public.profile_fix_birth_records_v1(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
