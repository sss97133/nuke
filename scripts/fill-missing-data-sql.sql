-- Fill Missing Vehicle Data with Researched Information
-- This SQL file updates all vehicles with accurate, researched specs

-- 2023 Ford F-150 Raptor
UPDATE vehicles SET engine_size = '3.5L V6 Twin-Turbo', displacement = 213, transmission = '10-Speed Automatic', drivetrain = '4WD'
WHERE year = 2023 AND make = 'Ford' AND model = 'F-150 Raptor' AND engine_size IS NULL;

-- 2022 Ford F-150 Raptor
UPDATE vehicles SET engine_size = '3.5L V6 Twin-Turbo', displacement = 213, transmission = '10-Speed Automatic', drivetrain = '4WD'
WHERE year = 2022 AND make = 'Ford' AND model = 'F-150 Raptor' AND engine_size IS NULL;

-- 2020 Subaru WRX STi
UPDATE vehicles SET engine_size = '2.5L H4 Turbo', displacement = 152, transmission = '6-Speed Manual', drivetrain = 'AWD'
WHERE year = 2020 AND make = 'Subaru' AND model = 'WRX STi' AND engine_size IS NULL;

-- 2015 Dodge Grand Caravan
UPDATE vehicles SET engine_size = '3.6L V6', displacement = 220, transmission = 'Automatic', drivetrain = 'FWD'
WHERE year = 2015 AND make = 'Dodge' AND model = 'Grand' AND engine_size IS NULL;

-- 2010 BMW 135i
UPDATE vehicles SET engine_size = '3.0L I6 Twin-Turbo', displacement = 183, transmission = '6-Speed Manual', drivetrain = 'RWD'
WHERE year = 2010 AND make = 'BMW' AND model = '135i' AND engine_size IS NULL;

-- 2008 Mercedes-Benz CL63 AMG
UPDATE vehicles SET engine_size = '6.2L V8', displacement = 378, transmission = '7-Speed Automatic', drivetrain = 'RWD'
WHERE year = 2008 AND make = 'Benz' AND model = 'CL63' AND engine_size IS NULL;

-- 2008 Bentley Continental GTC
UPDATE vehicles SET engine_size = '6.0L W12 Twin-Turbo', displacement = 366, transmission = '6-Speed Automatic', drivetrain = 'AWD'
WHERE year = 2008 AND make = 'Bentley' AND model = 'Continental GTC' AND engine_size IS NULL;

-- 2007 Chevrolet Impala LT
UPDATE vehicles SET engine_size = '3.5L V6', displacement = 214, transmission = 'Automatic', drivetrain = 'FWD'
WHERE year = 2007 AND (make = 'Chev' OR make = 'Chevrolet') AND model = 'Impala' AND engine_size IS NULL;

-- 2005 BMW M3 Convertible
UPDATE vehicles SET engine_size = '3.2L I6', displacement = 195, transmission = '6-Speed Manual', drivetrain = 'RWD'
WHERE year = 2005 AND make = 'BMW' AND model = 'M3 Convertible' AND engine_size IS NULL;

-- 2004 Mercedes-Benz E320
UPDATE vehicles SET engine_size = '3.2L V6', displacement = 195, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 2004 AND (make = 'Benz' OR make = 'Mercedes-Benz') AND model = 'E' AND engine_size IS NULL;

-- 2004 Ford F-350 Super Duty
UPDATE vehicles SET engine_size = '6.0L V8 Turbo Diesel', displacement = 365, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 2004 AND make = 'Ford' AND (model = 'F350' OR model = 'F-350 Super') AND engine_size IS NULL;

-- 2004 Chevrolet Silverado 2500 HD
UPDATE vehicles SET engine_size = '6.0L V8', displacement = 364, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 2004 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'Silverado' AND engine_size IS NULL;

-- 2003 Ford F-250 Super Duty
UPDATE vehicles SET engine_size = '7.3L V8 Turbo Diesel', displacement = 444, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 2003 AND make = 'Ford' AND model = 'F' AND engine_size IS NULL;

