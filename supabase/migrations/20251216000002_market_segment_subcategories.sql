-- =====================================================
-- MARKET SEGMENT SUBCATEGORIES (UI FACETS)
-- =====================================================
-- Adds user-definable subcategories for each market segment (e.g. "Commuter",
-- "Luxury", "Track", "Work Truck"). Readable by anon for public market browsing.
-- Also extends market_segments_index to include subcategory_count + subcategories JSON.
--
-- Idempotent + safe for `supabase db reset`.
-- Date: 2025-12-16

begin;

-- ==========================
-- 1) SUBCATEGORIES TABLE
-- ==========================

create table if not exists public.market_segment_subcategories (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.market_segments(id) on delete cascade,

  slug text not null,
  name text not null,
  description text,

  status text not null default 'active' check (status in ('active', 'draft', 'archived')),

  created_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_segment_subcategories_segment_slug_unique unique (segment_id, slug)
);

create index if not exists idx_market_segment_subcategories_segment_status
  on public.market_segment_subcategories (segment_id, status);

create index if not exists idx_market_segment_subcategories_status
  on public.market_segment_subcategories (status);

-- Best-effort updated_at trigger (helper exists in multiple migrations in this repo)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists market_segment_subcategories_set_updated_at on public.market_segment_subcategories;
    create trigger market_segment_subcategories_set_updated_at
      before update on public.market_segment_subcategories
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.market_segment_subcategories enable row level security;

-- ==========================
-- 2) RLS POLICIES
-- ==========================

drop policy if exists market_segment_subcategories_select_anon on public.market_segment_subcategories;
create policy market_segment_subcategories_select_anon
  on public.market_segment_subcategories
  for select
  to anon
  using (
    status = 'active'
    and exists (
      select 1
      from public.market_segments s
      where s.id = segment_id
        and s.status = 'active'
    )
  );

drop policy if exists market_segment_subcategories_select_authenticated on public.market_segment_subcategories;
create policy market_segment_subcategories_select_authenticated
  on public.market_segment_subcategories
  for select
  to authenticated
  using (
    -- Auth users can browse active subcategories; drafts/archived reserved for creator (future).
    status = 'active'
    or created_by = auth.uid()
  );

drop policy if exists market_segment_subcategories_insert on public.market_segment_subcategories;
create policy market_segment_subcategories_insert
  on public.market_segment_subcategories
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.market_segments s
      where s.id = segment_id
        and s.status = 'active'
    )
  );

drop policy if exists market_segment_subcategories_update on public.market_segment_subcategories;
create policy market_segment_subcategories_update
  on public.market_segment_subcategories
  for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists market_segment_subcategories_delete on public.market_segment_subcategories;
create policy market_segment_subcategories_delete
  on public.market_segment_subcategories
  for delete
  to authenticated
  using (created_by = auth.uid());

-- ==========================
-- 3) EXTEND MARKET SEGMENTS INDEX VIEW
-- ==========================

create or replace view public.market_segments_index as
select
  s.id as segment_id,
  s.slug,
  s.name,
  s.description,
  s.manager_type,
  s.status,
  s.year_min,
  s.year_max,
  s.makes,
  s.model_keywords,
  s.created_at,
  s.updated_at,

  f.id as fund_id,
  f.symbol as fund_symbol,
  f.fund_type,
  f.nav_share_price,
  f.total_shares_outstanding,
  f.total_aum_usd,

  st.vehicle_count,
  st.market_cap_usd,
  st.change_7d_pct,
  st.change_30d_pct,

  sc.subcategory_count,
  sc.subcategories
from public.market_segments s
left join public.market_funds f
  on f.segment_id = s.id
  and f.status = 'active'
cross join lateral public.market_segment_stats(s.id) st
cross join lateral (
  select
    count(*)::int as subcategory_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'segment_id', c.segment_id,
          'slug', c.slug,
          'name', c.name,
          'description', c.description
        )
        order by c.name
      ),
      '[]'::jsonb
    ) as subcategories
  from public.market_segment_subcategories c
  where c.segment_id = s.id
    and c.status = 'active'
) sc
where s.status = 'active';

comment on view public.market_segments_index is 'Market segments + optional fund mapping + stats for browse/heatmap UIs. Includes subcategories JSON for UI facets.';

commit;


