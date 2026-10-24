-- Revert 20261027010000_receipt_queue_evidence. No hard deletes: queue-pass rows are retired, prior rows un-retired.
-- 1. retire queue-pass rows, then un-retire each receipt's latest pre-queue row
update receipt_vehicle_links set retired_at = now() where basis_ref->>'pass'='queue_evidence' and retired_at is null;
update receipt_vehicle_links l set retired_at = null
where l.basis_ref->>'pass' is distinct from 'queue_evidence' and l.retired_at is not null
  and not exists (select 1 from receipt_vehicle_links a where a.receipt_id=l.receipt_id and a.retired_at is null)
  and l.id = (select x.id from receipt_vehicle_links x where x.receipt_id=l.receipt_id and x.basis_ref->>'pass' is distinct from 'queue_evidence' order by x.retired_at desc nulls last limit 1);
-- 2. objects
drop function if exists public.receipt_link_one(uuid);
drop function if exists public.receipt_queue_resolve(text, uuid);
drop function if exists public.receipt_work_cats(text);
alter table if exists public.receipt_vendor_specialties rename to retired_receipt_vendor_specialties_20261027;
-- 3. single-arg refresh: re-apply the function body from 20261027000000 (receipt_vehicle_links_refresh(text)) after:
drop function if exists public.receipt_vehicle_links_refresh(text);
drop function if exists public.receipt_vehicle_links_refresh(text, uuid);
-- then re-run the receipt_vehicle_links_refresh + receipt_type_signals definitions from 20261027000000_receipt_vehicle_links.sql
-- basis column stays text (superset of the enum values; harmless). vehicle_receipts view: re-run its definition from 20261027000000.
