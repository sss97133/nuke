-- Cited model-word alias table for the house-lot matcher (run agg_houselot_v1_20261024 inputs). Additive; rows are never deleted.
-- An alias says: in a conceptcarz title for MAKE and model years [year_lo,year_hi], the word cc_word names the same car as house_word.
-- Used only to decide whether a cc title word is present in a house lot title; uniqueness rules are unchanged.
create table if not exists public.agg_houselot_model_alias_v1 (
  id serial primary key, make text not null, cc_word text not null, house_word text not null,
  year_lo int not null, year_hi int not null, first_word_ok boolean not null default false,
  citation_url text not null, citation_quote text not null, added_at timestamptz not null default now(),
  unique (make, cc_word, house_word, year_lo, year_hi));
alter table public.agg_houselot_model_alias_v1 enable row level security;
insert into public.agg_houselot_model_alias_v1 (make, cc_word, house_word, year_lo, year_hi, first_word_ok, citation_url, citation_quote) values
 ('chevrolet','stingray','corvette',1963,1967,false,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C2)','second-generation Corvette (1963-1967) "Sting Ray"'),
 ('chevrolet','sting','corvette',1963,1967,false,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C2)','second-generation Corvette (1963-1967) "Sting Ray"'),
 ('chevrolet','ray','corvette',1963,1967,false,'https://en.wikipedia.org/wiki/Chevrolet_Corvette_(C2)','second-generation Corvette (1963-1967) "Sting Ray"'),
 ('ford','sportsroof','fastback',1969,1973,false,'https://en.wikipedia.org/wiki/Ford_Mustang_(first_generation)','fastback body version was named SportsRoof'),
 ('plymouth','cuda','barracuda',1969,1974,true,'https://en.wikipedia.org/wiki/Plymouth_Barracuda','the sport model ''Cuda (BS) of the Barracuda line'),
 ('buick','grand','regal',1982,1987,true,'https://en.wikipedia.org/wiki/Buick_Regal','Regal Grand National, named for the NASCAR Winston Cup Grand National Series')
on conflict do nothing;
select count(*) n from public.agg_houselot_model_alias_v1;
