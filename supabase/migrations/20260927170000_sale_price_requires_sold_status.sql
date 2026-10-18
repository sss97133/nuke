-- Lock 1 of the data locks (P3.4 of the approved lock-down plan, 2026-09-27):
-- vehicles.sale_price is accepted only with a sold status.
--
-- Binds every non-owner role, service_role included: it owns no table, so a trigger it cannot disable
-- refuses its write. The owner (postgres) can ALTER TABLE ... DISABLE TRIGGER; the DDL tripwire (lock 4)
-- records that. This is a lock against everything except the owner credentials.
--
-- THE RULE: a positive sale_price claims that money moved. The write is accepted only when
--   * sale_status = 'sold' OR auction_outcome = 'sold'  (the 'status' basis of vehicle_sale_basis()), or
--   * the row already carried that price (an UPDATE that leaves sale_price unchanged — the 247,954 legacy
--     rows measured below stay editable in every other column), or
--   * the transaction runs under nuke.bulk_sale_correction = 'on', which the sanctioned chokepoint
--     correct_vehicle_sale_provenance_batch() sets for itself (migration 20260927020100).
-- Everything else is refused with SQLSTATE 23514 (check_violation) and a hint. Quotes belong in
-- asking_price, bids in high_bid / winning_bid.
--
-- MEASURED (prod, read-only, 2026-09-27 ~17:40Z, session cb179857):
--   vehicles: 947,298 rows; 409,460 with sale_price > 0; 247,954 of those have NO sold status
--   (sale_status <> 'sold' AND auction_outcome <> 'sold'). That is why this is a column-scoped trigger
--   and not a CHECK: a CHECK ... NOT VALID still fails every UPDATE of any column on a violating row.
--   It becomes a CHECK when the corrections finish (P1.4 of the plan).
--
-- LIVE WRITERS CHECKED (deployed code read through the Management API, not the repo copy):
--   extract-bat-core v135: the INSERT payload sets sale_status and auction_outcome to 'sold' together
--     with sale_price (lines 1349-1353); the UPDATE path writes sale_price only inside the branch that
--     also sets both statuses to 'sold' (1651-1663); the unsold branches set sale_price = NULL; a sale
--     field that already holds a different value goes through correct_vehicle_sale_provenance_batch
--     (SALE_FIELDS supersession, 1796+). COMPLIES.
--   bat-closed-lots-sync v1: writes bat_listings only (sale_price only when sold_text says "Sold for",
--     with listing_status 'sold'); vehicles are reached through the trigger fixed below. COMPLIES.
--   ingest v49 / poll-listing-feeds v81: write asking_price only (ingest 753, 847, 1435). COMPLY.
--   ingest-observation v96: writes vehicle_observations only. COMPLIES.
--   DB-side writers on live triggers: apply_auction_listing_outcome_to_vehicle_timeline (vehicle_listings)
--     and auto_mark_vehicle_sold_from_external_listing (external_listings) set sale_status = 'sold' AND
--     auction_outcome = 'sold' with the price. COMPLY.
--     sync_bat_listing_to_vehicle (bat_listings, AFTER INSERT OR UPDATE) copied NEW.sale_price into a
--     vehicle that had none REGARDLESS of listing_status. 2,640 bat_listings rows carry sale_price > 0
--     with listing_status <> 'sold' (of 105,052 priced, 172,606 total); any re-touch of one of them would
--     have been refused here and failed the caller's whole upsert. Fixed below: the copy happens only when
--     listing_status = 'sold', which is the rule itself ("a price alone is never a sale").
--   cron.job: no active job writes sale_price / sale_status / auction_outcome.
--   The dormant SECURITY DEFINER loaders (backfill_sold_vehicles_comprehensive,
--   backfill_vehicle_data_from_bat_listings, drain_bat_queue_from_*, parse_bat_*, upsert_live_auction_
--   vehicles, enrich_cross_ref_*, import_missing_bat_vehicles, batch_apply_bat_parsed,
--   merge_vehicle_into_primary_by_url, auto_merge_duplicates_with_notification) are on no cron and called
--   by no deployed function; each must comply, or use the chokepoint, before it is re-enabled.
--
-- SCHEMA_LAW: §1 nothing guards these columns today (only the vocabulary CHECKs); §5 the invariant lives
-- at the data layer; §6 writers named above; §7 CI-applied; undo = DROP TRIGGER trg_guard_vehicle_sale_price
-- ON public.vehicles (the function may stay). db-safety: no rows are written; CREATE TRIGGER takes a
-- SHARE ROW EXCLUSIVE lock on vehicles for milliseconds, bounded by lock_timeout.

