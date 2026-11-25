-- Retires what 20261126191300 added. It duplicated vehicle_decode_rules, which already holds
-- the 1973 Firebird VIN rules (vin_engine_char, vin_series_char, vin_body_code, vin_plant_char,
-- vin_format) and the production table (model_production / 1973_firebird), with citations.
-- One rule store, not two.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP VIEW IF EXISTS public.v_vin_position_decode;
DROP TABLE IF EXISTS public.vin_position_rules;

DELETE FROM public.vehicle_production_data
WHERE make = 'Pontiac' AND model = 'Firebird' AND year = 1973
  AND data_source = 'tran-zam.com 1973 Firebirds production tables'
  AND verified_by = 'source page read 2026-11-25';
