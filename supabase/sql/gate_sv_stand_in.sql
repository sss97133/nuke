-- Stand-in for the contract test_receipt_type_signals.sql: the live receipt_type_gate_sv as read 2026-11-05 (not a migration).
CREATE OR REPLACE FUNCTION public.receipt_type_gate_sv(s jsonb, v vehicles)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare fam text; cls text; pos boolean := false;
begin
  if v.id is null then return 'fail'; end if;
  cls := receipt_vehicle_class(v);
  fam := case when lower(v.make) in ('chevrolet','chevy','gmc') then 'gm' else lower(v.make) end;
  if jsonb_array_length(s->'makes')>0 then
    if fam is not null and not (s->'makes') ? fam then return 'fail'; end if; pos := true; end if;
  if jsonb_array_length(s->'models')>0 then
    if not exists (select 1 from jsonb_array_elements_text(s->'models') m where lower(coalesce(v.model,'')) like '%'||m||'%') then return 'fail'; end if; pos := true; end if;
  if (s->>'truck')::boolean and not (s->>'car')::boolean and cls='car' then return 'fail'; end if;
  if (s->>'car')::boolean and not (s->>'truck')::boolean and cls='truck' then return 'fail'; end if;
  if ((s->>'truck')::boolean and cls='truck') or ((s->>'car')::boolean and cls='car') then pos := true; end if;
  return case when pos then 'pass' else 'unknown' end;
end $function$
