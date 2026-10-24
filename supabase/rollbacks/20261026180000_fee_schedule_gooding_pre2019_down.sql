delete from platform_fee_schedule where platform='gooding' and currency='USD' and valid_to='2019-01-01' and rate=0.10 and cited_on='2026-10-24';
update platform_fee_schedule set valid_from = null where id in (55,56) and valid_from='2019-01-01';
