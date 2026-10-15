-- flag_duplicate_image as production held it on 2026-10-15 (pg_get_functiondef md5 1646b35a2afde74919d53cc2d3041535). -- gitleaks:allow (function fingerprint, not a secret)
-- A fixture for test_wrong_byte_image_holds.sql only.
CREATE OR REPLACE FUNCTION public.flag_duplicate_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE existing uuid;
BEGIN
  IF NEW.file_hash IS NOT NULL AND NEW.is_duplicate IS NOT TRUE THEN
    SELECT id INTO existing
      FROM vehicle_images
      WHERE user_id = NEW.user_id AND file_hash = NEW.file_hash
      LIMIT 1;
    IF existing IS NOT NULL THEN
      NEW.is_duplicate := true;
      NEW.duplicate_of := existing;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
