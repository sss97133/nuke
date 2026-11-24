-- Data-set decoders (20261123190000)
--  1. VIN decoders for 1970-71 (series digits, no engine), 1972-80 (now incl. year A = 1980; year 0 is not a 1972-80 year)
--     and 1981 17-character Pontiac Firebird VINs feed the existing vin_cohort / vin_series / vin_engine / plant_year sets.
--     Every VIN position meaning is a cited vehicle_decode_rules row (1973 rows already cite DeMauro 1994 and are untouched).
--  2. vehicle_code_readings: block casting, engine code, transmission case / tail casting, paint code, Fisher style number
--     and cowl option codes read from landed listing text (vehicles text columns) and non-bid auction comments. Each row cites
--     its origin row and column with a confidence; nothing is read from photos here and nothing is guessed. Unknown stays absent.
--     Written by the run-stamped producer text_code_decode_v1; text_code_decode_revert_v1 backs rows up, then deletes a run.
--  3. data_set_candidates_v1 turns active readings into memberships (basis_type code_reading) keyed exactly like the photo
--     decode observations, so a text-read 9799914 block and a photo-read 9799914 block land in the same set.
-- Revert: supabase/sql/revert_20261123190000_data_set_decoders.sql (revert membership runs, then reading runs, first).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '300s';

INSERT INTO public.vehicle_decode_rules (rule_key, make, model, code, year_min, year_max, qualifiers, value, citation_url,
  citation_title, citation_locator, cited_on)
