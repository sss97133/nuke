-- get_high_bid_signals as plpgsql: the SQL-language version got a generic plan that timed out at 10s.
create or replace function public.get_high_bid_signals(p_make text, p_model text default null, p_year int default null,
                                                       p_year_range int default 5, p_limit int default 20)
returns table(event_id uuid, vehicle_id uuid, yr int, mk text, mdl text, high_bid numeric, ended_at timestamptz,
              platform text, listing_url text, outcome text, signal_label text)
language plpgsql stable security definer set statement_timeout to '10s' as $$
declare r int := least(greatest(coalesce(p_year_range,5),0),50);
begin
  return query
  with h as materialized (
    select e.id, e.vehicle_id, e.high_bid, coalesce(e.ended_at, e.sold_at) as ended_at, e.source_platform,
           e.source_url, e.sale_outcome
      from public.vehicle_events e
     where e.high_bid is not null and e.sale_outcome in ('bid_to','no_sale','withdrawn'))
  select h.id, v.id, v.year, v.make, v.model, h.high_bid, h.ended_at, h.source_platform, h.source_url,
         h.sale_outcome::text, 'high_bid_not_sale'::text
    from h join public.vehicles v on v.id = h.vehicle_id
   where lower(v.make) = lower(p_make) and v.deleted_at is null
     and v.id <> all (array(select q.row_id from public.record_quarantine q where q.tbl = 'vehicles' and q.released_at is null))
     and (p_model is null or lower(v.model) like '%'||lower(p_model)||'%')
     and (p_year is null or v.year between p_year - r and p_year + r)
   order by h.ended_at desc nulls last
   limit least(greatest(coalesce(p_limit,20),1),200);
end $$;
