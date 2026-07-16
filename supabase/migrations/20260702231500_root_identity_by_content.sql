-- Content-identity rooting via storage etags (applied live 2026-07-02; this is the repo record).
-- storage.objects single-part etags ARE the MD5 of stored bytes — content identity computed at
-- upload time, sitting unused in metadata. Landed on the spine through a new service-side
-- chokepoint (no client grant): one image_identities row per distinct content,
-- vehicle_images.image_identity_id linked additively (only-if-null). Hash algorithm carried by
-- the column NAME (content_hash_md5) per the Seam-2 parity doctrine. phash/phash_hex NOT NULL
-- relaxed: identities are rootable by ANY content key; other hashes backfill later.
-- First run (Skylar, 26,777 rows): 12,599 identities created, 9,540 rows newly linked →
-- 20,104/26,777 rooted (75%, was 39%); 3,056 byte-exact duplicate rows now share identities.

alter table image_identities alter column phash_hex drop not null;
alter table image_identities alter column phash drop not null;
alter table image_identities add column if not exists content_hash_md5 text;
create unique index if not exists idx_image_identities_md5
  on image_identities (content_hash_md5) where content_hash_md5 is not null;
comment on column image_identities.content_hash_md5 is
  'MD5 of the stored bytes (= single-part storage etag). Equality key for exact-content joins; algorithm named by the column per hash-tagging doctrine.';

create or replace function public.root_identity_by_content(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identities int;
  v_linked int;
begin
  if jsonb_typeof(p_batch) <> 'array' then
    raise exception 'root_identity_by_content: p_batch must be a jsonb array';
  end if;

  with items as (
    select distinct on (x.md5) x.md5, x.basename, x.size, x.mime
    from jsonb_to_recordset(p_batch)
      as x(image_id uuid, md5 text, basename text, size bigint, mime text)
    where x.md5 is not null and x.md5 <> '' and position('-' in x.md5) = 0
    order by x.md5
  ),
  ins as (
    insert into image_identities (content_hash_md5, original_filename, file_size_bytes, mime_type, first_seen_at, first_seen_source)
    select i.md5, i.basename, i.size, i.mime, now(), 'storage_etag_rooting'
    from items i
    where not exists (select 1 from image_identities ii where ii.content_hash_md5 = i.md5)
    returning 1
  )
  select count(*) into v_identities from ins;

  with items as (
    select x.image_id, x.md5
    from jsonb_to_recordset(p_batch)
      as x(image_id uuid, md5 text, basename text, size bigint, mime text)
    where x.md5 is not null and x.md5 <> '' and position('-' in x.md5) = 0
  ),
  upd as (
    update vehicle_images vi
    set image_identity_id = ii.id
    from items i
    join image_identities ii on ii.content_hash_md5 = i.md5
    where vi.id = i.image_id
      and vi.image_identity_id is null
    returning 1
  )
  select count(*) into v_linked from upd;

  return jsonb_build_object('identities_created', v_identities, 'rows_linked', v_linked);
end;
$$;

revoke all on function public.root_identity_by_content(jsonb) from public, anon, authenticated;

comment on function public.root_identity_by_content(jsonb) is
  'Roots content identity from storage etags (md5): one identity per distinct content, additive only-if-null linking of vehicle_images.image_identity_id. Service-side organ (no client grant). Batch: [{image_id, md5, basename, size, mime}].';
