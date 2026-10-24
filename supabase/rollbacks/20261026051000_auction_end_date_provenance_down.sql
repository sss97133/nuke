-- Revert data runs first (supabase/sql/revert_ae_end_date_receipt_v1.sql), then drop the provenance table.
drop table if exists public.auction_event_end_date_provenance;
