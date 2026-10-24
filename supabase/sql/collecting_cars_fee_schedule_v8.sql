-- Collecting Cars first-class hammer (run 7e1d0c24-2026-4a10-9e00-0000000a5017)
insert into platform_fee_schedule (platform, role, fee_kind, rate, min_amount, cap_amount, currency, published_price_basis, valid_from, valid_to, source_url, notes, tier_floor, lot_class, cited_on, history_verified, sale_type)
select 'collecting_cars','buyer','percent',0.06,mn,cp,cur,'hammer',null,null,'https://collectingcars.com/faqs',
  'Buyer''s Premium 6% ex-tax ("Car & Bike buyers not in the UK or Australia"), car min/max per auction currency; "The entirety of the winning bid will be paid to the seller" so the published sold price is hammer. UK buyers pay 7.2% inc VAT, AU 6.6% inc GST (not modelled). Current schedule, history not verified. run 7e1d0c24-2026-4a10-9e00-0000000a5017',
  0,'car','2026-10-23'::date,false,'any'
from (values ('GBP',1000,6000),('EUR',1000,7000),('USD',1000,10000),('CAD',1500,10000),('AUD',2000,11000),('HKD',10000,60000),('CHF',1000,7000)) v(cur,mn,cp)
where not exists (select 1 from platform_fee_schedule f where f.platform='collecting_cars' and f.role='buyer' and f.currency=v.cur and f.lot_class='car');
insert into price_basis_backfill_queue_v3 (tbl,id,run_id)
select 'vehicle_events', id, '7e1d0c24-2026-4a10-9e00-0000000a5017' from vehicle_events
where price_basis_run_id='price_basis_v3_cc_sale_truth_v1_20261023' and event_status='sold' on conflict do nothing;
select backfill_price_basis_batch_v3('vehicle_events','7e1d0c24-2026-4a10-9e00-0000000a5017',2000);