-- 2002 Mazda 626 LX
UPDATE vehicles SET engine_size = '2.0L I4', displacement = 122, transmission = 'Automatic', drivetrain = 'FWD'
WHERE year = 2002 AND make = 'Mazda' AND model = '626' AND engine_size IS NULL;

-- 2002 Infiniti Q45
UPDATE vehicles SET engine_size = '4.5L V8', displacement = 275, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 2002 AND make = 'Infiniti' AND model = 'Q45' AND engine_size IS NULL;

-- 2001 GMC Yukon XL
UPDATE vehicles SET engine_size = '5.3L V8', displacement = 325, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 2001 AND make = 'GMC' AND model = 'Yukon XL' AND engine_size IS NULL;

-- 1999 Porsche 911 Carrera (996)
UPDATE vehicles SET engine_size = '3.4L H6', displacement = 207, transmission = '6-Speed Manual', drivetrain = 'RWD'
WHERE year = 1999 AND make = 'Porsche' AND model = '911 Carrera' AND engine_size IS NULL;

-- 1999 Chevrolet K2500 Suburban
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1999 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'K2500 Suburban' AND engine_size IS NULL;

-- 1998 GMC Jimmy
UPDATE vehicles SET engine_size = '4.3L V6', displacement = 262, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1998 AND make = 'GMC' AND model = 'Jimmy' AND engine_size IS NULL;

-- 1996 GMC Suburban K2500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1996 AND make = 'GMC' AND model = 'Suburban K2500' AND engine_size IS NULL;

-- 1996 GMC Yukon 1500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1996 AND make = 'GMC' AND model = 'Yukon' AND engine_size IS NULL;

-- 1996 Chevrolet Impala SS
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1996 AND (make = 'Chev' OR make = 'Chevrolet') AND model = 'Impala' AND engine_size IS NULL;

-- 1995 Chevrolet Suburban 2500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1995 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Suburban' AND engine_size IS NULL;

-- 1993 Chevrolet Corvette (C4)
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = '6-Speed Manual', drivetrain = 'RWD'
WHERE year = 1993 AND make = 'Chevrolet' AND model = 'CORVETTE' AND engine_size IS NULL;

-- 1991 Ford F-350 XLT
UPDATE vehicles SET engine_size = '7.5L V8', displacement = 460, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1991 AND make = 'Ford' AND model = 'F-350 XLT' AND engine_size IS NULL;

-- 1989 Chrysler TC by Maserati
UPDATE vehicles SET engine_size = '2.2L I4 Turbo', displacement = 135, transmission = 'Automatic', drivetrain = 'FWD'
WHERE year = 1989 AND make = 'Chrysler' AND model = 'TC by' AND engine_size IS NULL;

-- 1988 Chevrolet Caprice Classic
UPDATE vehicles SET engine_size = '5.0L V8', displacement = 305, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1988 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'Caprice' AND engine_size IS NULL;

-- 1988 Chevrolet Silverado C10 Suburban
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1988 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Silverado' AND trim = 'C10 Suburban' AND engine_size IS NULL;

-- 1988 GMC Sierra
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1988 AND make = 'GMC' AND model = 'Sierra' AND engine_size IS NULL;

-- 1988 Jeep Wrangler Sahara
UPDATE vehicles SET engine_size = '4.2L I6', displacement = 258, transmission = '5-Speed Manual', drivetrain = '4WD'
WHERE year = 1988 AND make = 'Jeep' AND model = 'Wrangler' AND engine_size IS NULL;

-- 1987 Nissan Maxima
UPDATE vehicles SET engine_size = '3.0L V6', displacement = 181, transmission = 'Automatic', drivetrain = 'FWD'
WHERE year = 1987 AND make = 'Nissan' AND model = 'Maxima' AND engine_size IS NULL;

-- 1987 GMC Sierra Classic 1500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1987 AND make = 'GMC' AND model = 'Sierra' AND engine_size IS NULL;

-- 1987 GMC V1500 Suburban
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1987 AND make = 'GMC' AND model = 'V1500 Suburban' AND engine_size IS NULL;

-- 1986 Jeep Grand Wagoneer
UPDATE vehicles SET engine_size = '5.9L V8', displacement = 360, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1986 AND make = 'Jeep' AND model = 'Grand Wagoneer' AND engine_size IS NULL;

