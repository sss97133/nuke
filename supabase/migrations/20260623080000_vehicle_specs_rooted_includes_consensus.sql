-- Second half of closing the spec drill→cite→proof loop. get_vehicle_specs marks a field
-- 'rooted' (drillable) from _source_image_id OR vehicle_observations OR vehicle_field_sources —
-- but NOT field_evidence (the build_field_consensus pipeline). So consensus-sourced fields
-- (e.g. K5 interior_color=Buckskin, drivetrain=4WD, both cited to the SPID build plate) showed
-- as flat, non-drillable text even though get_field_provenance can now cite them. One additive
-- clause: a field is rooted if it has a non-superseded field_evidence row. Read-only, additive.

CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with gate as (
    select v.* from vehicles v
    where v.id = p_vehicle_id
      and (v.is_public = true or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  fields(ord, label, fld) as (values
    (1,'VIN','vin'), (2,'Mileage','mileage'), (3,'Transmission','transmission'),
    (4,'Drivetrain','drivetrain'), (5,'Body','body_style'), (6,'Color','color'),
    (7,'Interior','interior_color'), (8,'Engine','engine_type'), (9,'Fuel','fuel_type')
  )
  select case when not exists (select 1 from gate) then null else coalesce((
    select jsonb_agg(spec order by ord) from (
      select f.ord,
        jsonb_build_object(
          'field', f.fld,
          'label', f.label,
          'value', (select to_jsonb(g)->>f.fld from gate g),
          'inline_source', (select to_jsonb(g)->>(f.fld||'_source') from gate g),
          'rooted', (
            (select nullif(to_jsonb(g)->>(f.fld||'_source_image_id'),'') is not null from gate g)
            or exists (select 1 from vehicle_observations o
                       where o.vehicle_id = p_vehicle_id and not coalesce(o.is_superseded,false)
                         and o.structured_data ? f.fld)
            or exists (select 1 from vehicle_field_sources fs
                       where fs.vehicle_id = p_vehicle_id and fs.field_name = f.fld
                         and coalesce(fs.field_value,'') <> ''
                         and coalesce(fs.source_type,'') not in ('computed',''))
            or exists (select 1 from field_evidence fe
                       where fe.vehicle_id = p_vehicle_id and fe.field_name = f.fld
                         and coalesce(fe.proposed_value,'') <> '' and fe.status <> 'superseded')
          ),
          'evidence_count', (select count(*) from vehicle_observations o
                             where o.vehicle_id = p_vehicle_id and not coalesce(o.is_superseded,false)
                               and o.structured_data ? f.fld)
        ) as spec
      from fields f
      where coalesce((select to_jsonb(g)->>f.fld from gate g), '') <> ''
    ) q
  ), '[]'::jsonb) end
$function$;

NOTIFY pgrst, 'reload schema';
