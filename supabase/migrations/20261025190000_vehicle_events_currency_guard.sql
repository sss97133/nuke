-- Guard new vehicle_events price writes against unlabeled native currency.
-- Found 2026-10-23: 394 sold rows (RM Sotheby's EUR, Gooding GBP/EUR, Bonhams GBP/EUR/CHF) carried
-- metadata.currency but currency_code NULL, and Collecting Cars stored GBP/EUR/AUD amounts as if USD.
-- 1. If the writer put an ISO code in metadata.currency / metadata.currency_code and left currency_code
--    NULL, copy it (cited in currency_source). Not a guess: the importer's own field.
-- 2. Reject a currency_code that contradicts metadata.currency.
-- 3. Reject a priced write with no currency for houses whose native currency is not USD.
-- Rule 3 fires only on INSERT or when a price value changes, so metadata-only edits of legacy rows pass.
-- Revert: DROP TRIGGER IF EXISTS trg_vehicle_events_currency_guard ON public.vehicle_events;
--         DROP FUNCTION IF EXISTS public.vehicle_events_currency_guard();
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_events_currency_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meta_cur text := upper(coalesce(NEW.metadata->>'currency_code', NEW.metadata->>'currency'));
  priced boolean := coalesce(NEW.final_price, NEW.current_price, NEW.hammer_price, NEW.starting_price) IS NOT NULL;
BEGIN
  IF meta_cur IS NOT NULL AND meta_cur !~ '^[A-Z]{3}$' THEN meta_cur := NULL; END IF;
  IF NEW.currency_code IS NULL AND meta_cur IS NOT NULL AND priced THEN
    NEW.currency_code := meta_cur;
    NEW.currency_source := coalesce(NEW.currency_source, 'currency_guard: copied from writer metadata.currency');
  END IF;
  IF NEW.currency_code IS NOT NULL AND meta_cur IS NOT NULL AND NEW.currency_code <> meta_cur THEN
    RAISE EXCEPTION 'vehicle_events currency_code % contradicts metadata currency % (event %)', NEW.currency_code, meta_cur, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code IS NULL AND priced
     AND (TG_OP = 'INSERT' OR (NEW.final_price, NEW.current_price, NEW.hammer_price, NEW.starting_price)
          IS DISTINCT FROM (OLD.final_price, OLD.current_price, OLD.hammer_price, OLD.starting_price))
     AND NEW.source_platform IN
     ('collecting_cars','shannons','historics','coys','car_and_classic','catawiki','iconic','silverstone',
      'aguttes','artcurial','pickles','lloyds','trade_me','L''Art de l''Automobile') THEN
    RAISE EXCEPTION 'vehicle_events price on non-USD house % needs currency_code (event %)', NEW.source_platform, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vehicle_events_currency_guard ON public.vehicle_events;
CREATE TRIGGER trg_vehicle_events_currency_guard
  BEFORE INSERT OR UPDATE OF final_price, current_price, hammer_price, starting_price, currency_code, metadata
  ON public.vehicle_events FOR EACH ROW EXECUTE FUNCTION public.vehicle_events_currency_guard();
