-- v16 event dump: every dated auction event with its own listing mileage (if any), keyed by auction_event_id.
-- Output: vehicle_id|auction_event_id|end_day|price|mileage|tmu. end_day = auction_events.auction_end_date (UTC day;
-- 2026-10-24 receipt-derived days are cited in auction_event_end_date_provenance). price = coalesce(hammer_price, winning_bid).
-- Never uses vehicles.sale_date or backfill-sale-results observation dates. Suspect-mileage vehicles get empty mileage.
set statement_timeout = '170s';
select string_agg(e.vehicle_id||'|'||e.id||'|'||to_char(e.auction_end_date at time zone 'UTC','YYYY-MM-DD')||'|'||
  coalesce(coalesce(e.hammer_price,e.winning_bid)::text,'')||'|'||coalesce(case when s.vehicle_id is null then m.mileage_at_listing::text end,'')||'|'||
  case when m.mileage_tmu and s.vehicle_id is null then 't' else 'f' end, E'\n') s
from public.auction_events e
left join public.auction_event_listing_mileage_usable m on m.auction_event_id = e.id
left join lateral (select x.vehicle_id from public.mileage_value_status x
  where x.vehicle_id = e.vehicle_id and x.status = 'suspect' and x.superseded_at is null limit 1) s on true
where e.auction_end_date is not null and e.vehicle_id between 'LO'::uuid and 'HI'::uuid;
