-- Allow moderators/admins to view ownership-documents (private bucket) for review workflows.
-- Users can already view their own ownership documents.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping ownership-documents moderator read policy: storage.objects does not exist.';
    return;
  end if;

  execute 'drop policy if exists "Moderators can view all ownership documents" on storage.objects';

  execute $p$
    create policy "Moderators can view all ownership documents"
    on storage.objects
    for select
    using (
      bucket_id = 'ownership-documents'
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (p.user_type in ('moderator','admin') or p.role in ('moderator','admin'))
      )
    )
  $p$;
exception
  when undefined_column then
    -- Some environments may not have profiles.user_type or profiles.role; skip.
    return;
end
$$;

commit;


