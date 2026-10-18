-- Validate scene_micro_atom_evidence_vehicle_id_fkey on public.scene_micro_atom_evidence against existing rows (declared NOT VALID in 20261003200000).
-- The deploy runs psql without a transaction, so the timeouts sit inside an explicit one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '900s';
alter table public.scene_micro_atom_evidence validate constraint scene_micro_atom_evidence_vehicle_id_fkey;
commit;
