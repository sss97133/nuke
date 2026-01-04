-- =====================================================
-- MEME LIBRARY INDEXING (STORAGE BUCKET + ADMIN RPCs)
-- =====================================================
-- Adds a dedicated storage bucket for meme assets and admin-only RPCs to upsert
-- packs/actions without opening write access to the public.
--
-- Date: 2025-12-15

begin;

-- ==========================
-- 1) Storage bucket: meme-assets
-- ==========================
do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'Skipping meme-assets bucket setup: storage schema not available.';
    return;
  end if;

  -- Public bucket for easy rendering via getPublicUrl
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'meme-assets',
    'meme-assets',
    true,
    10485760, -- 10MB
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ]::text[]
  )
  on conflict (id) do update set
    public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ]::text[];

  -- Ensure RLS is enabled
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then
    raise notice 'Skipping RLS enable on storage.objects (insufficient privilege)';
  end;

  -- Drop legacy policies (safe for re-runs)
  execute 'drop policy if exists "meme-assets: public read" on storage.objects';
  execute 'drop policy if exists "meme-assets: admin insert" on storage.objects';
  execute 'drop policy if exists "meme-assets: admin update" on storage.objects';
  execute 'drop policy if exists "meme-assets: admin delete" on storage.objects';

  -- Public read
  execute $p$
    create policy "meme-assets: public read"
    on storage.objects
    for select
    using (bucket_id = 'meme-assets')
  $p$;

  -- Admin write (via admin_users table)
  execute $p$
    create policy "meme-assets: admin insert"
    on storage.objects
    for insert
    with check (
      bucket_id = 'meme-assets'
      and auth.role() = 'authenticated'
      and exists (
        select 1 from public.admin_users au
        where au.user_id = auth.uid()
          and au.is_active = true
      )
    )
  $p$;

  execute $p$
    create policy "meme-assets: admin update"
    on storage.objects
    for update
    using (
      bucket_id = 'meme-assets'
      and auth.role() = 'authenticated'
      and exists (
        select 1 from public.admin_users au
        where au.user_id = auth.uid()
          and au.is_active = true
      )
    )
    with check (bucket_id = 'meme-assets')
  $p$;

  execute $p$
    create policy "meme-assets: admin delete"
    on storage.objects
    for delete
    using (
      bucket_id = 'meme-assets'
      and auth.role() = 'authenticated'
      and exists (
        select 1 from public.admin_users au
        where au.user_id = auth.uid()
          and au.is_active = true
      )
    )
  $p$;
end
$$;

-- ==========================
-- 2) Admin RPCs: upsert packs/actions
-- ==========================
-- NOTE: These are SECURITY DEFINER and gated by admin_users.

create or replace function public.admin_upsert_stream_action_pack(
  p_slug text,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_is_active boolean
)
returns uuid as $$
declare
  v_user_id uuid;
  v_pack_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.admin_users au
    where au.user_id = v_user_id and au.is_active = true
  ) then
    raise exception 'Admin access required';
  end if;

  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'Missing slug';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Missing name';
  end if;

  insert into public.stream_action_packs (slug, name, description, price_cents, is_active)
  values (
    btrim(p_slug),
    p_name,
    p_description,
    coalesce(p_price_cents, 0),
    coalesce(p_is_active, true)
  )
  on conflict (slug) do update set
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into v_pack_id;

  return v_pack_id;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_upsert_stream_action_pack(text, text, text, bigint, boolean) to authenticated;

create or replace function public.admin_upsert_stream_action(
  p_pack_id uuid,
  p_slug text,
  p_title text,
  p_kind text,
  p_render_text text,
  p_image_url text,
  p_sound_key text,
  p_duration_ms integer,
  p_cooldown_ms integer,
  p_is_active boolean,
  p_source_url text,
  p_attribution text,
  p_license text,
  p_tags text[],
  p_metadata jsonb
)
returns uuid as $$
declare
  v_user_id uuid;
  v_action_id uuid;
  v_kind text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.admin_users au
    where au.user_id = v_user_id and au.is_active = true
  ) then
    raise exception 'Admin access required';
  end if;

  if p_pack_id is null then
    raise exception 'Missing pack_id';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'Missing slug';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Missing title';
  end if;

  v_kind := coalesce(p_kind, 'text_popup');

  insert into public.stream_actions (
    pack_id, slug, title, kind,
    render_text, image_url, sound_key,
    duration_ms, cooldown_ms, is_active
  )
  values (
    p_pack_id, btrim(p_slug), p_title, v_kind,
    p_render_text, p_image_url, p_sound_key,
    coalesce(p_duration_ms, 1800),
    coalesce(p_cooldown_ms, 2500),
    coalesce(p_is_active, true)
  )
  on conflict (pack_id, slug) do update set
    title = excluded.title,
    kind = excluded.kind,
    render_text = excluded.render_text,
    image_url = excluded.image_url,
    sound_key = excluded.sound_key,
    duration_ms = excluded.duration_ms,
    cooldown_ms = excluded.cooldown_ms,
    is_active = excluded.is_active,
    updated_at = now()
  returning id into v_action_id;

  update public.stream_actions
  set
    source_url = nullif(btrim(coalesce(p_source_url, '')), ''),
    attribution = nullif(btrim(coalesce(p_attribution, '')), ''),
    license = nullif(btrim(coalesce(p_license, '')), ''),
    tags = coalesce(p_tags, array[]::text[]),
    metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = v_action_id;

  return v_action_id;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_upsert_stream_action(uuid, text, text, text, text, text, text, integer, integer, boolean, text, text, text, text[], jsonb) to authenticated;

create or replace function public.admin_delete_stream_action(
  p_action_id uuid
)
returns void as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.admin_users au
    where au.user_id = v_user_id and au.is_active = true
  ) then
    raise exception 'Admin access required';
  end if;

  if p_action_id is null then
    raise exception 'Missing action_id';
  end if;

  delete from public.stream_actions where id = p_action_id;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_delete_stream_action(uuid) to authenticated;

create or replace function public.admin_delete_stream_action_pack(
  p_pack_id uuid
)
returns void as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.admin_users au
    where au.user_id = v_user_id and au.is_active = true
  ) then
    raise exception 'Admin access required';
  end if;

  if p_pack_id is null then
    raise exception 'Missing pack_id';
  end if;

  -- Delete pack (actions will cascade due to ON DELETE CASCADE)
  delete from public.stream_action_packs where id = p_pack_id;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_delete_stream_action_pack(uuid) to authenticated;

commit;


