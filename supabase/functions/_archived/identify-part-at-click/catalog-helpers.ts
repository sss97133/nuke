/**
 * Catalog Helper Functions
 * 
 * Gets relevant catalog parts for AI to reference during identification
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

export async function getCatalogPartsForSystem(
  vehicleContext: string,
  system: string,
  componentType: string
): Promise<any[]> {
  // Map system to catalog categories
  const categoryMap: Record<string, string[]> = {
    'brake_system': ['brake', 'master cylinder', 'brake line', 'wheel cylinder', 'brake booster'],
    'cooling': ['radiator', 'water pump', 'thermostat', 'hose', 'fan'],
    'electrical': ['alternator', 'battery', 'starter', 'wiring', 'fuse'],
    'fuel': ['carburetor', 'fuel pump', 'fuel line', 'fuel tank'],
    'exhaust': ['exhaust manifold', 'muffler', 'catalytic converter', 'exhaust pipe'],
    'suspension': ['shock', 'spring', 'control arm', 'ball joint', 'tie rod'],
    'body_panels': ['fender', 'hood', 'door', 'bumper', 'grille', 'headlight']
  };

  const searchTerms = categoryMap[system] || [componentType];

  // Query catalog for matching parts
  const { data: catalogParts } = await supabase
    .from('part_catalog')
    .select('*')
    .or(searchTerms.map(term => `part_name.ilike.%${term}%`).join(','))
    .limit(20);

  if (catalogParts && catalogParts.length > 0) {
    return catalogParts;
  }

  // Fallback: Return common parts for this vehicle type
  return getCommonPartsForVehicle(vehicleContext, system);
}

function getCommonPartsForVehicle(vehicleContext: string, system: string): any[] {
  // Hardcoded common parts database (for when catalog is empty)
  const commonParts: Record<string, any[]> = {
    'brake_system': [
      { part_name: 'Master Cylinder', oem_part_number: 'GM-MC-15643918', part_description: 'Black cylinder with reservoir, mounts on firewall' },
      { part_name: 'Brake Booster', oem_part_number: 'GM-BB-25010743', part_description: 'Large round canister behind master cylinder' },
      { part_name: 'Proportioning Valve', oem_part_number: 'GM-PV-19209419', part_description: 'Small brass valve near frame' }
    ],
    'cooling': [
      { part_name: 'Radiator', oem_part_number: 'GM-RAD-3010329', part_description: 'Front-mounted heat exchanger' },
      { part_name: 'Water Pump', oem_part_number: 'GM-WP-14048041', part_description: 'Bolted to engine block, driven by belt' },
      { part_name: 'Thermostat Housing', oem_part_number: 'GM-TH-10105117', part_description: 'Chrome or painted housing on intake manifold' }
    ],
    'electrical': [
      { part_name: 'Alternator', oem_part_number: 'GM-ALT-10463152', part_description: 'Belt-driven generator on engine side' },
      { part_name: 'Battery', oem_part_number: 'GM-BATT-AC-DELCO', part_description: 'Black or red top battery in tray' },
      { part_name: 'Starter', oem_part_number: 'GM-STR-10465423', part_description: 'Cylindrical motor on engine block' }
    ],
    'fuel': [
      { part_name: 'Carburetor', oem_part_number: 'GM-CARB-17059614', part_description: 'Quadrajet 4-barrel on intake manifold' },
      { part_name: 'Fuel Pump', oem_part_number: 'GM-FP-6472268', part_description: 'Mechanical pump on engine block' },
      { part_name: 'Fuel Filter', oem_part_number: 'GM-FF-25116871', part_description: 'Inline canister filter' }
    ],
    'body_panels': [
      { part_name: 'Hood', oem_part_number: 'GM-HOOD-14048959', part_description: 'Front opening panel, steel or fiberglass' },
      { part_name: 'Front Bumper', oem_part_number: 'GM-BMP-15571692', part_description: 'Chrome steel bumper with brackets' },
      { part_name: 'Grille', oem_part_number: 'GM-GRL-14024372', part_description: 'Chrome or painted plastic grille' },
      { part_name: 'Headlight Assembly', oem_part_number: 'GM-HL-5968831', part_description: 'Square sealed beam unit' }
    ]
  };

  return commonParts[system] || [];
}