SELECT n.* FROM (VALUES
  ('vin_series_char','Pontiac','Firebird','23',1970,1971,'{}'::jsonb,'{"series": "Firebird (base)"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1970-71 VIN section, 2nd-3rd digits (series 2 + model digit)','2026-11-23'::date),
  ('vin_series_char','Pontiac','Firebird','24',1970,1971,'{}'::jsonb,'{"series": "Esprit"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1970-71 VIN section, 2nd-3rd digits (series 2 + model digit)','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','26',1970,1971,'{}'::jsonb,'{"series": "Formula"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1970-71 VIN section, 2nd-3rd digits (series 2 + model digit)','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','28',1970,1971,'{}'::jsonb,'{"series": "Trans Am"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1970-71 VIN section, 2nd-3rd digits (series 2 + model digit)','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','S',1972,1972,'{}'::jsonb,'{"series": "Firebird (base)"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','S',1974,1980,'{}'::jsonb,'{"series": "Firebird (base)"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','T',1972,1972,'{}'::jsonb,'{"series": "Esprit"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','T',1974,1980,'{}'::jsonb,'{"series": "Esprit"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','U',1972,1972,'{}'::jsonb,'{"series": "Formula"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','U',1974,1980,'{}'::jsonb,'{"series": "Formula"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','V',1972,1972,'{}'::jsonb,'{"series": "Trans Am"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','V',1974,1974,'{}'::jsonb,'{"series": "Trans Am"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','W',1975,1980,'{"conflict": "some decoders start W in 1976 (joltparts.com/pages/pontiac-vin-decoder notes the disagreement)"}'::jsonb,'{"series": "Trans Am"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','X',1979,1979,'{}'::jsonb,'{"series": "Trans Am 10th Anniversary"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','X',1980,1980,'{}'::jsonb,'{"series": "Trans Am Turbo Indy Pace Car"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 2nd digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','S',1981,1981,'{}'::jsonb,'{"series": "Firebird (base)"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','T',1981,1981,'{}'::jsonb,'{"series": "Esprit"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','V',1981,1981,'{}'::jsonb,'{"series": "Formula"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','W',1981,1981,'{}'::jsonb,'{"series": "Trans Am"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','X',1981,1981,'{}'::jsonb,'{"series": "Trans Am Special Edition"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_series_char','Pontiac','Firebird','Y',1981,1981,'{}'::jsonb,'{"series": "NASCAR Turbo Trans Am Pace Car"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 5th digit','2026-11-23'),
  ('vin_body_code','Pontiac','Firebird','87',1970,1972,'{}'::jsonb,'{"body": "sport coupe"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','body type digits (87 = Sport Coupe, all 1970-81)','2026-11-23'),
  ('vin_body_code','Pontiac','Firebird','87',1974,1980,'{}'::jsonb,'{"body": "sport coupe"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','body type digits (87 = Sport Coupe, all 1970-81)','2026-11-23'),
  ('vin_body_code','Pontiac','Firebird','87',1981,1981,'{}'::jsonb,'{"body": "sport coupe"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 6th-7th digits','2026-11-23'),
  ('vin_plant_char','Pontiac','Firebird','N',1970,1972,'{}'::jsonb,'{"plant": "Norwood, Ohio"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','assembly plant digit','2026-11-23'),
  ('vin_plant_char','Pontiac','Firebird','N',1974,1981,'{}'::jsonb,'{"plant": "Norwood, Ohio"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','assembly plant digit','2026-11-23'),
  ('vin_plant_char','Pontiac','Firebird','L',1970,1972,'{}'::jsonb,'{"plant": "Van Nuys, California"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','assembly plant digit','2026-11-23'),
  ('vin_plant_char','Pontiac','Firebird','L',1974,1981,'{}'::jsonb,'{"plant": "Van Nuys, California"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','assembly plant digit','2026-11-23'),
  ('vin_plant_char','Pontiac','Firebird','L',1973,1973,'{}'::jsonb,'{"plant": "Van Nuys, California"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 7th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','A',1978,1980,'{}'::jsonb,'{"displacement_ci": 231, "cylinders": 6, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','C',1977,1977,'{}'::jsonb,'{"displacement_ci": 231, "cylinders": 6, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','D',1972,1972,'{}'::jsonb,'{"displacement_ci": 250, "cylinders": 6, "carb": "1bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','D',1974,1976,'{}'::jsonb,'{"displacement_ci": 250, "cylinders": 6, "carb": "1bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','G',1979,1979,'{}'::jsonb,'{"displacement_ci": 305, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','H',1975,1975,'{}'::jsonb,'{"displacement_ci": 305, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','H',1980,1980,'{}'::jsonb,'{"displacement_ci": 305, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','J',1976,1976,'{}'::jsonb,'{"displacement_ci": 350, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','K',1977,1979,'{}'::jsonb,'{"displacement_ci": 403, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','L',1978,1978,'{}'::jsonb,'{"displacement_ci": 350, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','M',1972,1972,'{}'::jsonb,'{"displacement_ci": 350, "carb": "2bbl", "exhaust": "single"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','M',1974,1976,'{}'::jsonb,'{"displacement_ci": 350, "carb": "2bbl", "exhaust": "single"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','N',1972,1972,'{}'::jsonb,'{"displacement_ci": 350, "carb": "2bbl", "exhaust": "dual"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','N',1974,1974,'{}'::jsonb,'{"displacement_ci": 350, "carb": "2bbl", "exhaust": "dual"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','R',1972,1972,'{}'::jsonb,'{"displacement_ci": 400, "carb": "2bbl", "exhaust": "single"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','R',1974,1974,'{}'::jsonb,'{"displacement_ci": 400, "carb": "2bbl", "exhaust": "single"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','P',1974,1974,'{}'::jsonb,'{"displacement_ci": 400, "carb": "2bbl", "exhaust": "dual"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','P',1977,1977,'{}'::jsonb,'{"displacement_ci": 350, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','R',1977,1977,'{}'::jsonb,'{"displacement_ci": 350, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','S',1975,1976,'{}'::jsonb,'{"displacement_ci": 400, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','S',1980,1980,'{}'::jsonb,'{"displacement_ci": 265, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','T',1972,1972,'{}'::jsonb,'{"displacement_ci": 400, "carb": "4bbl", "exhaust": "dual"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','T',1974,1974,'{}'::jsonb,'{"displacement_ci": 400, "carb": "4bbl", "exhaust": "dual"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','T',1980,1980,'{}'::jsonb,'{"displacement_ci": 301, "carb": "4bbl", "application": "Turbo"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','U',1978,1978,'{}'::jsonb,'{"displacement_ci": 305, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','W',1975,1976,'{}'::jsonb,'{"displacement_ci": 455, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','W',1979,1980,'{}'::jsonb,'{"displacement_ci": 301, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','X',1972,1972,'{}'::jsonb,'{"displacement_ci": 455, "carb": "4bbl", "application": "H.O."}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','X',1974,1974,'{}'::jsonb,'{"displacement_ci": 455, "application": "Super Duty"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','Y',1974,1974,'{}'::jsonb,'{"displacement_ci": 455, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','Y',1977,1977,'{}'::jsonb,'{"displacement_ci": 301, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','Y',1979,1979,'{}'::jsonb,'{"displacement_ci": 301, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','Y',1980,1980,'{}'::jsonb,'{"displacement_ci": 301, "carb": "4bbl", "application": "T/A 4.9"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','Z',1977,1979,'{}'::jsonb,'{"displacement_ci": 400, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1972-80 13-character VIN section, 5th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','A',1981,1981,'{}'::jsonb,'{"displacement_ci": 231, "cylinders": 6, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','H',1981,1981,'{}'::jsonb,'{"displacement_ci": 305, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','S',1981,1981,'{}'::jsonb,'{"displacement_ci": 265, "carb": "2bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','T',1981,1981,'{}'::jsonb,'{"displacement_ci": 301, "carb": "4bbl", "application": "Turbo"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','W',1981,1981,'{}'::jsonb,'{"displacement_ci": 301, "carb": "4bbl", "note": "135 hp or T/A 4.9 150 hp"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23'),
  ('vin_engine_char','Pontiac','Firebird','L',1981,1981,'{}'::jsonb,'{"displacement_ci": 350, "carb": "4bbl"}'::jsonb,'http://www.drivinithome.com/firebird-vin-decoding/','Drivin'' It Home, ''Firebird VIN Decoding'' (1967-1981 Firebird VIN charts)','1981 17-character VIN section, 8th digit','2026-11-23')
) n(rule_key, make, model, code, year_min, year_max, qualifiers, value, citation_url, citation_title, citation_locator, cited_on)
WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_decode_rules d WHERE d.superseded_at IS NULL AND d.rule_key = n.rule_key
                   AND coalesce(d.make, '') = n.make AND coalesce(d.model, '') = n.model AND coalesce(d.code, '') = n.code
                   AND coalesce(d.year_min, 0) = n.year_min AND coalesce(d.year_max, 0) = n.year_max AND d.citation_url = n.citation_url);

