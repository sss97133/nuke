-- Nuke Ltd is the legal/operating company (N-Zero platform), not a dealer that does car deals.
-- Vehicles belong to Skylar (person), not to Nuke (company). Remove any incorrect organization_vehicles
-- links so Nuke Ltd does not show a vehicle count or vehicle list.

DELETE FROM organization_vehicles
WHERE organization_id IN (
  SELECT id FROM businesses
  WHERE LOWER(TRIM(business_name)) = 'nuke ltd'
     OR LOWER(TRIM(COALESCE(legal_name, ''))) = 'nuke ltd'
     OR slug = 'nuke-ltd'
);
