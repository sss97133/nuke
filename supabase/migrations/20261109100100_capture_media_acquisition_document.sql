-- device_file_media_document: the server half of the screen-capture evidence rule (screen_text_v1).
--
-- STATUS: written, NEVER EXECUTED before merge (the box has no Postgres; it is syntax-checked with pglast only).
-- `supabase-deploy.yml` applies new migrations when a PR merges to main. It adds two functions and grants one. It
-- changes no table, column, policy or existing function and writes no row when it is applied. When a phone calls
-- it, it writes to the table created by 20261109100050_vehicle_price_observations.sql.
--
-- Why a separate function: screen recordings and screenshots are DOCUMENTS. device_file_images (the photo filing
-- gate) refuses them by design (a VIN printed on a document is not a photo of the vehicle), and its methods
-- (vin_ocr / serial_ocr) read an identifier off a photo. A screen capture is attributed by its own text: a vehicle
-- named by year + make + model, or by its own VIN, plus a price or seller line (ScreenCaptureEvidence on the phone).
--
-- What the phone sends: a metadata-only vehicle_images row (no pixels, no vehicle_id), then this call with the
-- method, the confidence, the CITED FIELDS (name, value, frame index, seconds into the preview) and the PRICE
-- OBSERVATIONS (amount, kind asking | offer | agreed | unknown, frame index, seconds). Never the OCR text. The phone has already decided; this function revalidates everything it can. It cannot re-read the pixels,
-- so the text itself is trusted to the phone, as for photos.
--
--   1. caller owns the row; the row was written by this feature (source capture_relay_ios_media, exif media.kind
--      screen_recording | screenshot, media.match.rule screen_text_v1); the row is not sensitive;
--   2. the vehicle is associated with the caller (user_associated_vehicle_ids) and not deleted;
--   3. CONTEXT: the capture's taken_at is inside the vehicle's acquisition window, recomputed here:
--        anchor = vehicles.purchase_date (UTC midnight), else the vehicle's first filed photo (taken_at, a real
--        photo: not a clip, not sensitive, not superseded, not a duplicate). created_at is never used.
--        window = 21 days before the anchor to 3 days after a purchase_date, or 2 days after a photo.
--   4. the cited fields are well formed and agree with the vehicle: screen_vin needs a vin field equal to the
--      vehicle's VIN; screen_ymm needs a vehicle field equal to its year make model, and refuses when another of
--      the caller's vehicles has the same year/make/model (ambiguous); any vin field must equal the vehicle's VIN;
--      a price observation (500 to 5,000,000) or a seller field is required;
--   5. then ONE transaction: insert an `acquisition_document` into vehicle_documents (privacy_level private,
--      vendor_name = the cited seller, description = the cited fields and price observations with their frames,
--      amount = the AGREED price only when exactly one agreed amount was seen, else null), insert one
--      vehicle_price_observations row per price (owner-only table; type and frame cited), and set the row's
--      vehicle_id and is_document, recording document_id and the cited fields in exif_data.media.
--      The capture-media storage policy lets the preview upload only after vehicle_id is set.
--   If anything fails, nothing is written: vehicle_id stays null, no document exists, storage refuses the
--   preview, and the capture stays on the phone.
--
-- It does NOT write vehicles.purchase_price or vehicles.purchase_date, and no price is a price of record: prices
-- are typed observations ('unknown' when the text around the price was not clear). See
-- apps/nuke-capture-ios/docs/VIDEO_SYNC_PLAN.md.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.device_media_doc_result(p_row_id uuid, p_status text, p_detail text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('results', jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('image_id', p_row_id::text, 'status', p_status, 'detail', p_detail))));
$fn$;