ALTER TABLE public.data_sets DROP CONSTRAINT IF EXISTS data_sets_set_kind_check;
ALTER TABLE public.data_sets ADD CONSTRAINT data_sets_set_kind_check CHECK (set_kind IN ('vin_cohort','vin_series','vin_engine',
  'plant_year','cowl_style','cowl_option','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
  'replica_cohort','comment_theme'));
ALTER TABLE public.data_set_members DROP CONSTRAINT IF EXISTS data_set_members_basis_type_check;
ALTER TABLE public.data_set_members ADD CONSTRAINT data_set_members_basis_type_check CHECK (basis_type IN ('observation',
  'field_evidence','vehicle_vin','vehicle_flag','comment_rubric','code_reading'));

-- Keyed code readings: one row per (vehicle, kind, code, origin row, origin column), each citing the row it was read from.
CREATE TABLE IF NOT EXISTS public.vehicle_code_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('engine_block_casting','engine_code','trans_case_casting','trans_tail_casting',
    'paint_code','cowl_style','cowl_option')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  model_year integer,
  origin_table text NOT NULL CHECK (origin_table IN ('vehicles','auction_comments')),
  origin_id uuid NOT NULL,
  origin_column text NOT NULL,
  match_text text CHECK (match_text IS NULL OR length(match_text) <= 160),
  match_offset integer,
  pattern_key text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  rule_version text NOT NULL,
  run_id text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','reverted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_code_readings_active_uq
  ON public.vehicle_code_readings (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS vehicle_code_readings_vehicle_idx ON public.vehicle_code_readings (vehicle_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS vehicle_code_readings_run_idx ON public.vehicle_code_readings (run_id);
COMMENT ON TABLE public.vehicle_code_readings IS
  'Codes read from landed listing text (20261123190000, text_code_decode_v1). Each row is an inference citing its origin row and column; '
  'match_text is the matched span only for listing text and NULL for comments (no comment text or author is stored).';

CREATE TABLE IF NOT EXISTS public.vehicle_code_reading_runs (
  run_id text PRIMARY KEY,
  producer text NOT NULL,
  logic_version text NOT NULL,
  scope text NOT NULL,
  n_vehicles integer,
  status text NOT NULL DEFAULT 'applying' CHECK (status IN ('applying','applied','reverted')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reverted_at timestamptz
);
-- Revert keeps a copy of every row it removes.
CREATE TABLE IF NOT EXISTS public.vehicle_code_readings_backup (LIKE public.vehicle_code_readings);
ALTER TABLE public.vehicle_code_readings_backup ADD COLUMN IF NOT EXISTS backed_up_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.vehicle_code_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_code_reading_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_code_readings_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_code_readings, public.vehicle_code_reading_runs, public.vehicle_code_readings_backup
  FROM PUBLIC, anon, authenticated;

-- The patterns. Each returns (kind, code, match_text, offset). Keywords are case-insensitive; codes are upper-cased.
-- Engine codes are kept only when a cited Pontiac engine_stamp_code rule lists that code for the car's model year.
CREATE OR REPLACE FUNCTION public.text_code_matches_v1(p_text text)
RETURNS TABLE (kind text, code text, match_text text, pattern_key text, base_conf numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH p(kind, pattern_key, re, base_conf) AS (VALUES
    ('engine_block_casting', 'block_casting_no',
       '((?:block|engine)[^.;|•\n]{0,40}?casting\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{6,7}))\M', 0.60),
    ('engine_code', 'engine_code_label',
       '((?:engine|block)\s+(?:code|stamp(?:ed)?(?:\s+code)?|id\s+code)\s*(?:is|of|:|-|=|#)?\s*["“'']?([A-Za-z0-9]{2})["”'']?)\M', 0.60),
    ('engine_code', 'engine_stamp_after_partial_vin',
       '(engine\s+stamp\s*:?\s*[0-9]{6,8}\s+([A-Za-z0-9]{2}))\M', 0.60),
    ('engine_code', 'code_suffix',
       '(\m([A-Za-z][A-Za-z0-9])[- ](?:code|suffix)\M)', 0.50),
    ('engine_code', 'cid_code_block',
       '(\m(?:350|400|455)\s+([WXYZwxyz][A-Za-z0-9])\s+(?:block|engine)\M)', 0.55),
    ('trans_case_casting', 'trans_case_casting_no',
       '((?:trans(?:mission)?|muncie|turbo|th-?400|th-?350|m2[012]|case)[^.;|•\n]{0,30}?casting\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{7}))\M', 0.50),
    ('trans_case_casting', 'main_case',
       '((?:main\s+case\s*(?:casting)?\s*(?:no\.?|#|:)?\s*([0-9]{7}))|(?:\m([0-9]{7})\s+main\s+case))\M', 0.50),
    ('trans_tail_casting', 'tail_housing_no',
       '((?:tail\s*(?:housing|shaft\s+housing)?|extension\s+housing)\s*(?:casting)?\s*(?:no\.?|num(?:ber)?\.?|#|:)?\s*[:#]?\s*([0-9]{7}))\M', 0.55),
    ('paint_code', 'paint_code',
       '(paint\s+code\s*(?:is|of|:|-|#)?\s*[:#]?\s*([0-9]{2}[A-Za-z]?))\M', 0.55),
    ('paint_code', 'paint_colon_named',
       '(paint\s*:\s*([0-9]{2}[A-Za-z]?)\s*[(-])', 0.55),
    ('cowl_style', 'fisher_style',
       '(\m(2F[SUVWXsuvwx]?87)\M)', 0.60),
    ('cowl_option', 'tag_then_option',
       '((?:cowl|trim|body|fisher)\s+(?:tag|plate)[^.|•\n]{0,120}?\m(WS4|WS6|W50|W66|W72|Y82|Y84|Y85|Y88|Y89|CC1|ws4|ws6|y82|y84|y85)\M)', 0.50),
    ('cowl_option', 'option_then_tag',
       '(\m(WS4|WS6|W50|W66|W72|Y82|Y84|Y85|Y88|Y89|CC1)\M[^.|•\n]{0,60}?(?:cowl|trim|body)\s+tag)', 0.50)),
  m AS (
    SELECT p.kind, p.pattern_key, p.base_conf, x.g
      FROM p CROSS JOIN LATERAL regexp_matches(p_text, p.re, 'gi') AS x(g))
  SELECT m.kind, upper(coalesce(m.g[2], m.g[3])), left(regexp_replace(m.g[1], '\s+', ' ', 'g'), 160), m.pattern_key, m.base_conf
    FROM m
   WHERE coalesce(m.g[2], m.g[3]) IS NOT NULL
     -- a block reading must not be a head, intake, manifold, carb, distributor or transmission number
     AND NOT (m.kind = 'engine_block_casting' AND m.g[1] ~* '(head|intake|manifold|carb|distributor|trans|bell|water pump|crank)')
     AND NOT (m.kind = 'trans_case_casting' AND m.g[1] ~* '(tail|extension|intake|head|manifold|carb|block|engine|bell)')
$function$;

-- Producer: reads listing text on vehicles and non-bid auction comments for the scope, batched by vehicle.
CREATE OR REPLACE FUNCTION public.text_code_decode_v1(p_run uuid, p_scope text DEFAULT 'pontiac_f_body', p_vehicle uuid DEFAULT NULL,
  p_batch integer DEFAULT 400)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '900s'
AS $function$
DECLARE v_ids uuid[]; v_chunk uuid[]; i int := 1; n int := 0; b int := 0;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'text_code_decode_v1: run required'; END IF;
  IF p_scope NOT IN ('vehicle','pontiac_f_body') THEN RAISE EXCEPTION 'text_code_decode_v1: unknown scope %', p_scope; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_code_reading_runs r WHERE r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_v1: run % already exists', p_run;
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(coalesce(public.data_set_scope_vehicles(p_scope, p_vehicle), '{}')) x
   WHERE x::text NOT LIKE '9cf5b7a4%';
  v_ids := coalesce(v_ids, '{}');
  INSERT INTO public.vehicle_code_reading_runs (run_id, producer, logic_version, scope, n_vehicles)
  VALUES (p_run::text, 'text_code_decode_v1', 'text_code_decode/20261123190000.1', p_scope, cardinality(v_ids));
  WHILE i <= cardinality(v_ids) LOOP
    v_chunk := v_ids[i : i + p_batch - 1];
    WITH src AS (
      SELECT x.id AS vehicle_id, x.year, 'vehicles'::text AS ot, x.id AS oid, c.col, c.txt, true AS keep_text
        FROM public.vehicles x
       CROSS JOIN LATERAL (VALUES ('description', x.description), ('highlights', x.highlights), ('equipment', x.equipment),
                                  ('modifications', x.modifications), ('numbers_quote', x.numbers_quote)) c(col, txt)
       WHERE x.id = ANY (v_chunk) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL AND c.txt IS NOT NULL
         AND c.txt ~* '(casting|code|stamp|paint|2f[suvwx]?87|tag|case|housing)'
      UNION ALL
      SELECT ac.vehicle_id, x.year, 'auction_comments', ac.id, 'comment_text', ac.comment_text, false
        FROM public.auction_comments ac JOIN public.vehicles x ON x.id = ac.vehicle_id
       WHERE ac.vehicle_id = ANY (v_chunk) AND ac.comment_type IS DISTINCT FROM 'bid' AND ac.comment_type IS DISTINCT FROM 'sold'
         AND ac.comment_text ~* '(casting|code|stamp|paint|2f[suvwx]?87|tag|case|housing)'),
    hits AS (
      SELECT s.*, t.kind, t.code, t.match_text, t.pattern_key,
             CASE WHEN s.ot = 'auction_comments' THEN round(t.base_conf * 0.6, 3) ELSE t.base_conf END AS conf
        FROM src s CROSS JOIN LATERAL public.text_code_matches_v1(s.txt) t),
    ok AS (
      SELECT h.* FROM hits h
       WHERE h.code ~ '^[A-Z0-9]{2,8}$'
         AND (h.kind <> 'engine_code' OR EXISTS (
               SELECT 1 FROM public.vehicle_decode_rules d WHERE d.rule_key = 'engine_stamp_code' AND d.superseded_at IS NULL
                  AND lower(d.make) = 'pontiac' AND upper(d.code) = h.code AND d.year_min <= h.year AND d.year_max >= h.year))
         AND (h.kind NOT IN ('paint_code','cowl_style','cowl_option') OR h.year IS NOT NULL)),
    one AS (
      SELECT DISTINCT ON (o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col) o.*
        FROM ok o ORDER BY o.vehicle_id, o.kind, o.code, o.ot, o.oid, o.col, o.conf DESC, o.pattern_key),
    -- two different codes of one kind read for the same car lower every reading of that kind for it
    scored AS (
      SELECT o.*, CASE WHEN count(DISTINCT o.code) OVER (PARTITION BY o.vehicle_id, o.kind) > 1 AND o.kind <> 'cowl_option'
                       THEN round(o.conf * 0.6, 3) ELSE o.conf END AS conf2
        FROM one o)
    INSERT INTO public.vehicle_code_readings (vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text,
      pattern_key, confidence, rule_version, run_id)
    SELECT s.vehicle_id, s.kind, s.code, s.year, s.ot, s.oid, s.col, CASE WHEN s.keep_text THEN s.match_text END, s.pattern_key,
           s.conf2, 'text_code_decode_v1', p_run::text
      FROM scored s
    ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
    GET DIAGNOSTICS b = ROW_COUNT;
    n := n + b;
    i := i + p_batch;
  END LOOP;
  UPDATE public.vehicle_code_reading_runs SET status = 'applied', applied_at = now(),
         summary = jsonb_build_object('inserted', n,
           'by_kind', (SELECT jsonb_object_agg(k, c) FROM (SELECT r.kind || ':' || r.origin_table AS k, count(*) AS c
                         FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text GROUP BY 1) z),
           'vehicles_with_readings', (SELECT count(DISTINCT r.vehicle_id) FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text))
   WHERE run_id = p_run::text;
  RETURN (SELECT jsonb_build_object('run_id', run_id, 'vehicles', n_vehicles) || summary FROM public.vehicle_code_reading_runs
           WHERE run_id = p_run::text);
END
$function$;

-- Revert a reading run: refused while an unreverted membership run still cites its rows; copies rows to the backup, then deletes.
CREATE OR REPLACE FUNCTION public.text_code_decode_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE n_bk int; n_del int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.data_set_members m JOIN public.vehicle_code_readings r ON r.id = m.basis_id
              WHERE m.basis_type = 'code_reading' AND m.state = 'active' AND r.run_id = p_run::text) THEN
    RAISE EXCEPTION 'text_code_decode_revert_v1: active data_set_members cite run %; revert the membership run first', p_run;
  END IF;
  INSERT INTO public.vehicle_code_readings_backup SELECT r.*, now() FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_bk = ROW_COUNT;
  DELETE FROM public.vehicle_code_readings r WHERE r.run_id = p_run::text;
  GET DIAGNOSTICS n_del = ROW_COUNT;
  UPDATE public.vehicle_code_reading_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('backed_up', n_bk, 'deleted', n_del))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'backed_up', n_bk, 'deleted', n_del);
END
$function$;

REVOKE ALL ON FUNCTION public.text_code_matches_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.text_code_decode_v1(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.text_code_decode_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.text_code_matches_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.text_code_decode_v1(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.text_code_decode_revert_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.data_set_basis_live(p_basis_type text, p_basis_id uuid, p_vehicle uuid, p_detail jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE p_basis_type
    WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.id = p_basis_id
                                      AND o.vehicle_id = p_vehicle AND NOT coalesce(o.is_superseded, false))
    WHEN 'field_evidence' THEN EXISTS (SELECT 1 FROM public.field_evidence f WHERE f.id = p_basis_id AND f.vehicle_id = p_vehicle
                                      AND coalesce(f.status, '') NOT IN ('rejected','superseded')
                                      AND upper(btrim(f.proposed_value)) = p_detail->>'vin')
    WHEN 'vehicle_vin' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND upper(btrim(x.vin)) = p_detail->>'vin')
    WHEN 'vehicle_flag' THEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = p_basis_id AND x.deleted_at IS NULL
                                      AND x.merged_into_vehicle_id IS NULL AND x.is_replica IS TRUE
                                      AND upper(btrim(x.vin)) = p_detail->>'vin'
                                      AND (p_detail->>'cohort' IS DISTINCT FROM 'as_presented'
                                           OR ((public.data_set_replica_presented_v1(x.replica_quote)).p_series IS NOT DISTINCT FROM p_detail->>'presented_series'
                                               AND (public.data_set_replica_presented_v1(x.replica_quote)).p_app IS NOT DISTINCT FROM p_detail->>'presented_engine')))
    WHEN 'comment_rubric' THEN EXISTS (SELECT 1 FROM public.auction_comments c WHERE c.id = p_basis_id
                                      AND c.vehicle_id IS NOT DISTINCT FROM p_vehicle
                                      AND c.auction_event_id IS NOT DISTINCT FROM nullif(p_detail->>'auction_event_id', '')::uuid)
    WHEN 'code_reading' THEN EXISTS (SELECT 1 FROM public.vehicle_code_readings r WHERE r.id = p_basis_id
                                      AND r.vehicle_id = p_vehicle AND r.state = 'active'
                                      AND upper(r.code) = p_detail->>'code')
    ELSE false END
$function$;


CREATE OR REPLACE FUNCTION public.data_set_scope_vehicles(p_scope text, p_vehicle uuid)
RETURNS uuid[] LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT CASE p_scope
    WHEN 'vehicle' THEN ARRAY[p_vehicle]
    WHEN 'pontiac_f_body' THEN (SELECT array_agg(x.id ORDER BY x.id) FROM public.vehicles x
                                 WHERE lower(x.make) = 'pontiac'
                                   AND (lower(coalesce(x.model, '')) ~ 'firebird|trans ?am'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^2[A-Z]87[A-Z][2-9A][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^22[3468]87[01][A-Z][0-9]{6}$'
                                        OR upper(btrim(coalesce(x.vin, ''))) ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'))
  END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
RETURNS TABLE (set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid,
  vehicle_id uuid, basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
  WITH v AS (
    SELECT x.id, upper(btrim(x.vin)) AS vin, x.year, lower(btrim(x.make)) AS mk, x.is_replica, x.replica_quote
      FROM public.vehicles x
     WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
       AND x.status IS DISTINCT FROM 'merged'),
  -- Pontiac Firebird VIN formats (vehicle_decode_rules cite the chart for each position):
  --   gm_1970_1971_car_vin_v1: 2 + series (2 digits, e.g. 28 = Trans Am) + body (2) + year digit (0/1) + plant + serial (6); no engine
  --   gm_1972_1980_car_vin_v1: 2 + series + body (2) + engine + year (2-9, A = 1980) + plant + serial (6)
  --   gm_1981_17_vin_v1: 1G2 + restraint + series + body (2) + engine + check + B (1981) + plant + serial (6)
  vin AS (
    SELECT v.*, substr(v.vin, 2, 1) AS series, substr(v.vin, 3, 2) AS body, substr(v.vin, 5, 1) AS eng,
           substr(v.vin, 7, 1) AS plant,
           CASE substr(v.vin, 6, 1) WHEN 'A' THEN 1980 ELSE 1970 + substr(v.vin, 6, 1)::int END AS dyear,
           'gm_1972_1980_car_vin_v1'::text AS fmt
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^2[A-Z][0-9]{2}[A-Z][2-9A][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 2, 2), substr(v.vin, 4, 2), NULL::text, substr(v.vin, 7, 1),
           1970 + substr(v.vin, 6, 1)::int, 'gm_1970_1971_car_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^22[3468]87[01][A-Z][0-9]{6}$'
    UNION ALL
    SELECT v.*, substr(v.vin, 5, 1), substr(v.vin, 6, 2), substr(v.vin, 8, 1), substr(v.vin, 11, 1),
           1981, 'gm_1981_17_vin_v1'
      FROM v WHERE v.mk = 'pontiac' AND v.vin ~ '^1G2[A-C][A-Z]87[A-Z][0-9X]B[A-Z][0-9]{6}$'),
  vin_ok AS (SELECT * FROM vin WHERE vin.year IS NULL OR vin.year = vin.dyear),
  vin_basis AS (
    SELECT o.*, fe.id AS fe_id, fe.source_confidence,
           -- a model-scoped VIN character rule applies only when the VIN's body code is one that model's rule lists
           EXISTS (SELECT 1 FROM public.vehicle_decode_rules b WHERE b.rule_key = 'vin_body_code' AND b.superseded_at IS NULL
                    AND lower(b.make) = o.mk AND b.code = o.body
                    AND (b.year_min IS NULL OR b.year_min <= o.dyear) AND (b.year_max IS NULL OR b.year_max >= o.dyear)) AS body_ruled
      FROM vin_ok o
      LEFT JOIN LATERAL (
        SELECT f.id, f.source_confidence FROM public.field_evidence f
         WHERE f.vehicle_id = o.id AND f.source_type = 'gm_vin_chart' AND f.field_name = 'vin'
           AND upper(btrim(f.proposed_value)) = o.vin AND coalesce(f.status, '') NOT IN ('rejected','superseded')
         ORDER BY f.source_confidence DESC NULLS LAST, f.id LIMIT 1) fe ON true),
  vin_rows AS (
    SELECT b.*, k.kind, k.skey, k.lbl
      FROM vin_basis b
     CROSS JOIN LATERAL (VALUES
       ('vin_cohort', format('%s:%s:%s%s:%s', b.mk, b.dyear, b.series, b.body, b.eng),
          CASE WHEN b.body_ruled THEN jsonb_build_object('series', public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear),
                                                         'engine', public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear)) END),
       ('vin_series', format('%s:%s:%s%s', b.mk, b.dyear, b.series, b.body),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_series_char', b.mk, b.series, b.dyear) END),
       ('vin_engine', format('%s:%s:%s', b.mk, b.dyear, b.eng),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_engine_char', b.mk, b.eng, b.dyear) END),
       ('plant_year', format('%s:%s:%s', b.mk, b.dyear, b.plant),
          CASE WHEN b.body_ruled THEN public.data_set_rule_label('vin_plant_char', b.mk, b.plant, b.dyear) END)
     ) k(kind, skey, lbl)
     WHERE b.eng IS NOT NULL OR k.kind IN ('vin_series','plant_year')),
  vin_out AS (
    SELECT r.kind, lower(r.skey),
           CASE WHEN r.kind = 'vin_cohort' THEN
                  CASE WHEN r.lbl->'series'->>'label' IS NOT NULL AND r.lbl->'engine'->>'label' IS NOT NULL
                       THEN (r.lbl->'series'->>'label') || '; ' || (r.lbl->'engine'->>'label') END
                ELSE r.lbl->>'label' END,
           jsonb_build_object('decode_rule', r.fmt, 'rules', coalesce(r.lbl, '{}'::jsonb)),
           'vehicle'::text, r.id, r.id,
           CASE WHEN r.fe_id IS NOT NULL THEN 'field_evidence' ELSE 'vehicle_vin' END,
           coalesce(r.fe_id, r.id),
           jsonb_build_object('vin', r.vin, 'positions', jsonb_build_object('series', r.series, 'body', r.body,
             'engine', r.eng, 'year', r.dyear, 'plant', r.plant)),
           CASE WHEN r.fe_id IS NOT NULL THEN least(greatest(coalesce(r.source_confidence, 90), 1), 100) / 100.0 ELSE 0.80 END,
           r.fmt
      FROM vin_rows r),
  -- Photo decode observations (one reviewer's reading of one photo each).
  obs AS (
    SELECT o.id, o.vehicle_id, o.extraction_method AS m, o.structured_data AS sd,
           least(greatest(coalesce(o.confidence_score, 0.5), 0.01), 1) AS conf, v.year, v.mk,
           CASE WHEN o.structured_data->>'tag_model_year' ~ '^[0-9]{2}$' THEN 1900 + (o.structured_data->>'tag_model_year')::int
                ELSE v.year END AS tyear
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id
     WHERE o.extraction_method IN ('cowl_tag_decode_v1','engine_block_decode_v1','trans_id_stamp_decode_v1')
       AND NOT coalesce(o.is_superseded, false)),
  obs_codes AS (
    SELECT o.*, e.kind, upper(btrim(e.code)) AS code, e.rule_key
      FROM obs o
     CROSS JOIN LATERAL (VALUES
       ('engine_block_casting', CASE WHEN o.m = 'engine_block_decode_v1' THEN o.sd->>'engine_block_casting' END, 'block_casting'),
       ('engine_code', CASE WHEN o.m = 'engine_block_decode_v1' THEN coalesce(o.sd->>'engine_code_stamp', o.sd->>'engine_code') END, 'engine_stamp_code'),
       ('trans_case_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_case_casting', o.sd->>'case_casting') END, 'transmission_case_casting'),
       ('trans_tail_casting', CASE WHEN o.m = 'trans_id_stamp_decode_v1' THEN coalesce(o.sd->>'transmission_tailhousing_casting', o.sd->>'transmission_tailhousing') END, 'transmission_tailhousing_casting'),
       ('paint_code', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'paint_code', o.sd->'body_tag_paint_code'->>'lower') END, 'body_tag_paint_code'),
       ('cowl_style', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN coalesce(o.sd->>'fisher_style_number', o.sd->>'body_tag_style') END, 'body_tag_style_number'),
       ('plant_year', CASE WHEN o.m = 'cowl_tag_decode_v1' THEN o.sd->>'assembly_plant_code' END, 'body_tag_plant_code')
     ) e(kind, code, rule_key)
     WHERE e.code IS NOT NULL AND btrim(e.code) ~ '^[A-Za-z0-9]{1,12}$' AND o.mk IS NOT NULL
       AND (e.kind NOT IN ('paint_code','cowl_style','plant_year') OR o.tyear IS NOT NULL)
       AND (e.kind <> 'plant_year' OR btrim(e.code) ~ '^[A-Za-z]$')),
  obs_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'paint_code' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'cowl_style' THEN format('%s:%s', c.tyear, c.code)
             WHEN 'plant_year' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey,
           public.data_set_rule_label(CASE WHEN c.kind = 'plant_year' THEN 'vin_plant_char' ELSE c.rule_key END, c.mk, c.code,
             CASE WHEN c.kind IN ('paint_code','cowl_style','plant_year') THEN c.tyear END) AS lbl,
           CASE WHEN c.sd->>'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 AND EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = (c.sd->>'image_id')::uuid AND vi.vehicle_id = c.vehicle_id)
                THEN (c.sd->>'image_id')::uuid END AS image_id
      FROM obs_codes c),
  obs_out AS (
    SELECT k.kind, k.skey, k.lbl->>'label', jsonb_build_object('decode_rule', k.m, 'rules', k.lbl),
           mt.member_type, mt.member_id, k.vehicle_id, 'observation'::text, k.id,
           jsonb_build_object('claim_role', k.sd->>'claim_role', 'code', k.code), k.conf, k.m
      FROM obs_keyed k
     CROSS JOIN LATERAL (VALUES ('vehicle', k.vehicle_id), ('image', k.image_id)) mt(member_type, member_id)
     WHERE mt.member_id IS NOT NULL),
  -- Text code readings (vehicle_code_readings, text_code_decode_v1): one cited read of one code in one origin row each.
  crd AS (
    SELECT r.id, r.vehicle_id, r.kind, upper(r.code) AS code, r.model_year AS tyear, r.confidence AS conf, v.mk,
           r.origin_table, r.origin_id, r.origin_column, r.rule_version,
           CASE r.kind WHEN 'engine_block_casting' THEN 'block_casting' WHEN 'engine_code' THEN 'engine_stamp_code'
                       WHEN 'trans_case_casting' THEN 'transmission_case_casting'
                       WHEN 'trans_tail_casting' THEN 'transmission_tailhousing_casting'
                       WHEN 'paint_code' THEN 'body_tag_paint_code' WHEN 'cowl_style' THEN 'body_tag_style_number'
                       WHEN 'cowl_option' THEN 'body_tag_option_code' END AS rule_key
      FROM public.vehicle_code_readings r JOIN v ON v.id = r.vehicle_id
     WHERE r.state = 'active' AND v.mk IS NOT NULL
       AND (r.kind NOT IN ('paint_code','cowl_style','cowl_option') OR r.model_year IS NOT NULL)),
  crd_keyed AS (
    SELECT c.*, lower(CASE c.kind
             WHEN 'engine_code' THEN format('%s:%s', c.mk, c.code)
             WHEN 'paint_code' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             WHEN 'cowl_style' THEN format('%s:%s', c.tyear, c.code)
             WHEN 'cowl_option' THEN format('%s:%s:%s', c.mk, c.tyear, c.code)
             ELSE c.code END) AS skey,
           public.data_set_rule_label(c.rule_key, c.mk, c.code,
             CASE WHEN c.kind IN ('paint_code','cowl_style','cowl_option','engine_code') THEN c.tyear END) AS lbl
      FROM crd c),
  crd_out AS (
    SELECT k.kind, k.skey, k.lbl->>'label', jsonb_build_object('decode_rule', k.rule_version, 'rules', k.lbl),
           'vehicle'::text, k.vehicle_id, k.vehicle_id, 'code_reading'::text, k.id,
           jsonb_build_object('code', k.code, 'origin_table', k.origin_table, 'origin_id', k.origin_id,
                              'origin_column', k.origin_column), k.conf, k.rule_version
      FROM crd_keyed k),
  -- Replicas (vehicles.is_replica): as built = the VIN cohort; as presented = replica_presented_v1 read of replica_quote,
  -- resolved to VIN codes through the decode rules for that year (no rule, no as-presented membership).
  rep AS (
    SELECT b.*,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_series,
           (public.data_set_replica_presented_v1(b.replica_quote)).p_app
      FROM vin_basis b WHERE b.is_replica IS TRUE AND b.eng IS NOT NULL),
  rep_codes AS (
    SELECT r.*,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_series_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'series' = r.p_series AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS ps,
           (SELECT d.code FROM public.vehicle_decode_rules d WHERE d.rule_key = 'vin_engine_char' AND d.superseded_at IS NULL
             AND lower(d.make) = r.mk AND d.value->>'application' = r.p_app AND d.year_min <= r.dyear AND d.year_max >= r.dyear
             ORDER BY d.id LIMIT 1) AS pe
      FROM rep r),
  rep_out AS (
    SELECT 'replica_cohort'::text, lower(format('as_built:%s:%s:%s%s:%s', r.mk, r.dyear, r.series, r.body, r.eng)),
           NULL::text, jsonb_build_object('rule', 'replica_cohort_v1', 'cohort', 'as_built'),
           'vehicle'::text, r.id, r.id, 'vehicle_flag'::text, r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_built', 'vin', r.vin), 0.80::numeric, 'replica_cohort_v1'::text
      FROM rep_codes r
    UNION ALL
    SELECT 'replica_cohort', lower(CASE WHEN r.pe IS NOT NULL THEN format('as_presented:%s:%s:%s%s:%s', r.mk, r.dyear, r.ps, r.body, r.pe)
                                        ELSE format('as_presented:%s:%s:%s%s', r.mk, r.dyear, r.ps, r.body) END),
           concat_ws(' ', r.p_series, r.p_app), jsonb_build_object('rule', 'replica_presented_v1', 'cohort', 'as_presented'),
           'vehicle', r.id, r.id, 'vehicle_flag', r.id,
           jsonb_build_object('is_replica', true, 'cohort', 'as_presented', 'presented_series', r.p_series,
                              'presented_engine', r.p_app, 'read_from', 'vehicles.replica_quote', 'vin', r.vin),
           0.50, 'replica_presented_v1'
      FROM rep_codes r WHERE r.ps IS NOT NULL),
  com_out AS (
    SELECT 'comment_theme'::text, t.theme, NULL::text, jsonb_build_object('rubric', 'comment_theme_v1'),
           'auction_comment'::text, c.id, c.vehicle_id, 'comment_rubric'::text, c.id,
           jsonb_build_object('matched', t.matched, 'auction_event_id', c.auction_event_id), 0.50::numeric, 'comment_theme_v1'::text
      FROM public.auction_comments c
      JOIN v ON v.id = c.vehicle_id
     CROSS JOIN LATERAL public.data_set_comment_themes_v1(c.comment_text) t
     WHERE c.comment_type IS DISTINCT FROM 'bid' AND c.comment_type IS DISTINCT FROM 'sold')
  SELECT * FROM vin_out
  UNION ALL SELECT * FROM obs_out
  UNION ALL SELECT * FROM rep_out
  UNION ALL SELECT * FROM com_out
  UNION ALL SELECT * FROM crd_out
$function$;


CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
              JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme','cowl_option']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;


REVOKE ALL ON FUNCTION public.data_set_candidates_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_data_sets(uuid) TO anon, authenticated, service_role;

commit;
