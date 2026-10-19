-- Classic chassis serials are scoped by manufacturer. The first capture-fold
-- migration was already present on main, so the push deployer correctly did not
-- replay that edited file. Move this trigger correction to a new forward file.
SET lock_timeout = '3s';
SET statement_timeout = '10s';

DO $owner_guard$
DECLARE
  v_definition text := pg_get_functiondef('public.enforce_vin_uniqueness()'::regprocedure);
  v_current_hash text := md5(v_definition);
BEGIN
  IF position('v_classic_serial' IN v_definition) > 0 THEN RETURN; END IF;
  IF v_current_hash <> '3896038eacd5775f349b5b5d22a8a9c3' THEN -- gitleaks:allow (function-definition fingerprint, not a credential)
    RAISE EXCEPTION 'vehicle identifier uniqueness trigger drift (md5 %); re-read it', v_current_hash;
  END IF;

  EXECUTE $definition$CREATE OR REPLACE FUNCTION public.enforce_vin_uniqueness()
  RETURNS trigger
  LANGUAGE plpgsql AS $function$
  DECLARE
    v_norm text;
    v_existing uuid;
    v_classic_serial boolean;
  BEGIN
    IF NEW.vin IS NULL OR length(trim(NEW.vin)) < 11 THEN
      RETURN NEW;
    END IF;

    v_norm := upper(trim(NEW.vin));
    v_classic_serial := length(v_norm) < 17
      AND NEW.profile_origin = 'device_evidence'
      AND NEW.origin_metadata -> 'device_evidence' ->> 'basis' IN ('serial_album', 'capture_session');

    IF v_classic_serial THEN
      SELECT id INTO v_existing
        FROM public.vehicles
       WHERE upper(trim(vin)) = v_norm
         AND upper(public.normalize_make(make)) = upper(public.normalize_make(NEW.make))
         AND id <> NEW.id
       LIMIT 1;
    ELSE
      SELECT id INTO v_existing
        FROM public.vehicles
       WHERE upper(trim(vin)) = v_norm
         AND id <> NEW.id
       LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'VIN or chassis identifier % already exists on vehicle %', v_norm, v_existing
        USING ERRCODE = 'unique_violation',
              HINT = 'Attach observations to the existing vehicle via the sanctioned identity path.';
    END IF;
    RETURN NEW;
  END;
  $function$;$definition$;
END;
$owner_guard$;
