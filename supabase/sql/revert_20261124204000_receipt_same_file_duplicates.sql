-- Revert 20261124204000_receipt_same_file_duplicates: restore the readings the backfill marked (their held links go back
-- to linked) and the previous duplicate trigger. Readings flagged at landing since then keep their flag.
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
  if new.duplicate_of is not null and coalesce(new.is_superseded,false) = false then
    new.is_superseded := true;
    new.superseded_at := coalesce(new.superseded_at, now()); new.superseded_reason := coalesce(new.superseded_reason, 'duplicate_of '||new.duplicate_of::text);
  end if;
  return new;
end $function$;
DROP TRIGGER IF EXISTS trg_receipts_flag_duplicate ON public.receipts;
CREATE TRIGGER trg_receipts_flag_duplicate BEFORE INSERT OR UPDATE OF user_id, vendor_name, total_amount, total, file_name, duplicate_of
  ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.receipts_flag_duplicate();
WITH marked AS (
  UPDATE public.receipts r SET duplicate_of = NULL, duplicate_reason = NULL, duplicate_run_id = NULL,
         is_superseded = false, superseded_at = NULL, superseded_reason = NULL
   WHERE r.duplicate_run_id = 'receipt_same_file_20261124' RETURNING r.id),
held AS (
  UPDATE public.receipt_vehicle_links l SET retired_at = now()
    FROM marked m WHERE l.receipt_id = m.id AND l.status = 'held' AND l.retired_at IS NULL AND l.run_id = 'duplicate_trigger' RETURNING l.*)
INSERT INTO public.receipt_vehicle_links (receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, run_id)
SELECT h.receipt_id, h.vehicle_id, h.user_id, 'linked', h.basis, h.basis_ref - 'duplicate_hold', h.confidence, 'revert_20261124204000' FROM held h;
COMMIT;
