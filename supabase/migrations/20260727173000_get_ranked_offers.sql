-- get_ranked_offers — the shared ranked live-offers read for web, iOS and API.
-- One implementation so a new surface is a rendering job, never a second answer.
-- See docs/architecture/MULTI_SURFACE_BRIEF_2026-07-27.md.
--
-- Applied to prod via apply_migration on 2026-07-27 (CI's DB path is broken —
-- see .claude/ISSUES.md), across three revisions. This file is the final state.
--
-- Design notes worth keeping:
--   * Rank = desire prior (market_segments.priority) decayed by age. Freshness is
--     PART of rank, not a later filter: the owner's stated challenge is "being
--     first to the offering then to engage with it."
--   * Specificity REFINES the prior, never erases it. A first revision let the
--     most specific segment win the match outright; because 'squarebody' carries
--     priority NULL, a 1978 K10 inherited NULL and scored below a random 1973
--     sedan (measured: 0 specific matches in the top 200). Now the LABEL comes
--     from the most specific segment and the PRIORITY is the best across every
--     match. After the fix: 24 specific matches in the top 200.
--   * Price walks listing column -> auction event -> bat_listings. Adding the
--     bat rung took priced coverage from ~25% to 74.5% of returned rows. When no
--     rung hits, price stays NULL and the surface says "not priced yet" — never
--     an honest-low guess.
create or replace function public.get_ranked_offers(
  p_limit        integer default 50,
  p_max_hours    integer default 168,
  p_min_price    numeric default null,
  p_max_price    numeric default null,
  p_max_priority integer default null
)
returns table (
  vehicle_id uuid, year integer, make text, model text,
  segment_slug text, segment_name text, priority integer, match_kind text,
  price numeric, price_source text, location text, source text,
  listing_url text, image_url text, hours_old numeric, rank_score numeric
)
language sql stable security invoker set search_path = public as $$
  with live as (
    select v.id, v.year, v.make, v.model, v.location, v.source,
           coalesce(v.listing_url, v.discovery_url) as url,
           v.primary_image_url,
           coalesce(v.price, v.asking_price) as px_direct, v.created_at
    from vehicles v
    where v.created_at > now() - make_interval(hours => p_max_hours)
      and v.year is not null and v.make is not null and v.model is not null
      and coalesce(v.sale_status, '') not in ('sold','ended')
  ),
  priced as (
    select l.*,
           (select coalesce(e.current_price, e.buy_now_price, e.starting_price)
              from vehicle_events e where e.vehicle_id = l.id
               and coalesce(e.current_price, e.buy_now_price, e.starting_price) is not null
             order by e.created_at desc limit 1) as px_event,
           (select coalesce(b.final_bid, b.sale_price, b.starting_bid)
              from bat_listings b where b.vehicle_id = l.id
               and coalesce(b.final_bid, b.sale_price, b.starting_bid) is not null
             order by b.created_at desc limit 1) as px_bat
    from live l
  ),
  laddered as (
    select p.*, coalesce(p.px_direct, p.px_event, p.px_bat) as px,
           case when p.px_direct is not null then 'listing'
                when p.px_event  is not null then 'event'
                when p.px_bat    is not null then 'bat' else null end as px_src
    from priced p
  ),
  hits as (
    select l.id, s.slug, s.name, s.priority,
           (s.makes is not null or s.model_keywords is not null) as is_specific
    from laddered l
    join market_segments s
      on s.status = 'active'
     and (s.year_min is null or l.year >= s.year_min)
     and (s.year_max is null or l.year <= s.year_max)
     and (s.makes is null or l.make ilike any (s.makes))
     and (s.model_keywords is null or exists (
           select 1 from unnest(s.model_keywords) k where l.model ilike '%'||k||'%'))
  ),
  label as (
    select distinct on (id) id, slug, name, is_specific
    from hits order by id, is_specific desc, priority asc nulls last
  ),
  best as (select id, min(priority) as priority from hits group by id)
  select l.id, l.year, l.make, l.model, lb.slug, lb.name, b.priority,
         case when lb.is_specific then 'specific' else 'year-band' end,
         l.px, l.px_src, l.location, l.source, l.url, l.primary_image_url,
         round(extract(epoch from now() - l.created_at)/3600.0, 1),
         round((100.0 / greatest(coalesce(b.priority, 9), 1))
               * case when lb.is_specific then 1.25 else 1.0 end
               * exp(-extract(epoch from now() - l.created_at) / (86400.0 * 3)), 3)
  from laddered l
  join label lb on lb.id = l.id
  join best  b  on b.id  = l.id
  where (p_max_priority is null or coalesce(b.priority, 99) <= p_max_priority)
    and (p_min_price is null or l.px >= p_min_price)
    and (p_max_price is null or l.px <= p_max_price)
  order by rank_score desc, l.created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_ranked_offers to anon, authenticated, service_role;
