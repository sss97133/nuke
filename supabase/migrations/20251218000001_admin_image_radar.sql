-- Admin Image Radar (duplicate / contamination signals)
-- Provides aggregated keys for detecting repeated images across many vehicles/listings.

create or replace function public.admin_image_radar(
  p_kind text default 'normalized_url',
  p_source text default null,
  p_min_count int default 25,
  p_limit int default 50
)
returns table (
  kind text,
  key text,
  n bigint,
  vehicles bigint,
  sample_url text,
  sample_vehicle_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_min int;
  v_lim int;
  v_is_admin boolean;
  v_has_allowlist boolean;
  v_role text;
begin
  v_kind := lower(coalesce(p_kind, 'normalized_url'));
  v_min := greatest(1, least(coalesce(p_min_count, 25), 1000000));
  v_lim := greatest(1, least(coalesce(p_limit, 50), 500));

  -- request.jwt.claim.role is set by PostgREST. When running as service_role (e.g. maintenance jobs),
  -- auth.uid() is typically NULL but role will be service_role.
  v_role := nullif(current_setting('request.jwt.claim.role', true), '');

  if v_role = 'service_role' then
    -- Allow internal jobs / maintenance access.
    null;
  else
    select public.is_admin_or_moderator() into v_is_admin;
    select exists(
      select 1
      from public.admin_users au
      where au.user_id = auth.uid() and au.is_active = true
    ) into v_has_allowlist;

    if not coalesce(v_is_admin, false) and not coalesce(v_has_allowlist, false) then
      raise exception 'Forbidden';
    end if;
  end if;

  return query
  with base as (
    select
      vi.vehicle_id,
      vi.image_url,
      vi.created_at,
      case
        when v_kind = 'file_hash' then vi.file_hash
        when v_kind = 'perceptual_hash' then vi.perceptual_hash
        when v_kind = 'dhash' then vi.dhash
        else
          lower(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  split_part(coalesce(vi.image_url, ''), '?', 1),
                  '#.*$',
                  ''
                ),
                '-scaled\\.',
                '.'
              ),
              '-[0-9]{2,5}x[0-9]{2,5}(\\.[a-z0-9]+)$',
              '\\1'
            )
          )
      end as k
    from public.vehicle_images vi
    where (vi.is_duplicate is null or vi.is_duplicate = false)
      and (p_source is null or vi.source = p_source)
  ), agg as (
    select
      k as key,
      count(*)::bigint as n,
      count(distinct vehicle_id)::bigint as vehicles,
      min(image_url) as sample_url,
      (array_agg(vehicle_id order by created_at desc nulls last))[1] as sample_vehicle_id
    from base
    where k is not null and k <> ''
    group by k
    having count(*) >= v_min
    order by count(*) desc
    limit v_lim
  )
  select
    v_kind::text as kind,
    agg.key::text,
    agg.n,
    agg.vehicles,
    agg.sample_url,
    agg.sample_vehicle_id
  from agg;
end;
$$;

grant execute on function public.admin_image_radar(text, text, int, int) to authenticated;
