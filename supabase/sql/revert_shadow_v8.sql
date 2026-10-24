-- Revert shadow v8 work (all additive; nothing deleted). Live estimate never touched.
-- Shadow rows: model_version in ('shadow-v8-route-blend','shadow-v8-hier-recal'), runs ...a5015/...a5016 -> ignore model_version.
-- v8 comp snapshot: DROP TABLE public.shadow_sale_prices_snap_v8;
-- Bonhams sale dates (run a5018):
UPDATE auction_events ae SET auction_end_date = l.old_value FROM auction_end_date_backfill_log l
 WHERE l.run_id = '7e1d0c24-2026-4a10-9e00-0000000a5018' AND l.auction_event_id = ae.id AND ae.auction_end_date = l.new_value;
select revert_price_basis_run_v2('7e1d0c24-2026-4a10-9e00-0000000a5018');
-- Collecting Cars hammer (run a5017): restore ve price columns, then retire the fee rows (no delete).
select revert_price_basis_run_v2('7e1d0c24-2026-4a10-9e00-0000000a5017');
update platform_fee_schedule set valid_to = '2000-01-01' where platform = 'collecting_cars' and notes like '%0000000a5017%';
-- View: DROP VIEW public.shadow_sale_prices; then CREATE VIEW public.shadow_sale_prices AS <def> using
--   select def from shadow_view_defs_backup where view_name='shadow_sale_prices' order by saved_at desc limit 1;
--   (the row saved by shadow_sale_prices_ve_branch_v8.sql). Drop needed because source_tbl column was appended.
