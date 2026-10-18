-- 20261006234500_enforce_vehicle_sale_date_retraction.sql
--
-- The mechanism behind a rule lanes S2 and V2b (2026-10-06) recorded only in their audit entries: a vehicles.sale_date
-- that correct_vehicle_sale_provenance_batch retracted to NULL because the day was an importer's write clock stays
-- retracted. Nothing enforced it.
--
-- The hole, read-only on prod at 2026-10-06 23:32Z over the 1,231 PCARMARKET vehicles lane V2b retracted at 23:15-23:19Z
-- (all 1,231 still NULL, 0 re-dated):
--   * trigger_auto_mark_vehicle_sold (AFTER INSERT OR UPDATE OF listing_status, final_price, sold_at, end_date ON
--     external_listings, WHEN sold) runs auto_mark_vehicle_sold_from_external_listing(), which sets vehicles.sale_date =
--     coalesce(sold_at::date, end_date::date, current_date) when sale_date is NULL or earlier. 1,201 of the 1,231 keep a
--     PCARMARKET external_listings row reading sold whose sold_at is the importer's write clock (sub-second, within 1 s
--     of the row's created_at or updated_at). An update of one of those columns re-dates the vehicle. 730 of the 1,201
--     rows have no end_date, so skipping sold_at alone would stamp current_date instead.
--   * fix_missing_sale_dates() (unscheduled) fills every NULL sale_date with sale_price > 0 from
--     external_listings.sold_at::date: one call re-dates 1,196 of the 1,231.
--   * import-pcarmarket-listing writes vehicles.sale_date from the page on a re-import.
--   No sanctioned writer supersedes external_listings.sold_at, so the source rows stay. The vehicle has to refuse the day.
--
-- What this migration does:
--   1. enforce_vehicle_sale_date_retraction(), BEFORE UPDATE OF sale_date ON vehicles, only on rows whose sale_date
--      moves to a non-NULL day and whose provenance_metadata carries sale_provenance_corrections (trigger WHEN clause).
--      The write is refused when the latest sale_date entry for that exact day is a retraction (corrected null, original
--      = the day) whose source basis, type or finding, or whose reason, names a write clock or an ingest stamp, and no
--      later entry set that day again. A refused write keeps OLD.sale_date and is recorded in
--      provenance_metadata.sale_date_lock_hits[] (last 20); the rest of the row lands. The sanctioned writer re-asserting
--      the day passes: its transaction-local nuke.bulk_sale_correction flag plus its own new audit entry for that day in
--      the same row write. Any other day passes. Nothing is raised.
--   2. auto_mark_vehicle_sold_from_external_listing(): a sold_at that carries the write-clock signature names no sale
--      day, so for that row the function leaves vehicles.sale_date and organization_vehicles.sale_date as they are (no
--      end_date or current_date fallback). Every other line is the live body (md5 0e35eebd..., read 2026-10-06 23:20Z).
--   3. Names the mechanism where the rule lives: a pipeline_registry row for vehicles.sale_date (none existed; an
--      existing row is appended to, never replaced) and the comments on vehicles.sale_date, vehicles.provenance_metadata,
--      external_listings.sold_at and both functions.
--
-- Trigger order: BEFORE UPDATE triggers fire in name order. trg_enforce_vehicle_sale_date_retraction sorts before
-- trg_flag_sale_date_ingest_stamp, the only other BEFORE trigger on vehicles that reads sale_date, so a refused day is
-- never flagged. No BEFORE trigger on vehicles sets sale_date (prod, 2026-10-06).
--
-- Cost: CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE on vehicles until COMMIT (readers continue, writers wait;
-- DROP TRIGGER would take ACCESS EXCLUSIVE, so nothing here drops); it runs last, a few statements before COMMIT, and
-- lock_timeout 5 s caps the wait behind an in-flight writer. No index, no table rewrite, no row replay. A row whose
-- sale_date does not move stops at the WHEN clause's second comparison; a moving row without corrections adds one jsonb
-- key test. Local PG17, 196,006 such rows moved per UPDATE, 5 alternating runs: median 1,149 ms with the guard, 1,142 ms
-- without.
--
-- Contract: supabase/sql/test_vehicle_sale_date_retraction_guard.sql (PostgreSQL 17, CI job metric-fold-health-contract).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Refuse to replace a producer body that changed after it was read.
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure));
  IF f = '9c8f473e3b4b9ce2b21e96be6e6b7e35' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'auto_mark_vehicle_sold_from_external_listing already leaves write-clock days alone';
  ELSIF f <> '0e35eebd55832b86f7c8b4ae567806ca' THEN -- gitleaks:allow (live fingerprint read 2026-10-06 23:20Z, not a secret)
    RAISE EXCEPTION 'auto_mark_vehicle_sold_from_external_listing drifted since 2026-10-06 23:20Z (md5 %); review before replacement', f;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.enforce_vehicle_sale_date_retraction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day     text := to_char(NEW.sale_date, 'YYYY-MM-DD');
  v_entries jsonb := OLD.provenance_metadata -> 'sale_provenance_corrections';
  v_written jsonb;
  v_lock_at bigint;
  v_lift_at bigint;
  v_meta    jsonb;
  v_hits    jsonb;
