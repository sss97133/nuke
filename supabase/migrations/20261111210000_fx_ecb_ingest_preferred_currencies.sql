-- ECB daily FX ingest keeps every currency a preference names for ECB, not only those it already held.
-- Before: fx_ecb_refresh_ingest() stored a cross rate only for currencies already in fx_rates with provider 'ecb'
-- (AUD, CAD, CHF, DKK, GBP, HKD + EUR). NZD was loaded from the Federal Reserve H.10 (FRED DEXUSNZ) only, whose rows
-- stop at 2026-10-16, so fx_usd_rate('NZD', today) found nothing in its 7-day window and the live board could not
-- convert New Zealand bids. The ECB file does publish NZD (eurofxref-hist-90d.xml, 2026-11-06: 1 EUR = 2.0141 NZD;
-- 65 of 65 days carry it), and fx_rate_provider_preference already names ecb as the NZD fallback (rank 2).
-- After: the ingest also keeps any currency fx_rate_provider_preference lists with provider 'ecb'. Rows are appended
-- per reference date (on conflict do nothing); nothing is overwritten.
-- Both functions existed only in the live database (cron jobs fx_ecb_refresh_request 30 16 * * 1-5 and
-- fx_ecb_refresh_ingest 45 16 * * 1-5); their definitions are committed here as found, with the one filter change.
-- The migration requests the 90-day file once so the next ingest backfills NZD for those 65 days.

set lock_timeout = '5s';
set statement_timeout = '10s';

create or replace function public.fx_ecb_refresh_request()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare v_url text := 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'; v_id bigint;
begin
  v_id := net.http_get(url := v_url, timeout_milliseconds := 30000);
  insert into fx_ecb_fetch_log(request_id, source_url) values (v_id, v_url);
  return v_id;
end $function$;

create or replace function public.fx_ecb_refresh_ingest()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare r record; x xml; ns text[] := array[array['e','http://www.ecb.int/vocabulary/2002-08-01/eurofxref']];
  v_days int; v_ins int; v_out jsonb := '[]'::jsonb; v_run text;
begin
  for r in select l.request_id, l.source_url, h.status_code, h.content from fx_ecb_fetch_log l
           left join net._http_response h on h.id = l.request_id
           where l.processed_at is null order by l.request_id loop
    if r.status_code is null then
      if (select requested_at from fx_ecb_fetch_log where request_id=r.request_id) < now() - interval '1 hour' then
        update fx_ecb_fetch_log set processed_at=now(), note='no response within 1h' where request_id=r.request_id;
      end if;
      continue;
    end if;
    if r.status_code <> 200 then
      update fx_ecb_fetch_log set processed_at=now(), http_status=r.status_code, note='http error' where request_id=r.request_id;
      continue;
    end if;
    x := r.content::xml;
    v_run := 'fx_ecb_daily_auto_' || to_char(now() at time zone 'UTC','YYYYMMDD') || '_' || r.request_id;
    with d as (
      select (xpath('/e:Cube/@time', c, ns))[1]::text::date dt, c from unnest(xpath('//e:Cube[@time]', x, ns)) c
    ), q as (
      select d.dt, (xpath('/e:Cube/@currency', k, ns))[1]::text cur, (xpath('/e:Cube/@rate', k, ns))[1]::text::numeric rate
      from d, unnest(xpath('/e:Cube/e:Cube', d.c, ns)) k
    ), u as (select dt, rate usd from q where cur='USD'),
    rws as (
      select u.dt, 'EUR' base, u.usd rate, 'ecb_direct_usd_per_eur' method,
        format('ECB euro foreign exchange reference rate %s: 1 EUR = %s USD', u.dt, u.usd) src
      from u
      union all
      select q.dt, q.cur, round(u.usd/q.rate, 9), 'ecb_cross_via_eur',
        format('ECB euro foreign exchange reference rates %s: 1 EUR = %s USD, 1 EUR = %s %s; USD per %s = %s/%s', q.dt, u.usd, q.rate, q.cur, q.cur, u.usd, q.rate)
      from q join u using (dt)
      where q.cur in (select distinct base_currency from fx_rates where provider='ecb' and base_currency<>'EUR'
                      union
                      select currency from fx_rate_provider_preference where provider='ecb' and currency not in ('EUR','USD'))
    ), ins as (
      insert into fx_rates(rate_date, base_currency, quote_currency, rate, method, source, source_url, fetched_at, run_id, provider)
      select dt, base, 'USD', rate, method, src, r.source_url, now(), v_run, 'ecb' from rws
      on conflict (base_currency, quote_currency, rate_date, provider) do nothing
      returning 1
    )
    select (select count(distinct dt) from u), (select count(*) from ins) into v_days, v_ins;
    update fx_ecb_fetch_log set processed_at=now(), http_status=200, days_seen=v_days, rows_inserted=v_ins, note=v_run where request_id=r.request_id;
    v_out := v_out || jsonb_build_object('request_id', r.request_id, 'days', v_days, 'inserted', v_ins);
  end loop;
  return v_out;
end $function$;

revoke all on function public.fx_ecb_refresh_request() from public, anon, authenticated;
revoke all on function public.fx_ecb_refresh_ingest() from public, anon, authenticated;
grant execute on function public.fx_ecb_refresh_request() to service_role;
grant execute on function public.fx_ecb_refresh_ingest() to service_role;

select public.fx_ecb_refresh_request();
