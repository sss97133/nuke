-- Gooding & Company US buyer's premium before 2019-01-01 was a flat 10%.
-- Sources: 2012 Pebble Beach notice "All lots include a 10% buyer's premium"
--   https://www.supercars.net/blog/2012-pebble-beach-auctions-by-gooding-company/
-- 2019 notice: "Beginning January 1, 2019 ... 12% ... 10% on the remainder"
--   https://motorsportsnewswire.com/2019/07/22/gooding-company-2019-pebble-beach-auctions-2/
-- Data check: pre-2019 Gooding gross prices fit 10% (round hammer) far more than 12%/10% tiered.
update platform_fee_schedule set valid_from = '2019-01-01'
 where id in (55,56) and platform='gooding' and valid_from is null;
insert into platform_fee_schedule
 (platform, role, fee_kind, rate, currency, published_price_basis, valid_from, valid_to,
  source_url, notes, tier_floor, lot_class, cited_on, history_verified, sale_type)
select 'gooding','buyer','percent',0.10,'USD','gross_incl_premium',null,'2019-01-01',
  'https://www.supercars.net/blog/2012-pebble-beach-auctions-by-gooding-company/',
  'US live auctions before 2019-01-01: flat 10% (2012 notice); 12%/10% tier began 2019-01-01 per https://motorsportsnewswire.com/2019/07/22/gooding-company-2019-pebble-beach-auctions-2/',
  0,'any','2026-10-24',false,'any'
where not exists (select 1 from platform_fee_schedule where platform='gooding' and currency='USD' and valid_to='2019-01-01' and rate=0.10);
