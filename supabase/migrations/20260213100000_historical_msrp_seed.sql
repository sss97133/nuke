-- Historical Factory MSRP seed data for common collector vehicles
-- Sources: manufacturer archives, period literature, automotive encyclopedias
-- All prices are original MSRP in USD at time of sale (not adjusted for inflation)

-- Clear any empty rows first
DELETE FROM oem_trim_levels WHERE base_msrp_usd IS NULL;

-- ============================================================
-- FORD MUSTANG (1964.5 - 2024)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
-- First generation (1964.5-1973)
('Ford', 'Mustang', 'Hardtop', 'base', 'Mustang Hardtop', 1965, 1966, 2372),
('Ford', 'Mustang', 'Convertible', 'base', 'Mustang Convertible', 1965, 1966, 2614),
('Ford', 'Mustang', 'Fastback 2+2', 'base', 'Mustang Fastback', 1965, 1966, 2589),
('Ford', 'Mustang', 'GT Hardtop', 'gt', 'Mustang GT', 1965, 1966, 2616),
('Ford', 'Mustang', 'GT Convertible', 'gt', 'Mustang GT Convertible', 1965, 1966, 2858),
('Ford', 'Mustang', 'GT Fastback', 'gt', 'Mustang GT Fastback', 1965, 1966, 2833),
('Ford', 'Mustang', 'Shelby GT350', 'shelby', 'Shelby GT350', 1965, 1966, 4547),
('Ford', 'Mustang', 'Shelby GT500', 'shelby', 'Shelby GT500', 1967, 1968, 4195),
('Ford', 'Mustang', 'Boss 302', 'boss', 'Boss 302', 1969, 1970, 3588),
('Ford', 'Mustang', 'Boss 429', 'boss', 'Boss 429', 1969, 1970, 4798),
('Ford', 'Mustang', 'Mach 1', 'mach1', 'Mach 1', 1969, 1970, 3139),
('Ford', 'Mustang', 'Mach 1', 'mach1', 'Mach 1', 1971, 1973, 3268),
('Ford', 'Mustang', 'Hardtop', 'base', 'Mustang', 1967, 1968, 2472),
('Ford', 'Mustang', 'Hardtop', 'base', 'Mustang', 1969, 1970, 2635),
('Ford', 'Mustang', 'Convertible', 'base', 'Mustang Convertible', 1969, 1970, 2832),
-- Fox body (1979-1993)
('Ford', 'Mustang', 'LX', 'base', 'Mustang LX', 1987, 1993, 9885),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 1987, 1993, 13585),
('Ford', 'Mustang', 'LX 5.0', 'lx50', 'Mustang LX 5.0', 1987, 1993, 12265),
('Ford', 'Mustang', 'Cobra', 'cobra', 'SVT Cobra', 1993, 1993, 18505),
-- SN95 (1994-2004)
('Ford', 'Mustang', 'Base', 'base', 'Mustang V6', 1994, 1998, 14330),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 1994, 1998, 17510),
('Ford', 'Mustang', 'SVT Cobra', 'cobra', 'SVT Cobra', 1994, 1998, 22235),
('Ford', 'Mustang', 'Cobra R', 'cobra_r', 'SVT Cobra R', 2000, 2000, 54995),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 1999, 2004, 21510),
('Ford', 'Mustang', 'SVT Cobra', 'cobra', 'SVT Cobra', 2003, 2004, 33460),
('Ford', 'Mustang', 'Mach 1', 'mach1', 'Mach 1', 2003, 2004, 28705),
-- S197 (2005-2014)
('Ford', 'Mustang', 'V6', 'base', 'Mustang V6', 2005, 2009, 19215),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 2005, 2009, 25215),
('Ford', 'Mustang', 'Shelby GT500', 'shelby', 'Shelby GT500', 2007, 2009, 41995),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 2010, 2014, 30495),
('Ford', 'Mustang', 'Shelby GT500', 'shelby', 'Shelby GT500', 2010, 2014, 54995),
('Ford', 'Mustang', 'Boss 302', 'boss', 'Boss 302', 2012, 2013, 42200),
-- S550 (2015-2023)
('Ford', 'Mustang', 'EcoBoost', 'base', 'Mustang EcoBoost', 2015, 2023, 26395),
('Ford', 'Mustang', 'GT', 'gt', 'Mustang GT', 2015, 2023, 35995),
('Ford', 'Mustang', 'Shelby GT350', 'shelby', 'Shelby GT350', 2016, 2020, 49995),
('Ford', 'Mustang', 'Shelby GT350R', 'shelby', 'Shelby GT350R', 2016, 2020, 63645),
('Ford', 'Mustang', 'Shelby GT500', 'shelby', 'Shelby GT500', 2020, 2022, 72900),
('Ford', 'Mustang', 'Mach 1', 'mach1', 'Mach 1', 2021, 2023, 52915)
ON CONFLICT DO NOTHING;

