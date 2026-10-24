-- cited buyer fee per McCormick auction (Auction-N page text "N% buy fee"); 48,62,76,80 have no cited fee -> held
set statement_timeout='55s';
alter table public.mccormick_results_stage_v1_20261024 add column if not exists buyer_fee_pct numeric, add column if not exists price_net_usd numeric, add column if not exists fee_source_url text;
update public.mccormick_results_stage_v1_20261024 s set buyer_fee_pct=f.p, fee_source_url='https://www.classic-carauction.com/Auction-'||s.auction_nbr,
  price_net_usd=case when s.status='sold' then round(s.price_usd/(1+f.p/100.0)) else s.price_usd end
from (values (47,5),(49,5),(50,5),(51,5),(52,5),(53,5),(54,5),(55,5),(56,5),(57,5),(58,5),(59,5),(60,5),(61,5),(63,5),(64,5),(65,5),(66,5),(67,6),(68,6),(69,6),(70,6),(71,6),(72,6),(73,6),(74,6),(75,6),(77,6),(78,6),(79,6)) f(n,p) where f.n=s.auction_nbr;
