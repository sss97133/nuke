-- Porsche 356 chassis-number ranges. Citations:
--  [K071] Porsche Classic parts catalogue 356 1950-55 / 356A 1956-59, summary of vehicle ident. nos.
--         https://files.porsche.com/f/332100/80a442c564/kat071-e-356-59-katalog.pdf
--  [K072] Porsche Classic parts catalogue 356B 1960-63 / 356C 1964-65
--         https://files.porsche.com/f/332100/dcbcda8d37/kat072-e-356-65-katalog.pdf
--  [F4E]  flat4ever.com "La gamme Porsche 356" (pre-A and T1/T2 coachbuilder ranges) https://www.flat4ever.com/la-gamme-porsche-356/
--  [EUR]  356 A T1 European Registry https://www.356european.com/en/data.html
-- Karmann coupes (356B T6 / 356C) carry chassis numbers 210001-214400 / 215001-222580; a 6-digit 21xxxx stamp on
-- a Karmann car is therefore a chassis number, not only a body plate.
INSERT INTO public.identifier_rules (make_canonical, model_prefix, kind, series, body_style, coachbuilder, model_year_from, model_year_to, pattern, range_lo, range_hi, citation) VALUES
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1950,1951,'^[0-9]{4,5}$',5001,5600,'[F4E] coupe 5002-5600 incl. Glaser cabrios 5001-5162'),
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1951,1953,'^[0-9]{5}$',10001,12387,'[F4E] 1951-53 coupe/cabrio 10001-12387'),
('PORSCHE','356','chassis','pre-A','CABRIOLET','Reutter',1952,1953,'^[0-9]{5}$',15001,15116,'[F4E] cabrio 15001-15116'),
('PORSCHE','356','chassis','pre-A','COUPE','Reutter',1953,1955,'^[0-9]{5}$',50001,55000,'[K071] coupe to 55000; [F4E] 50001-54223'),
('PORSCHE','356','chassis','pre-A','CABRIOLET','Reutter',1953,1955,'^[0-9]{5}$',60001,61000,'[K071] cabrio 60395-61000; [F4E] 60001-60923'),
('PORSCHE','356','chassis','pre-A','SPEEDSTER',NULL,1954,1955,'^[0-9]{5}$',80001,81900,'[K071] Speedster 80001-81900'),
('PORSCHE','356','chassis','356A T1','COUPE','Reutter',1956,1957,'^[0-9]{5}$',55001,59099,'[K071][EUR] coupe 55001-59090'),
('PORSCHE','356','chassis','356A','COUPE','Reutter',1957,1959,'^[0-9]{6}$',100001,108917,'[K071] coupe 100001-108917'),
('PORSCHE','356','chassis','356A T1','CABRIOLET','Reutter',1956,1957,'^[0-9]{5}$',61001,61892,'[K071][EUR] cabrio 61001-61892'),
('PORSCHE','356','chassis','356A T2','CABRIOLET','Reutter',1958,1959,'^[0-9]{6}$',150001,152475,'[K071] cabrio 150001-152475'),
('PORSCHE','356','chassis','356A','SPEEDSTER',NULL,1956,1959,'^[0-9]{5}$',81901,84954,'[K071] Speedster 81901-84922; [F4E] to 84954'),
('PORSCHE','356','chassis','356A T2','CONVERTIBLE_D','Drauz',1958,1959,'^[0-9]{5}$',85501,86830,'[K071] Convertible D 85501-86830'),
('PORSCHE','356','chassis','356B','COUPE','Reutter',1960,1963,'^[0-9]{6}$',108918,125239,'[K072] coupe 108918-125239'),
('PORSCHE','356','chassis','356B','CABRIOLET','Reutter',1960,1963,'^[0-9]{6}$',152476,158700,'[K072] cabrio 152476-158700'),
('PORSCHE','356','chassis','356B','ROADSTER','Drauz/D''Ieteren',1960,1962,'^[0-9]{5}$',86831,89849,'[K072] roadster 86831-89800; [F4E] to 89849'),
('PORSCHE','356','chassis','356B T5','HARDTOP','Karmann',1961,1962,'^[0-9]{6}$',200001,202299,'[K072] Karmann hardtop 200001-202299'),
('PORSCHE','356','chassis','356B T6','COUPE','Karmann',1962,1963,'^[0-9]{6}$',210001,214400,'[K072] Karmann coupe 210001-214400'),
('PORSCHE','356','chassis','356C','COUPE','Reutter',1964,1965,'^[0-9]{6}$',126001,131930,'[K072] coupe 126001-131927; [F4E] to 131930'),
('PORSCHE','356','chassis','356C','COUPE','Karmann',1964,1965,'^[0-9]{6}$',215001,222580,'[K072] Karmann coupe 215001-221482 (MY64), 221483- (MY65); [F4E] to 222580'),
('PORSCHE','356','chassis','356C','CABRIOLET','Reutter',1964,1966,'^[0-9]{6}$',159001,162175,'[K072] cabrio 159001-161577 (MY64), 161578- ; [F4E] to 162175'),
('PORSCHE','356','engine',NULL,NULL,NULL,1950,1965,'^[0-9]{4,6}$',NULL,NULL,'[K071][K072] engine numbers 4-6 digits (e.g. 1600C 710001-, SC 810001-)');