BEGIN
  IF v_day IS NULL OR jsonb_typeof(v_entries) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  -- Position of the latest write-clock retraction of this day, and of the latest entry that set this day.
  SELECT max(t.i) FILTER (
           WHERE t.e -> 'corrected' = 'null'::jsonb
             AND left(t.e ->> 'original', 10) = v_day
             AND concat_ws(' ', t.e -> 'source' ->> 'basis', t.e -> 'source' ->> 'type',
                                t.e -> 'source' ->> 'finding', t.e ->> 'reason')
                 ~* 'write[ _-]?(clock|time)|ingest[ _-]?stamp'),
         max(t.i) FILTER (WHERE left(t.e ->> 'corrected', 10) = v_day)
    INTO v_lock_at, v_lift_at
  FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(e, i)
  WHERE t.e ->> 'field' = 'sale_date';

  IF v_lock_at IS NULL OR v_lock_at < coalesce(v_lift_at, 0) THEN
    RETURN NEW;
  END IF;

  -- The sanctioned writer re-asserting this day passes: it runs under its transaction-local flag and appends its own
  -- cited audit entry for this day in the same row write.
  IF current_setting('nuke.bulk_sale_correction', true) = 'on' THEN
    v_written := NEW.provenance_metadata -> 'sale_provenance_corrections';
    IF jsonb_typeof(v_written) = 'array' AND jsonb_array_length(v_written) > jsonb_array_length(v_entries) THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_written) WITH ORDINALITY AS w(e, i)
                 WHERE w.i > jsonb_array_length(v_entries)
                   AND w.e ->> 'field' = 'sale_date'
                   AND left(w.e ->> 'corrected', 10) = v_day) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Refused: the column keeps its value, the attempt is recorded, the rest of the row lands.
  NEW.sale_date := OLD.sale_date;
  v_meta := CASE WHEN jsonb_typeof(NEW.provenance_metadata) = 'object' THEN NEW.provenance_metadata
                 ELSE OLD.provenance_metadata END;
  IF NOT (v_meta ? 'sale_provenance_corrections') THEN
    v_meta := v_meta || jsonb_build_object('sale_provenance_corrections', v_entries);
  END IF;
  v_hits := CASE WHEN jsonb_typeof(v_meta -> 'sale_date_lock_hits') = 'array'
                 THEN v_meta -> 'sale_date_lock_hits' ELSE '[]'::jsonb END;
  WHILE jsonb_array_length(v_hits) >= 20 LOOP
    v_hits := v_hits - 0;
  END LOOP;
  NEW.provenance_metadata := v_meta || jsonb_build_object('sale_date_lock_hits', v_hits || jsonb_build_array(
    jsonb_build_object(
      'at', now(),
      'blocked_day', v_day,
      'kept', OLD.sale_date,
      'retraction_asserted_by', v_entries -> (v_lock_at::int - 1) ->> 'asserted_by',
      'app_writer', nullif(current_setting('app.writer', true), ''),
      'db_role', current_user::text,
      'session_role', session_user::text,
      'trigger_depth', pg_trigger_depth())));
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.enforce_vehicle_sale_date_retraction() IS
'BEFORE UPDATE guard for vehicles.sale_date (migration 20261006234500). Refuses a write of a day that correct_vehicle_sale_provenance_batch retracted as an importer write clock: the latest provenance_metadata.sale_provenance_corrections entry with field sale_date for that day has corrected null, original = the day (ISO text), and source.basis, source.type, source.finding or reason matching write clock / write time / ingest stamp, with no later entry setting that day. A refused write keeps OLD.sale_date and appends {at, blocked_day, kept, retraction_asserted_by, app_writer, db_role, session_role, trigger_depth} to provenance_metadata.sale_date_lock_hits (last 20); the retraction record is put back if the same write dropped it; the rest of the row lands. Passes the sanctioned writer re-asserting the day (nuke.bulk_sale_correction = on and a new audit entry for that day in the same row write), any other day, and every retraction to NULL. Never raises. Assay: vehicles with jsonb_array_length(provenance_metadata->''sale_date_lock_hits'') > 0 name a writer still trying to land a retracted day.';

