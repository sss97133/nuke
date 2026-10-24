-- run agg_misattach_v1_20261024: conceptcarz events attached to the wrong vehicle (model/chassis differ from the
-- vehicle and from the Barrett-Jackson lot page, which carries the vehicle's VIN). Flag vehicle_id as suspect;
-- undo the dup_agg_v1 duplicate role on the 6 that were wrongly called duplicates. The Maserati (same VIN) is a
-- real restatement with a wrong price: BJ page shows $29,700 (gross). No prices moved, nothing deleted.
create temp table _m(aid uuid, grp text, note text) on commit drop;
insert into _m values
('85b8ff91-ccb8-40de-a16f-8b8f79882822','A','conceptcarz 1963 Corvair 95 Rampside vs BJ reno-2014 1963 C-10 custom pickup'),
('0f5a2d1d-221e-456f-aa28-1a0859186a75','A','conceptcarz 1958 Impala chassis F58N160753 vs BJ scottsdale-2011 1958 Corvette roadster'),
('5b796487-0b84-4e0b-a640-15aa7afffa30','A','conceptcarz 1952 Styleline Deluxe vs BJ orange-county-2012 1952 Chevrolet 3100 pickup'),
('75460879-9cda-4791-af30-034317f12923','A','conceptcarz 1969 Chevelle SS vs BJ palm-beach-2009 1969 Camaro RS/SS'),
('6536079c-e7aa-4800-b9e5-ab8d467207f7','A','conceptcarz 1941 Ford Super Deluxe Coupe vs BJ northeast-2017 1941 Ford custom firetruck'),
('1a26d719-d1c6-4bd2-8d24-a87da32ea277','A','conceptcarz 1951 Mercury Monterey Coupe vs BJ scottsdale-2014 1951 Mercury convertible'),
('d81b9612-4d89-4a8f-ba9f-813906e8ee62','B','conceptcarz 1958 Impala chassis F58J118998 $77,000 vs vehicle VIN J58S102565 (BJ lot 1029 $114,400)'),
('e1ce65be-0dc0-4a3d-a14b-7b98bc718736','B','conceptcarz Continental GT chassis SCBCR73W07C043423 $59,400 vs vehicle VIN SCBDR33W87C047068 (BJ lot 484.1 $52,800)'),
('87035f98-7920-4d6b-bc5d-abf81cae2d2e','B','conceptcarz 1956 Buick Special Century $72,600 vs BJ lot 693.1 Special Riviera VIN 4C2048154 $22,550'),
('84aeb90c-a47f-4042-a674-0cfe788eabb1','B','conceptcarz 1962 Bel Air Bubble Top $60,500 vs BJ lot 1062.1 Corvette VIN 20867S103585 $95,700'),
('742d1b4c-1f7d-4cdc-8fa7-7d5c18733752','C','same VIN ZAMFE39A970032265; conceptcarz $31,900 vs BJ lot 348 $29,700 (gross) -> duplicate with wrong price');
create table if not exists public.backup_agg_misattach_v1_20261024 as select * from public.vehicle_events where id in (select aid from _m);
update public.vehicle_events e set
  sale_truth_role = case when m.grp='A' then b0.sale_truth_role when m.grp='C' then 'duplicate' else e.sale_truth_role end,
  duplicate_of_event_id = case when m.grp='A' then b0.duplicate_of_event_id when m.grp='C' then '0c79638f-2751-4463-8594-417c696a2231'::uuid else e.duplicate_of_event_id end,
  source_suspect = case when m.grp='C' then array['final_price','sold_at'] else array['vehicle_id'] end,
  source_suspect_reason = 'misattached aggregator event: '||m.note,
  source_suspect_run_id = 'agg_misattach_v1_20261024', source_suspect_at = now()
from _m m left join public.backup_dup_agg_v1_20261024 b0 on b0.id = m.aid
where e.id = m.aid;
