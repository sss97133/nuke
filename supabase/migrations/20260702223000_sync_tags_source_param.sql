[38;5;142m[dotenvx@1.52.0] injecting env (73) from .env[39m
 CREATE OR REPLACE FUNCTION public.sync_local_vision_tags(p_batch jsonb, p_source text DEFAULT 'blur_app_localstore'::text)+
  RETURNS jsonb                                                                                                            +
  LANGUAGE plpgsql                                                                                                         +
  SECURITY DEFINER                                                                                                         +
  SET search_path TO 'public'                                                                                              +
 AS $function$                                                                                                             +
 declare                                                                                                                   +
   v_user        uuid := auth.uid();                                                                                       +
   v_received    int;                                                                                                      +
   v_matched     int;                                                                                                      +
   v_matched_ids text[];                                                                                                   +
 begin                                                                                                                     +
   if v_user is null then                                                                                                  +
     raise exception 'sync_local_vision_tags: authentication required';                                                    +
   end if;                                                                                                                 +
   if jsonb_typeof(p_batch) <> 'array' then                                                                                +
     raise exception 'sync_local_vision_tags: p_batch must be a JSON array';                                               +
   end if;                                                                                                                 +
                                                                                                                           +
   v_received := jsonb_array_length(p_batch);                                                                              +
                                                                                                                           +
   with items as (                                                                                                         +
     select                                                                                                                +
       x.local_id,                                                                                                         +
       x.labels,                                                                                                           +
       case when jsonb_typeof(x.labels) = 'array'                                                                          +
            then array(select jsonb_array_elements_text(x.labels))                                                         +
            else null end as labels_arr,                                                                                   +
       x.is_vehicle,                                                                                                       +
       x.is_personal,                                                                                                      +
       x.owner_verdict                                                                                                     +
     from jsonb_to_recordset(p_batch)                                                                                      +
       as x(local_id text, labels jsonb, is_vehicle boolean, is_personal boolean, owner_verdict text)                      +
     where x.local_id is not null and x.local_id <> ''                                                                     +
   ),                                                                                                                      +
   upd as (                                                                                                                +
     update vehicle_images vi                                                                                              +
     set                                                                                                                   +
       apple_ml_labels = case                                                                                              +
         when (vi.apple_ml_labels is null or cardinality(vi.apple_ml_labels) = 0)                                          +
              and i.labels_arr is not null                                                                                 +
         then i.labels_arr                                                                                                 +
         else vi.apple_ml_labels end,                                                                                      +
       ai_scan_metadata = case                                                                                             +
         -- bulk backfill must never clobber a live phone push; live pushes still refresh their own                        +
         when coalesce(p_source,'') <> 'blur_app_localstore' and vi.ai_scan_metadata ? 'on_device_vision'                  +
           then vi.ai_scan_metadata                                                                                        +
         else jsonb_set(                                                                                                   +
           coalesce(vi.ai_scan_metadata, '{}'::jsonb),                                                                     +
           '{on_device_vision}',                                                                                           +
           jsonb_build_object(                                                                                             +
             'source',        coalesce(p_source, 'blur_app_localstore'),                                                   +
             'labels',        coalesce(i.labels, '[]'::jsonb),                                                             +
             'is_vehicle',    i.is_vehicle,                                                                                +
             'is_personal',   i.is_personal,                                                                               +
             'owner_verdict', i.owner_verdict,                                                                             +
             'synced_at',     to_jsonb(now())                                                                              +
           ),                                                                                                              +
           true) end                                                                                                       +
     from items i                                                                                                          +
     where vi.user_id = v_user                                                                                             +
       and vi.exif_data->>'uuid' = i.local_id                                                                              +
     returning i.local_id                                                                                                  +
   )                                                                                                                       +
   select count(distinct local_id), array_agg(distinct local_id)                                                           +
     into v_matched, v_matched_ids                                                                                         +
   from upd;                                                                                                               +
                                                                                                                           +
   begin                                                                                                                   +
     insert into analysis_events (user_id, stage, detail)                                                                  +
     values (v_user, 'tag_sync_batch', jsonb_build_object(                                                                 +
       'received', v_received,                                                                                             +
       'matched', coalesce(v_matched, 0),                                                                                  +
       'source', coalesce(p_source, 'blur_app_localstore'),                                                                +
       'sample_local_id', p_batch->0->>'local_id'                                                                          +
     ));                                                                                                                   +
   exception when others then null;                                                                                        +
   end;                                                                                                                    +
                                                                                                                           +
   return jsonb_build_object(                                                                                              +
     'received',    v_received,                                                                                            +
     'matched',     coalesce(v_matched, 0),                                                                                +
     'matched_ids', to_jsonb(coalesce(v_matched_ids, array[]::text[]))                                                     +
   );                                                                                                                      +
 end;                                                                                                                      +
 $function$                                                                                                                +
 

grant execute on function public.sync_local_vision_tags(jsonb, text) to authenticated;