-- The producer: a write-clock sold_at is not a sale day. Live body except the declaration of sold_at_is_write_clock,
-- the block that sets it, and the new_sale_date assignment.
CREATE OR REPLACE FUNCTION public.auto_mark_vehicle_sold_from_external_listing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  affected_rows integer;
  sale_amount numeric;
  new_sale_date date;
  sold_at_is_write_clock boolean := false;
begin
  -- Only process when listing_status is sold
  if new.listing_status = 'sold' and new.vehicle_id is not null then
    affected_rows := 0;
    sale_amount := coalesce(new.final_price, new.current_bid);
    -- A sold_at with sub-second precision within 1 s of this row's own created_at or updated_at is the clock of the
    -- write that stored it (import-pcarmarket-listing, Feb 2026), not a sale instant. Such a row names no sale day:
    -- vehicles.sale_date and organization_vehicles.sale_date stay as they are (migration 20261006234500).
    if new.sold_at is not null and date_trunc('second', new.sold_at) <> new.sold_at then
      sold_at_is_write_clock := coalesce(abs(extract(epoch from new.sold_at - new.created_at)) <= 1, false)
                             or coalesce(abs(extract(epoch from new.sold_at - new.updated_at)) <= 1, false);
      if not sold_at_is_write_clock and tg_op = 'UPDATE' then
        sold_at_is_write_clock := coalesce(abs(extract(epoch from new.sold_at - old.updated_at)) <= 1, false);
      end if;
    end if;
    new_sale_date := case when sold_at_is_write_clock then null
                          else coalesce(new.sold_at::date, new.end_date::date, current_date) end;

    -- Update organization_vehicles for this vehicle and organization (best-effort)
    if new.organization_id is not null and to_regclass('public.organization_vehicles') is not null then
      insert into organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        listing_status,
        sale_date,
        sale_price,
        status,
        updated_at
      )
      values (
        new.organization_id,
        new.vehicle_id,
        'sold_by',
        'sold',
        new_sale_date,
        sale_amount,
        'past',
        now()
      )
      on conflict (organization_id, vehicle_id, relationship_type)
      do update set
        listing_status = 'sold',
        -- Only advance the sale_date (guarded by the WHERE clause below)
        sale_date = coalesce(excluded.sale_date, organization_vehicles.sale_date),
        sale_price = coalesce(sale_amount, organization_vehicles.sale_price),
        status = 'past',
        updated_at = now()
      where organization_vehicles.sale_date is null or excluded.sale_date >= organization_vehicles.sale_date;
    end if;

    -- Update vehicles table sale fields + auction bid semantics
    update vehicles
    set
      sale_price = coalesce(sale_amount, vehicles.sale_price),
      sale_date = coalesce(new_sale_date, vehicles.sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      winning_bid = coalesce(sale_amount, vehicles.winning_bid),
      high_bid = coalesce(sale_amount, vehicles.high_bid),
      bid_count = coalesce(new.bid_count, vehicles.bid_count),
      auction_source = coalesce(new.platform, vehicles.auction_source),
      -- Keep legacy string cache aligned for older UI paths
      auction_end_date = coalesce(new.end_date::date::text, vehicles.auction_end_date),
      -- BaT cache fields (latest SOLD listing)
      bat_auction_url = case when new.platform = 'bat' then coalesce(new.listing_url, vehicles.bat_auction_url) else vehicles.bat_auction_url end,
      bat_lot_number = case when new.platform = 'bat' then coalesce(new.metadata->>'lot_number', vehicles.bat_lot_number) else vehicles.bat_lot_number end,
      bat_seller = case when new.platform = 'bat' then coalesce(new.metadata->>'seller_username', vehicles.bat_seller) else vehicles.bat_seller end,
      bat_buyer = case when new.platform = 'bat' then coalesce(new.metadata->>'buyer_username', vehicles.bat_buyer) else vehicles.bat_buyer end,
      reserve_status = case when new.platform = 'bat' then coalesce(new.metadata->>'reserve_status', vehicles.reserve_status) else vehicles.reserve_status end,
      bat_bids = case when new.platform = 'bat' then coalesce(new.bid_count, vehicles.bat_bids) else vehicles.bat_bids end,
      bat_views = case when new.platform = 'bat' then coalesce(new.view_count, vehicles.bat_views) else vehicles.bat_views end,
      bat_watchers = case when new.platform = 'bat' then coalesce(new.watcher_count, vehicles.bat_watchers) else vehicles.bat_watchers end,
      updated_at = now()
    where
      id = new.vehicle_id
      and (vehicles.sale_date is null or new_sale_date >= vehicles.sale_date);

    get diagnostics affected_rows = row_count;
    if affected_rows > 0 then
      raise notice 'Updated vehicle % sold cache from external listing % (platform=%)', new.vehicle_id, new.id, new.platform;
    end if;
  end if;

  return new;
end;
$function$;

COMMENT ON FUNCTION public.auto_mark_vehicle_sold_from_external_listing() IS
'Marks vehicles as sold when external_listings are sold; multi-auction safe (latest sale_date wins). Updates BaT cache fields when platform=bat. A sold_at with sub-second precision within 1 s of the listing row''s created_at or updated_at (old or new) is an importer write clock, not a sale day: for that row vehicles.sale_date and organization_vehicles.sale_date stay as they are, a dated vehicle''s sale cache is not moved, and an undated vehicle gets its sale status and price without a day (migration 20261006234500). A day retracted on the vehicle is also refused by trg_enforce_vehicle_sale_date_retraction.';

-- Name the mechanism in the registry. No row existed for vehicles.sale_date on 2026-10-06; an existing row is appended to.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES (
  'vehicles', 'sale_date',
  'listing landers (auto_mark_vehicle_sold_from_external_listing via trigger_auto_mark_vehicle_sold, sync_bat_listing_to_vehicle, the BaT parse and backfill functions, platform extractors)',
  'Day the vehicle sold, as the landing source read it (timestamps cast to a day in the database time zone, UTC); NULL when no supported sale day exists. Enforced by trg_enforce_vehicle_sale_date_retraction (BEFORE UPDATE, migration 20261006234500): a day correct_vehicle_sale_provenance_batch retracted to NULL as an importer write clock or ingest stamp is not written back by any lander; the write keeps the previous value and lands in provenance_metadata.sale_date_lock_hits. auto_mark_vehicle_sold_from_external_listing does not copy an external_listings.sold_at that carries the write-clock signature.',
  false,
  'Landers write it when a listing reads sold. Corrections: correct_vehicle_sale_provenance_batch only (cited source.ref, expected-value guarded, audited in provenance_metadata.sale_provenance_corrections); re-asserting a retracted day takes a new cited correction.')
ON CONFLICT (table_name, column_name) DO UPDATE
SET description = pipeline_registry.description || ' Enforced by trg_enforce_vehicle_sale_date_retraction (BEFORE UPDATE, migration 20261006234500): a day correct_vehicle_sale_provenance_batch retracted as an importer write clock or ingest stamp is not written back by any lander; refused writes land in provenance_metadata.sale_date_lock_hits.',
    updated_at = now()
WHERE pipeline_registry.description NOT LIKE '%trg_enforce_vehicle_sale_date_retraction%';

-- The database describes itself: append to each column comment once, or set it where none exists.
DO $$
DECLARE r record; cur text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('external_listings', 'sold_at',
       'Sale instant as the listing''s lander stored it (event clock, UTC). A value with sub-second precision within 1 s of this row''s created_at or updated_at is the lander''s write clock (import-pcarmarket-listing, Feb 2026: 1,920 PCARMARKET, 10 BaT and 8 Cars & Bids sold rows on 2026-10-06), not a sale instant; auto_mark_vehicle_sold_from_external_listing does not copy it to vehicles.sale_date (trg_enforce_vehicle_sale_date_retraction, migration 20261006234500).'),
      ('vehicles', 'sale_date',
       'Enforced by trg_enforce_vehicle_sale_date_retraction (BEFORE UPDATE): a day correct_vehicle_sale_provenance_batch retracted as an importer write clock or ingest stamp is not written back; refused writes land in provenance_metadata.sale_date_lock_hits.'),
      ('vehicles', 'provenance_metadata',
       'Keys: sale_provenance_corrections[] holds the audit entries of correct_vehicle_sale_provenance_batch {field, original, corrected, source, reason, asserted_by, asserted_at}; sale_date_lock_hits[] holds the writes of a retracted sale day refused by trg_enforce_vehicle_sale_date_retraction {at, blocked_day, kept, retraction_asserted_by, app_writer, db_role, session_role, trigger_depth}, last 20.')
    ) AS t(tbl, col, txt)
  LOOP
    SELECT col_description(a.attrelid, a.attnum) INTO cur
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', r.tbl)::regclass AND a.attname = r.col AND NOT a.attisdropped;
    IF cur IS NULL THEN
      EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L', r.tbl, r.col, r.txt);
    ELSIF cur NOT LIKE '%trg_enforce_vehicle_sale_date_retraction%' THEN
      EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L', r.tbl, r.col,
                     cur || CASE WHEN cur ~ '[.!?]\s*$' THEN ' ' ELSE '. ' END || r.txt);
    END IF;
  END LOOP;
END
$$;

-- Last: the trigger (SHARE ROW EXCLUSIVE on vehicles until COMMIT). Replaced in place on a re-apply, never dropped.
CREATE OR REPLACE TRIGGER trg_enforce_vehicle_sale_date_retraction
BEFORE UPDATE OF sale_date ON public.vehicles
FOR EACH ROW
WHEN (NEW.sale_date IS NOT NULL
      AND NEW.sale_date IS DISTINCT FROM OLD.sale_date
      AND OLD.provenance_metadata ? 'sale_provenance_corrections')
EXECUTE FUNCTION public.enforce_vehicle_sale_date_retraction();

COMMENT ON TRIGGER trg_enforce_vehicle_sale_date_retraction ON public.vehicles IS
'Keeps a sale day that correct_vehicle_sale_provenance_batch retracted as an importer write clock from coming back through any in-place writer (trigger_auto_mark_vehicle_sold, fix_missing_sale_dates, importers); see enforce_vehicle_sale_date_retraction(). Fires BEFORE UPDATE OF sale_date only when the day moves to a non-NULL value on a row carrying provenance_metadata.sale_provenance_corrections; sorts before trg_flag_sale_date_ingest_stamp.';

COMMIT;
