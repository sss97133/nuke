-- Background / shop-context vehicle sightings.
--
-- A photo whose primary subject is one vehicle (vehicle_images.vehicle_id) often also shows other
-- vehicles in the frame (e.g. a Karmann Ghia and a blue '32 coupe behind a gold '66 Mustang at a
-- shop). Those photos should appear on the *other* vehicles' profiles as "seen in background /
-- shop context", never as primary photos.
--
-- No parallel table: this extends the existing image_observations layer, whose role check already
-- allows 'background' and 'incidental'. Adds:
--   * a dedupe index for active background links written by this path
--   * vehicle_background_images view (read path for profiles)
--   * link_background_vehicles(run, actor, items)  -- audited writer, logs to profile_fix_log
--   * revert_background_vehicles(run)              -- revert by deactivation (never deletes)
-- vehicle_images is never modified, so the photo's vehicle_id / is_primary cannot change.

create unique index if not exists uq_image_obs_background_link_active
  on public.image_observations (image_id, vehicle_id, role)
  where is_active and vehicle_id is not null and role in ('background', 'incidental')
    and observed_by = 'background_link_v1';

create or replace view public.vehicle_background_images
with (security_invoker = true) as
select o.vehicle_id,
       o.image_id,
       o.role,
       o.confidence,
       o.bbox,
       o.confidence_basis,
       vi.vehicle_id   as primary_vehicle_id,
       vi.image_url,
       vi.thumbnail_url,
       vi.taken_at,
       'seen_in_background'::text as display_category
from public.image_observations o
join public.vehicle_images vi on vi.id = o.image_id
where o.is_active
  and o.superseded_by is null
  and o.vehicle_id is not null
  and o.role in ('background', 'incidental')
  and vi.vehicle_id is distinct from o.vehicle_id
  and coalesce(vi.is_sensitive, false) = false
  and coalesce(vi.is_duplicate, false) = false;

comment on view public.vehicle_background_images is
  'Photos where a vehicle is seen in the background / shop context of another vehicle''s photo. Never primary photos.';

create or replace function public.link_background_vehicles(p_run_id uuid, p_actor uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; v_img uuid; v_veh uuid; v_role text; v_conf numeric; v_id uuid;
  linked int := 0; refused jsonb := '[]'::jsonb;
begin
  if p_run_id is null or p_actor is null then
    raise exception 'link_background_vehicles: run id and actor required';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_img  := (it->>'image_id')::uuid;
    v_veh  := (it->>'vehicle_id')::uuid;
    v_role := coalesce(it->>'role', 'background');
    v_conf := coalesce((it->>'confidence')::numeric, 0);
    if v_role not in ('background', 'incidental') then
      refused := refused || jsonb_build_object('image_id', v_img, 'vehicle_id', v_veh, 'why', 'role'); continue;
    end if;
    if v_conf < 0.8 then
      refused := refused || jsonb_build_object('image_id', v_img, 'vehicle_id', v_veh, 'why', 'confidence<0.8'); continue;
    end if;
    if not exists (select 1 from vehicles where id = v_veh and deleted_at is null and merged_into_vehicle_id is null) then
      refused := refused || jsonb_build_object('image_id', v_img, 'vehicle_id', v_veh, 'why', 'vehicle'); continue;
    end if;
    if not exists (select 1 from vehicle_images where id = v_img and coalesce(is_sensitive, false) = false
                     and vehicle_id is distinct from v_veh) then
      refused := refused || jsonb_build_object('image_id', v_img, 'vehicle_id', v_veh,
                                               'why', 'image missing, sensitive, or already a primary photo of this vehicle'); continue;
    end if;
    if exists (select 1 from image_observations where image_id = v_img and vehicle_id = v_veh and is_active
                 and role in ('background', 'incidental')) then
      refused := refused || jsonb_build_object('image_id', v_img, 'vehicle_id', v_veh, 'why', 'already linked'); continue;
    end if;
    insert into image_observations (image_id, vehicle_id, role, confidence, confidence_basis, bbox,
                                    layer_version, observed_by, agent_version)
    values (v_img, v_veh, v_role, v_conf, coalesce(it->'evidence', '{}'::jsonb), it->'bbox',
            jsonb_build_object('run_id', p_run_id, 'actor', p_actor), 'background_link_v1', 'background_link_v1')
    returning id into v_id;
    insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    values (p_run_id, 'background_vehicle_link', v_veh, 'image_observations', v_id, 'is_active', 'insert', null,
            jsonb_build_object('image_id', v_img, 'role', v_role, 'is_active', true), it->'evidence');
    linked := linked + 1;
  end loop;
  return jsonb_build_object('run_id', p_run_id, 'linked', linked, 'refused', refused);
end $$;

create or replace function public.revert_background_vehicles(p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update image_observations o set is_active = false
  from profile_fix_log l
  where l.run_id = p_run_id and l.rule = 'background_vehicle_link' and l.reverted_at is null
    and l.target_table = 'image_observations' and l.target_pk = o.id and o.is_active;
  get diagnostics n = row_count;
  update profile_fix_log set reverted_at = now()
  where run_id = p_run_id and rule = 'background_vehicle_link' and reverted_at is null;
  return n;
end $$;

revoke all on function public.link_background_vehicles(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.revert_background_vehicles(uuid) from public, anon, authenticated;
grant select on public.vehicle_background_images to authenticated, service_role;
