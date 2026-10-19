-- auto_classify_vehicle: resolve canonical_make_id from the vehicle's own make text, case-insensitively, and again
-- whenever make changes.
--
-- The trigger set canonical_make_id only while it was NULL and only on an exact-case match, so a rewritten make kept
-- the previous make's id. Measured 2026-10-18 02:30Z over mv_treemap_outcomes (512,978 vehicles): 774 ids named a
-- different make than the vehicle's make (Datsun filed as Nissan, Shelby and Ford both ways, De Tomaso as DeSoto,
-- Austin as Austin-Healey) and 880 were NULL although the make matched a canonical make. mv_treemap_outcomes takes
-- brand_name from this id, so those sales counted under the wrong brand.
--
-- The listed make is testimony; a parent brand is a separate relation (canonical_makes.parent_company), not an
-- identity rewrite. The id follows the make text: display_name first, then canonical_name, then an alias, all
-- case-insensitive, so a make with a row of its own (Datsun) wins over another make's alias for it (Nissan lists
-- 'datsun'). A make that resolves to nothing clears an id inherited from the previous make text; an id the writer
-- sets in the same statement is kept. The trigger also fires on UPDATE OF canonical_make_id, so an id written
-- against a resolvable make is corrected to that make. era and segment_id are unchanged.
--
-- Contract: supabase/sql/test_auto_classify_vehicle_make.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.auto_classify_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_make text;
  v_make_id uuid;
