-- Pre-1981 identifier rules for the largest makes in the corpus (Chevrolet, Ford, Pontiac, Dodge, VW, Mercedes, then
-- the other GM / Ford / Chrysler divisions that share a format). Patterns run against the value normalized by
-- identifier_rule_for (upper case, spaces / dashes / dots / slashes removed). The model-year digit is checked against
-- vehicles.year by the extractor (scripts/identifier-backfill/pre1981), not by the pattern.
-- Sources:
--  [WB-GM]  Wikibooks, Vehicle Identification Numbers/GM/VIN Code History, en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/GM/VIN_Code_History
--  [ECK]    Eckler's, 1965-71 Passenger Car VIN Numbers, ecklers.com/65-71-vin-numbers-tech-guide.html
--  [NOVA]   NovaResource 1967 VIN decoder, novaresource.org/v67.htm
--  [OCW]    Old Cars Weekly, "It's all in the numbers: Ford's serial numbers 1950-1980", oldcarsweekly.com/features/its-all-in-the-numbers-fords-serial-numbers-1950-1980
--  [FA]     The Ford Almanac, How to decode a classic Ford VIN, thefordalmanac.com/how-to-decode-a-classic-ford-vin-1960s1970s-models-explained/
--  [440]    Mopar Enthusiast Network, 1962-1980 Dodge/Chrysler/Plymouth VIN breakdowns, 440magnum-network.com/mopar-information/vin-code-breakdowns/
--  [ZATZ]   D. Zatz, 1968-1980 Mopar VIN decoder, motales.com/cars/materials/vin-decoder.php
--  [PP]     Pacific Parts, Air-cooled reference guide v25.7 p.31 (VW chassis ranges by model year), pacificparts.net/vwbook/files/basic-html/page31.html
--  [SAMBA]  TheSamba, Beetle VIN / chassis numbers, thesamba.com/vw/archives/info/bugchassisdating.php
--  [MBM]    MB Manuals, W113 identification (14-character chassis number), mbmanuals.com/pdf/mb113-identification.pdf
--  [CD]     Classic Decoder, Mercedes-Benz pre-1981 chassis number structure, classicdecoder.com/vin-decoder/mercedes
SET statement_timeout = '60s';

INSERT INTO public.identifier_rules (make_canonical, model_prefix, kind, series, model_year_from, model_year_to, pattern, citation)
SELECT v.* FROM (VALUES
  -- GM: division digit 1 Chevrolet, 2 Pontiac, 3 Oldsmobile, 4 Buick, 6 Cadillac (US divisions from MY1965; Cadillac MY1971)
  ('CHEVROLET','','vin','GM 13-char 1965-71',1965,1971,'^1[0-9]{4}[0-9][A-Z0-9][0-9]{6}$','[WB-GM][ECK][NOVA] div 1, series 2, body 2, model-year digit (pos 6), plant, 6-digit sequence'),
  ('CHEVROLET','','vin','GM 13-char 1972-80',1972,1980,'^1[A-Z][0-9]{2}[A-Z0-9][0-9][A-Z0-9][0-9]{6}$','[WB-GM] from MY1972: div, series letter, body 2, engine, model-year digit (pos 6), plant, 6-digit sequence'),
  ('CHEVROLET','','vin','Chevrolet 12-char 1960-64',1960,1964,'^[0-9]{5}[A-Z0-9][0-9]{6}$','[WB-GM] pre-1965 US: model-year digit first (pos 1), series/body 4, plant, 6-digit sequence'),
  ('PONTIAC','','vin','GM 13-char 1965-71',1965,1971,'^2[0-9]{4}[0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 2 Pontiac; layout as Chevrolet 1965-71'),
  ('PONTIAC','','vin','GM 13-char 1972-80',1972,1980,'^2[A-Z][0-9]{2}[A-Z0-9][0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 2 Pontiac; MY1972+ layout'),
  ('OLDSMOBILE','','vin','GM 13-char 1965-71',1965,1971,'^3[0-9]{4}[0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 3 Oldsmobile'),
  ('OLDSMOBILE','','vin','GM 13-char 1972-80',1972,1980,'^3[A-Z][0-9]{2}[A-Z0-9][0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 3 Oldsmobile; MY1972+ layout'),
  ('BUICK','','vin','GM 13-char 1965-71',1965,1971,'^4[0-9]{4}[0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 4 Buick'),
  ('BUICK','','vin','GM 13-char 1972-80',1972,1980,'^4[A-Z][0-9]{2}[A-Z0-9][0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 4 Buick; MY1972+ layout'),
  ('CADILLAC','','vin','GM 13-char 1971',1971,1971,'^6[0-9]{4}[0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 6 Cadillac adopted the 5-digit model code in MY1971'),
  ('CADILLAC','','vin','GM 13-char 1972-80',1972,1980,'^6[A-Z][0-9]{2}[A-Z0-9][0-9][A-Z0-9][0-9]{6}$','[WB-GM] div 6 Cadillac; MY1972+ layout'),
  -- Ford Motor Co. 11-character, 1960-80 (Canada from 1966)
  ('FORD','','vin','Ford 11-char 1960-80',1960,1980,'^[0-9][A-Z][0-9]{2}[A-Z0-9][0-9]{6}$','[OCW][FA] model-year digit (pos 1), plant letter, body serial 2, engine code, 6-digit consecutive unit no.'),
  ('MERCURY','','vin','Ford 11-char 1960-80',1960,1980,'^[0-9][A-Z][0-9]{2}[A-Z0-9][0-9]{6}$','[OCW][FA] same 11-character Ford Motor Co. format'),
  ('LINCOLN','','vin','Ford 11-char 1960-80',1960,1980,'^[0-9][A-Z][0-9]{2}[A-Z0-9][0-9]{6}$','[OCW][FA] same 11-character Ford Motor Co. format'),
  -- Chrysler Corp. 13-character, 1966-80
  ('DODGE','','vin','Mopar 13-char 1966-80',1966,1980,'^[A-Z][A-Z][0-9]{2}[A-Z0-9][0-9][A-Z][0-9]{6}$','[440][ZATZ] car line, price class, body 2, engine, model-year digit (pos 6), plant, 6-digit sequence'),
  ('PLYMOUTH','','vin','Mopar 13-char 1966-80',1966,1980,'^[A-Z][A-Z][0-9]{2}[A-Z0-9][0-9][A-Z][0-9]{6}$','[440][ZATZ] same Chrysler Corp. format'),
  ('CHRYSLER','','vin','Mopar 13-char 1966-80',1966,1980,'^[A-Z][A-Z][0-9]{2}[A-Z0-9][0-9][A-Z][0-9]{6}$','[440][ZATZ] same Chrysler Corp. format'),
  ('IMPERIAL','','vin','Mopar 13-char 1966-80',1966,1980,'^[A-Z][A-Z][0-9]{2}[A-Z0-9][0-9][A-Z][0-9]{6}$','[440][ZATZ] same Chrysler Corp. format'),
  -- Volkswagen: from MY1965 the chassis no. starts with the 2-digit model number, 3rd digit = model year
  ('VOLKSWAGEN','','chassis','VW 9-digit 1965-69',1965,1969,'^[1-4][0-9][5-9][0-9]{6,7}$','[SAMBA][PP] model no. 2, model-year digit (pos 3), sequence; e.g. Beetle 115 000 001 (MY65) - 119 1200 000 (MY69)'),
  ('VOLKSWAGEN','','chassis','VW 10-digit 1970-79',1970,1979,'^[1-4][0-9][0-9]2[0-9]{6}$','[SAMBA][PP] model no. 2, model-year digit (pos 3), 7-digit sequence from x2 000 001; e.g. Beetle 110 2000 001 (MY70) - 118 2050 000 (MY78)')
) AS v(make_canonical, model_prefix, kind, series, model_year_from, model_year_to, pattern, citation)
WHERE NOT EXISTS (SELECT 1 FROM public.identifier_rules r WHERE r.make_canonical = v.make_canonical AND r.kind = v.kind AND r.series = v.series);

