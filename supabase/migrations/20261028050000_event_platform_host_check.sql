-- Platform vs cited URL host (2026-10-24).
-- WHY: 38 Barrett-Jackson-labelled events with active price conflicts link to bringatrailer.com or mecum.com. Two writers:
--   orphan-backfill-v1 (February, out of band, not in this repo; 23 rows) and an unattributed 2026-10-17 bulk insert
--   (225 auction_listing rows in one transaction, no extraction_method and no write_receipts row; 15 rows). Both took the
--   platform from vehicles.discovery_source (where the vehicle was first seen) and the URL from vehicles.listing_url
--   (where it was last listed). Corpus-wide the same pattern shows as e.g. mecum/bringatrailer.com 267, bat/barrett-jackson.com 218.
-- FIX: the cited URL host is the evidence for the platform. A check function compares them, a trigger flags (never
--   rewrites) a mismatch on every insert or platform/url update, whatever the writer, and a batch flags existing rows.
-- Revert (no hard delete):
--   drop trigger if exists vehicle_events_platform_host_flag on vehicle_events;
--   select revert_platform_host_flag_v1(run_id) for each run; select revert_lot_category_v1(run_id) for each run;
--   drop the functions below; table platform_url_host and backups stay as records.

create table if not exists public.platform_url_host (
  platform_key text not null,      -- lower(source_platform) with non-alphanumerics removed
  host text not null,              -- registrable host; subdomains match
  note text,
  primary key (platform_key, host)
);
insert into public.platform_url_host (platform_key, host, note) values
 ('bat','bringatrailer.com','Bring a Trailer'),('bringatrailer','bringatrailer.com','Bring a Trailer'),
 ('mecum','mecum.com',null),('carsandbids','carsandbids.com',null),
 ('barrettjackson','barrett-jackson.com',null),('bonhams','bonhams.com','incl. cars.bonhams.com'),
 ('gooding','goodingco.com',null),('broadarrow','broadarrowauctions.com',null),('rmsothebys','rmsothebys.com',null),
 ('pcarmarket','pcarmarket.com',null),('collectingcars','collectingcars.com',null),('barnfinds','barnfinds.com',null),
 ('ebaymotors','ebay.com',null),('ebay','ebay.com',null),('facebookmarketplace','facebook.com',null),
 ('craigslist','craigslist.org','city subdomains'),('ksl','ksl.com',null),('gaaclassiccars','gaaclassiccars.com',null),
 ('historics','historics.co.uk',null),('sbxcars','sbxcars.com',null),('sbx','sbxcars.com',null),
 ('classiccars','classiccars.com',null),('hemmings','hemmings.com',null),('hagerty','hagerty.com',null)
on conflict do nothing;
revoke all on public.platform_url_host from anon, authenticated;

-- 'match' | 'mismatch' | 'unmapped_platform' | 'no_url'
create or replace function public.event_platform_host_check(p_platform text, p_url text)
returns text language sql stable set search_path to 'public' as $$
  with k as (select regexp_replace(lower(coalesce(p_platform,'')), '[^a-z0-9]', '', 'g') key,
                    lower(substring(p_url from '^[a-zA-Z]+://(?:[^@/]*@)?(?:www\.)?([^/:?#]+)')) h)
  select case
    when k.h is null then 'no_url'
    when not exists (select 1 from platform_url_host m where m.platform_key = k.key) then 'unmapped_platform'
    when exists (select 1 from platform_url_host m where m.platform_key = k.key and (k.h = m.host or k.h like '%.' || m.host)) then 'match'
    else 'mismatch' end
  from k
$$;

create or replace function public.vehicle_events_platform_host_flag_tg()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_host text;
begin
  if public.event_platform_host_check(NEW.source_platform, NEW.source_url) = 'mismatch'
     and not ('source_platform' = any(coalesce(NEW.source_suspect, '{}'))) then
    v_host := lower(substring(NEW.source_url from '^[a-zA-Z]+://(?:www\.)?([^/:?#]+)'));
    NEW.source_suspect := coalesce(NEW.source_suspect, '{}') || array['source_platform'];
    NEW.source_suspect_reason := coalesce(NEW.source_suspect_reason || '; ', '') ||
      format('platform_host_check_v1: platform %s but cited url host %s', NEW.source_platform, v_host);
    NEW.source_suspect_run_id := coalesce(NEW.source_suspect_run_id, 'platform_host_check_v1_trigger');
    NEW.source_suspect_at := coalesce(NEW.source_suspect_at, now());
  end if;
  return NEW;
end $$;
drop trigger if exists vehicle_events_platform_host_flag on public.vehicle_events;
create trigger vehicle_events_platform_host_flag before insert or update of source_platform, source_url
  on public.vehicle_events for each row execute function public.vehicle_events_platform_host_flag_tg();

