-- run dup_agg_v1_20261024: aggregator (conceptcarz) events that restate a house sale within 14 days at the same price
-- (or at the house event's gross) -> sale_truth_role=duplicate, duplicate_of_event_id=house event. No prices are moved.
create temp table _d(aid uuid, hid uuid, dd numeric, eq text) on commit drop;
insert into _d values
('de45a8d1-f8a1-4ed4-8591-a171ab999bc2'::uuid,'bfcb865a-8a4d-4496-bac0-c5fb71ec15c4'::uuid,6.25,'gross'),
('1f956107-58ce-4f9a-9e22-359923636f5a'::uuid,'61a224e6-cc1e-4db7-9cfb-7d27825b5aee'::uuid,1.0,'final'),
('85b8ff91-ccb8-40de-a16f-8b8f79882822'::uuid,'15fa4add-b8a0-49af-ae6c-e4ccdb198067'::uuid,1.0,'final'),
('4fce8279-b01a-45bf-a870-9fbcf14a77e5'::uuid,'425e85ce-f3a8-4bab-88bc-4673a957dc87'::uuid,2.0,'final'),
('0f5a2d1d-221e-456f-aa28-1a0859186a75'::uuid,'54b97e75-32a2-40d7-981c-8e6a7b365c98'::uuid,2.0,'final'),
('43ab0427-af04-4591-a5ab-95f3c27cec40'::uuid,'602760f6-da1f-4c3f-b152-adfbd539cd27'::uuid,6.0,'final'),
('5b796487-0b84-4e0b-a640-15aa7afffa30'::uuid,'3897bc9d-5316-4fc9-bea1-3824c115aa34'::uuid,7.0,'final'),
('a60b2ce6-ef51-404d-b903-d3f3ade18cad'::uuid,'5620019a-d470-4e2a-a5d2-068a2759cc1f'::uuid,7.0,'final'),
('c3189cf6-11fe-44b9-91a4-a4de0666b585'::uuid,'acd702ef-5205-4c3e-88d1-5e09a5c865a9'::uuid,7.0,'final'),
('b93950c9-faec-4571-bb00-9ff5782edd1c'::uuid,'7669065c-5d13-4566-b1fa-38f10d707de4'::uuid,7.09,'final'),
('75460879-9cda-4791-af30-034317f12923'::uuid,'59085870-2d92-4d98-91e4-781e8813f952'::uuid,8.0,'final'),
('6536079c-e7aa-4800-b9e5-ab8d467207f7'::uuid,'0f559892-438d-4d26-b108-26dfc3a2b5f0'::uuid,10.0,'final'),
('b408fb15-de73-4d40-a646-bb9603b6e959'::uuid,'88777d37-ae7f-4bfc-81bd-86d477fb55f1'::uuid,10.0,'final'),
('2c8f8a54-f538-4914-8dec-6df7360fa71d'::uuid,'a234e568-e3da-4e25-bcce-70978cd60546'::uuid,10.0,'final'),
('1a26d719-d1c6-4bd2-8d24-a87da32ea277'::uuid,'3115b2e4-5d16-48f2-87e5-73961441a83f'::uuid,11.0,'final'),
('53c5f710-8205-4542-8aab-439d9d4795a8'::uuid,'ac5f08e2-1f84-4716-bfb7-467876a609ad'::uuid,12.0,'final'),
('18d36331-55de-451c-a359-7e71b2842a51'::uuid,'bd226599-c6f0-4cf9-8e9c-2846073d8a81'::uuid,12.0,'final');
create table if not exists public.backup_dup_agg_v1_20261024 as select * from public.vehicle_events where id in (select aid from _d);
update public.vehicle_events e set sale_truth_role='duplicate', duplicate_of_event_id=d.hid,
  source_suspect = case when d.dd > 0 then array['sold_at'] else e.source_suspect end,
  source_suspect_reason = 'aggregator restatement of house sale '||d.hid||' ('||d.dd||' d apart, price = house '||d.eq||')',
  source_suspect_run_id = 'dup_agg_v1_20261024', source_suspect_at = now()
from _d d where e.id = d.aid and coalesce(e.sale_truth_role,'') <> 'duplicate';
