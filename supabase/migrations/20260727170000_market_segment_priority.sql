-- Market segment desirability priority — the ranking prior the deal surfaces lack.
--
-- WHY
-- The listing artery is healthy (441 feeds, ~2,400-2,900 vehicles/24h at 98.2%
-- complete year+make+model as of 2026-07-27) and nothing ranks what it delivers.
-- Ranking needs a desirability prior and the platform has none, so every surface
-- that wanted one would have hardcoded its own — three frontends, three answers.
-- This column is the single shared prior. See
-- docs/architecture/MULTI_SURFACE_BRIEF_2026-07-27.md.
--
-- WHY A COLUMN AND NOT A NEW TABLE (SCHEMA_LAW §1, §2)
-- Searched first: market_segments (4 rows), vehicle_segments (43),
-- canonical_vehicle_types (15), market_indexes (10). market_segments already
-- carries exactly this shape — slug, year_min, year_max, makes[],
-- model_keywords[], manager_type, status — and already holds era-and-make bands
-- ('squarebody' 1973-1987 Chevrolet/GMC). No new organ is earned; the existing
-- one was missing one attribute. SCHEMA_LAW §2 names "ranking joins" as what
-- earns storage, which is precisely this.
--
-- SEMANTICS
-- priority 1 = most desirable. NULL = unranked, which is NOT "least desirable":
-- unranked segments must sort after ranked ones but stay visible. The four
-- pre-existing rows are deliberately left NULL — they are lenses (porsche,
-- trucks), not era bands, and ranking them was not asked for.
--
-- The era rows below encode a general collector-market ordering. It is a PRIOR,
-- not a filter: it ranks when nothing more specific is known. A segment carrying
-- makes[] or model_keywords[] is more specific and outranks a bare year band —
-- which is how 1973 belongs to both the 1963-73 era and to 'squarebody'
-- (1973-1987) without contradiction. Consumers resolve by specificity, then by
-- priority. Rank never becomes a WHERE clause; a clean flip in any year is still
-- a deal, and being first to a fresh listing outweighs era.
--
-- PER-USER PRIORS
-- This is the house prior, one row set, world-readable. If priorities ever become
-- per-user, they move to observation rows with the canonical DNA tuple
-- (source, method, observed_at, trust) rather than growing a column per user.
--
-- LIVE VERIFICATION (probed 2026-07-27 before writing)
--   - market_segments: 4 rows, all manager_type='ai', status='active'
--   - CHECK market_segments_manager_type_check = ANY(ARRAY['ai','human'])
--     -> owner-declared rows use 'human'; no new vocabulary minted
--   - CHECK market_segments_status_check = ANY(ARRAY['active','draft','archived'])
--   - UNIQUE (slug) exists -> ON CONFLICT (slug) is safe and idempotent
--   - RLS enabled, one policy: segments_public_read, SELECT to public
--     WHERE status='active'. These rows are market taxonomy, not private data,
--     so public read is the intended posture and is inherited unchanged.
--   - No new writer: nothing writes market_segments on a schedule today.

alter table public.market_segments
  add column if not exists priority integer;

alter table public.market_segments
  drop constraint if exists market_segments_priority_check;

alter table public.market_segments
  add constraint market_segments_priority_check
  check (priority is null or priority between 1 and 99);

comment on column public.market_segments.priority is
  'Desirability rank for ordering listings; 1 = most desirable, NULL = unranked (sorts last, stays visible). A PRIOR, never a filter. Segments carrying makes[]/model_keywords[] are more specific and outrank bare year bands.';

-- Era bands. Ordering per the owner 2026-07-27 (T1, owner-stated):
-- "i prioritize 1963-73, 1973-80, 1981-91, top desires in general. 1992-1999,
--  2000-2013, specific cars as well as pre 1963... basically theres obvious
--  amazing cars available in any year but for year based searching, its that
--  order to prioritize."
-- 1973 sits in both the first and second band as stated; it is assigned to the
-- earlier band here and the overlap is carried by 'squarebody' (1973-1987),
-- which wins on specificity for GM trucks.
insert into public.market_segments (slug, name, description, year_min, year_max, manager_type, status, priority)
values
  ('era-1963-1973', 'Muscle & Classic Era (1963-1973)',
   'Peak collector desirability. Pre-emissions muscle, first-gen pony cars, early 4x4s.',
   1963, 1973, 'human', 'active', 1),
  ('era-1974-1980', 'Malaise & Squarebody Era (1974-1980)',
   'Emissions-choked cars but the opening of the squarebody truck era; strong truck demand.',
   1974, 1980, 'human', 'active', 2),
  ('era-1981-1991', 'Late Square & Early Modern (1981-1991)',
   'Squarebody run-out, early fuel injection, rising 80s-nostalgia demand.',
   1981, 1991, 'human', 'active', 3),
  ('era-1992-1999', 'OBD-II Transition (1992-1999)',
   'Cheap entry, thinner collector premium; flips live here on condition not era.',
   1992, 1999, 'human', 'active', 4),
  ('era-2000-2013', 'Modern Used (2000-2013)',
   'Volume market. Ranked last of the bands; a deal here is about price, not desirability.',
   2000, 2013, 'human', 'active', 5),
  ('era-pre-1963', 'Pre-1963 (case-by-case)',
   'Not a band so much as a set of specific cars; judge individually, never by year alone.',
   1900, 1962, 'human', 'active', 6)
on conflict (slug) do update
  set priority    = excluded.priority,
      name        = excluded.name,
      description = excluded.description,
      year_min    = excluded.year_min,
      year_max    = excluded.year_max,
      status      = excluded.status;
