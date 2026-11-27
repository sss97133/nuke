-- Read-only queries behind README.md (run 2026-11-23 on qkgaybvrernstplzjaam). Safe to re-run.

-- Fill, width, distinct values per column (planner stats; ANALYZE cron weekly-analyze-vehicle-images is INACTIVE).
select attname, null_frac, avg_width, n_distinct, left(most_common_vals::text, 90)
from pg_stats where schemaname = 'public' and tablename = 'vehicle_images' order by null_frac desc;

-- ai_scan_metadata top-level key frequencies (0.5% sample; x200.1 for totals).
select k, count(*) from public.vehicle_images tablesample system (0.5),
  jsonb_object_keys(case when jsonb_typeof(ai_scan_metadata) = 'object' then ai_scan_metadata else '{}' end) k
group by k order by 2 desc;

-- Which classifier prompt answered (legacy vs v98), by month.
select left(k->'classifier_receipt'->>'model', 30) model, k->'classifier_receipt'->>'prompt_version' pv, (k ? 'v2') has_v2,
       k->>'classifier_ok' ok, date_trunc('month', (m->>'processed_at')::timestamptz) mon, count(*)
from (select ai_scan_metadata m, ai_scan_metadata->'classification' k
      from public.vehicle_images tablesample system (0.5) where ai_scan_metadata ? 'classification') z
group by 1,2,3,4,5 order by 5 desc nulls last, 6 desc;

-- Answers stored in JSON that never reached a column (coverage gaps 1-10).
with s as (select * from public.vehicle_images tablesample system (0.5)),
k as (select s.*, ai_scan_metadata->'classification' c, ai_scan_metadata->'byok_deep_analysis' d from s)
select count(*) n,
  count(*) filter (where c->>'vin_detected' ~ '^[A-HJ-NPR-Z0-9]{17}$' and vehicle_vin is null) vin17_not_landed,
  count(*) filter (where nullif(c->'vehicle_hints'->>'make', '') is not null) hint_make,
  count(*) filter (where jsonb_typeof(c->'detected_text') = 'array' and jsonb_array_length(c->'detected_text') > 0) detected_text,
  count(*) filter (where c->>'image_type' = 'receipt_document' and is_document is not true) receipt_not_doc,
  count(*) filter (where c->>'image_type' in ('vehicle_exterior','vehicle_interior','engine_bay','undercarriage')
                   and ai_detected_angle is null and angle is null) angle_derivable,
  count(*) filter (where c->>'image_type' is not null and category in ('general','gallery')) typed_but_generic,
  count(*) filter (where d is not null and camera_pose is null) deep_pose_not_landed,
  count(*) filter (where d::text ~ 'damage_localized":\s*\[\s*\{') deep_damage,
  count(*) filter (where d::text ~ '"person":\s*true') deep_person,
  count(*) filter (where d is not null and fabrication_stage is null) deep_phase_not_landed
from k;

-- Index usage and size.
select s.indexrelname, s.idx_scan, s.last_idx_scan, pg_relation_size(s.indexrelid) / 1048576 mb, pg_get_indexdef(s.indexrelid)
from pg_stat_user_indexes s where s.relname = 'vehicle_images' order by s.idx_scan;

-- Views and triggers that depend on a column.
select v.relname, string_agg(distinct a.attname, ',') from pg_depend d join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
where d.refobjid = 'public.vehicle_images'::regclass and v.oid <> 'public.vehicle_images'::regclass group by 1;

-- Orphan check for a function: trigger, cron, SQL caller (then git grep the repo).
select (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname = :'fn') trig,
       (select count(*) from cron.job j where j.command ~ :'fn' and j.active) cron,
       (select count(*) from pg_proc p where p.prosrc ~ ('\m' || :'fn' || '\M') and p.proname <> :'fn') callers;

-- Junk hero images on vehicles.
select count(*) filter (where primary_image_url = 'jpg') jpg, count(*) filter (where primary_image_url !~ '^https?://') not_url
from public.vehicles;
