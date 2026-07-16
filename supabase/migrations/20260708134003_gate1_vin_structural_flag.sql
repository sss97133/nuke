-- Gate 1: VIN structural validation at write time. FLAG-FIRST (never rejects), consistent
-- with the sale_date gate. Appends data_quality_flags.vin_structurally_suspect when a
-- non-null VIN fails a structural check we can cite. When the era pattern is unknown, does
-- nothing (don't flag what can't be cited). The app UI reads the flag as "check your VIN".

CREATE OR REPLACE FUNCTION public.flag_vin_structurally_suspect()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v        text;
  n        int;
  is_modern boolean;
  bad      boolean := false;
  reason   text := NULL;
  -- check-digit machinery: letter_map[ ascii(c)-64 ] = ISO-3779 transliteration value.
  -- A-Z: A1 B2 C3 D4 E5 F6 G7 H8 I0 J1 K2 L3 M4 N5 O0 P7 Q0 R9 S2 T3 U4 V5 W6 X7 Y8 Z9
  letter_map text := '12345678012345070923456789';
  weights  int[] := ARRAY[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  s        int := 0;
  c        text;
  val      int;
  chk      text;
  p2       text;
BEGIN
  IF NEW.vin IS NULL OR btrim(NEW.vin) = '' THEN
    RETURN NEW;
  END IF;
  v := upper(btrim(NEW.vin));
  n := length(v);

  is_modern := (n = 17) OR (NEW.year IS NOT NULL AND NEW.year >= 1981);

  IF is_modern THEN
    IF n <> 17 THEN
      bad := true; reason := 'modern VIN (year>=1981) must be 17 chars, got '||n;
    ELSIF v ~ '[IOQ]' THEN
      bad := true; reason := '17-char VIN contains illegal I/O/Q';
    ELSIF v !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN
      bad := true; reason := '17-char VIN has non-VIN characters';
    ELSE
      -- ISO 3779 check digit at position 9
      FOR i IN 1..17 LOOP
        c := substr(v, i, 1);
        IF c ~ '[0-9]' THEN val := c::int;
        ELSE val := substr(letter_map, ascii(c) - 64, 1)::int;
        END IF;
        s := s + val * weights[i];
      END LOOP;
      chk := (s % 11)::text;
      IF s % 11 = 10 THEN chk := 'X'; END IF;
      IF chk <> substr(v, 9, 1) THEN
        bad := true; reason := 'check digit mismatch (computed '||chk||', VIN has '||substr(v,9,1)||')';
      END IF;
    END IF;
  ELSE
    -- pre-1981 / short VIN
    IF n < 5 OR n > 16 THEN
      bad := true; reason := 'pre-1981 VIN length out of range (5-16), got '||n;
    ELSIF NEW.year IS NOT NULL AND NEW.year BETWEEN 1973 AND 1980
          AND lower(coalesce(NEW.make,'')) IN ('chevrolet','gmc','chevy')
          AND lower(coalesce(NEW.model,'')) ~ '(blazer|suburban|jimmy|cheyenne|silverado|sierra|pickup|truck|c10|c20|c30|k5|k10|k20|k30|c1500|k1500)' THEN
      -- 1973-80 GM light truck/SUV: pos1 = division (C Chevy / T GMC), pos2 = C (2WD) or K (4WD)
      p2 := substr(v, 2, 1);
      IF p2 NOT IN ('C','K') THEN
        bad := true; reason := '1973-80 GM truck VIN position 2 must be C or K, got '''||p2||'''';
      END IF;
    END IF;
  END IF;

  IF bad THEN
    NEW.data_quality_flags := COALESCE(NEW.data_quality_flags, '{}'::jsonb)
      || jsonb_build_object(
           'vin_structurally_suspect',
           jsonb_build_object('flagged_at', now(), 'vin', v, 'reason', reason,
                              'detector', 'flag_vin_structurally_suspect'));
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_flag_vin_structurally_suspect ON public.vehicles;
CREATE TRIGGER trg_flag_vin_structurally_suspect
  BEFORE INSERT OR UPDATE OF vin, year, make, model ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.flag_vin_structurally_suspect();

COMMENT ON FUNCTION public.flag_vin_structurally_suspect() IS
  'Gate 1: FLAG-ONLY VIN structural validation. Sets data_quality_flags.vin_structurally_suspect for 17-char VIN check-digit/charset failures, wrong-length modern VINs, and 1973-80 GM truck pos2!=C/K (the CRK178P122739 case). Never rejects. Silent when the era pattern is not derivable.';
