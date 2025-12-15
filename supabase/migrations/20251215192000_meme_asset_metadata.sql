-- =====================================================
-- MEME ASSET METADATA (PROVENANCE + TAGGING)
-- =====================================================
-- Adds optional fields to stream_actions so we can index meme templates safely:
-- - provenance/source URL
-- - attribution/license
-- - tags (template family/group)
-- - metadata (freeform JSON for future)
--
-- Date: 2025-12-15

begin;

do $$
begin
  if to_regclass('public.stream_actions') is null then
    raise notice 'Skipping meme metadata: stream_actions does not exist.';
    return;
  end if;

  alter table public.stream_actions
    add column if not exists source_url text,
    add column if not exists attribution text,
    add column if not exists license text,
    add column if not exists tags text[] not null default array[]::text[],
    add column if not exists metadata jsonb not null default '{}'::jsonb;

  create index if not exists idx_stream_actions_tags on public.stream_actions using gin (tags);
end
$$;

commit;