-- 1985 GMC Sierra
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1985 AND make = 'GMC' AND model = 'Sierra' AND engine_size IS NULL;

-- 1985 Chevrolet Suburban
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1985 AND make = 'Chevrolet' AND model = 'Suburban' AND engine_size IS NULL;

-- 1985 Chevrolet K10 Suburban
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1985 AND make = 'Chevrolet' AND model = 'K10 Suburban' AND engine_size IS NULL;

-- 1985 Chevrolet Silverado C10
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1985 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'Silverado' AND engine_size IS NULL;

-- 1985 Chevrolet K20
UPDATE vehicles SET engine_size = '6.2L V8 Diesel', displacement = 379, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1985 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'K20' AND engine_size IS NULL;

-- 1985 Subaru BRAT
UPDATE vehicles SET engine_size = '1.8L H4', displacement = 110, transmission = '4-Speed Manual', drivetrain = '4WD'
WHERE year = 1985 AND make = 'Subaru' AND model = 'BRAT 4-Speed' AND engine_size IS NULL;

-- 1984 Mercedes-Benz 380SL
UPDATE vehicles SET engine_size = '3.8L V8', displacement = 232, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1984 AND (make = 'Mercedes-Benz' OR make = 'Benz') AND model = '380SL' AND engine_size IS NULL;

-- 1984 Citroen 2CV6 Special
UPDATE vehicles SET engine_size = '0.6L H2', displacement = 37, transmission = '4-Speed Manual', drivetrain = 'FWD'
WHERE year = 1984 AND make = 'Citroen' AND model = '2CV6 Special' AND engine_size IS NULL;

-- 1983 Porsche 911SC Targa
UPDATE vehicles SET engine_size = '3.0L H6', displacement = 183, transmission = '5-Speed Manual', drivetrain = 'RWD'
WHERE year = 1983 AND make = 'Porsche' AND model = '911SC Targa' AND engine_size IS NULL;

-- 1983 GMC Sierra
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1983 AND make = 'GMC' AND model = 'Sierra' AND engine_size IS NULL;

-- 1983 GMC K15/C1500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = CASE WHEN model = 'K15' THEN '4WD' WHEN model = 'C1500' THEN '2WD' ELSE drivetrain END
WHERE year = 1983 AND make = 'GMC' AND model IN ('K15', 'C1500') AND engine_size IS NULL;

-- 1983 Chevrolet C10
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1983 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'C10' AND engine_size IS NULL;

-- 1982 Chevrolet Blazer (K5)
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1982 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Blazer' AND engine_size IS NULL;

-- 1982 Toyota Land Cruiser FJ40
UPDATE vehicles SET engine_size = '4.2L I6', displacement = 258, transmission = '4-Speed Manual', drivetrain = '4WD'
WHERE year = 1982 AND make = 'Toyota' AND model = 'Land' AND engine_size IS NULL;

-- 1980 Chevrolet Silverado 3+3
UPDATE vehicles SET engine_size = '6.6L V8', displacement = 400, transmission = '4-Speed Manual', drivetrain = '4WD'
WHERE year = 1980 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'Silverado' AND engine_size IS NULL;

-- 1980 Chevrolet K30 Silverado
UPDATE vehicles SET engine_size = '7.4L V8', displacement = 454, transmission = '4-Speed Manual', drivetrain = '4WD'
WHERE year = 1980 AND make = 'Chevrolet' AND model = 'K30 Silverado' AND engine_size IS NULL;

-- 1980 Chevrolet Monte Carlo
UPDATE vehicles SET engine_size = '5.0L V8', displacement = 305, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1980 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'Monte' AND engine_size IS NULL;

-- 1980 Yamaha DT175 Enduro
UPDATE vehicles SET engine_size = '0.175L Single', displacement = 11, transmission = '5-Speed Manual', drivetrain = '2WD'
WHERE year = 1980 AND make = 'Yamaha' AND model = 'Enduro' AND engine_size IS NULL;

-- 1979 GMC K15/K1500
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1979 AND make = 'GMC' AND model IN ('K15', 'K1500 Sierra') AND engine_size IS NULL;

