import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Canonical make names — from → to
const NORMALIZATIONS = {
  // Lowercase → proper case
  'chevrolet': 'Chevrolet',
  'ford': 'Ford',
  'cadillac': 'Cadillac',
  'pontiac': 'Pontiac',
  'dodge': 'Dodge',
  'plymouth': 'Plymouth',
  'gmc': 'GMC',
  'mercedes-benz': 'Mercedes-Benz',
  'volkswagen': 'Volkswagen',
  'jaguar': 'Jaguar',
  'toyota': 'Toyota',
  'chrysler': 'Chrysler',
  'oldsmobile': 'Oldsmobile',
  'lincoln': 'Lincoln',
  'jeep': 'Jeep',
  'buick': 'Buick',
  'austin': 'Austin',
  'bmw': 'BMW',
  'porsche': 'Porsche',
  'ferrari': 'Ferrari',
  'honda': 'Honda',
  'nissan': 'Nissan',
  'mazda': 'Mazda',
  'subaru': 'Subaru',
  'mercury': 'Mercury',
  'audi': 'Audi',
  'volvo': 'Volvo',
  'fiat': 'Fiat',
  'acura': 'Acura',
  'lexus': 'Lexus',
  'suzuki': 'Suzuki',
  'mitsubishi': 'Mitsubishi',
  'saab': 'Saab',
  'tesla': 'Tesla',
  'infiniti': 'Infiniti',
  'ram': 'Ram',
  // Abbreviations/variants → canonical
  'VW': 'Volkswagen',
  'Chevy': 'Chevrolet',
  'Mercedes Benz': 'Mercedes-Benz',
  'Mercedes': 'Mercedes-Benz',
  'Merc': 'Mercedes-Benz',
  'Alfa': 'Alfa Romeo',
  'Aston': 'Aston Martin',
  'Rolls': 'Rolls-Royce',
  'Mini': 'MINI',
  'International Harvester': 'International',
  'Land-Rover': 'Land Rover',
  'Landrover': 'Land Rover',
  'DeTomaso': 'De Tomaso',
};

let grandTotal = 0;

for (const [from, to] of Object.entries(NORMALIZATIONS)) {
  let total = 0;
  while (true) {
    const { data } = await sb.from('vehicles')
      .select('id')
      .eq('make', from)
      .eq('status', 'active')
      .limit(500);
    if (!data || data.length === 0) break;
    await sb.from('vehicles').update({ make: to }).in('id', data.map(r => r.id));
    total += data.length;
  }
  if (total > 0) {
    console.log(`  ${from} → ${to}: ${total}`);
    grandTotal += total;
  }
}

console.log(`\nTotal make normalized: ${grandTotal}`);
