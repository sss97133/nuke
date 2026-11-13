-- Garage organizer v1: evidence-scored photo filing for an owner's uploads.
create table if not exists public.garage_org_run(
  run_id uuid primary key default gen_random_uuid(), owner_id uuid not null, kind text not null,
  params jsonb, stats jsonb, started_at timestamptz default now(), finished_at timestamptz);
create table if not exists public.garage_org_vehicle(
  owner_id uuid, vehicle_id uuid, make_n text, model_n text, year int, color_n text, vin text, plate_n text,
  n_truth int, primary key(owner_id, vehicle_id));
create table if not exists public.garage_org_photo(
  image_id uuid primary key, owner_id uuid not null, taken_at timestamptz, lat float8, lon float8, cell text,
  cur_vehicle_id uuid, is_truth boolean, is_target boolean, gate text,
  c_make text, c_model text, c_year int, c_color text, c_conf numeric, c_text text, c_vin text, dhash text,
  session_id bigint);
create index if not exists garage_org_photo_sess on public.garage_org_photo(owner_id, session_id);
create index if not exists garage_org_photo_cell on public.garage_org_photo(owner_id, cell);
create table if not exists public.garage_org_score(
  run_id uuid, image_id uuid, vehicle_id uuid, score numeric, confidence numeric, rnk int, margin numeric,
  signals jsonb, decision text, applied boolean default false, primary key(run_id, image_id, vehicle_id));
create index if not exists garage_org_score_img on public.garage_org_score(run_id, rnk, decision);
create table if not exists public.garage_org_proposal(
  id uuid primary key default gen_random_uuid(), run_id uuid, owner_id uuid, kind text check (kind in ('new_vehicle','merge')),
  payload jsonb, evidence jsonb, confidence numeric, status text default 'proposed', created_at timestamptz default now());
create table if not exists public.garage_org_image_backup(run_id uuid, image_id uuid, row jsonb, backed_up_at timestamptz default now(), primary key(run_id,image_id));
alter table public.garage_org_run enable row level security;
alter table public.garage_org_vehicle enable row level security;
alter table public.garage_org_photo enable row level security;
alter table public.garage_org_score enable row level security;
alter table public.garage_org_proposal enable row level security;
alter table public.garage_org_image_backup enable row level security;

create or replace function public._go_n(t text) returns text language sql immutable as $$
  select nullif(replace(regexp_replace(lower(coalesce(t,'')),'[^a-z0-9]','','g'),'chevy','chevrolet'),'') $$;