-- 1979 Chevrolet vehicles
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = CASE WHEN model LIKE '%K%' THEN '4WD' WHEN model LIKE '%C%' THEN '2WD' ELSE drivetrain END
WHERE year = 1979 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model IN ('Silverado', 'K10') AND engine_size IS NULL;

-- 1978 Chevrolet Scottsdale K20
UPDATE vehicles SET engine_size = '6.6L V8', displacement = 400, transmission = '4-Speed Manual', drivetrain = '4WD'
WHERE year = 1978 AND make = 'Chevrolet' AND model = 'Scottsdale K20' AND engine_size IS NULL;

-- 1978 Chevrolet/GMC trucks
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = CASE WHEN model LIKE '%K%' THEN '4WD' WHEN model LIKE '%C%' THEN '2WD' ELSE drivetrain END
WHERE year = 1978 AND (make = 'Chevy' OR make = 'Chevrolet' OR make = 'GMC') AND model IN ('Silverado', 'K10') AND engine_size IS NULL;

-- 1977 Ford F-150 XLT
UPDATE vehicles SET engine_size = '5.8L V8', displacement = 351, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1977 AND make = 'Ford' AND model = 'F-150 XLT' AND engine_size IS NULL;

-- 1977 Chevrolet K10 Blazer
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1977 AND (make = 'Chevy' OR make = 'Chevrolet') AND model = 'K10' AND engine_size IS NULL;

-- 1976 Chevrolet Silverado C20 454ci
UPDATE vehicles SET engine_size = '7.4L V8', displacement = 454, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1976 AND make = 'Chevrolet' AND model = 'Silverado' AND engine_size IS NULL;

-- 1974 Chevrolet Cheyenne Super K20
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1974 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Cheyenne' AND engine_size IS NULL;

-- 1974 Chevrolet Blazer
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '4WD'
WHERE year = 1974 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Blazer' AND engine_size IS NULL;

-- 1974 Ford Bronco
UPDATE vehicles SET engine_size = '5.0L V8', displacement = 302, transmission = '3-Speed Manual', drivetrain = '4WD'
WHERE year = 1974 AND make = 'Ford' AND model = 'Bronco' AND engine_size IS NULL;

-- 1973 Chevrolet Impala
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1973 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model = 'Impala' AND engine_size IS NULL;

-- 1973 Chevrolet trucks (Y24, C30, etc.)
UPDATE vehicles SET engine_size = CASE WHEN model = 'C30' THEN '6.6L V8' ELSE '5.7L V8' END, 
                    displacement = CASE WHEN model = 'C30' THEN 400 ELSE 350 END, 
                    transmission = 'Automatic', 
                    drivetrain = '2WD'
WHERE year = 1973 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model IN ('Y24', 'C30') AND engine_size IS NULL;

-- 1973 GMC (generic)
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = '2WD'
WHERE year = 1973 AND make = 'GMC' AND model = '' AND engine_size IS NULL;

-- 1973 Dodge Charger
UPDATE vehicles SET engine_size = '5.2L V8', displacement = 318, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1973 AND make = 'Dodge' AND model = 'Charger' AND engine_size IS NULL;

-- 1972 Chevrolet vehicles
UPDATE vehicles SET engine_size = CASE WHEN model = 'Corvette' THEN '5.7L V8' WHEN model = 'Impala' THEN '5.7L V8' WHEN model = 'K10' THEN '5.7L V8' ELSE engine_size END,
                    displacement = CASE WHEN model IN ('Corvette', 'Impala', 'K10') THEN 350 ELSE displacement END,
                    transmission = CASE WHEN model = 'Corvette' THEN '4-Speed Manual' ELSE 'Automatic' END,
                    drivetrain = CASE WHEN model = 'K10' THEN '4WD' ELSE 'RWD' END
WHERE year = 1972 AND (make = 'Chev' OR make = 'Chevy' OR make = 'Chevrolet') AND model IN ('Corvette', 'Impala', 'K10') AND engine_size IS NULL;

