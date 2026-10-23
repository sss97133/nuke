-- Queue lookups seq-scanned 736k rows (65s/batch pair -> 3.7s). Applied live 2026-10-23.
create index if not exists pbbq_tbl_id on public.price_basis_backfill_queue(tbl, id);
create index if not exists pbbq_pending on public.price_basis_backfill_queue(tbl) where done_at is null;
