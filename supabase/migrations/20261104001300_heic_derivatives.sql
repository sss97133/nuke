-- HEIC browser-safe derivatives. Originals (image_url/storage_path) are never modified.
-- Derivatives = Supabase Storage render endpoint (returns JPEG, honours HEIC rotation; verified 262/262).
-- Backfill applied via _pf_update run a0d17000-1103-4000-8000-000000000006 (revert: select profile_fix_revert('a0d17000-1103-4000-8000-000000000006')).
create or replace function public.heic_render_url(p_url text, p_w int) returns text
language sql immutable as $f$
  select replace(p_url,'/storage/v1/object/public/','/storage/v1/render/image/public/')
         ||'?width='||p_w||'&height='||p_w||'&resize=contain&quality=80'
$f$;

create or replace function public._heic_set_derivatives() returns trigger
language plpgsql as $f$
begin
  if NEW.image_url like '%/storage/v1/object/public/%'
     and (NEW.image_url ~* '\.hei[cf]($|\?)' or coalesce(NEW.mime_type,'') ilike '%hei%') then
    if NEW.thumbnail_url is null or NEW.thumbnail_url ~* '\.hei[cf]($|\?)' then NEW.thumbnail_url := heic_render_url(NEW.image_url,400); end if;
    if NEW.medium_url   is null or NEW.medium_url   ~* '\.hei[cf]($|\?)' then NEW.medium_url   := heic_render_url(NEW.image_url,1080); end if;
    if NEW.large_url    is null or NEW.large_url    ~* '\.hei[cf]($|\?)' then NEW.large_url    := heic_render_url(NEW.image_url,2048); end if;
  end if;
  return NEW;
end $f$;

drop trigger if exists a01_trg_heic_derivatives on public.vehicle_images;
create trigger a01_trg_heic_derivatives before insert or update of image_url on public.vehicle_images
  for each row execute function public._heic_set_derivatives();
-- Revert hook: drop trigger a01_trg_heic_derivatives on public.vehicle_images; drop function public._heic_set_derivatives(); drop function public.heic_render_url(text,int);

-- Split proposals (no data moved)
create table if not exists public.vehicle_split_proposal(id bigserial primary key, source_vehicle_id uuid not null, proposed_desc text,
  image_ids uuid[], candidate_vehicle_id uuid, confidence text, reason text, status text default 'proposed', created_at timestamptz default now());
