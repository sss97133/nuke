-- Ops (not a schema migration): repoint photos left on merged vehicles to merge target via existing path.
-- run c0de2026-1103-4000-8000-000000000010 ; revert: select profile_fix_revert('c0de2026-1103-4000-8000-000000000010');
--   + update image_observations set is_active=false where id in (select obs_id from backup_20261103_merge_repoint where obs_id is not null);
create table if not exists backup_20261103_merge_repoint(backed_up_at timestamptz default now(), proposal_id uuid, image_id uuid, row jsonb, obs_id uuid);
create or replace function pg_temp.repoint(p_prop uuid) returns int language plpgsql as $$
declare p record; i record; o uuid; n int:=0; r uuid:='c0de2026-1103-4000-8000-000000000010';
begin
 select * into p from vehicle_merge_proposals where id=p_prop and status='merged';
 if not found then raise exception 'not merged'; end if;
 for i in select * from vehicle_images where vehicle_id=p.duplicate_vehicle_id loop
   o := public.ingest_image_observation(i.id, p.primary_vehicle_id, 'subject', 0.97, 'merge_carry_v1', 'merge:'||p_prop,
        jsonb_build_object('basis','vehicle_merge_proposals','proposal_id',p_prop,'from_vehicle',p.duplicate_vehicle_id,'note','merged vehicle; photo follows merge target'));
   insert into backup_20261103_merge_repoint(proposal_id,image_id,row,obs_id) values(p_prop,i.id,to_jsonb(i),o);
   perform public._pf_update(r,'merge_repoint','vehicle_images',i.id,'merged_from_vehicle_id',to_jsonb(p.duplicate_vehicle_id::text),p.primary_vehicle_id,jsonb_build_object('proposal',p_prop),false);
   perform public._pf_update(r,'merge_repoint','vehicle_images',i.id,'vehicle_id',to_jsonb(p.primary_vehicle_id::text),p.primary_vehicle_id,jsonb_build_object('proposal',p_prop),false);
   n:=n+1;
 end loop;
 return n;
end $$;
