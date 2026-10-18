-- propose_listing_vin_merge(holder, listed, vin): the proposal path for two vehicles that one listing's seller-typed VIN says are one car,
-- when the VIN is held by vehicle `holder` and the writer could not put it on vehicle `listed` (a held VIN is never moved).
-- propose_vin_merges() only sees vehicles.vin, so it cannot see this pair. The function files one pending REVIEW row in merge_proposals
-- (never a merge; a merge needs an approved row) with the evidence: the shared VIN, the listing that carries it, the other platform's URL.
-- Defining a service-role function in a reviewed migration, like propose_vin_merges.
-- First use (2026-10-15): eBay Motors listings whose VIN is already held by a BaT or other record, found by the first 420 item reads.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.propose_listing_vin_merge(p_holder uuid, p_listed uuid, p_vin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vin text := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_id uuid;
  v_holder_url text;
  v_listing record;
BEGIN
  IF p_holder IS NULL OR p_listed IS NULL OR p_holder = p_listed OR length(v_vin) < 8 THEN
    RAISE EXCEPTION 'need two different vehicles and a VIN of at least 8 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_holder AND upper(vin) = v_vin) THEN
    RAISE EXCEPTION 'vehicle % does not hold VIN %', p_holder, v_vin USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM merge_proposals
              WHERE (vehicle_a_id = p_holder AND vehicle_b_id = p_listed) OR (vehicle_a_id = p_listed AND vehicle_b_id = p_holder)) THEN
    RETURN NULL;
  END IF;
  SELECT source_url INTO v_holder_url FROM vehicle_events WHERE vehicle_id = p_holder AND source_url IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT source_platform, source_listing_id, source_url INTO v_listing FROM vehicle_events
   WHERE vehicle_id = p_listed AND source_url IS NOT NULL ORDER BY created_at LIMIT 1;
  INSERT INTO merge_proposals (vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence, ai_reasoning, preferred_primary,
                               status, match_tier, confidence, ai_verified, proposed_by, evidence)
  VALUES (p_holder, p_listed, 'listing_vin_match', 'REVIEW', 0.9,
          format('A listing''s seller-typed VIN %s is the VIN vehicle A already holds. Same car, two records.', v_vin),
          'A', 'pending', 1, 0.9, false, 'extract-ebay-motors',
          jsonb_build_object('vin', v_vin, 'basis', 'seller-typed VIN on the listing equals the VIN held by vehicle a',
                             'listing_platform', v_listing.source_platform, 'listing_id', v_listing.source_listing_id, 'listing_url', v_listing.source_url,
                             'holder_url', v_holder_url))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.propose_listing_vin_merge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_listing_vin_merge(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public.propose_listing_vin_merge(uuid, uuid, text) IS
  'Files one pending REVIEW merge_proposals row for two vehicles a listing''s VIN says are one car (holder has the VIN, listed was created from the listing). Idempotent per pair; never merges. Service role only.';
COMMIT;
