-- Revert run identity_lex_v1_20261025: retire rows (no delete).
update public.vehicle_identity_evidence set retired_at = now() where run_id = 'identity_lex_v1_20261025' and retired_at is null;
update public.make_alias_ref set retired_at = now() where run_id = 'identity_lex_v1_20261025' and retired_at is null;