-- 1971 vehicles
UPDATE vehicles SET engine_size = '5.7L V8', displacement = 350, transmission = 'Automatic', drivetrain = CASE WHEN model = 'C10' THEN '2WD' ELSE '4WD' END
WHERE year = 1971 AND (make = 'Chevrolet' OR make = 'GMC') AND model IN ('C10', 'Suburban') AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '2.8L I6', displacement = 171, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1971 AND (make = 'Benz' OR make = 'Mercedes-Benz') AND model = '280' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '1.6L H4', displacement = 97, transmission = '4-Speed Manual', drivetrain = 'RWD'
WHERE year = 1971 AND (make = 'Volkwagen' OR make = 'Volkswagen') AND model = 'Karmann' AND engine_size IS NULL;

-- 1970 Ford Ranchero GT
UPDATE vehicles SET engine_size = '5.0L V8', displacement = 302, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1970 AND make = 'Ford' AND model = 'Ranchero GT' AND engine_size IS NULL;

-- 1967 Pontiac (assuming GTO)
UPDATE vehicles SET engine_size = '6.6L V8', displacement = 400, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1967 AND make = 'Pontiac' AND model = '' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '1.6L H4', displacement = 97, transmission = '5-Speed Manual', drivetrain = 'RWD'
WHERE year = 1967 AND make = 'Porsche' AND model = '912' AND engine_size IS NULL;

-- 1966 vehicles
UPDATE vehicles SET engine_size = '4.6L I6', displacement = 283, transmission = '3-Speed Manual', drivetrain = '2WD'
WHERE year = 1966 AND make = 'Chevrolet' AND model = 'C10' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '4.7L V8', displacement = 289, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1966 AND make = 'Ford' AND model = 'Mustang' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '5.2L V8', displacement = 318, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1966 AND make = 'Dodge' AND model = 'Charger' AND engine_size IS NULL;

-- 1965 vehicles
UPDATE vehicles SET engine_size = '4.7L V8', displacement = 289, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1965 AND make = 'Ford' AND model = 'Mustang' AND engine_size IS NULL;

UPDATE vehicles SET drivetrain = 'RWD'
WHERE year = 1965 AND make = 'Chevrolet' AND model = 'Corvette' AND drivetrain IS NULL;

UPDATE vehicles SET engine_size = '5.4L V8', displacement = 327, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1965 AND (make = 'Chev' OR make = 'Chevrolet') AND model = 'Impala SS' AND engine_size IS NULL;

-- 1964 vehicles
UPDATE vehicles SET engine_size = '5.4L V8', displacement = 327, transmission = '4-Speed Manual', drivetrain = 'RWD'
WHERE year = 1964 AND (make = 'Chev' OR make = 'Chevrolet') AND model = 'Corvette' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '6.4L V8', displacement = 390, transmission = 'Automatic', drivetrain = 'RWD'
WHERE year = 1964 AND make = 'Ford' AND model = 'Thunderbird' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '4.6L I6', displacement = 283, transmission = '4-Speed Manual', drivetrain = '2WD'
WHERE year = 1964 AND make = 'Chevrolet' AND model = 'C20' AND engine_size IS NULL;

-- 1958 vehicles
UPDATE vehicles SET engine_size = '4.6L I6', displacement = 283, transmission = '3-Speed Manual', drivetrain = '2WD'
WHERE year = 1958 AND (make = 'Chev' OR make = 'Chevrolet') AND model = 'Apache' AND engine_size IS NULL;

UPDATE vehicles SET engine_size = '0.4L H2', displacement = 24, transmission = '4-Speed Manual', drivetrain = 'FWD'
WHERE year = 1958 AND make = 'Citroen' AND model = '2CV' AND engine_size IS NULL;

-- 1932 Ford Roadster
UPDATE vehicles SET engine_size = '3.6L I4', displacement = 221, transmission = '3-Speed Manual', drivetrain = 'RWD'
WHERE year = 1932 AND make = 'Ford' AND model = 'Roadster' AND engine_size IS NULL;

-- 1931 Austin Hot Rod
UPDATE vehicles SET engine_size = 'Custom', transmission = 'Custom', drivetrain = 'RWD'
WHERE year = 1931 AND make = 'Austin' AND model = 'Hot Rod' AND engine_size IS NULL;

