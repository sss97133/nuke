-- Revert run identity_decode_conflict_flag_v1_20261025 (no COMMIT). Restores prior conflict/conflict_with; evidence rows untouched otherwise.
update public.vehicle_identity_evidence e set conflict=l.prev_conflict, conflict_with=l.prev_conflict_with
  from public.identity_decode_conflict_flag_log l
 where l.evidence_id=e.id and l.run_id='identity_decode_conflict_flag_v1_20261025';
insert into public.vehicle_category_change_log(run_id,phase,counts)
values ('identity_decode_conflict_flag_v1_20261025','revert',jsonb_build_object('note','conflict flags restored from identity_decode_conflict_flag_log'));
-- To drop the surfacing objects as well (optional):
-- drop function if exists public.flag_evidence_decode_conflicts(text); drop view if exists public.vehicle_evidence_decode_conflict;
