-- 20260524000100_vin_uniqueness_trigger.sql
--
-- Shape rule: a VIN cannot exist on two vehicle rows.
--
-- Why a trigger and not UNIQUE INDEX: 139 existing dupe VIN groups (143 pending
-- merge_proposals). A full UNIQUE would fail at create time. A partial UNIQUE
-- with created_at >= '2026-05-23' would let new rows collide with old rows.
-- A trigger enforces "no new dupes" regardless of historical state — once the
-- 143 proposals drain, this trigger can be promoted to a full UNIQUE.
--
-- The trigger rejects INSERT or UPDATE that would land a VIN already held by
-- another row (case-insensitive, trimmed, length >= 11).

CREATE OR REPLACE FUNCTION public.enforce_vin_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_norm TEXT;
  v_existing UUID;
BEGIN
  IF NEW.vin IS NULL OR length(trim(NEW.vin)) < 11 THEN
    RETURN NEW;  -- short / empty VINs are not real VINs
  END IF;

  v_norm := upper(trim(NEW.vin));

  SELECT id INTO v_existing
    FROM vehicles
   WHERE upper(trim(vin)) = v_norm
     AND id <> NEW.id
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'VIN % already exists on vehicle %', v_norm, v_existing
      USING ERRCODE = 'unique_violation',
            HINT = 'Attach observations to the existing vehicle via ingest-observation, or resolve via merge_proposals.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_vin_uniqueness ON public.vehicles;
CREATE TRIGGER trg_enforce_vin_uniqueness
  BEFORE INSERT OR UPDATE OF vin ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_vin_uniqueness();

COMMENT ON FUNCTION public.enforce_vin_uniqueness() IS
'Shape rule: rejects INSERT/UPDATE that would put an existing VIN on a second vehicle row. Forward-only — historical dupes are not deleted (testimony invariant). Promotable to UNIQUE INDEX after the 143 pending merge_proposals drain.';
