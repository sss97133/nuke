-- Let a model have several generation cohorts, and register the K5 Blazer generations.
-- make_model_profiles was unique on (make, model, year, grain) NULLS NOT DISTINCT. Generation and model
-- cohorts have year NULL, so a model could hold only ONE generation cohort (K5 Blazer sat in a single
-- 1973-1991 slot). The key now includes the year window, so 1969-72, 1973-75, 1976-80 and 1981-91 can coexist.
-- Evidence for the K5 boundaries, sold-price medians by model year from vehicle_valuation_feed (2026-10-03):
--   1969-72 $65K-$116K (n=302); 1973 $38.6K, 1974 $46.3K, 1975 $51.4K (n=31 together);
--   1976 $32.6K, 1977 $26.0K, 1978 $28.3K, 1979 $26.3K (n=11-14 each); 1980 n=2; 1981-91 $24K-$35K.
-- Owner testimony 2026-10-03: 1976-80 are more comparable to each other than to 1973-75 because of the
-- roof structure. The roof detail itself is not yet recorded as a fact.
-- Callers (web CohortTerminal, iOS CohortTerminalView, universal-search) pass the first six arguments
-- by name; the two new arguments are optional, so they keep working.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.make_model_profiles add column if not exists cohort_label text;
alter table public.make_model_profiles add column if not exists basis text;
comment on column public.make_model_profiles.cohort_label is 'Human label for the cohort window, e.g. 1976-80. Null for year-grain profiles.';
comment on column public.make_model_profiles.basis is 'Why the cohort boundaries are where they are: the measurement and who asserted it, with date. Null when the window is just the canonical model range.';

alter table public.make_model_profiles drop constraint make_model_profiles_make_model_year_grain_key;
alter table public.make_model_profiles add constraint make_model_profiles_cohort_key
  unique nulls not distinct (canonical_make, canonical_model, year, grain, year_start, year_end);

drop function public.register_make_model_subject(text, text, integer, text, integer, integer);
create function public.register_make_model_subject(
  p_make text, p_model text, p_year integer default null, p_grain text default 'year',
  p_year_start integer default null, p_year_end integer default null,
  p_label text default null, p_basis text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_cm public.canonical_models%rowtype;
  v_ys integer;
  v_ye integer;
  v_swap integer;
  v_max_year integer := extract(year from now())::int + 1;
begin
  if p_make is null or length(trim(p_make)) < 1 or p_model is null or length(trim(p_model)) < 1 then
    return null;
  end if;
  if p_grain not in ('year','generation','model') then return null; end if;
  if p_grain = 'year' and (p_year is null or p_year < 1885 or p_year > v_max_year) then return null; end if;

  select * into v_cm from public.canonical_models cm
   where lower(cm.make) = lower(p_make)
     and (lower(cm.canonical_model) = lower(p_model)
          or lower(p_model) = any (select lower(a) from unnest(cm.aliases) a))
   limit 1;

  if p_grain <> 'year' then
    v_ys := coalesce(p_year_start, v_cm.year_start, 1885);
    v_ye := coalesce(p_year_end, v_cm.year_end, v_max_year);
    if v_ys > v_ye then
      v_swap := v_ys; v_ys := v_ye; v_ye := v_swap;
    end if;
    if v_ye > v_max_year then v_ye := v_max_year; end if;
    if v_ys < 1885 then v_ys := 1885; end if;
  end if;

  insert into public.make_model_profiles
    (canonical_make, canonical_model, grain, year, year_start, year_end, canonical_model_id, cohort_label, basis)
  values (
    upper(coalesce(v_cm.make, p_make)),
    coalesce(v_cm.canonical_model, p_model),
    p_grain,
    case when p_grain = 'year' then p_year end,
    case when p_grain <> 'year' then v_ys end,
    case when p_grain <> 'year' then v_ye end,
    v_cm.id, p_label, p_basis
  )
  on conflict (canonical_make, canonical_model, year, grain, year_start, year_end) do update
    set updated_at = now(),
        canonical_model_id = coalesce(excluded.canonical_model_id, public.make_model_profiles.canonical_model_id),
        cohort_label = coalesce(excluded.cohort_label, public.make_model_profiles.cohort_label),
        basis = coalesce(excluded.basis, public.make_model_profiles.basis)
  returning subject_id into v_id;
  return v_id;
end;
$function$;
grant execute on function public.register_make_model_subject(text, text, integer, text, integer, integer, text, text)
  to anon, authenticated, service_role;
comment on function public.register_make_model_subject(text, text, integer, text, integer, integer, text, text) is
  'Lazy upsert of a make_model cohort subject (year | model | generation grain). Canonicalizes via canonical_models. Non-year grains always get a non-NULL [year_start, year_end] window (explicit bounds > canonical model range > all-years fallback) so cohort_members can resolve. A model may hold several generation cohorts: the key includes the window. Optional label and basis record why the boundaries are where they are.';
commit;

-- The K5 Blazer generation cohorts (plain statements: each call upserts one profile).
select public.register_make_model_subject('CHEVROLET', 'K5 Blazer', null, 'generation', 1969, 1972, '1969-72',
  'Sold-price medians by model year 2026-10-03 (vehicle_valuation_feed): $65K-$116K, n=302, well above 1973 and later.');
select public.register_make_model_subject('CHEVROLET', 'K5 Blazer', null, 'generation', 1973, 1975, '1973-75',
  'Owner testimony 2026-10-03: 1976-80 are more comparable to each other than to 1973-75 because of the roof structure (detail not yet recorded). Sold medians $38.6K-$51.4K, n=31.');
select public.register_make_model_subject('CHEVROLET', 'K5 Blazer', null, 'generation', 1976, 1980, '1976-80',
  'Owner testimony 2026-10-03 (roof structure, detail not yet recorded). Sold medians $26.0K-$32.6K for 1976-79, n=11-14 per year; 1980 has n=2.');
select public.register_make_model_subject('CHEVROLET', 'K5 Blazer', null, 'generation', 1981, 1991, '1981-91',
  'Not yet separated from 1976-80 by evidence. Sold medians $24.2K-$35.3K.');
update public.make_model_profiles set cohort_label = '1973-91 (superset)',
  basis = 'Original single-slot generation cohort; kept as the Squarebody-era superset of the finer K5 cohorts.'
 where subject_id = 'feb225e6-3a73-425d-ba12-143680e8b9ca' and cohort_label is null;
