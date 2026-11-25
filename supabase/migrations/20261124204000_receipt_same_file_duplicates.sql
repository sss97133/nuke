-- The same stored file read more than once is one paper: its later readings are duplicates of one canonical reading,
-- at landing (trigger) and for the readings already held.
--
-- Measured 2026-11-24 (scripts/data/q.sh): among receipts that are neither superseded nor duplicates, 42 stored files
-- (receipts.file_url, the original object in storage) carry 85 readings; 43 later readings (25 with a live linked
-- vehicle link) are counted beside their first. receipts_flag_duplicate keys on custodian | vendor | amount | file
-- name, so two readings of one file that disagree on the amount or the vendor (OCR, then an LLM re-read) both stay
-- live and the paper's money and lines count twice.
--
--   receipts_flag_duplicate(): unchanged rule first; then, when a receipt is still not a duplicate, an EARLIER live
--     reading of the same custodian's same stored file makes it a duplicate ('auto: same stored file read again').
--     Earlier is required, so updating the first reading can never make it the duplicate of a later one (the old
--     content-key rule did not check order). The trigger now also fires on UPDATE OF file_url.
--   Backfill: for each such file the canonical reading is the one that carries receipt_items, else the earliest; the
--     others get duplicate_of = canonical with duplicate_run_id 'receipt_same_file_20261124'. The existing triggers do
--     the rest: is_superseded is stamped (receipts_flag_duplicate) and each duplicate's linked vehicle link is retired
--     and re-written held with hold_reason 'duplicate_of <canonical>' (receipts_document_kind_links). Nothing is deleted;
--     clearing duplicate_of restores a reading.
--   receipt_itemise_retained() (20261124203000) holds later readings of one file on sibling_receipt_id already; after
--     this, those readings are duplicates and the canonical alone carries the lines.
-- Contract: supabase/sql/test_receipt_same_file_duplicates.sql (PG17, production trigger definitions).
-- Revert: supabase/sql/revert_20261124204000_receipt_same_file_duplicates.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.receipts_flag_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.content_key := public.receipt_content_key(new.user_id, new.vendor_name, coalesce(new.total_amount, new.total), new.file_name);
  if new.duplicate_of is null and new.content_key is not null then
    select r.id into new.duplicate_of from public.receipts r
     where r.content_key = new.content_key and r.id <> new.id and r.duplicate_of is null
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same user, vendor, amount and original file name');
    end if;
  end if;
  -- The same stored file read again (amounts or vendor may disagree between readings): the earlier live reading stands.
  if new.duplicate_of is null and coalesce(new.file_url, '') <> '' then
    select r.id into new.duplicate_of from public.receipts r
     where r.file_url = new.file_url and r.id <> new.id and r.user_id is not distinct from new.user_id
       and r.duplicate_of is null and r.is_superseded is not true
       and (r.created_at, r.id) < (coalesce(new.created_at, now()), new.id)
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same stored file read again');
    end if;
  end if;
  if new.duplicate_of is not null and coalesce(new.is_superseded,false) = false then
    -- superseded_by points at payment_events, so the canonical receipt id goes in superseded_reason instead
    new.is_superseded := true;
    new.superseded_at := coalesce(new.superseded_at, now()); new.superseded_reason := coalesce(new.superseded_reason, 'duplicate_of '||new.duplicate_of::text);
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS trg_receipts_flag_duplicate ON public.receipts;
CREATE TRIGGER trg_receipts_flag_duplicate BEFORE INSERT OR UPDATE OF user_id, vendor_name, total_amount, total, file_name, file_url, duplicate_of
  ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.receipts_flag_duplicate();

DO $$
DECLARE n_dup int; n_files int; n_linked_before int; n_linked_after int; n_expected_lost int;
BEGIN
  CREATE TEMP TABLE same_file ON COMMIT DROP AS
  WITH live AS (
    SELECT r.id, r.user_id, r.file_url, r.created_at,
           EXISTS (SELECT 1 FROM public.receipt_items i WHERE i.receipt_id = r.id) AS has_lines
      FROM public.receipts r
     WHERE r.duplicate_of IS NULL AND r.is_superseded IS NOT TRUE AND coalesce(r.file_url, '') <> ''),
  ranked AS (
    SELECT live.*, row_number() OVER (PARTITION BY user_id, file_url ORDER BY has_lines DESC, created_at, id) AS rn,
           count(*) OVER (PARTITION BY user_id, file_url) AS n
      FROM live)
  SELECT d.id, c.id AS canonical_id
    FROM ranked d JOIN ranked c ON c.user_id IS NOT DISTINCT FROM d.user_id AND c.file_url = d.file_url AND c.rn = 1
   WHERE d.n > 1 AND d.rn > 1;

  SELECT count(*), count(DISTINCT canonical_id) INTO n_dup, n_files FROM same_file;
  SELECT count(DISTINCT l.receipt_id) INTO n_linked_before FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  -- Duplicates whose linked links will be held; their canonical keeps (or already has) the paper on the vehicle.
  SELECT count(DISTINCT l.receipt_id) INTO n_expected_lost FROM public.receipt_vehicle_links l JOIN same_file s ON s.id = l.receipt_id
   WHERE l.status = 'linked' AND l.retired_at IS NULL;

  UPDATE public.receipts r
     SET duplicate_of = s.canonical_id,
         duplicate_reason = 'same stored file read more than once; canonical = the reading that carries lines, else the earliest',
         duplicate_run_id = 'receipt_same_file_20261124'
    FROM same_file s
   WHERE r.id = s.id AND r.duplicate_of IS NULL;

  SELECT count(DISTINCT l.receipt_id) INTO n_linked_after FROM public.receipt_vehicle_links l WHERE l.status = 'linked' AND l.retired_at IS NULL;
  IF n_linked_after <> n_linked_before - n_expected_lost THEN
    RAISE EXCEPTION 'same-file duplicates: linked receipts % -> %, expected %', n_linked_before, n_linked_after, n_linked_before - n_expected_lost;
  END IF;
  RAISE NOTICE 'same-file duplicates: % readings of % files marked; linked receipts % -> %', n_dup, n_files, n_linked_before, n_linked_after;
END $$;

COMMIT;
