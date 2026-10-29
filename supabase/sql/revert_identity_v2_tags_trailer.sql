-- Revert for turn-57 changes (no COMMIT; run inside a transaction you control).
-- 1) trailer_v2 run: retire, do not delete.
update public.vehicle_identity_evidence set retired_at=now()
 where run_id='identity_trailer_v2_backlog_20261025' and retired_at is null;
-- 2) restore original source tags (tag fix run identity_v2_ref_tag_fix_20261025).
update public.vehicle_identity_evidence
   set issues=array_replace(issues,'ref:rule_based:moto_v2 extractor rule list; no external source fetched','ref:wikipedia:List_of_motorcycle_manufacturers+per-brand model lists (moto_v2)')
 where run_id='identity_moto_v2_backlog_20261025';
update public.vehicle_identity_evidence
   set issues=array_replace(issues,'ref:rule_based:cart_v2 extractor rule list; no external source fetched','cart_v2')
 where run_id='identity_cart_v2_backlog_20261025';
-- 3) optional: un-retire cart_v2 (it failed fresh check 141/150=94.0%; leave retired unless deliberately overriding).
-- update public.vehicle_identity_evidence set retired_at=null where run_id='identity_cart_v2_backlog_20261025';
insert into public.vehicle_category_change_log(run_id,phase,counts)
values ('identity_v2_ref_tag_fix_20261025','revert',jsonb_build_object('note','tags restored; trailer_v2 retired'));
