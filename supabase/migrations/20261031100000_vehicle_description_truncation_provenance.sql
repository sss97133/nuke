-- v38: first-class description truncation / length provenance (schema-first; additive, reversible).
-- extract-bat-core <4.5.8 stored a 480-char summary + '…' in vehicles.description. Features must be able to
-- tell a cut-off summary from a full post body, and full bodies recovered from saved pages are kept as cited
-- evidence (never overwriting vehicles.description, never shadowing a longer text).

alter table public.vehicles
  add column if not exists description_truncated boolean,
  add column if not exists description_length_source text;
do $$ begin
  alter table public.vehicles add constraint vehicles_description_length_source_chk
    check (description_length_source is null or description_length_source in ('full_post_body','summary_480','unknown')) not valid;
exception when duplicate_object then null; end $$;
comment on column public.vehicles.description_truncated is 'true = description is a cut-off summary (e.g. extract-bat-core <4.5.8 480-char + …); false = full body; null = unknown, use vehicle_description_effective()';
comment on column public.vehicles.description_length_source is 'full_post_body | summary_480 | unknown';

create or replace function public.is_legacy_truncated_description(t text)
returns boolean language sql immutable parallel safe as $$
  select coalesce(length(t) between 400 and 481 and right(t,1) = '…', false)
$$;

create table if not exists public.vehicle_description_restorations (
  id bigserial primary key,
  vehicle_id uuid not null references public.vehicles(id),
  old_length int not null,
  old_md5 text not null,
  full_text text not null,
  full_length int not null,
  full_md5 text not null,
  source_url text not null,
  source_ref text not null,
  fetched_at timestamptz,
  rule text not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint vdr_longer_chk check (full_length > old_length),
  constraint vdr_len_chk check (full_length = length(full_text))
);
create unique index if not exists vdr_vehicle_run_uq on public.vehicle_description_restorations(vehicle_id, run_id);
create index if not exists vdr_vehicle_live_idx on public.vehicle_description_restorations(vehicle_id) where retired_at is null;
comment on table public.vehicle_description_restorations is 'Full description bodies recovered from saved source pages for rows whose stored text is a proven cut of that body (old_md5 = md5 of the stored cut). Evidence only; revert by setting retired_at.';

-- Best available text for features: a live restoration applies only while vehicles.description is still the exact
-- cut it was proven against, and only if it is longer; otherwise the stored text wins.
create or replace function public.vehicle_description_effective(p_vehicle_id uuid)
returns table(description text, truncated boolean, length_source text, restoration_id bigint)
language sql stable as $$
  with v as (select v.description d, v.description_truncated t, v.description_length_source s from public.vehicles v where v.id = p_vehicle_id),
  r as (select x.id, x.full_text from public.vehicle_description_restorations x, v
        where x.vehicle_id = p_vehicle_id and x.retired_at is null and x.old_md5 = md5(v.d) and x.full_length > length(v.d)
        order by x.full_length desc, x.id desc limit 1)
  select coalesce(r.full_text, v.d),
         case when r.id is not null then false when v.t is not null then v.t
              when v.d is null then null else public.is_legacy_truncated_description(v.d) end,
         case when r.id is not null then 'full_post_body' when v.s is not null then v.s
              when v.d is null then null when public.is_legacy_truncated_description(v.d) then 'summary_480' else 'unknown' end,
         r.id
  from v left join r on true
$$;