CREATE OR REPLACE FUNCTION public.device_file_media_document(
  p_row_id uuid,
  p_vehicle_id uuid,
  p_method text,
  p_confidence numeric,
  p_fields jsonb,
  p_prices jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.vehicle_images%ROWTYPE;
  v_veh public.vehicles%ROWTYPE;
  v_kind text;
  v_anchor timestamptz;
  v_after interval;
  v_vin text;
  v_vehicle_text text;
  v_agreed_n integer;
  v_agreed numeric;
  v_seller text;
  v_date text;
  v_path text;
  v_doc_id uuid;
  v_desc text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'device_file_media_document: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Inputs.
  IF p_method IS NULL OR p_method NOT IN ('screen_vin', 'screen_ymm')
     OR p_confidence IS NULL OR p_confidence < 0.9 OR p_confidence > 1 THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_method', 'method screen_vin or screen_ymm at confidence 0.9 or more');
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 12
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_fields) f
        WHERE jsonb_typeof(f) <> 'object'
           OR coalesce(f ->> 'name', '') NOT IN ('vehicle', 'vin', 'seller', 'seller_line', 'date')
           OR length(coalesce(f ->> 'value', '')) NOT BETWEEN 1 AND 80
           OR CASE WHEN coalesce(pg_input_is_valid(f ->> 'frame', 'integer'), false)
                   THEN (f ->> 'frame')::integer NOT BETWEEN 1 AND 12 ELSE true END
           OR CASE WHEN coalesce(pg_input_is_valid(f ->> 'seconds', 'numeric'), false)
                   THEN (f ->> 'seconds')::numeric NOT BETWEEN 0 AND 60 ELSE true END
     ) THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_fields', 'cited fields malformed');
  END IF;
  IF jsonb_typeof(p_prices) IS DISTINCT FROM 'array' OR jsonb_array_length(p_prices) > 8
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_prices) f
        WHERE jsonb_typeof(f) <> 'object'
           OR coalesce(f ->> 'kind', '') NOT IN ('asking', 'offer', 'agreed', 'unknown')
           OR CASE WHEN coalesce(pg_input_is_valid(f ->> 'amount', 'numeric'), false)
                   THEN (f ->> 'amount')::numeric NOT BETWEEN 500 AND 5000000 ELSE true END
           OR CASE WHEN coalesce(pg_input_is_valid(f ->> 'frame', 'integer'), false)
                   THEN (f ->> 'frame')::integer NOT BETWEEN 1 AND 12 ELSE true END
           OR CASE WHEN coalesce(pg_input_is_valid(f ->> 'seconds', 'numeric'), false)
                   THEN (f ->> 'seconds')::numeric NOT BETWEEN 0 AND 60 ELSE true END
     ) THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_fields', 'price observations malformed');
  END IF;

  -- The row: owned, written by this feature, a screen capture, decided by this rule.
  SELECT * INTO v_row FROM public.vehicle_images WHERE id = p_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_row_missing');
  END IF;
  v_kind := v_row.exif_data #>> '{media,kind}';
  IF v_row.user_id IS DISTINCT FROM v_caller
     OR v_row.source IS DISTINCT FROM 'capture_relay_ios_media'
     OR v_kind IS NULL OR v_kind NOT IN ('screen_recording', 'screenshot')
     OR v_row.exif_data #>> '{media,match,rule}' IS DISTINCT FROM 'screen_text_v1'
     OR coalesce(v_row.is_sensitive, false)
     OR v_row.taken_at IS NULL THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_row', 'not a screen-capture row of this caller');
  END IF;
  IF v_row.vehicle_id IS NOT NULL THEN
    IF v_row.vehicle_id = p_vehicle_id AND v_row.exif_data #>> '{media,document_id}' IS NOT NULL THEN
      RETURN public.device_media_doc_result(p_row_id, 'already');
    END IF;
    RETURN public.device_media_doc_result(p_row_id, 'refused_conflict', 'row already has another vehicle');
  END IF;

  -- The vehicle: the caller's, and live.
  IF NOT EXISTS (SELECT 1 FROM public.user_associated_vehicle_ids(v_caller) a(vid) WHERE a.vid = p_vehicle_id) THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_not_associated');
  END IF;
  SELECT * INTO v_veh FROM public.vehicles WHERE id = p_vehicle_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_vehicle_unavailable');
  END IF;

  -- Context: the acquisition window, recomputed. created_at is never an anchor.
  IF v_veh.purchase_date IS NOT NULL THEN
    v_anchor := v_veh.purchase_date::timestamp AT TIME ZONE 'UTC';
    v_after := interval '3 days';
  ELSE
    SELECT min(vi.taken_at) INTO v_anchor
      FROM public.vehicle_images vi
     WHERE vi.vehicle_id = p_vehicle_id
       AND vi.taken_at IS NOT NULL
       AND NOT coalesce(vi.is_sensitive, false)
       AND NOT coalesce(vi.is_superseded, false)
       AND NOT coalesce(vi.is_duplicate, false)
       AND NOT coalesce(vi.is_video, false)
       AND vi.source IS DISTINCT FROM 'capture_relay_ios_media';
    v_after := interval '2 days';
  END IF;
  IF v_anchor IS NULL THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_no_anchor', 'no purchase_date and no filed photo');
  END IF;
  IF v_row.taken_at < v_anchor - interval '21 days' OR v_row.taken_at >= v_anchor + v_after THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_outside_context');
  END IF;

  -- Cited fields against the vehicle.
  v_vin := upper(btrim(coalesce(v_veh.vin, '')));
  SELECT upper(btrim(f ->> 'value')) INTO v_seller FROM jsonb_array_elements(p_fields) f WHERE f ->> 'name' = 'vin' LIMIT 1;
  IF v_seller IS NOT NULL AND v_seller IS DISTINCT FROM v_vin THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_vin_mismatch');
  END IF;
  IF p_method = 'screen_vin' THEN
    IF length(v_vin) <> 17 OR v_seller IS NULL THEN
      RETURN public.device_media_doc_result(p_row_id, 'refused_vin_mismatch', 'screen_vin needs the vehicle''s own VIN cited');
    END IF;
  ELSE
    SELECT lower(btrim(f ->> 'value')) INTO v_vehicle_text FROM jsonb_array_elements(p_fields) f WHERE f ->> 'name' = 'vehicle' LIMIT 1;
    IF v_veh.year IS NULL OR nullif(btrim(v_veh.make), '') IS NULL OR nullif(btrim(v_veh.model), '') IS NULL
       OR v_vehicle_text IS DISTINCT FROM lower(btrim(v_veh.year::text || ' ' || btrim(v_veh.make) || ' ' || btrim(v_veh.model))) THEN
      RETURN public.device_media_doc_result(p_row_id, 'refused_vehicle_mismatch');
    END IF;
    -- A year + make + model that fits two of the caller's vehicles names neither.
    IF EXISTS (
      SELECT 1 FROM public.user_associated_vehicle_ids(v_caller) a(vid)
        JOIN public.vehicles o ON o.id = a.vid
       WHERE o.id <> p_vehicle_id AND o.deleted_at IS NULL
         AND o.year = v_veh.year
         AND lower(btrim(coalesce(o.make, ''))) = lower(btrim(v_veh.make))
         AND lower(btrim(coalesce(o.model, ''))) = lower(btrim(v_veh.model))
    ) THEN
      RETURN public.device_media_doc_result(p_row_id, 'refused_ambiguous', 'another vehicle has the same year, make and model');
    END IF;
  END IF;

  -- Commercial evidence: a price observation or a seller.
  v_seller := NULL;
  SELECT btrim(f ->> 'value') INTO v_seller FROM jsonb_array_elements(p_fields) f WHERE f ->> 'name' = 'seller' LIMIT 1;
  IF jsonb_array_length(p_prices) = 0 AND v_seller IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f ->> 'name' = 'seller_line') THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_no_commercial_evidence', 'needs a price or a seller line');
  END IF;
  -- The document's amount is the agreed price, and only when exactly one agreed amount was seen. An asking price
  -- or an offer is never the document's amount.
  SELECT count(DISTINCT (f ->> 'amount')::numeric), min((f ->> 'amount')::numeric)
    INTO v_agreed_n, v_agreed
    FROM jsonb_array_elements(p_prices) f WHERE f ->> 'kind' = 'agreed';
  IF v_agreed_n IS DISTINCT FROM 1 THEN v_agreed := NULL; END IF;
  SELECT f ->> 'value' INTO v_date FROM jsonb_array_elements(p_fields) f WHERE f ->> 'name' = 'date' LIMIT 1;
  IF v_date IS NOT NULL AND NOT (v_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' AND coalesce(pg_input_is_valid(v_date, 'date'), false)) THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_fields', 'unreadable date');
  END IF;

  -- Where the preview will land: the phone names it, the storage policy only opens exactly this name.
  v_path := v_row.exif_data #>> '{media,preview_path}';
  IF v_path IS NULL OR v_path !~ ('^users/' || v_caller::text || '/previews/' || p_row_id::text || '\.(mp4|jpg)$') THEN
    RETURN public.device_media_doc_result(p_row_id, 'refused_row', 'preview path is not this row''s own');
  END IF;

  -- Attach: one transaction (this function body), so a failure leaves no document and no vehicle_id.
  SELECT 'Phone ' || replace(v_kind, '_', ' ') || ' of ' || to_char(v_row.taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
         || ' read on the device (screen_text_v1, ' || p_method || ', confidence ' || p_confidence::text || '). Cited: '
         || string_agg((f ->> 'name') || ' ' || (f ->> 'value') || ' [frame ' || (f ->> 'frame') || ' at ' || (f ->> 'seconds') || ' s]', '; ')
         || coalesce('. Prices seen (typed observations, not prices of record): ' || (
              SELECT string_agg((q ->> 'kind') || ' $' || (q ->> 'amount') || ' [frame ' || (q ->> 'frame') || ' at ' || (q ->> 'seconds') || ' s]', '; ')
                FROM jsonb_array_elements(p_prices) q), '')
         || '. capture_media:' || p_row_id::text
    INTO v_desc
    FROM jsonb_array_elements(p_fields) f;

  INSERT INTO public.vehicle_documents
    (vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, amount, vendor_name, currency, privacy_level)
  VALUES
    (p_vehicle_id, v_caller, 'acquisition_document',
     'Acquisition record (' || replace(v_kind, '_', ' ') || ' ' || to_char(v_row.taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ')',
     v_desc, 'capture-media/' || v_path, v_row.mime_type, v_agreed, nullif(v_seller, ''), 'USD', 'private')
  RETURNING id INTO v_doc_id;

  INSERT INTO public.vehicle_price_observations
    (vehicle_id, user_id, price_type, amount, media_row_id, document_id, frame_index, frame_seconds, observed_at)
  SELECT p_vehicle_id, v_caller, f ->> 'kind', (f ->> 'amount')::numeric, p_row_id, v_doc_id,
         (f ->> 'frame')::integer, (f ->> 'seconds')::numeric, v_row.taken_at
    FROM jsonb_array_elements(p_prices) f
  ON CONFLICT (media_row_id, price_type, amount) DO NOTHING;

  UPDATE public.vehicle_images
     SET vehicle_id = p_vehicle_id,
         is_document = true,
         auto_suggested_vehicle_id = p_vehicle_id,
         exif_data = jsonb_set(jsonb_set(jsonb_set(exif_data, '{media,document_id}', to_jsonb(v_doc_id::text), true),
                               '{media,screen_fields}', p_fields, true),
                               '{media,screen_prices}', p_prices, true)
   WHERE id = p_row_id;

  RETURN public.device_media_doc_result(p_row_id, 'filed', v_doc_id::text);
END;
$fn$;

REVOKE ALL ON FUNCTION public.device_media_doc_result(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.device_file_media_document(uuid, uuid, text, numeric, jsonb, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.device_file_media_document(uuid, uuid, text, numeric, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.device_file_media_document(uuid, uuid, text, numeric, jsonb, jsonb) IS
  'Attaches an on-device-read screen recording or screenshot to one vehicle as a private acquisition_document, '
  'after revalidating ownership, association, the acquisition window and the cited fields, and records typed '
  'price observations (asking/offer/agreed/unknown, each with its frame). Preview only; the '
  'original never uploads. Rule screen_text_v1. See apps/nuke-capture-ios/docs/VIDEO_SYNC_PLAN.md.';