SET statement_timeout = '120s';
SET lock_timeout = '10s';

-- ─── 1. The guard ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_vehicle_sale_price()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- A NULL or non-positive sale_price claims nothing.
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN
    RETURN NEW;
  END IF;

  -- A status says money moved (the 'status' basis in vehicle_sale_basis()).
  IF NEW.sale_status = 'sold' OR NEW.auction_outcome = 'sold' THEN
    RETURN NEW;
  END IF;

  -- The correction chokepoint runs under this transaction-local flag (see 20260927020100).
  IF current_setting('nuke.bulk_sale_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Legacy rows (247,954 priced-without-status on 2026-09-27): every other column stays writable;
  -- the price itself may only change with a status, or through the chokepoint.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE    = 'check_violation',
    CONSTRAINT = 'vehicles_sale_price_requires_sold_status',
    TABLE      = 'vehicles',
    COLUMN     = 'sale_price',
    MESSAGE    = format('vehicles.sale_price = %s refused for %s: no sold status (sale_status = %L, auction_outcome = %L)',
                        NEW.sale_price, NEW.id, NEW.sale_status, NEW.auction_outcome),
    DETAIL     = 'A price alone is a bid, an ask or an estimate, never a sale (vehicle_sale_basis, 2026-09-27).',
    HINT       = 'Write a quote to asking_price and a bid to high_bid / winning_bid. Write a sale with sale_status = ''sold'' or auction_outcome = ''sold'' in the same statement. Supersede a wrong sale value through correct_vehicle_sale_provenance_batch(), never by overwriting it.';
END;
$fn$;

COMMENT ON FUNCTION public.guard_vehicle_sale_price() IS
  'Lock 1 (2026-09-27): refuses a positive vehicles.sale_price unless sale_status/auction_outcome say sold, the price is unchanged (legacy row), or nuke.bulk_sale_correction = on (the correction chokepoint). Binds service_role; only the table owner can disable the trigger.';

DROP TRIGGER IF EXISTS trg_guard_vehicle_sale_price ON public.vehicles;
CREATE TRIGGER trg_guard_vehicle_sale_price
  BEFORE INSERT OR UPDATE OF sale_price, sale_status, auction_outcome ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_sale_price();

-- ─── 2. The one live writer that would have tripped it: sync_bat_listing_to_vehicle ──────────────
-- Body is the live definition (pg_get_functiondef, 2026-09-27) with ONE change in each branch:
-- sale_price is copied from the listing only when the listing says sold. Everything else verbatim.
CREATE OR REPLACE FUNCTION public.sync_bat_listing_to_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Update the linked vehicle with BaT data
  -- Match by vehicle_id (FK) preferring over URL matching for reliability
  IF NEW.vehicle_id IS NOT NULL THEN
    UPDATE vehicles
    SET
      bat_comments = NEW.comment_count,
      bat_bids = NEW.bid_count,
      bat_views = NEW.view_count,
      -- 2026-09-27: a listing price is a sale only when the listing says sold (lock 1)
      sale_price = CASE WHEN NEW.listing_status = 'sold' THEN COALESCE(vehicles.sale_price, NEW.sale_price) ELSE vehicles.sale_price END,
      sale_date = COALESCE(vehicles.sale_date, NEW.sale_date),
      bat_seller = COALESCE(vehicles.bat_seller, NEW.seller_username),
      bat_buyer = COALESCE(vehicles.bat_buyer, NEW.buyer_username),
      bat_listing_title = COALESCE(vehicles.bat_listing_title, NEW.bat_listing_title),
      auction_end_date = COALESCE(vehicles.auction_end_date, NEW.auction_end_date::text),
      -- Post-sale state sync: when BaT listing is sold, update vehicle state
      sale_status = CASE
        WHEN NEW.listing_status = 'sold' AND NEW.sale_price IS NOT NULL
        THEN 'sold'
        ELSE COALESCE(vehicles.sale_status,
          CASE WHEN NEW.listing_status IS NOT NULL THEN NEW.listing_status ELSE vehicles.sale_status END)
      END,
      is_for_sale = CASE
        WHEN NEW.listing_status = 'sold' THEN false
        ELSE vehicles.is_for_sale
      END,
      current_value = CASE
        WHEN NEW.listing_status = 'sold' AND NEW.sale_price IS NOT NULL
        THEN COALESCE(vehicles.current_value, NEW.sale_price)
        ELSE vehicles.current_value
      END,
      updated_at = NOW()
    WHERE id = NEW.vehicle_id;
  ELSIF NEW.bat_listing_url IS NOT NULL THEN
    -- Fallback: match by URL (legacy behavior)
    UPDATE vehicles
    SET
      bat_comments = NEW.comment_count,
      bat_bids = NEW.bid_count,
      bat_views = NEW.view_count,
      -- 2026-09-27: a listing price is a sale only when the listing says sold (lock 1)
      sale_price = CASE WHEN NEW.listing_status = 'sold' THEN COALESCE(vehicles.sale_price, NEW.sale_price) ELSE vehicles.sale_price END,
      sale_date = COALESCE(vehicles.sale_date, NEW.sale_date),
      bat_seller = COALESCE(vehicles.bat_seller, NEW.seller_username),
      bat_buyer = COALESCE(vehicles.bat_buyer, NEW.buyer_username),
      bat_listing_title = COALESCE(vehicles.bat_listing_title, NEW.bat_listing_title),
      auction_end_date = COALESCE(vehicles.auction_end_date, NEW.auction_end_date::text),
      sale_status = CASE
        WHEN NEW.listing_status = 'sold' AND NEW.sale_price IS NOT NULL
        THEN 'sold'
        ELSE COALESCE(vehicles.sale_status,
          CASE WHEN NEW.listing_status IS NOT NULL THEN NEW.listing_status ELSE vehicles.sale_status END)
      END,
      is_for_sale = CASE
        WHEN NEW.listing_status = 'sold' THEN false
        ELSE vehicles.is_for_sale
      END,
      current_value = CASE
        WHEN NEW.listing_status = 'sold' AND NEW.sale_price IS NOT NULL
        THEN COALESCE(vehicles.current_value, NEW.sale_price)
        ELSE vehicles.current_value
      END,
      updated_at = NOW()
    WHERE bat_auction_url = NEW.bat_listing_url
       OR bat_auction_url = NEW.bat_listing_url || '/';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_bat_listing_to_vehicle() IS
  'bat_listings → vehicles gap-fill (AFTER INSERT OR UPDATE). 2026-09-27: sale_price is copied only when listing_status = sold, so the sale guard (trg_guard_vehicle_sale_price) never refuses this trigger; 2,640 legacy bat_listings rows carried a price without a sold status.';

-- ─── Live verification (run after apply) ─────────────────────────────────────────────────────────
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.vehicles'::regclass AND tgname = 'trg_guard_vehicle_sale_price';
--   -> one row, tgenabled = 'O'
-- The attack tests (all rolled back; run them again any time):
--   BEGIN; UPDATE vehicles SET sale_price = 12345 WHERE id = <a vehicle with no sale_price and no sold status>;  -- ERROR 23514
--   ROLLBACK;
--   BEGIN; UPDATE vehicles SET sale_price = 12345, sale_status = 'sold' WHERE id = <same>;  -- UPDATE 1
--   ROLLBACK;
--   BEGIN; SELECT set_config('nuke.bulk_sale_correction', 'on', true);
--          UPDATE vehicles SET sale_price = 12345 WHERE id = <same>;  -- UPDATE 1 (chokepoint context)
--   ROLLBACK;