create table if not exists public.bak_event_flags_v1 (
  run_id text not null, id uuid not null, source_suspect text[], source_suspect_reason text, source_suspect_run_id text,
  source_suspect_at timestamptz, lot_category text, lot_category_source text, backed_up_at timestamptz default now(),
  primary key (run_id, id));
revoke all on public.bak_event_flags_v1 from anon, authenticated;

-- Flags existing mismatches, at most p_limit rows a call; returns rows flagged.
create or replace function public.flag_platform_host_mismatch_v1(p_run_id text, p_limit int default 5000)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  create temp table if not exists _phm (id uuid primary key);
  truncate _phm;
  insert into _phm select e.id from vehicle_events e
   where e.source_url ~* '^https?://' and not ('source_platform' = any(coalesce(e.source_suspect, '{}')))
     and regexp_replace(lower(coalesce(e.source_platform,'')), '[^a-z0-9]', '', 'g') in (select platform_key from platform_url_host)
     and event_platform_host_check(e.source_platform, e.source_url) = 'mismatch'
   limit p_limit;
  insert into bak_event_flags_v1 (run_id, id, source_suspect, source_suspect_reason, source_suspect_run_id, source_suspect_at, lot_category, lot_category_source)
  select p_run_id, e.id, e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.lot_category, e.lot_category_source
    from vehicle_events e join _phm using (id) on conflict do nothing;
  update vehicle_events e set source_suspect = coalesce(e.source_suspect, '{}') || array['source_platform'],
         source_suspect_reason = coalesce(e.source_suspect_reason || '; ', '') ||
           format('platform_host_check_v1: platform %s but cited url host %s', e.source_platform, lower(substring(e.source_url from '^[a-zA-Z]+://(?:www\.)?([^/:?#]+)'))),
         source_suspect_run_id = coalesce(e.source_suspect_run_id, p_run_id), source_suspect_at = coalesce(e.source_suspect_at, now())
    from _phm where e.id = _phm.id;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.revert_platform_host_flag_v1(p_run_id text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update vehicle_events e set source_suspect = b.source_suspect, source_suspect_reason = b.source_suspect_reason,
         source_suspect_run_id = b.source_suspect_run_id, source_suspect_at = b.source_suspect_at
    from bak_event_flags_v1 b where b.run_id = p_run_id and b.id = e.id;
  get diagnostics n = row_count; return n;
end $$;

-- Gooding non-car lots: fills lot_category only where it is null, citing the lot page read.
-- p_rows: [{eid, u, title, checked}]; rule gooding_lot_category_v1: page has no "Chassis" specification and price < 50,000.
create or replace function public.set_lot_category_from_page_v1(p_run_id text, p_category text, p_rule text, p_rows jsonb)
returns table(event_id uuid, outcome text) language plpgsql security definer set search_path to 'public' as $$
declare r record; v_lc text;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(eid uuid, u text, title text, checked date) loop
    event_id := r.eid;
    select e.lot_category into v_lc from vehicle_events e where e.id = r.eid;
    if not found then outcome := 'not_found'; return next; continue; end if;
    if v_lc is not null then outcome := case when v_lc = p_category then 'already_set' else 'cited_value_kept_' || v_lc end; return next; continue; end if;
    insert into bak_event_flags_v1 (run_id, id, source_suspect, source_suspect_reason, source_suspect_run_id, source_suspect_at, lot_category, lot_category_source)
    select p_run_id, e.id, e.source_suspect, e.source_suspect_reason, e.source_suspect_run_id, e.source_suspect_at, e.lot_category, e.lot_category_source
      from vehicle_events e where e.id = r.eid on conflict do nothing;
    update vehicle_events set lot_category = p_category,
           lot_category_source = format('%s %s: lot page "%s" read %s (%s)', p_rule, p_run_id, r.title, r.checked, r.u)
     where id = r.eid;
    insert into price_basis_backfill_queue_v3 (tbl, id, run_id) values ('vehicle_events', r.eid, p_run_id) on conflict do nothing;
    outcome := 'set'; return next;
  end loop;
end $$;

create or replace function public.revert_lot_category_v1(p_run_id text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update vehicle_events e set lot_category = b.lot_category, lot_category_source = b.lot_category_source
    from bak_event_flags_v1 b where b.run_id = p_run_id and b.id = e.id;
  get diagnostics n = row_count; return n;
end $$;

revoke execute on function public.flag_platform_host_mismatch_v1(text,int), public.revert_platform_host_flag_v1(text),
  public.set_lot_category_from_page_v1(text,text,text,jsonb), public.revert_lot_category_v1(text) from public, anon, authenticated;