-- VW Type 1 (Beetle) year ranges, pre-1965 sequential chassis numbers [PP]
INSERT INTO public.identifier_rules (make_canonical, model_prefix, kind, series, model_year_from, model_year_to, pattern, range_lo, range_hi, citation)
SELECT 'VOLKSWAGEN','beetle','chassis','Type 1 MY'||y, y, y, '^[0-9]{6,7}$', lo, hi, '[PP] Type 1 Beetle sedan chassis range for model year '||y
FROM (VALUES (1954,575415,781883),(1955,781884,929745),(1956,929746,1394118),(1957,1394119,1600439),(1958,1600440,1774680),
             (1959,1774681,2528667),(1960,2528668,3192506),(1961,3192507,4010994),(1962,4010995,4846835),(1963,4846836,5667118),
             (1964,5677119,6502399)) r(y,lo,hi)
WHERE NOT EXISTS (SELECT 1 FROM public.identifier_rules x WHERE x.make_canonical='VOLKSWAGEN' AND x.series='Type 1 MY'||y);

-- Mercedes-Benz pre-FIN chassis number (Fahrgestellnummer): 6-digit Baumuster, 2 config digits, 5-6 digit serial
INSERT INTO public.identifier_rules (make_canonical, model_prefix, kind, series, model_year_from, model_year_to, pattern, citation)
SELECT 'MERCEDES-BENZ','','chassis','Fahrgestellnummer 14-digit',1960,1980,'^1[0-2][0-9]{4}[0-9]{2}[0-9]{6}$',
       '[MBM][CD] e.g. 113.044-10-012345: Baumuster 6 (113.044 = 280 SL), steering 1/2, transmission 0/2, 6-digit serial'
WHERE NOT EXISTS (SELECT 1 FROM public.identifier_rules WHERE make_canonical='MERCEDES-BENZ' AND series='Fahrgestellnummer 14-digit')
UNION ALL
SELECT 'MERCEDES-BENZ','','chassis','Fahrgestellnummer 13-digit',1950,1963,'^1[0-9]{5}[0-9]{2}[0-9]{5}$',
       '[CD] pre-1981 chassis numbers vary by series and plant; earlier series carry a shorter serial after the Baumuster and config digits (lower confidence)'
WHERE NOT EXISTS (SELECT 1 FROM public.identifier_rules WHERE make_canonical='MERCEDES-BENZ' AND series='Fahrgestellnummer 13-digit');