-- ============================================================
-- CHEVROLET CORVETTE (1953 - 2024)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
-- C1 (1953-1962)
('Chevrolet', 'Corvette', 'Base', 'base', 'Corvette', 1953, 1955, 3498),
('Chevrolet', 'Corvette', 'Base', 'base', 'Corvette', 1956, 1957, 3120),
('Chevrolet', 'Corvette', 'Base', 'base', 'Corvette', 1958, 1960, 3631),
('Chevrolet', 'Corvette', 'Base', 'base', 'Corvette', 1961, 1962, 3934),
-- C2 Sting Ray (1963-1967)
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette Sting Ray Coupe', 1963, 1963, 4252),
('Chevrolet', 'Corvette', 'Convertible', 'base', 'Corvette Sting Ray Convertible', 1963, 1963, 4037),
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette Sting Ray', 1964, 1967, 4252),
('Chevrolet', 'Corvette', 'L88', 'l88', 'Corvette L88', 1967, 1969, 5675),
-- C3 (1968-1982)
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette Stingray', 1968, 1972, 4663),
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 1973, 1977, 5562),
('Chevrolet', 'Corvette', 'Pace Car', 'pace_car', 'Corvette Pace Car', 1978, 1978, 13653),
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 1978, 1982, 9647),
-- C4 (1984-1996)
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 1984, 1989, 21800),
('Chevrolet', 'Corvette', 'ZR-1', 'zr1', 'Corvette ZR-1', 1990, 1995, 58995),
('Chevrolet', 'Corvette', 'Grand Sport', 'gs', 'Corvette Grand Sport', 1996, 1996, 36785),
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 1990, 1996, 33635),
-- C5 (1997-2004)
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 1997, 2004, 37495),
('Chevrolet', 'Corvette', 'Z06', 'z06', 'Corvette Z06', 2001, 2004, 47500),
-- C6 (2005-2013)
('Chevrolet', 'Corvette', 'Coupe', 'base', 'Corvette', 2005, 2013, 44245),
('Chevrolet', 'Corvette', 'Z06', 'z06', 'Corvette Z06', 2006, 2013, 65890),
('Chevrolet', 'Corvette', 'ZR1', 'zr1', 'Corvette ZR1', 2009, 2013, 103300),
('Chevrolet', 'Corvette', 'Grand Sport', 'gs', 'Corvette Grand Sport', 2010, 2013, 55045),
('Chevrolet', 'Corvette', '427 Convertible', '427', 'Corvette 427 Convertible', 2013, 2013, 75925),
-- C7 (2014-2019)
('Chevrolet', 'Corvette', 'Stingray', 'base', 'Corvette Stingray', 2014, 2019, 51995),
('Chevrolet', 'Corvette', 'Grand Sport', 'gs', 'Corvette Grand Sport', 2017, 2019, 65450),
('Chevrolet', 'Corvette', 'Z06', 'z06', 'Corvette Z06', 2015, 2019, 79995),
('Chevrolet', 'Corvette', 'ZR1', 'zr1', 'Corvette ZR1', 2019, 2019, 121000),
-- C8 (2020-present)
('Chevrolet', 'Corvette', 'Stingray', 'base', 'Corvette Stingray', 2020, 2025, 59995),
('Chevrolet', 'Corvette', 'Z06', 'z06', 'Corvette Z06', 2023, 2025, 111100),
('Chevrolet', 'Corvette', 'E-Ray', 'eray', 'Corvette E-Ray', 2024, 2025, 104295),
('Chevrolet', 'Corvette', 'ZR1', 'zr1', 'Corvette ZR1', 2025, 2025, 150000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- PORSCHE 911 (1965 - 2024)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
-- Classic air-cooled (1965-1998)
('Porsche', '911', 'Base', 'base', '911', 1965, 1968, 6500),
('Porsche', '911', 'S', 's', '911S', 1967, 1973, 7770),
('Porsche', '911', 'T', 't', '911T', 1969, 1973, 6350),
('Porsche', '911', 'E', 'e', '911E', 1969, 1973, 7295),
('Porsche', '911', 'Carrera RS 2.7', 'rs', '911 Carrera RS 2.7', 1973, 1973, 10200),
('Porsche', '911', 'Turbo', 'turbo', '911 Turbo (930)', 1976, 1989, 26000),
('Porsche', '911', 'SC', 'sc', '911 SC', 1978, 1983, 22810),
('Porsche', '911', 'Carrera', 'carrera', '911 Carrera 3.2', 1984, 1989, 31950),
('Porsche', '911', 'Carrera 4', 'carrera4', '964 Carrera 4', 1989, 1994, 69500),
('Porsche', '911', 'Carrera 2', 'carrera2', '964 Carrera 2', 1990, 1994, 58500),
('Porsche', '911', 'Turbo', 'turbo', '964 Turbo', 1991, 1994, 95000),
('Porsche', '911', 'RS America', 'rs', '964 RS America', 1993, 1994, 53900),
('Porsche', '911', 'Carrera', 'carrera', '993 Carrera', 1995, 1998, 59900),
('Porsche', '911', 'Carrera 4S', 'carrera4s', '993 Carrera 4S', 1996, 1998, 73000),
('Porsche', '911', 'Turbo', 'turbo', '993 Turbo', 1996, 1998, 105000),
('Porsche', '911', 'Turbo S', 'turbo_s', '993 Turbo S', 1997, 1998, 150000),
-- Water-cooled (1999-present)
('Porsche', '911', 'Carrera', 'carrera', '996 Carrera', 1999, 2004, 65595),
('Porsche', '911', 'Turbo', 'turbo', '996 Turbo', 2001, 2005, 111000),
('Porsche', '911', 'GT3', 'gt3', '996 GT3', 2004, 2005, 99900),
('Porsche', '911', 'GT2', 'gt2', '996 GT2', 2002, 2005, 179990),
('Porsche', '911', 'Carrera', 'carrera', '997 Carrera', 2005, 2011, 70200),
('Porsche', '911', 'Carrera S', 'carrera_s', '997 Carrera S', 2005, 2011, 79100),
('Porsche', '911', 'Turbo', 'turbo', '997 Turbo', 2007, 2013, 132800),
('Porsche', '911', 'GT3', 'gt3', '997 GT3', 2007, 2011, 106275),
('Porsche', '911', 'GT3 RS', 'gt3rs', '997 GT3 RS', 2007, 2011, 118675),
('Porsche', '911', 'GT2 RS', 'gt2rs', '997 GT2 RS', 2011, 2011, 245000),
('Porsche', '911', 'Carrera', 'carrera', '991 Carrera', 2012, 2019, 84300),
('Porsche', '911', 'Carrera S', 'carrera_s', '991 Carrera S', 2012, 2019, 97400),
('Porsche', '911', 'Turbo', 'turbo', '991 Turbo', 2014, 2019, 150400),
('Porsche', '911', 'Turbo S', 'turbo_s', '991 Turbo S', 2014, 2019, 188100),
('Porsche', '911', 'GT3', 'gt3', '991 GT3', 2014, 2019, 130400),
('Porsche', '911', 'GT3 RS', 'gt3rs', '991 GT3 RS', 2016, 2019, 175900),
('Porsche', '911', 'GT2 RS', 'gt2rs', '991 GT2 RS', 2018, 2019, 293200),
('Porsche', '911', 'R', 'r', '991 911 R', 2016, 2016, 184900),
-- 992 (2020-present)
('Porsche', '911', 'Carrera', 'carrera', '992 Carrera', 2020, 2025, 101200),
('Porsche', '911', 'Carrera S', 'carrera_s', '992 Carrera S', 2020, 2025, 117100),
('Porsche', '911', 'Turbo S', 'turbo_s', '992 Turbo S', 2021, 2025, 207000),
('Porsche', '911', 'GT3', 'gt3', '992 GT3', 2022, 2025, 161100),
('Porsche', '911', 'GT3 RS', 'gt3rs', '992 GT3 RS', 2023, 2025, 223800)
ON CONFLICT DO NOTHING;

-- ============================================================
-- CHEVROLET CAMARO (1967 - 2024)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Chevrolet', 'Camaro', 'Base', 'base', 'Camaro', 1967, 1969, 2466),
('Chevrolet', 'Camaro', 'SS', 'ss', 'Camaro SS', 1967, 1969, 2853),
('Chevrolet', 'Camaro', 'Z/28', 'z28', 'Camaro Z/28', 1967, 1969, 3100),
('Chevrolet', 'Camaro', 'RS', 'rs', 'Camaro RS', 1967, 1969, 2621),
('Chevrolet', 'Camaro', 'COPO', 'copo', 'Camaro COPO 427', 1969, 1969, 3500),
('Chevrolet', 'Camaro', 'Base', 'base', 'Camaro', 1970, 1973, 2749),
('Chevrolet', 'Camaro', 'Z/28', 'z28', 'Camaro Z/28', 1970, 1973, 3196),
('Chevrolet', 'Camaro', 'SS', 'ss', 'Camaro SS', 1970, 1972, 3070),
('Chevrolet', 'Camaro', 'Z28', 'z28', 'Camaro Z28', 1977, 1981, 5170),
('Chevrolet', 'Camaro', 'IROC-Z', 'iroc', 'Camaro IROC-Z', 1985, 1990, 12561),
('Chevrolet', 'Camaro', 'Z28', 'z28', 'Camaro Z28', 1993, 2002, 16779),
('Chevrolet', 'Camaro', 'SS', 'ss', 'Camaro SS', 1996, 2002, 22545),
('Chevrolet', 'Camaro', 'SS', 'ss', 'Camaro SS', 2010, 2015, 31545),
('Chevrolet', 'Camaro', 'ZL1', 'zl1', 'Camaro ZL1', 2012, 2015, 54995),
('Chevrolet', 'Camaro', 'Z/28', 'z28', 'Camaro Z/28', 2014, 2015, 75000),
('Chevrolet', 'Camaro', 'SS', 'ss', 'Camaro SS', 2016, 2024, 37995),
('Chevrolet', 'Camaro', 'ZL1', 'zl1', 'Camaro ZL1', 2017, 2024, 62000),
('Chevrolet', 'Camaro', 'LT1', 'lt1', 'Camaro LT1', 2020, 2024, 34995)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DODGE/PLYMOUTH MUSCLE (1966 - 1974)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Dodge', 'Charger', 'Base', 'base', 'Charger', 1966, 1967, 3122),
('Dodge', 'Charger', 'R/T', 'rt', 'Charger R/T', 1968, 1970, 3480),
('Dodge', 'Charger', 'Base', 'base', 'Charger', 1968, 1970, 3014),
('Dodge', 'Charger', 'Daytona', 'daytona', 'Charger Daytona', 1969, 1969, 3993),
('Dodge', 'Challenger', 'Base', 'base', 'Challenger', 1970, 1974, 2851),
('Dodge', 'Challenger', 'R/T', 'rt', 'Challenger R/T', 1970, 1971, 3266),
('Dodge', 'Challenger', 'T/A', 'ta', 'Challenger T/A', 1970, 1970, 3450),
('Plymouth', 'Barracuda', 'Base', 'base', 'Barracuda', 1970, 1974, 2764),
('Plymouth', 'Barracuda', 'AAR', 'aar', 'AAR Barracuda', 1970, 1970, 3400),
('Plymouth', 'Cuda', 'Hemi', 'hemi', 'Hemi Cuda', 1970, 1971, 4295),
('Plymouth', 'Road Runner', 'Base', 'base', 'Road Runner', 1968, 1970, 2896),
('Plymouth', 'Road Runner', 'Superbird', 'superbird', 'Superbird', 1970, 1970, 4298),
('Dodge', 'Viper', 'RT/10', 'rt10', 'Viper RT/10', 1992, 1995, 50000),
('Dodge', 'Viper', 'GTS', 'gts', 'Viper GTS', 1996, 2002, 66200),
('Dodge', 'Viper', 'SRT-10', 'srt10', 'Viper SRT-10', 2003, 2010, 83795),
('Dodge', 'Viper', 'ACR', 'acr', 'Viper ACR', 2016, 2017, 117895),
('Dodge', 'Challenger', 'SRT Hellcat', 'hellcat', 'Challenger Hellcat', 2015, 2023, 59995),
('Dodge', 'Challenger', 'SRT Demon', 'demon', 'Challenger SRT Demon', 2018, 2018, 84995),
('Dodge', 'Challenger', 'SRT Demon 170', 'demon170', 'Challenger SRT Demon 170', 2023, 2023, 96666)
ON CONFLICT DO NOTHING;

-- ============================================================
-- PONTIAC GTO / FIREBIRD / TRANS AM
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Pontiac', 'GTO', 'Base', 'base', 'GTO', 1964, 1967, 2852),
('Pontiac', 'GTO', 'Judge', 'judge', 'GTO Judge', 1969, 1971, 3313),
('Pontiac', 'GTO', 'Base', 'base', 'GTO', 1968, 1972, 3101),
('Pontiac', 'Firebird', 'Base', 'base', 'Firebird', 1967, 1969, 2666),
('Pontiac', 'Firebird', '400', '400', 'Firebird 400', 1967, 1969, 2996),
('Pontiac', 'Firebird', 'Trans Am', 'trans_am', 'Firebird Trans Am', 1969, 1969, 3556),
('Pontiac', 'Firebird', 'Trans Am', 'trans_am', 'Firebird Trans Am', 1970, 1981, 4305),
('Pontiac', 'Firebird', 'Trans Am', 'trans_am', 'Firebird Trans Am', 1982, 1992, 12499)
ON CONFLICT DO NOTHING;

-- ============================================================
-- BMW M CARS
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('BMW', 'M3', 'E30 M3', 'e30', 'M3', 1988, 1991, 34950),
('BMW', 'M3', 'E36 M3', 'e36', 'M3', 1995, 1999, 35900),
('BMW', 'M3', 'E46 M3', 'e46', 'M3', 2001, 2006, 46500),
('BMW', 'M3', 'E90 M3', 'e90', 'M3 Sedan', 2008, 2013, 54400),
('BMW', 'M3', 'E92 M3', 'e92', 'M3 Coupe', 2008, 2013, 56500),
('BMW', 'M3', 'F80 M3', 'f80', 'M3', 2015, 2018, 62000),
('BMW', 'M3', 'G80 M3', 'g80', 'M3', 2021, 2025, 69900),
('BMW', 'M3', 'G80 M3 Competition', 'g80_comp', 'M3 Competition', 2021, 2025, 72800),
('BMW', 'M5', 'E28 M5', 'e28', 'M5', 1988, 1988, 47500),
('BMW', 'M5', 'E34 M5', 'e34', 'M5', 1991, 1993, 56500),
('BMW', 'M5', 'E39 M5', 'e39', 'M5', 2000, 2003, 69400),
('BMW', 'M5', 'E60 M5', 'e60', 'M5', 2006, 2010, 85800),
('BMW', 'M5', 'F10 M5', 'f10', 'M5', 2013, 2016, 93600),
('BMW', 'M5', 'F90 M5', 'f90', 'M5', 2018, 2023, 102700),
('BMW', 'Z8', 'Base', 'base', 'Z8', 2000, 2003, 128000),
('BMW', '2002', 'tii', 'tii', '2002tii', 1972, 1974, 4320),
('BMW', '2002', 'Turbo', 'turbo', '2002 Turbo', 1973, 1974, 6950),
('BMW', '2002', 'Base', 'base', '2002', 1968, 1976, 2850),
('BMW', 'M1', 'Base', 'base', 'M1', 1979, 1981, 100000),
('BMW', 'Z3', 'M Roadster', 'm', 'Z3 M Roadster', 1998, 2002, 42370),
('BMW', 'Z3', 'M Coupe', 'm_coupe', 'Z3 M Coupe', 1998, 2002, 42070),
('BMW', 'Z4', 'M', 'm', 'Z4 M', 2006, 2008, 46470),
('BMW', 'M2', 'F87 M2', 'f87', 'M2', 2016, 2021, 51700),
('BMW', 'M2', 'G87 M2', 'g87', 'M2', 2023, 2025, 62200)
ON CONFLICT DO NOTHING;

-- ============================================================
-- MERCEDES-BENZ AMG / CLASSIC
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Mercedes-Benz', '300SL', 'Gullwing', 'gullwing', '300SL Gullwing', 1954, 1957, 6820),
('Mercedes-Benz', '300SL', 'Roadster', 'roadster', '300SL Roadster', 1957, 1963, 10950),
('Mercedes-Benz', '190SL', 'Base', 'base', '190SL', 1955, 1963, 3998),
('Mercedes-Benz', 'SL', '280SL', 'w113', '280SL Pagoda', 1968, 1971, 8673),
('Mercedes-Benz', 'SL', '450SL', 'r107', '450SL', 1973, 1980, 13888),
('Mercedes-Benz', 'SL', '560SL', 'r107', '560SL', 1986, 1989, 48780),
('Mercedes-Benz', 'SL', 'SL500', 'r129', 'SL500', 1990, 2002, 86900),
('Mercedes-Benz', 'SL', 'SL55 AMG', 'r230', 'SL55 AMG', 2003, 2008, 117000),
('Mercedes-Benz', 'SL', 'SL65 AMG', 'r230', 'SL65 AMG', 2005, 2012, 186850),
('Mercedes-Benz', 'SLS AMG', 'Base', 'base', 'SLS AMG', 2011, 2014, 195825),
('Mercedes-Benz', 'SLS AMG', 'Black Series', 'black', 'SLS AMG Black Series', 2014, 2014, 275000),
('Mercedes-Benz', 'AMG GT', 'Base', 'base', 'AMG GT', 2016, 2021, 115900),
('Mercedes-Benz', 'AMG GT', 'GT R', 'gtr', 'AMG GT R', 2018, 2021, 162900),
('Mercedes-Benz', 'AMG GT', 'Black Series', 'black', 'AMG GT Black Series', 2021, 2022, 325000),
('Mercedes-Benz', 'G-Class', 'G63 AMG', 'g63', 'G63 AMG', 2013, 2025, 156450),
('Mercedes-Benz', 'G-Class', 'G500', 'g500', 'G500', 2002, 2012, 76870),
('Mercedes-Benz', 'C63 AMG', 'Sedan', 'sedan', 'C63 AMG', 2008, 2014, 59325),
('Mercedes-Benz', 'E63 AMG', 'Sedan', 'sedan', 'E63 AMG', 2007, 2016, 87900)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FERRARI
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Ferrari', '308', 'GTB', 'gtb', '308 GTB', 1976, 1985, 32000),
('Ferrari', '308', 'GTS', 'gts', '308 GTS', 1977, 1985, 34000),
('Ferrari', '328', 'GTB', 'gtb', '328 GTB', 1986, 1989, 58000),
('Ferrari', '328', 'GTS', 'gts', '328 GTS', 1986, 1989, 61000),
('Ferrari', '348', 'ts', 'ts', '348 ts', 1989, 1995, 97500),
('Ferrari', 'F355', 'Berlinetta', 'berlinetta', 'F355 Berlinetta', 1995, 1999, 134000),
('Ferrari', 'F355', 'Spider', 'spider', 'F355 Spider', 1995, 1999, 147000),
('Ferrari', '360', 'Modena', 'modena', '360 Modena', 1999, 2005, 150000),
('Ferrari', '360', 'Spider', 'spider', '360 Spider', 2001, 2005, 168000),
('Ferrari', '360', 'Challenge Stradale', 'cs', '360 Challenge Stradale', 2004, 2005, 175000),
('Ferrari', 'F430', 'Coupe', 'coupe', 'F430', 2005, 2009, 186925),
('Ferrari', 'F430', 'Spider', 'spider', 'F430 Spider', 2005, 2009, 207000),
('Ferrari', 'F430', 'Scuderia', 'scuderia', 'F430 Scuderia', 2008, 2009, 260000),
('Ferrari', '458', 'Italia', 'italia', '458 Italia', 2010, 2015, 230775),
('Ferrari', '458', 'Spider', 'spider', '458 Spider', 2012, 2015, 257412),
('Ferrari', '458', 'Speciale', 'speciale', '458 Speciale', 2014, 2015, 298000),
('Ferrari', '488', 'GTB', 'gtb', '488 GTB', 2016, 2019, 252800),
('Ferrari', '488', 'Spider', 'spider', '488 Spider', 2016, 2019, 280000),
('Ferrari', '488', 'Pista', 'pista', '488 Pista', 2019, 2020, 350000),
('Ferrari', 'F12', 'Berlinetta', 'berlinetta', 'F12 Berlinetta', 2013, 2017, 319995),
('Ferrari', '812', 'Superfast', 'superfast', '812 Superfast', 2018, 2022, 335275),
('Ferrari', 'Testarossa', 'Base', 'base', 'Testarossa', 1985, 1991, 87000),
('Ferrari', 'F40', 'Base', 'base', 'F40', 1988, 1992, 399150),
('Ferrari', 'F50', 'Base', 'base', 'F50', 1995, 1997, 478000),
('Ferrari', 'Enzo', 'Base', 'base', 'Enzo Ferrari', 2003, 2004, 659330),
('Ferrari', 'LaFerrari', 'Base', 'base', 'LaFerrari', 2014, 2016, 1416362),
('Ferrari', '550', 'Maranello', 'maranello', '550 Maranello', 1997, 2002, 204000),
('Ferrari', '575M', 'Maranello', 'maranello', '575M Maranello', 2002, 2006, 229000),
('Ferrari', '599', 'GTB Fiorano', 'gtb', '599 GTB Fiorano', 2007, 2012, 310543),
('Ferrari', 'California', 'Base', 'base', 'California', 2009, 2014, 198973)
ON CONFLICT DO NOTHING;

-- ============================================================
-- PORSCHE OTHER (356, 914, 944, 928, Boxster, Cayman)
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Porsche', '356', 'Coupe', 'base', '356 Coupe', 1950, 1955, 3395),
('Porsche', '356', 'Speedster', 'speedster', '356 Speedster', 1954, 1958, 2995),
('Porsche', '356A', 'Coupe', 'base', '356A Coupe', 1956, 1959, 3500),
('Porsche', '356B', 'Coupe', 'base', '356B Coupe', 1960, 1963, 3600),
('Porsche', '356C', 'Coupe', 'base', '356C Coupe', 1964, 1965, 4245),
('Porsche', '914', 'Base', 'base', '914 1.7', 1970, 1976, 3595),
('Porsche', '914', '914/6', '914_6', '914/6', 1970, 1972, 5999),
('Porsche', '944', 'Base', 'base', '944', 1983, 1991, 18450),
('Porsche', '944', 'Turbo', 'turbo', '944 Turbo', 1986, 1991, 29500),
('Porsche', '944', 'S2', 's2', '944 S2', 1989, 1991, 33500),
('Porsche', '928', 'Base', 'base', '928', 1978, 1982, 26000),
('Porsche', '928', 'S4', 's4', '928 S4', 1987, 1991, 54000),
('Porsche', '928', 'GTS', 'gts', '928 GTS', 1992, 1995, 82900),
('Porsche', '968', 'Base', 'base', '968', 1992, 1995, 39900),
('Porsche', 'Boxster', 'Base', 'base', 'Boxster 986', 1997, 2004, 39980),
('Porsche', 'Boxster', 'S', 's', 'Boxster S 986', 2000, 2004, 49930),
('Porsche', 'Cayman', 'Base', 'base', 'Cayman 987', 2006, 2012, 49400),
('Porsche', 'Cayman', 'S', 's', 'Cayman S 987', 2006, 2012, 58900),
('Porsche', 'Cayman', 'GT4', 'gt4', 'Cayman GT4', 2016, 2020, 85595),
('Porsche', 'Cayman', 'GT4 RS', 'gt4rs', 'Cayman GT4 RS', 2023, 2025, 143050),
('Porsche', 'Cayenne', 'Base', 'base', 'Cayenne', 2003, 2010, 41700),
('Porsche', 'Cayenne', 'Turbo', 'turbo', 'Cayenne Turbo', 2003, 2010, 89665),
('Porsche', 'Carrera GT', 'Base', 'base', 'Carrera GT', 2004, 2006, 440000),
('Porsche', '918', 'Spyder', 'base', '918 Spyder', 2014, 2015, 845000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- TOYOTA / LEXUS ENTHUSIAST
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Toyota', 'Supra', 'Turbo', 'turbo', 'Supra Turbo (A80)', 1993, 1998, 39900),
('Toyota', 'Supra', 'Base', 'base', 'Supra (A80)', 1993, 1998, 33900),
('Toyota', 'Supra', 'GR Supra', 'base', 'GR Supra (A90)', 2020, 2025, 49990),
('Toyota', 'MR2', 'Turbo', 'turbo', 'MR2 Turbo (SW20)', 1991, 1995, 23038),
('Toyota', 'MR2', 'Base', 'base', 'MR2 (AW11)', 1985, 1989, 10998),
('Toyota', 'Land Cruiser', 'FJ40', 'fj40', 'Land Cruiser FJ40', 1965, 1984, 3649),
('Toyota', 'Land Cruiser', 'FJ60', 'fj60', 'Land Cruiser FJ60', 1981, 1987, 12998),
('Toyota', 'Land Cruiser', 'FJ62', 'fj62', 'Land Cruiser FJ62', 1988, 1990, 19998),
('Toyota', 'Land Cruiser', '80 Series', '80', 'Land Cruiser (80 Series)', 1991, 1997, 34900),
('Toyota', 'Land Cruiser', '100 Series', '100', 'Land Cruiser (100 Series)', 1998, 2007, 48670),
('Toyota', 'AE86', 'GT-S', 'gts', 'Corolla GT-S (AE86)', 1984, 1987, 9588),
('Toyota', '2000GT', 'Base', 'base', '2000GT', 1967, 1970, 6800),
('Lexus', 'LFA', 'Base', 'base', 'LFA', 2012, 2012, 375000),
('Lexus', 'LC500', 'Base', 'base', 'LC500', 2018, 2025, 93050),
('Lexus', 'IS F', 'Base', 'base', 'IS F', 2008, 2014, 61000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- JAGUAR / ASTON MARTIN / BRITISH
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Jaguar', 'E-Type', 'Roadster', 'ots', 'E-Type OTS', 1961, 1968, 5595),
('Jaguar', 'E-Type', 'Coupe', 'fhc', 'E-Type FHC', 1961, 1968, 5895),
('Jaguar', 'E-Type', 'V12 Roadster', 'v12', 'E-Type V12 Roadster', 1971, 1975, 7200),
('Jaguar', 'XK120', 'Roadster', 'ots', 'XK120 OTS', 1949, 1954, 3345),
('Jaguar', 'XK140', 'Roadster', 'ots', 'XK140 OTS', 1955, 1957, 3480),
('Jaguar', 'XK150', 'Roadster', 'ots', 'XK150 OTS', 1957, 1961, 3980),
('Jaguar', 'XJ220', 'Base', 'base', 'XJ220', 1992, 1994, 580000),
('Jaguar', 'F-Type', 'Coupe', 'base', 'F-Type Coupe', 2014, 2024, 61600),
('Jaguar', 'F-Type', 'R', 'r', 'F-Type R', 2015, 2024, 103200),
('Aston Martin', 'DB5', 'Base', 'base', 'DB5', 1963, 1965, 5930),
('Aston Martin', 'DB6', 'Base', 'base', 'DB6', 1965, 1970, 6670),
('Aston Martin', 'V8 Vantage', 'Base', 'base', 'V8 Vantage', 2006, 2017, 119995),
('Aston Martin', 'DB9', 'Coupe', 'base', 'DB9', 2004, 2016, 186350),
('Aston Martin', 'DB11', 'V8', 'v8', 'DB11 V8', 2018, 2024, 198995),
('Aston Martin', 'DBS', 'Superleggera', 'base', 'DBS Superleggera', 2019, 2024, 316300)
ON CONFLICT DO NOTHING;

-- ============================================================
-- VOLKSWAGEN / AIR-COOLED
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Volkswagen', 'Beetle', 'Standard', 'base', 'Beetle', 1950, 1966, 1495),
('Volkswagen', 'Beetle', 'Deluxe', 'deluxe', 'Beetle Deluxe', 1950, 1966, 1595),
('Volkswagen', 'Beetle', 'Super Beetle', 'super', 'Super Beetle', 1971, 1979, 2199),
('Volkswagen', 'Beetle', 'Convertible', 'convertible', 'Beetle Convertible', 1950, 1979, 2095),
('Volkswagen', 'Bus', 'Standard', 'base', 'Type 2 Transporter', 1950, 1967, 2365),
('Volkswagen', 'Bus', 'Deluxe', 'deluxe', 'Type 2 Deluxe (Samba)', 1951, 1967, 2990),
('Volkswagen', 'Bus', 'Standard', 'base', 'Type 2 Bay Window', 1968, 1979, 2879),
('Volkswagen', 'Karmann Ghia', 'Coupe', 'base', 'Karmann Ghia', 1956, 1974, 2295),
('Volkswagen', 'Golf', 'GTI', 'gti', 'Golf GTI (Mk1)', 1983, 1984, 7990),
('Volkswagen', 'Golf', 'R32', 'r32', 'Golf R32 (Mk4)', 2004, 2004, 28150),
('Volkswagen', 'Golf', 'R', 'r', 'Golf R (Mk7)', 2015, 2021, 36595)
ON CONFLICT DO NOTHING;

-- ============================================================
-- JEEP / BRONCO / TRUCKS
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Jeep', 'CJ-5', 'Base', 'base', 'CJ-5', 1955, 1983, 2750),
('Jeep', 'CJ-7', 'Base', 'base', 'CJ-7', 1976, 1986, 5495),
('Jeep', 'Wrangler', 'Base', 'base', 'Wrangler YJ', 1987, 1995, 10295),
('Jeep', 'Wrangler', 'Base', 'base', 'Wrangler TJ', 1997, 2006, 15600),
('Jeep', 'Wrangler', 'Rubicon', 'rubicon', 'Wrangler Rubicon TJ', 2003, 2006, 25355),
('Jeep', 'Wrangler', 'Base', 'base', 'Wrangler JK', 2007, 2018, 23495),
('Jeep', 'Wrangler', 'Rubicon', 'rubicon', 'Wrangler Rubicon JK', 2007, 2018, 31095),
('Jeep', 'Wrangler', 'Base', 'base', 'Wrangler JL', 2018, 2025, 28975),
('Jeep', 'Wrangler', 'Rubicon 392', '392', 'Wrangler Rubicon 392', 2021, 2024, 74995),
('Jeep', 'Grand Cherokee', 'Trackhawk', 'trackhawk', 'Grand Cherokee Trackhawk', 2018, 2021, 86995),
('Ford', 'Bronco', 'Base', 'base', 'Bronco (1st Gen)', 1966, 1977, 2900),
('Ford', 'Bronco', 'Base', 'base', 'Bronco (6th Gen)', 2021, 2025, 29995),
('Ford', 'Bronco', 'Raptor', 'raptor', 'Bronco Raptor', 2022, 2025, 68500),
('Ford', 'F-150', 'Raptor', 'raptor', 'F-150 Raptor', 2010, 2014, 43350),
('Ford', 'F-150', 'Raptor', 'raptor', 'F-150 Raptor', 2017, 2025, 52855),
('Ford', 'F-150', 'Lightning', 'lightning', 'F-150 Lightning SVT', 1993, 1995, 21065),
('Ford', 'GT', 'Base', 'base', 'Ford GT', 2005, 2006, 150000),
('Ford', 'GT', 'Base', 'base', 'Ford GT', 2017, 2022, 450000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- NISSAN / DATSUN
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Datsun', '240Z', 'Base', 'base', '240Z', 1970, 1973, 3526),
('Datsun', '260Z', 'Base', 'base', '260Z', 1974, 1974, 4399),
('Datsun', '280Z', 'Base', 'base', '280Z', 1975, 1978, 5499),
('Datsun', '280ZX', 'Base', 'base', '280ZX', 1979, 1983, 7499),
('Nissan', '300ZX', 'Turbo', 'turbo', '300ZX Twin Turbo', 1990, 1996, 33600),
('Nissan', '300ZX', 'Base', 'base', '300ZX', 1990, 1996, 28600),
('Nissan', 'GT-R', 'Base', 'base', 'GT-R', 2009, 2024, 99590),
('Nissan', 'GT-R', 'NISMO', 'nismo', 'GT-R NISMO', 2015, 2024, 175490),
('Nissan', 'Skyline GT-R', 'R32', 'r32', 'Skyline GT-R R32', 1989, 1994, 40000),
('Nissan', 'Skyline GT-R', 'R34', 'r34', 'Skyline GT-R R34', 1999, 2002, 55000),
('Nissan', 'Silvia', 'S15', 's15', 'Silvia S15', 1999, 2002, 22000),
('Nissan', 'Z', 'Base', 'base', 'Nissan Z (RZ34)', 2023, 2025, 41015),
('Nissan', '370Z', 'NISMO', 'nismo', '370Z NISMO', 2009, 2020, 43560)
ON CONFLICT DO NOTHING;

-- ============================================================
-- HONDA / ACURA
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Honda', 'NSX', 'Base', 'base', 'NSX (NA1)', 1991, 2005, 60600),
('Honda', 'NSX', 'Type R', 'type_r', 'NSX-R', 2002, 2005, 89000),
('Honda', 'S2000', 'Base', 'base', 'S2000 (AP1)', 2000, 2003, 32000),
('Honda', 'S2000', 'Base', 'base', 'S2000 (AP2)', 2004, 2009, 33000),
('Honda', 'S2000', 'CR', 'cr', 'S2000 CR', 2008, 2009, 36000),
('Honda', 'Civic', 'Type R', 'type_r', 'Civic Type R (FK8)', 2017, 2021, 34700),
('Honda', 'Civic', 'Type R', 'type_r', 'Civic Type R (FL5)', 2023, 2025, 42895),
('Honda', 'Integra', 'Type R', 'type_r', 'Integra Type R (DC2)', 1997, 2001, 24350),
('Acura', 'NSX', 'Base', 'base', 'NSX (NC1)', 2017, 2022, 157500),
('Acura', 'NSX', 'Type S', 'type_s', 'NSX Type S', 2022, 2022, 169950)
ON CONFLICT DO NOTHING;

-- ============================================================
-- LAMBORGHINI
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Lamborghini', 'Countach', 'LP400', 'lp400', 'Countach LP400', 1974, 1978, 52000),
('Lamborghini', 'Countach', 'LP400S', 'lp400s', 'Countach LP400S', 1978, 1982, 69000),
('Lamborghini', 'Countach', 'LP5000 QV', 'qv', 'Countach QV', 1985, 1988, 99000),
('Lamborghini', 'Countach', '25th Anniversary', '25th', 'Countach 25th Anniversary', 1988, 1990, 118000),
('Lamborghini', 'Miura', 'P400', 'p400', 'Miura P400', 1966, 1969, 20000),
('Lamborghini', 'Miura', 'SV', 'sv', 'Miura SV', 1971, 1973, 25000),
('Lamborghini', 'Diablo', 'Base', 'base', 'Diablo', 1990, 1998, 211000),
('Lamborghini', 'Diablo', 'VT', 'vt', 'Diablo VT', 1993, 2000, 239000),
('Lamborghini', 'Murcielago', 'Coupe', 'base', 'Murcielago', 2002, 2010, 279000),
('Lamborghini', 'Murcielago', 'LP670-4 SV', 'sv', 'Murcielago SV', 2010, 2010, 450000),
('Lamborghini', 'Gallardo', 'Coupe', 'base', 'Gallardo', 2004, 2014, 175000),
('Lamborghini', 'Gallardo', 'Superleggera', 'sl', 'Gallardo Superleggera', 2007, 2008, 214000),
('Lamborghini', 'Huracan', 'LP610-4', 'base', 'Huracan', 2015, 2024, 237250),
('Lamborghini', 'Huracan', 'Performante', 'performante', 'Huracan Performante', 2018, 2020, 274390),
('Lamborghini', 'Huracan', 'STO', 'sto', 'Huracan STO', 2021, 2023, 327838),
('Lamborghini', 'Aventador', 'LP700-4', 'base', 'Aventador', 2012, 2022, 379700),
('Lamborghini', 'Aventador', 'SVJ', 'svj', 'Aventador SVJ', 2019, 2022, 517770)
ON CONFLICT DO NOTHING;

-- ============================================================
-- LAND ROVER / DEFENDER
-- ============================================================
INSERT INTO oem_trim_levels (make, model_family, trim_name, trim_level, marketing_name, year_start, year_end, base_msrp_usd) VALUES
('Land Rover', 'Defender', '90', '90', 'Defender 90 (Classic)', 1993, 1997, 29650),
('Land Rover', 'Defender', '110', '110', 'Defender 110 (Classic)', 1993, 1997, 32150),
('Land Rover', 'Defender', '90', '90', 'Defender 90 (New)', 2020, 2025, 49900),
('Land Rover', 'Defender', '110', '110', 'Defender 110 (New)', 2020, 2025, 53500),
('Land Rover', 'Defender', 'V8', 'v8', 'Defender V8', 2022, 2025, 99800),
('Land Rover', 'Range Rover', 'Classic', 'base', 'Range Rover Classic', 1970, 1995, 42850),
('Land Rover', 'Range Rover', 'Base', 'base', 'Range Rover (P38)', 1995, 2002, 59925),
('Land Rover', 'Range Rover', 'Sport SVR', 'svr', 'Range Rover Sport SVR', 2015, 2022, 111000),
('Land Rover', 'Discovery', 'Series I', 'base', 'Discovery', 1994, 1998, 28795)
ON CONFLICT DO NOTHING;

-- Update row count
DO $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM oem_trim_levels WHERE base_msrp_usd IS NOT NULL;
  RAISE NOTICE 'Total OEM trim levels with MSRP: %', cnt;
END $$;
