-- enforce_user_vehicle_evidence: allow revocations to bypass evidence check
--
-- The previous version raised on every UPDATE where NEW.role IN
-- ('owner', 'co_owner', 'contributor', 'consigned'). This made it
-- impossible to flip is_active=false without re-proving evidence — even
-- though revocation is the opposite of assignment.
--
-- Fix: early return when the operation is a revocation
-- (TG_OP=UPDATE, OLD.is_active=true, NEW.is_active=false). Original
-- intent of the trigger — gate ownership *assignments* — is preserved.
--
-- Discovered 2026-05-05 during garage cleanup audit: 19 bogus OWNER
-- perms from a 2026-03-09 backfill could not be revoked because the
-- trigger blocked the supersession PATCH. Per agent-trust-invariants
-- the right move is supersession (is_active=false), not DELETE.

CREATE OR REPLACE FUNCTION public.enforce_user_vehicle_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Revocations always allowed: an active row going inactive
  -- doesn't claim anything new, it retracts a prior claim.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_active, false) = true
     AND COALESCE(NEW.is_active, false) = false THEN
    RETURN NEW;
  END IF;

  -- previously_owned: user attestation OK, no evidence required
  IF NEW.role = 'previously_owned' THEN
    RETURN NEW;
  END IF;

  -- owner: require approved ownership_verifications with real URLs
  IF NEW.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot assign role=owner without approved ownership verification with valid document URL. Vehicle: %, User: %',
        NEW.vehicle_id, NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  -- co_owner, contributor, consigned: require photo evidence OR ownership docs
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = NEW.vehicle_id
        AND ov.user_id = NEW.user_id
        AND ov.status = 'approved'
        AND ov.title_document_url ~ '^https://'
    ) THEN
      RAISE EXCEPTION 'Cannot link user to vehicle without photo contributions or ownership documents. Role: %, Vehicle: %, User: %',
        NEW.role, NEW.vehicle_id, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
