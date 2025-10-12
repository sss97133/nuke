-- Make vehicles/* publicly readable in vehicle-data bucket while keeping other paths private
-- This migration sets bucket to private and adds RLS policies to allow anonymous read for vehicles/* only.

begin;

-- Ensure bucket exists and is private (public flag off so RLS governs access)
update storage.buckets
set public = false
where id = 'vehicle-data';

-- Enable RLS on storage.objects (usually enabled by default)
alter table if exists storage.objects enable row level security;

-- Drop old broad policies if they exist to avoid overexposure
do $$
begin
  if exists (
    select 1 from pg_policies 
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public access to vehicle-data'
  ) then
    drop policy "Public access to vehicle-data" on storage.objects;
  end if;
end$$;

-- Allow anonymous and authenticated SELECT for vehicle-data objects under vehicles/*
create policy if not exists "public read vehicle-data vehicles/*" on storage.objects
for select
using (
  bucket_id = 'vehicle-data'
  and (name like 'vehicles/%')
);

-- Maintain existing authenticated write access to vehicle-data (idempotent-safe)
create policy if not exists "auth write vehicle-data" on storage.objects
for insert
with check (
  bucket_id = 'vehicle-data'
);

create policy if not exists "auth update vehicle-data" on storage.objects
for update
using (
  bucket_id = 'vehicle-data'
)
with check (
  bucket_id = 'vehicle-data'
);

create policy if not exists "auth delete vehicle-data" on storage.objects
for delete
using (
  bucket_id = 'vehicle-data'
);

commit;
