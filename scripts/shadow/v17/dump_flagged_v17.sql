-- v17 drop list source: vehicle_events flagged as attached to the wrong vehicle (source_suspect @> {vehicle_id}),
-- i.e. agg_attach_audit_v1_20261024 + earlier flags. Fields: id|vehicle_id|platform|date|final|hammer|gross.
-- drop_vid_date.txt = distinct vehicle_id|date of dated rows. Run BEFORE agg_reattach_v1 moves any (the original
-- vehicle is the one whose comps were contaminated).
select string_agg(concat_ws('|', e.id, e.vehicle_id, coalesce(e.source_platform,''),
  coalesce((coalesce(e.sold_at,e.ended_at) at time zone 'UTC')::date::text,''),
  coalesce(e.final_price::text,''), coalesce(e.hammer_price::text,''), coalesce(e.gross_price::text,'')), E'\n') s, count(*) n
from vehicle_events e where 'vehicle_id' = any(e.source_suspect);