create or replace function public._go_vf(m jsonb, f text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(case when jsonb_typeof(m#>'{classification,v2,vehicle_fields}')='array'
     then m#>'{classification,v2,vehicle_fields}' else '[]' end) e
  where e->>'field_name'=f order by (e->>'confidence')::numeric desc nulls last limit 1 $$;

-- 1) stage: candidate vehicles + photos + capture sessions (gap>20min or >300m starts a new session)
create or replace function public.garage_org_stage_v1(p_owner uuid) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare n_v int; n_p int;
begin
  delete from garage_org_vehicle where owner_id=p_owner;
  insert into garage_org_vehicle(owner_id, vehicle_id, make_n, model_n, year, color_n, vin, plate_n, n_truth)
  select p_owner, v.id, _go_n(v.make), _go_n(v.model), v.year, lower(coalesce(v.color, v.color_primary)),
         case when length(v.vin)=17 then upper(v.vin) end, _go_n(v.license_plate),
         (select count(*) from vehicle_images i where i.vehicle_id=v.id and i.user_id=p_owner and i.vision_gate_status='approved' and i.is_duplicate is not true)
  from vehicles v
  where v.merged_into_vehicle_id is null and coalesce(v.make,'') not ilike 'unassigned%'
    and (v.owner_id=p_owner or exists(select 1 from vehicle_images i where i.vehicle_id=v.id and i.user_id=p_owner and i.vision_gate_status='approved'));
  get diagnostics n_v = row_count;

  delete from garage_org_photo where owner_id=p_owner;
  insert into garage_org_photo(image_id, owner_id, taken_at, lat, lon, cell, cur_vehicle_id, is_truth, is_target, gate,
     c_make, c_model, c_year, c_color, c_conf, c_text, c_vin, dhash)
  select i.id, p_owner, coalesce(i.taken_at, i.created_at), i.latitude, i.longitude,
     case when i.latitude is not null then round(i.latitude::numeric,3)||','||round(i.longitude::numeric,3) end,
     i.vehicle_id,
     (gv.vehicle_id is not null and (i.vision_gate_status='approved' or i.user_confirmed_vehicle)),
     ((i.vehicle_id is null or i.vehicle_id in (select id from vehicles where make ilike 'unassigned%' and owner_id=p_owner))
        and coalesce(i.vision_gate_status::text,'') not in ('rejected_personal')
        and coalesce((i.ai_scan_metadata#>>'{on_device_vision,is_personal}')::boolean,false)=false),
     i.vision_gate_status::text,
     _go_n(_go_vf(i.ai_scan_metadata,'make')->>'value'), _go_n(_go_vf(i.ai_scan_metadata,'model')->>'value'),
     case when (_go_vf(i.ai_scan_metadata,'year')->>'value') ~ '^\d{4}$' then (_go_vf(i.ai_scan_metadata,'year')->>'value')::int end,
     lower(_go_vf(i.ai_scan_metadata,'color')->>'value'),
     coalesce((_go_vf(i.ai_scan_metadata,'make')->>'confidence')::numeric,0),
     upper(regexp_replace(coalesce((select string_agg(x,' ') from jsonb_array_elements_text(case when jsonb_typeof(i.ai_scan_metadata#>'{classification,v2,text_lines}')='array' then i.ai_scan_metadata#>'{classification,v2,text_lines}' else '[]' end) x),''),'[^A-Za-z0-9]','','g')),
     upper(nullif(i.ai_scan_metadata#>>'{classification,v2,vin}','')),
     coalesce(i.dhash, i.phash)
  from vehicle_images i left join garage_org_vehicle gv on gv.owner_id=p_owner and gv.vehicle_id=i.vehicle_id
  where i.user_id=p_owner and i.is_duplicate is not true and i.is_superseded is not true and coalesce(i.is_video,false)=false;
  get diagnostics n_p = row_count;

  update garage_org_photo g set session_id=s.sid from (
    select image_id, sum(case when pt is null or taken_at-pt>interval '20 minutes'
        or (lat is not null and plat is not null and 111320*sqrt((lat-plat)^2+((lon-plon)*cos(radians(lat)))^2)>300) then 1 else 0 end)
        over (order by taken_at, image_id) sid
    from (select image_id, taken_at, lat, lon, lag(taken_at) over w pt, lag(lat) over w plat, lag(lon) over w plon
          from garage_org_photo where owner_id=p_owner window w as (order by taken_at, image_id)) o) s
  where g.image_id=s.image_id;
  analyze garage_org_photo; analyze garage_org_vehicle;
  return jsonb_build_object('vehicles',n_v,'photos',n_p,
    'truth',(select count(*) from garage_org_photo where owner_id=p_owner and is_truth),
    'targets',(select count(*) from garage_org_photo where owner_id=p_owner and is_target),
    'sessions',(select count(distinct session_id) from garage_org_photo where owner_id=p_owner));
end $$;

-- 2) score: every (photo, candidate vehicle). p_mode 'backtest' scores truth photos leave-one-out; 'live' scores targets.
create or replace function public.garage_org_score_v1(p_run uuid, p_owner uuid, p_mode text) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare n int;
begin
  delete from garage_org_score where run_id=p_run;
  create temp table _p on commit drop as
    select * from garage_org_photo where owner_id=p_owner and (case when p_mode='backtest' then is_truth else is_target end);
  -- session votes from confirmed photos in same session (excluding self)
  create temp table _sess on commit drop as
    select p.image_id, t.cur_vehicle_id vehicle_id, count(*)::numeric nv,
           sum(count(*)) over (partition by p.image_id) nall
    from _p p join garage_org_photo t on t.owner_id=p_owner and t.session_id=p.session_id and t.is_truth and t.image_id<>p.image_id
    group by 1,2;
  -- location prior: share of vehicle's confirmed photos in same ~100m cell (excluding self)
  create temp table _cell on commit drop as
    select p.image_id, t.cur_vehicle_id vehicle_id, count(*)::numeric nv, sum(count(*)) over (partition by p.image_id) nall
    from _p p join garage_org_photo t on t.owner_id=p_owner and t.cell=p.cell and t.is_truth and t.image_id<>p.image_id
    group by 1,2;
  create temp table _cand on commit drop as
    select image_id, vehicle_id from _sess
    union select image_id, vehicle_id from (select image_id, vehicle_id, row_number() over (partition by image_id order by nv desc) r from _cell) c where r<=5
    union select p.image_id, v.vehicle_id from _p p join garage_org_vehicle v on v.owner_id=p_owner
          and ((p.c_make is not null and v.make_n=p.c_make and (p.c_model is null or v.model_n is null or v.model_n like '%'||p.c_model||'%' or p.c_model like '%'||v.model_n||'%'))
            or (v.vin is not null and (p.c_vin=v.vin or (length(p.c_text)>=8 and position(right(v.vin,8) in p.c_text)>0)))
            or (v.plate_n is not null and length(v.plate_n)>=5 and position(upper(v.plate_n) in p.c_text)>0));
  insert into garage_org_score(run_id, image_id, vehicle_id, score, signals)
  select p_run, c.image_id, c.vehicle_id, s.score, s.sig
  from _cand c join _p p on p.image_id=c.image_id join garage_org_vehicle v on v.owner_id=p_owner and v.vehicle_id=c.vehicle_id
  left join _sess ss on ss.image_id=c.image_id and ss.vehicle_id=c.vehicle_id
  left join _cell cl on cl.image_id=c.image_id and cl.vehicle_id=c.vehicle_id
  cross join lateral (
    select
      (case when v.vin is not null and (p.c_vin=v.vin or position(right(v.vin,8) in coalesce(p.c_text,''))>0) then 3.0 else 0 end)
      + (case when v.plate_n is not null and length(v.plate_n)>=5 and position(upper(v.plate_n) in coalesce(p.c_text,''))>0 then 2.0 else 0 end)
      + coalesce(2.5*(ss.nv/ss.nall)*least(1, ss.nall/2.0),0)
      + coalesce(1.0*(cl.nv/cl.nall),0)
      + (case when p.c_make is null or v.make_n is null then 0 when p.c_make=v.make_n then 0.6 when p.c_conf>=0.7 then -1.5 else -0.3 end)
      + (case when p.c_model is null or v.model_n is null then 0
              when v.model_n like '%'||p.c_model||'%' or p.c_model like '%'||v.model_n||'%' then 1.0 when p.c_conf>=0.7 then -0.8 else 0 end)
      + (case when p.c_year is null or v.year is null then 0 when abs(p.c_year-v.year)<=1 then 0.4 when abs(p.c_year-v.year)>5 then -0.4 else 0 end)
      + (case when p.c_color is null or v.color_n is null then 0
              when position(split_part(p.c_color,' ',array_length(string_to_array(p.c_color,' '),1)) in v.color_n)>0 then 0.3 else 0 end) score,
      jsonb_strip_nulls(jsonb_build_object(
        'vin_text', case when v.vin is not null and (p.c_vin=v.vin or position(right(v.vin,8) in coalesce(p.c_text,''))>0) then v.vin end,
        'plate_text', case when v.plate_n is not null and length(v.plate_n)>=5 and position(upper(v.plate_n) in coalesce(p.c_text,''))>0 then v.plate_n end,
        'session', case when ss.nv is not null then jsonb_build_object('session_id',p.session_id,'votes',ss.nv,'confirmed_in_session',ss.nall) end,
        'location_cell', case when cl.nv is not null then jsonb_build_object('cell',p.cell,'votes',cl.nv,'confirmed_in_cell',cl.nall) end,
        'classifier', case when p.c_make is not null then jsonb_build_object('make',p.c_make,'model',p.c_model,'year',p.c_year,'color',p.c_color,'conf',p.c_conf,
                          'vehicle',jsonb_build_object('make',v.make_n,'model',v.model_n,'year',v.year,'color',v.color_n)) end)) sig) s;
  -- visual consistency: near-identical hash (hamming<=6) to a confirmed photo of the candidate
  update garage_org_score g set score=g.score+1.5, signals=g.signals||jsonb_build_object('visual_match',x.best)
  from (select c.image_id, c.vehicle_id, min(bit_count(('x'||lpad(p.dhash,16,'0'))::bit(64) # ('x'||lpad(t.dhash,16,'0'))::bit(64))) best
        from garage_org_score c join _p p on p.image_id=c.image_id and p.dhash ~ '^[0-9a-f]{16}$'
        join garage_org_photo t on t.owner_id=p_owner and t.is_truth and t.cur_vehicle_id=c.vehicle_id and t.image_id<>p.image_id and t.dhash ~ '^[0-9a-f]{16}$'
        where c.run_id=p_run group by 1,2) x
  where g.run_id=p_run and g.image_id=x.image_id and g.vehicle_id=x.vehicle_id and x.best<=6;
  update garage_org_score g set rnk=r.rnk, margin=r.margin, confidence=round(1/(1+exp(-(g.score-2.0))),3)
  from (select image_id, vehicle_id, row_number() over w rnk, score - coalesce(lead(score) over w,0) margin
        from garage_org_score where run_id=p_run window w as (partition by image_id order by score desc, vehicle_id)) r
  where g.run_id=p_run and g.image_id=r.image_id and g.vehicle_id=r.vehicle_id;
  select count(distinct image_id) into n from garage_org_score where run_id=p_run;
  return jsonb_build_object('scored_photos',n,'pairs',(select count(*) from garage_org_score where run_id=p_run));
end $$;

-- 3) backtest table: precision/recall per threshold on confirmed filings
create or replace function public.garage_org_backtest_v1(p_run uuid, p_owner uuid) returns jsonb language sql
set search_path to 'public','pg_temp' as $$
  with top as (select s.image_id, s.vehicle_id, s.score, s.margin, p.cur_vehicle_id truth
               from garage_org_score s join garage_org_photo p on p.image_id=s.image_id where s.run_id=p_run and s.rnk=1),
  tot as (select count(*) n from garage_org_photo where owner_id=p_owner and is_truth),
  th as (select t, m from unnest(array[1.0,1.5,2.0,2.5,3.0,3.5,4.0]) t, unnest(array[0.5,1.0,1.5]) m)
  select jsonb_agg(jsonb_build_object('score_ge',t,'margin_ge',m,'predicted',np,'correct',nc,
     'precision',round(nc::numeric/nullif(np,0),3),'recall',round(nc::numeric/(select n from tot),3)) order by t,m)
  from (select t, m, count(*) filter (where score>=t and margin>=m) np,
               count(*) filter (where score>=t and margin>=m and vehicle_id=truth) nc from th cross join top group by t,m) x $$;

-- 4) decide + apply (newest first). auto: vehicle_id; suggest: auto_suggested_* only when empty. All via _pf_update (revertible).
create or replace function public.garage_org_apply_v1(p_run uuid, p_owner uuid, p_auto_score numeric, p_auto_margin numeric,
   p_sugg_score numeric, p_limit int default 2000, p_dry boolean default true) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare r record; na int:=0; ns int:=0; ev jsonb;
begin
  update garage_org_score s set decision = case
     when s.rnk<>1 then null
     when s.score>=p_auto_score and s.margin>=p_auto_margin and coalesce(p.gate,'') not like 'rejected%' then 'auto_file'
     when s.score>=p_sugg_score then 'suggest' else 'hold' end
  from garage_org_photo p where p.image_id=s.image_id and s.run_id=p_run;
  for r in select s.*, p.taken_at from garage_org_score s join garage_org_photo p on p.image_id=s.image_id
           where s.run_id=p_run and s.decision in ('auto_file','suggest') and not s.applied
           order by p.taken_at desc limit p_limit loop
    ev := jsonb_build_object('engine','garage_org_v1','score',r.score,'margin',r.margin,'confidence',r.confidence,'signals',r.signals);
    if not p_dry then
      insert into garage_org_image_backup(run_id,image_id,row) select p_run, i.id, to_jsonb(i) from vehicle_images i where i.id=r.image_id on conflict do nothing;
    end if;
    if r.decision='auto_file' then
      if (select vehicle_id is null or vehicle_id in (select id from vehicles where make ilike 'unassigned%') from vehicle_images where id=r.image_id) then
        perform _pf_update(p_run,'garage_org_autofile_v1','vehicle_images',r.image_id,'vehicle_id',to_jsonb(r.vehicle_id),r.vehicle_id,ev,p_dry);
        perform _pf_update(p_run,'garage_org_autofile_v1','vehicle_images',r.image_id,'auto_suggestion_confidence',to_jsonb(r.confidence),r.vehicle_id,ev,p_dry);
        perform _pf_update(p_run,'garage_org_autofile_v1','vehicle_images',r.image_id,'auto_suggestion_reasons',
           to_jsonb(array(select 'garage_org_v1:'||k from jsonb_object_keys(r.signals) k)),r.vehicle_id,ev,p_dry);
        na := na+1;
      end if;
    elsif (select auto_suggested_vehicle_id is null from vehicle_images where id=r.image_id) then
      perform _pf_update(p_run,'garage_org_suggest_v1','vehicle_images',r.image_id,'auto_suggested_vehicle_id',to_jsonb(r.vehicle_id),r.vehicle_id,ev,p_dry);
      perform _pf_update(p_run,'garage_org_suggest_v1','vehicle_images',r.image_id,'auto_suggestion_confidence',to_jsonb(r.confidence),r.vehicle_id,ev,p_dry);
      perform _pf_update(p_run,'garage_org_suggest_v1','vehicle_images',r.image_id,'auto_suggestion_reasons',
           to_jsonb(array(select 'garage_org_v1:'||k from jsonb_object_keys(r.signals) k)),r.vehicle_id,ev,p_dry);
      ns := ns+1;
    end if;
    if not p_dry then update garage_org_score set applied=true where run_id=p_run and image_id=r.image_id and vehicle_id=r.vehicle_id; end if;
  end loop;
  return jsonb_build_object('auto_filed',na,'suggested',ns,
    'held',(select count(*) from garage_org_photo p where p.owner_id=p_owner and p.is_target
            and not exists(select 1 from garage_org_score s where s.run_id=p_run and s.image_id=p.image_id and s.rnk=1 and s.decision in ('auto_file','suggest'))));
end $$;

-- 5) proposals: new-vehicle stubs (confident unfiled clusters matching nothing) and duplicate-vehicle merges. Never creates/deletes.
create or replace function public.garage_org_propose_v1(p_run uuid, p_owner uuid) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare nn int; nm int;
begin
  delete from garage_org_proposal where run_id=p_run;
  insert into garage_org_proposal(run_id, owner_id, kind, payload, evidence, confidence)
  select p_run, p_owner, 'new_vehicle',
    jsonb_build_object('make',mk,'model',md,'year',yr,'color',col),
    jsonb_build_object('sessions',sess,'photos',n,'agreeing_classifier_votes',nv,'sample_image_ids',ids,'first_seen',f,'last_seen',l),
    round(least(0.95, 0.4 + 0.1*least(nv,5)*(nv::numeric/n)),2)
  from (select c_make mk, c_model md, mode() within group (order by c_year) yr, mode() within group (order by c_color) col,
          count(distinct session_id) sess, count(*) n, count(*) filter (where c_conf>=0.7) nv,
          (array_agg(image_id order by taken_at desc))[1:5] ids, min(taken_at) f, max(taken_at) l
        from garage_org_photo p where owner_id=p_owner and is_target and c_make is not null and c_model is not null
          and not exists (select 1 from garage_org_vehicle v where v.owner_id=p_owner and v.make_n=p.c_make
                          and (v.model_n like '%'||p.c_model||'%' or p.c_model like '%'||v.model_n||'%'))
        group by 1,2) x
  where nv>=5 and sess>=2;
  get diagnostics nn = row_count;
  insert into garage_org_proposal(run_id, owner_id, kind, payload, evidence, confidence)
  select p_run, p_owner, 'merge',
    jsonb_build_object('keep_vehicle_id',keep,'merge_vehicle_id',dup,'proposed_change','vehicles.merged_into_vehicle_id = keep (not applied)'),
    jsonb_build_object('rule',rule,'keep',to_jsonb(k),'dup',to_jsonb(d)), conf
  from (
    select case when a.n_truth>=b.n_truth then a.vehicle_id else b.vehicle_id end keep,
           case when a.n_truth>=b.n_truth then b.vehicle_id else a.vehicle_id end dup,
           case when a.vin is not null and a.vin=b.vin then 'same_vin' else 'same_ymm_color_shared_sessions' end rule,
           case when a.vin is not null and a.vin=b.vin then 0.95 else 0.6 end conf, a k, b d
    from garage_org_vehicle a join garage_org_vehicle b on a.owner_id=p_owner and b.owner_id=p_owner and a.vehicle_id<b.vehicle_id
    where (a.vin is not null and a.vin=b.vin)
       or (a.vin is null or b.vin is null) and a.make_n=b.make_n and a.model_n=b.model_n and a.year=b.year
          and coalesce(a.color_n,'')=coalesce(b.color_n,'')
          and exists (select 1 from garage_org_photo x join garage_org_photo y on x.session_id=y.session_id and x.owner_id=p_owner and y.owner_id=p_owner
                      where x.cur_vehicle_id=a.vehicle_id and y.cur_vehicle_id=b.vehicle_id and x.is_truth and y.is_truth)) z;
  get diagnostics nm = row_count;
  return jsonb_build_object('new_vehicle_proposals',nn,'merge_proposals',nm);
end $$;

-- 6) one-shot pipeline for cron
create or replace function public.garage_org_run_v1(p_owner uuid, p_dry boolean default false, p_limit int default 2000) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '900s' as $$
declare rid uuid := gen_random_uuid(); st jsonb; sc jsonb; ap jsonb; pr jsonb; th jsonb;
begin
  insert into garage_org_run(run_id, owner_id, kind) values (rid, p_owner, case when p_dry then 'dry' else 'live' end);
  th := coalesce((select params from garage_org_run where owner_id=p_owner and kind='threshold' order by started_at desc limit 1),
                 '{"auto_score":3.0,"auto_margin":1.0,"suggest_score":1.5}');
  st := garage_org_stage_v1(p_owner);
  sc := garage_org_score_v1(rid, p_owner, 'live');
  ap := garage_org_apply_v1(rid, p_owner, (th->>'auto_score')::numeric, (th->>'auto_margin')::numeric, (th->>'suggest_score')::numeric, p_limit, p_dry);
  pr := garage_org_propose_v1(rid, p_owner);
  update garage_org_run set params=th, stats=jsonb_build_object('stage',st,'score',sc,'apply',ap,'proposals',pr), finished_at=now() where run_id=rid;
  return jsonb_build_object('run_id',rid,'stage',st,'score',sc,'apply',ap,'proposals',pr);
end $$;
