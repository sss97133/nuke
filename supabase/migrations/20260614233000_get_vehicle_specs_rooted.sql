-- get_vehicle_specs(vehicle) — every spec with its ROOTEDNESS, so the surface can
-- tell a FACT (backed by a real atom) from a FACADE (a bare column carrying only a
-- source LABEL and nothing beneath it, e.g. a color copied off a comp's BaT listing
-- written straight onto vehicles.color + color_source='bring a trailer').
-- rooted = a source image OR a field-keyed observation OR a real (non-computed)
-- field-evidence row actually exists for this field on THIS vehicle. A bare
-- {field}_source string is NOT a root. The root-system contract, executable:
-- the app renders rooted specs as drillable fact and unrooted ones as honest
-- "unverified" — never a bare comp value masquerading as this vehicle's truth.
create or replace function public.get_vehicle_specs(p_vehicle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
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
          ),
          'evidence_count', (select count(*) from vehicle_observations o
                             where o.vehicle_id = p_vehicle_id and not coalesce(o.is_superseded,false)
                               and o.structured_data ? f.fld)
        ) as spec
      from fields f
      where coalesce((select to_jsonb(g)->>f.fld from gate g), '') <> ''
    ) q
  ), '[]'::jsonb) end
$$;

grant execute on function public.get_vehicle_specs(uuid) to anon, authenticated;