BEGIN
  IF NEW.year IS NOT NULL AND NEW.era IS NULL THEN
    NEW.era := CASE
      WHEN NEW.year < 1946 THEN 'pre-war'
      WHEN NEW.year < 1960 THEN 'post-war'
      WHEN NEW.year < 1973 THEN 'classic'
      WHEN NEW.year < 1985 THEN 'malaise'
      WHEN NEW.year < 2000 THEN 'modern-classic'
      WHEN NEW.year < 2015 THEN 'modern'
      ELSE 'contemporary'
    END;
  END IF;

  IF NEW.make IS NOT NULL AND (
       TG_OP = 'INSERT' OR NEW.canonical_make_id IS NULL
       OR NEW.make IS DISTINCT FROM OLD.make OR NEW.canonical_make_id IS DISTINCT FROM OLD.canonical_make_id) THEN
    v_make := lower(btrim(NEW.make));
    SELECT cm.id INTO v_make_id
    FROM canonical_makes cm
    WHERE lower(cm.display_name) = v_make
       OR lower(cm.canonical_name) = v_make
       OR v_make = ANY (SELECT lower(a) FROM unnest(cm.aliases) AS a)
    ORDER BY lower(cm.display_name) = v_make DESC, lower(cm.canonical_name) = v_make DESC, cm.id
    LIMIT 1;
    IF v_make_id IS NOT NULL THEN
      NEW.canonical_make_id := v_make_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.make IS DISTINCT FROM OLD.make
          AND NEW.canonical_make_id IS NOT DISTINCT FROM OLD.canonical_make_id THEN
      NEW.canonical_make_id := NULL;
    END IF;
  END IF;

  IF NEW.segment_id IS NULL AND NEW.make IS NOT NULL THEN
    SELECT vs.id INTO NEW.segment_id
    FROM vehicle_segments vs
    WHERE
      (vs.slug = 'jdm' AND NEW.make IN ('Toyota','Honda','Nissan','Mazda','Subaru','Mitsubishi','Datsun','Lexus','Acura','Infiniti','Suzuki','Isuzu'))
      OR (vs.slug = 'air-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.year < 1999 AND NEW.model ~* '911|930|964|993|356|914|912')
      OR (vs.slug = 'water-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.model ~* '996|997|991|992|924|944|928|968|Boxster|Cayman|Cayenne|Panamera|Taycan|Macan|718')
      OR (vs.slug = 'muscle-car' AND NEW.make IN ('Chevrolet','Ford','Dodge','Plymouth','Pontiac','AMC','Oldsmobile','Buick','Mercury') AND NEW.model ~* 'Camaro|Mustang|Challenger|Charger|Cuda|Barracuda|GTO|Firebird|Trans Am|Chevelle|Nova|Corvette|Mach 1|Boss|Shelby|Road Runner|GTX|Super Bee|Coronet|442|Cutlass|GSX|Cougar|AMX|Javelin')
      OR (vs.slug = 'supercar' AND (NEW.make IN ('Lamborghini','Bugatti','Pagani','Koenigsegg','McLaren','Rimac') OR (NEW.make = 'Ferrari' AND NEW.model ~* 'F40|F50|Enzo|LaFerrari|288 GTO|250 GTO')))
      OR (vs.slug = 'truck' AND NEW.make IN ('Chevrolet','Ford','Dodge','GMC','Toyota','Ram','International') AND NEW.model ~* 'C10|C20|C30|K10|K20|K5|F-100|F-150|F-250|Pickup|Power Wagon|3100|Sierra|Hilux|Tacoma|S10|Ranger')
      OR (vs.slug = 'off-road' AND ((NEW.make = 'Jeep' AND NEW.model ~* 'CJ|Wrangler|Willys') OR (NEW.make = 'Toyota' AND NEW.model ~* 'Land Cruiser|FJ40|FJ45|FJ55|FJ60|4Runner') OR (NEW.make = 'Land Rover') OR (NEW.make = 'Ford' AND NEW.model ~* 'Bronco')))
      OR (vs.slug = 'euro' AND NEW.make IN ('Alfa Romeo','Fiat','Lancia','Peugeot','Citroen','Renault','Saab','Volvo','Opel'))
      OR (vs.slug = 'luxury' AND NEW.make IN ('Rolls-Royce','Bentley','Maybach','Aston Martin'))
      OR (vs.slug = 'sports-car' AND (NEW.make IN ('Lotus','TVR','Morgan','Caterham','Austin-Healey') OR (NEW.make = 'Jaguar' AND NEW.model ~* 'E-Type|XK|XJS|F-Type') OR (NEW.make = 'MG') OR (NEW.make = 'Triumph' AND NEW.model ~* 'TR|Spitfire|GT6')))
      OR (vs.slug = 'corvette' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Corvette')
      OR (vs.slug = 'mustang' AND NEW.make = 'Ford' AND NEW.model ~* 'Mustang')
      OR (vs.slug = 'camaro' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Camaro')
      OR (vs.slug = 'bronco' AND NEW.make = 'Ford' AND NEW.model ~* 'Bronco')
      OR (vs.slug = 'defender' AND NEW.make = 'Land Rover' AND NEW.model ~* 'Defender|Series')
      OR (vs.slug = 'g-wagon' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* 'G-Class|G-Wagon|G500|G550|G63|240GD|280GE|300GD|460|461|463')
      OR (vs.slug = 'e30' AND NEW.make = 'BMW' AND NEW.model ~* 'E30|325i|325is|318i|M3' AND NEW.year BETWEEN 1982 AND 1994)
      OR (vs.slug = 'e36' AND NEW.make = 'BMW' AND NEW.model ~* 'E36|318|323|325|328|M3' AND NEW.year BETWEEN 1992 AND 1999)
      OR (vs.slug = 'e46' AND NEW.make = 'BMW' AND NEW.model ~* 'E46|323|325|328|330|M3' AND NEW.year BETWEEN 1998 AND 2006)
      OR (vs.slug = 'skyline' AND NEW.make = 'Nissan' AND NEW.model ~* 'Skyline|GT-R|GTR')
      OR (vs.slug = 'miata' AND NEW.make = 'Mazda' AND NEW.model ~* 'MX-5|Miata')
      OR (vs.slug = 'supra' AND NEW.make = 'Toyota' AND NEW.model ~* 'Supra')
      OR (vs.slug = 'rx7' AND NEW.make = 'Mazda' AND NEW.model ~* 'RX-7|RX7')
      OR (vs.slug = 'nsx' AND NEW.make IN ('Acura','Honda') AND NEW.model ~* 'NSX')
      OR (vs.slug = 'w123' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* '240D|300D|300TD|280E' AND NEW.year BETWEEN 1976 AND 1985)
      OR (vs.slug = 'w124' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* '300E|300CE|E320|E420|E500|500E' AND NEW.year BETWEEN 1985 AND 1996)
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trigger_auto_classify_vehicle
  BEFORE INSERT OR UPDATE OF make, model, year, canonical_make_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.auto_classify_vehicle();

COMMENT ON FUNCTION public.auto_classify_vehicle() IS
  'BEFORE INSERT/UPDATE on vehicles: era from year; canonical_make_id from the make text (display_name, then '
  'canonical_name, then alias, case-insensitive), re-resolved when make or canonical_make_id changes; segment_id '
  'while NULL. 20261018230000.';

COMMIT;
