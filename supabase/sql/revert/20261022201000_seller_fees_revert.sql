alter table public.platform_fee_schedules drop column if exists seller_commission_pct, drop column if exists seller_commission_pct_no_reserve,
 drop column if exists seller_commission_min, drop column if exists seller_entry_fee_min, drop column if exists seller_entry_fee_max,
 drop column if exists seller_listing_fee, drop column if exists seller_fee_basis, drop column if exists seller_fee_source_url,
 drop column if exists seller_fee_source_quote, drop column if exists seller_fee_fetched_at, drop column if exists seller_fee_run_id;
-- seller_fee_note was not modified; backup kept in platform_fee_schedules_backup_20261022.
