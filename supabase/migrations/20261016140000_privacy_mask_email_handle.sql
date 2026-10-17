-- Privacy scrub for member handles that are email addresses.
--
-- PCarMarket lets a member's handle be an email address, and we stored it as the winning bidder, buyer, identity handle and
-- comment author (readable by anon through select=*). No existing writer covers those columns, so this adds one: the original
-- is copied to private.privacy_masked_values (service_role only), then replaced by a stable 'bidder-<8 hex of sha256>'
-- everywhere the handle appears. The caller passes the sha256 of the lower-cased handle, so the address never appears in SQL
-- text or logs. Bounded, idempotent (a masked handle no longer matches), service_role only.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.privacy_masked_values (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name     text NOT NULL,
  row_id         uuid NOT NULL,
  column_name    text NOT NULL,
  original_value text NOT NULL,
  masked_value   text NOT NULL,
  source         text NOT NULL DEFAULT 'privacy mask: email-form handle',
  masked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_masked_values_row ON private.privacy_masked_values (table_name, row_id);
REVOKE ALL ON TABLE private.privacy_masked_values FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.privacy_masked_values TO service_role;
COMMENT ON TABLE private.privacy_masked_values IS 'Originals of values replaced by privacy_mask_email_handle: table, row, column, original, masked form, source, time. service_role only.';

CREATE OR REPLACE FUNCTION public.privacy_mask_email_handle(p_handle_hash text, p_platform text DEFAULT 'pcarmarket')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private', 'pg_temp'
AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_id uuid; v_handle text; v_mask text;
  v_vehicles uuid[]; v_n jsonb := '{}'::jsonb; v_c bigint;
  v_src constant text := 'privacy mask: email-form handle';
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'privacy_mask_email_handle: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_handle_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'privacy_mask_email_handle: p_handle_hash must be a lowercase sha256 hex'; END IF;

  -- The identity: platform + sha256(lower(handle)); only email-form handles (an @ inside and a dot after it).
  SELECT e.id, e.handle INTO v_id, v_handle FROM public.external_identities e
   WHERE e.platform = p_platform AND e.handle ~ '.@.+\..' AND encode(sha256(convert_to(lower(e.handle), 'UTF8')), 'hex') = p_handle_hash;
  IF v_id IS NULL THEN RETURN jsonb_build_object('masked', false, 'reason', 'no_matching_email_form_handle'); END IF;

  v_mask := 'bidder-' || substr(p_handle_hash, 1, 8);
  IF EXISTS (SELECT 1 FROM public.external_identities WHERE platform = p_platform AND handle = v_mask) THEN v_mask := 'bidder-' || substr(p_handle_hash, 1, 14); END IF;

  -- Vehicles reached through this identity's comment/bid rows (indexed by author_external_identity_id).
  SELECT coalesce(array_agg(DISTINCT vehicle_id), '{}') INTO v_vehicles FROM public.auction_comments WHERE author_external_identity_id = v_id;

  -- auction_comments: author and the content hash that embeds the handle
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'auction_comments', id, 'author_username', author_username, v_mask, v_src FROM public.auction_comments WHERE author_external_identity_id = v_id AND author_username = v_handle;
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'auction_comments', id, 'content_hash', content_hash, replace(content_hash, v_handle, v_mask), v_src FROM public.auction_comments WHERE author_external_identity_id = v_id AND content_hash LIKE '%' || v_handle || '%';
  UPDATE public.auction_comments SET author_username = v_mask, content_hash = replace(content_hash, v_handle, v_mask)
   WHERE author_external_identity_id = v_id AND (author_username = v_handle OR content_hash LIKE '%' || v_handle || '%');
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('auction_comments', v_c);

  -- auction_events: winning/high bidder and the bid_history entries
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'auction_events', id, 'winning_bidder', winning_bidder, v_mask, v_src FROM public.auction_events WHERE vehicle_id = ANY (v_vehicles) AND winning_bidder = v_handle;
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'auction_events', id, 'high_bidder', high_bidder, v_mask, v_src FROM public.auction_events WHERE vehicle_id = ANY (v_vehicles) AND high_bidder = v_handle;
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'auction_events', id, 'bid_history', v_handle, v_mask, v_src FROM public.auction_events WHERE vehicle_id = ANY (v_vehicles) AND bid_history::text LIKE '%' || v_handle || '%';
  UPDATE public.auction_events SET
      winning_bidder = CASE WHEN winning_bidder = v_handle THEN v_mask ELSE winning_bidder END,
      high_bidder = CASE WHEN high_bidder = v_handle THEN v_mask ELSE high_bidder END,
      bid_history = CASE WHEN bid_history::text LIKE '%' || v_handle || '%'
        THEN (SELECT jsonb_agg(CASE WHEN el ->> 'user' = v_handle THEN jsonb_set(el, '{user}', to_jsonb(v_mask)) ELSE el END) FROM jsonb_array_elements(bid_history) el)
        ELSE bid_history END
   WHERE vehicle_id = ANY (v_vehicles) AND (winning_bidder = v_handle OR high_bidder = v_handle OR bid_history::text LIKE '%' || v_handle || '%');
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('auction_events', v_c);

  -- vehicle_events: buyer_identifier
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'vehicle_events', id, 'buyer_identifier', buyer_identifier, v_mask, v_src FROM public.vehicle_events WHERE vehicle_id = ANY (v_vehicles) AND buyer_identifier = v_handle;
  UPDATE public.vehicle_events SET buyer_identifier = v_mask WHERE vehicle_id = ANY (v_vehicles) AND buyer_identifier = v_handle;
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('vehicle_events', v_c);

  -- vehicles.origin_metadata: the importer stored the buyer handle there
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    SELECT 'vehicles', id, 'origin_metadata.pcarmarket_buyer_username', v_handle, v_mask, v_src FROM public.vehicles WHERE id = ANY (v_vehicles) AND origin_metadata ->> 'pcarmarket_buyer_username' = v_handle;
  UPDATE public.vehicles SET origin_metadata = jsonb_set(origin_metadata, '{pcarmarket_buyer_username}', to_jsonb(v_mask))
   WHERE id = ANY (v_vehicles) AND origin_metadata ->> 'pcarmarket_buyer_username' = v_handle;
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('vehicles', v_c);

  -- external_identities: handle and the profile URL that embeds it
  INSERT INTO private.privacy_masked_values (table_name, row_id, column_name, original_value, masked_value, source)
    VALUES ('external_identities', v_id, 'handle', v_handle, v_mask, v_src);
  UPDATE public.external_identities SET handle = v_mask, profile_url = replace(profile_url, v_handle, v_mask),
         display_name = CASE WHEN display_name = v_handle THEN v_mask ELSE display_name END, updated_at = now()
   WHERE id = v_id;
  v_n := v_n || jsonb_build_object('external_identities', 1);

  RETURN jsonb_build_object('masked', true, 'mask', v_mask, 'vehicles', cardinality(v_vehicles), 'rows', v_n);
END $$;

REVOKE ALL ON FUNCTION public.privacy_mask_email_handle(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_mask_email_handle(text, text) TO service_role;
COMMENT ON FUNCTION public.privacy_mask_email_handle(text, text) IS 'Replaces one email-form member handle (found by sha256 of its lower-cased text) with bidder-<8 hex> in auction_comments, auction_events, vehicle_events, vehicles.origin_metadata and external_identities, copying each original to private.privacy_masked_values first. service_role only; idempotent.';

COMMIT;
