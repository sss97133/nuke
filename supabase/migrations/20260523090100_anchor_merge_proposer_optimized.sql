-- 20260523090100_anchor_merge_proposer_optimized.sql
--
-- The original propose_anchor_merges() called compute_origination_anchor() in
-- a join, which blew the 120s timeout on the full vehicles table (148K rows).
--
-- Split into three cheaper functions:
--   propose_vin_merges()          — fast SQL, no function calls
--   propose_owner_merges(user_id) — scoped to one owner at a time
--   propose_anchor_merges()       — runs all owners + vin in sequence

DROP FUNCTION IF EXISTS public.propose_anchor_merges();

-- VIN duplicates — fast, runs on whole table
CREATE OR REPLACE FUNCTION public.propose_vin_merges()
RETURNS TABLE (proposal_id UUID, vehicle_a UUID, vehicle_b UUID, basis TEXT, confidence NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
  v_pair RECORD;
  v_id UUID;
BEGIN
  FOR v_pair IN
    SELECT upper(trim(vin)) AS vin_key,
           (array_agg(id ORDER BY created_at))[1] AS keeper,
           (array_agg(id ORDER BY created_at))[2] AS dupe
      FROM vehicles
     WHERE vin IS NOT NULL AND length(trim(vin)) >= 11
     GROUP BY upper(trim(vin))
    HAVING count(*) >= 2
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM merge_proposals
       WHERE (vehicle_a_id = v_pair.keeper AND vehicle_b_id = v_pair.dupe)
          OR (vehicle_a_id = v_pair.dupe AND vehicle_b_id = v_pair.keeper)
    ) THEN
      INSERT INTO merge_proposals (
        vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence,
        ai_reasoning, preferred_primary, status, match_tier, confidence,
        ai_verified, proposed_by
      ) VALUES (
        v_pair.keeper, v_pair.dupe,
        'anchor_system_vin_match', 'MERGE', 0.99,
        format('Same VIN %s on two vehicles. T1 anchor auto-merge.', v_pair.vin_key),
        'A', 'pending', 1, 0.99, true, 'origination_anchor_cron'
      ) RETURNING id INTO v_id;

      proposal_id := v_id; vehicle_a := v_pair.keeper; vehicle_b := v_pair.dupe;
      basis := 'vin_match'; confidence := 0.99;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.propose_vin_merges() TO authenticated;

-- Same-owner same-first-photo dupes — scoped per owner so it stays fast
CREATE OR REPLACE FUNCTION public.propose_owner_merges(p_owner UUID)
RETURNS TABLE (proposal_id UUID, vehicle_a UUID, vehicle_b UUID, basis TEXT, confidence NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
  v_pair RECORD;
  v_id UUID;
BEGIN
  FOR v_pair IN
    WITH owner_vehicles AS (
      -- Find vehicles where this owner is the dominant photo uploader
      SELECT
        vi.vehicle_id,
        v.year, v.make, v.model,
        MIN(vi.taken_at)::date AS first_photo,
        count(*) AS photo_count
      FROM vehicle_images vi
      JOIN vehicles v ON v.id = vi.vehicle_id
      WHERE vi.user_id = p_owner
      GROUP BY vi.vehicle_id, v.year, v.make, v.model
      HAVING count(*) >= 5  -- de-noise: only consider vehicles with real photo activity
    ),
    pairs AS (
      SELECT
        a.vehicle_id AS a_id, b.vehicle_id AS b_id,
        a.first_photo, a.photo_count AS a_n, b.photo_count AS b_n
      FROM owner_vehicles a
      JOIN owner_vehicles b ON a.vehicle_id < b.vehicle_id
        AND a.year = b.year AND a.make = b.make AND a.model = b.model
        AND a.first_photo = b.first_photo
    )
    SELECT * FROM pairs
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM merge_proposals
       WHERE (vehicle_a_id = v_pair.a_id AND vehicle_b_id = v_pair.b_id)
          OR (vehicle_a_id = v_pair.b_id AND vehicle_b_id = v_pair.a_id)
    ) THEN
      INSERT INTO merge_proposals (
        vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence,
        ai_reasoning, preferred_primary, status, match_tier, confidence,
        ai_verified, proposed_by
      ) VALUES (
        v_pair.a_id, v_pair.b_id,
        'anchor_system_owner_match', 'MERGE', 0.92,
        format('Owner %s has two same-year/make/model vehicles with identical first_photo %s. a=%s photos, b=%s photos.',
               p_owner, v_pair.first_photo, v_pair.a_n, v_pair.b_n),
        'A', 'pending', 2, 0.92, true, 'origination_anchor_cron'
      ) RETURNING id INTO v_id;

      proposal_id := v_id; vehicle_a := v_pair.a_id; vehicle_b := v_pair.b_id;
      basis := 'same_owner_same_first_photo'; confidence := 0.92;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.propose_owner_merges(UUID) TO authenticated;

-- Convenience: top-level runner
CREATE OR REPLACE FUNCTION public.propose_anchor_merges()
RETURNS TABLE (proposal_id UUID, vehicle_a UUID, vehicle_b UUID, basis TEXT, confidence NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE v_owner UUID;
BEGIN
  -- VIN merges first (fast, whole table)
  RETURN QUERY SELECT * FROM propose_vin_merges();

  -- Then per-owner merges
  FOR v_owner IN
    SELECT DISTINCT user_id FROM vehicle_images
     WHERE user_id IS NOT NULL
     GROUP BY user_id
    HAVING count(*) >= 10
  LOOP
    RETURN QUERY SELECT * FROM propose_owner_merges(v_owner);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.propose_anchor_merges() TO authenticated;
