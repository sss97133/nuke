-- Revert 20261027000000_receipt_vehicle_links (no data loss: receipts untouched; links table renamed, not dropped)
drop view if exists public.vehicle_receipts;
do $$ begin
  if to_regclass('public.retired_vehicle_receipts_stub_20261027') is not null then
    alter table public.retired_vehicle_receipts_stub_20261027 rename to vehicle_receipts; end if;
end $$;
drop trigger if exists trg_rvl_enforce on public.receipt_vehicle_links;
alter table if exists public.receipt_vehicle_links rename to retired_receipt_vehicle_links_20261027;
drop function if exists public.receipt_vehicle_links_refresh(text);
drop function if exists public.receipt_vehicle_links_enforce();
drop function if exists public.receipt_type_gate(uuid,uuid);
drop function if exists public.receipt_vehicle_class(public.vehicles);
drop function if exists public.receipt_type_signals(public.receipts);
drop function if exists public.receipt_page_date(public.receipts);
drop function if exists public.receipt_tie_weight(text);
drop function if exists public.receipt_user_vehicle_tie(uuid,uuid);
drop function if exists public.receipt_vin_check_ok(text);
