create or replace function public.garage_org_score_v1(p_run uuid, p_owner uuid, p_mode text) returns jsonb language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare n int;
begin
  delete from garage_org_score where run_id=p_run;
  create temp table _p on commit drop as
    select * from garage_org_photo where owner_id=p_owner and (case when p_mode='backtest' then is_truth else is_target end);
  -- session votes / location prior: pre-aggregated confirmed counts, minus self (leave-one-out)
  create temp table _sv on commit drop as select session_id k, cur_vehicle_id vehicle_id, count(*)::numeric n
    from garage_org_photo where owner_id=p_owner and is_truth group by 1,2;
  create temp table _cv on commit drop as select cell k, cur_vehicle_id vehicle_id, count(*)::numeric n
    from garage_org_photo where owner_id=p_owner and is_truth and cell is not null group by 1,2;
  create temp table _sess on commit drop as
    select image_id, vehicle_id, nv, sum(nv) over (partition by image_id) nall from (
      select p.image_id, s.vehicle_id, s.n - (p.is_truth and p.cur_vehicle_id=s.vehicle_id)::int nv
      from _p p join _sv s on s.k=p.session_id) x where nv>0;
  create temp table _cell on commit drop as
    select image_id, vehicle_id, nv, sum(nv) over (partition by image_id) nall from (
      select p.image_id, s.vehicle_id, s.n - (p.is_truth and p.cur_vehicle_id=s.vehicle_id)::int nv
      from _p p join _cv s on s.k=p.cell) x where nv>0;
  create index on _sess(image_id, vehicle_id); create index on _cell(image_id, vehicle_id); analyze _p; analyze _sess; analyze _cell;
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
  update garage_org_score g set rnk=r.rnk, margin=r.margin, confidence=round(1/(1+exp(-(g.score-2.0))),3)
  from (select image_id, vehicle_id, row_number() over w rnk, score - coalesce(lead(score) over w,0) margin
        from garage_org_score where run_id=p_run window w as (partition by image_id order by score desc, vehicle_id)) r
  where g.run_id=p_run and g.image_id=r.image_id and g.vehicle_id=r.vehicle_id;
  select count(distinct image_id) into n from garage_org_score where run_id=p_run;
  return jsonb_build_object('scored_photos',n,'pairs',(select count(*) from garage_org_score where run_id=p_run));
end $$;


create or replace function public.garage_org_visual_v1(p_run uuid, p_owner uuid) returns int language plpgsql
set search_path to 'public','pg_temp' set statement_timeout to '600s' as $$
declare n int;
begin
  create temp table _th on commit drop as select cur_vehicle_id vehicle_id, image_id, ('x'||lpad(dhash,16,'0'))::bit(64) h
    from garage_org_photo where owner_id=p_owner and is_truth and dhash ~ '^[0-9a-f]{16}$';
  create temp table _ph on commit drop as select image_id, ('x'||lpad(dhash,16,'0'))::bit(64) h from garage_org_photo where owner_id=p_owner and image_id in (select image_id from garage_org_score where run_id=p_run) and dhash ~ '^[0-9a-f]{16}$';
  create temp table _sc on commit drop as select image_id, vehicle_id from garage_org_score where run_id=p_run;
  create index on _th(vehicle_id); create index on _ph(image_id); create index on _sc(image_id); analyze _th; analyze _ph; analyze _sc;
  update garage_org_score g set score=g.score+1.5, signals=g.signals||jsonb_build_object('visual_match',x.best)
  from (select c.image_id, c.vehicle_id, min(bit_count(ph.h # th.h)) best
        from _ph ph join _sc c on c.image_id=ph.image_id join _th th on th.vehicle_id=c.vehicle_id and th.image_id<>ph.image_id
        group by 1,2) x
  where g.run_id=p_run and g.image_id=x.image_id and g.vehicle_id=x.vehicle_id and x.best<=6;
  get diagnostics n = row_count;
  update garage_org_score g set rnk=r.rnk, margin=r.margin, confidence=round(1/(1+exp(-(g.score-2.0))),3)
  from (select image_id, vehicle_id, row_number() over w rnk, score - coalesce(lead(score) over w,0) margin
        from garage_org_score where run_id=p_run window w as (partition by image_id order by score desc, vehicle_id)) r
  where g.run_id=p_run and g.image_id=r.image_id and g.vehicle_id=r.vehicle_id;
  return n;
end $$;
