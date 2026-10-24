-- run id 7e1d0c24-2026-4a10-9e00-0000000a5013 ; rule bonhams_page_basis_v1_ae_link
insert into price_basis_observation (tbl, event_id, kind, observed_basis, observed_hammer, observed_gross, currency, stored_price, evidence, source_url, observed_on, rule, run_id)
select 'auction_events', b.id, 'observed_page', o.observed_basis, o.observed_hammer, o.observed_gross, o.currency, b.winning_bid,
  'linked from price_basis_observation:'||o.id||' (vehicle_events '||o.event_id||') by bonhams auction/lot key '||b.k||'; ae.winning_bid equals observed '||case when b.winning_bid=o.observed_gross then 'gross' else 'hammer' end,
  o.source_url, o.observed_on, 'bonhams_page_basis_v1_ae_link', '7e1d0c24-2026-4a10-9e00-0000000a5013'
from (select id, winning_bid, currency_code, substring(source_url from 'auction/(\d+/lot/\d+)') k from auction_events where source='bonhams' and winning_bid>0 and currency_code is not null) b
join (select distinct on (k) * from (select *, substring(source_url from 'auction/(\d+/lot/\d+)') k from price_basis_observation where tbl='vehicle_events' and kind='observed_page' and superseded_at is null and rule='bonhams_page_basis_v1') x order by k, id desc) o
  on o.k=b.k and o.currency=b.currency_code and b.winning_bid in (o.observed_hammer, o.observed_gross)
where not exists (select 1 from price_basis_observation p where p.tbl='auction_events' and p.event_id=b.id and p.superseded_at is null and p.kind='observed_page');
