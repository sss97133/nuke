-- Revert 20261124206000_receipt_file_content_key: restore the readings the backfill marked (their held links go back to
-- linked), the 20261124204000 duplicate trigger, and drop the content key. Readings flagged at landing since keep their flag.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DROP TRIGGER IF EXISTS receipt_file_content_key_set ON public.receipts;
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

WITH marked AS (
  UPDATE public.receipts r SET duplicate_of = NULL, duplicate_reason = NULL, duplicate_run_id = NULL,
         is_superseded = false, superseded_at = NULL, superseded_reason = NULL
   WHERE r.duplicate_run_id = 'receipt_same_bytes_20261125' RETURNING r.id),
held AS (
  UPDATE public.receipt_vehicle_links l SET retired_at = now()
    FROM marked m WHERE l.receipt_id = m.id AND l.status = 'held' AND l.retired_at IS NULL AND l.run_id = 'duplicate_trigger' RETURNING l.*)
INSERT INTO public.receipt_vehicle_links (receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, run_id)
SELECT h.receipt_id, h.vehicle_id, h.user_id, 'linked', h.basis, h.basis_ref - 'duplicate_hold', h.confidence, 'revert_20261124206000' FROM held h;
DROP FUNCTION IF EXISTS public.receipt_file_content_key_set();
DROP FUNCTION IF EXISTS public.receipt_file_content_key(text);
DROP INDEX IF EXISTS public.receipts_user_file_content_key_idx;
ALTER TABLE public.receipts DROP COLUMN IF EXISTS file_content_key;
COMMIT;
