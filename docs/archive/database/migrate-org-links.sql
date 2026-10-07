-- Migrate organization_vehicles from duplicate businesses IDs to canonical organization IDs
-- Run this via supabase db execute or psql

-- First, ensure canonical IDs exist in businesses table (already done via API)

-- PCarMarket: all duplicates -> 2a2494ae-cc22-4300-accb-24ed9a054663
UPDATE organization_vehicles
SET organization_id = '2a2494ae-cc22-4300-accb-24ed9a054663'
WHERE organization_id IN (
  'd3bd67bb-0c19-4304-8a6b-89d384328eac',
  'f7c80592-6725-448d-9b32-2abf3e011cf8'
);

-- Cars and Bids: all duplicates -> 4dac1878-b3fc-424c-9e92-3cf552f1e053
UPDATE organization_vehicles
SET organization_id = '4dac1878-b3fc-424c-9e92-3cf552f1e053'
WHERE organization_id IN (
  'c124e282-a99c-4c9a-971d-65a0ddc03224',
  '822cae29-f80e-4859-9c48-a1485a543152'
);

-- Bring a Trailer: all duplicates -> d2bd6370-11d1-4af0-8dd2-3de2c3899166
UPDATE organization_vehicles
SET organization_id = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'
WHERE organization_id IN (
  '222375e1-901e-4a2c-a254-4e412f0e2a56',
  '3c0c5a1e-4836-430b-822d-585c70ad6dc1',
  '04ded0e8-e31e-4200-bf91-ed5f4fc6af4b',
  '93dfd8f8-0eaf-4fd1-b47a-24d5a8fd7965',
  'bd035ea4-75f0-4b17-ad02-aee06283343f',
  'e1f3c01f-e5e9-47b1-add6-9f7359ba0857'
);

-- SBX Cars: all duplicates -> a35b59b1-0e64-437c-953d-24a6f5bb17c6
UPDATE organization_vehicles
SET organization_id = 'a35b59b1-0e64-437c-953d-24a6f5bb17c6'
WHERE organization_id IN (
  '37b84b5e-ee28-410a-bea5-8d4851e39525',
  '23a897dc-7fb3-4464-bae3-2f92e801abb2'
);

-- Verify results
SELECT
  b.business_name,
  COUNT(*) as vehicle_count
FROM organization_vehicles ov
JOIN businesses b ON b.id = ov.organization_id
WHERE ov.organization_id IN (
  '2a2494ae-cc22-4300-accb-24ed9a054663',  -- PCarMarket
  '4dac1878-b3fc-424c-9e92-3cf552f1e053',  -- C&B
  'd2bd6370-11d1-4af0-8dd2-3de2c3899166',  -- BaT
  'a35b59b1-0e64-437c-953d-24a6f5bb17c6'   -- SBX
)
GROUP BY b.business_name
ORDER BY vehicle_count DESC;
