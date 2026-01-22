import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Map auction sources to organization IDs
const SOURCE_TO_ORG: Record<string, string> = {
  'Bring a Trailer': 'bd035ea4-75f0-4b17-ad02-aee06283343f',
  'Cars & Bids': '822cae29-f80e-4859-9c48-a1485a543152',
  'PCarMarket': 'f7c80592-6725-448d-9b32-2abf3e011cf8',
  'Collecting Cars': '0d435048-f2c5-47ba-bba0-4c18c6d58686',
  'Broad Arrow Auctions': 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a',
  'RM Sothebys': '5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1',
  'Gooding & Company': '98a2e93e-b814-4fda-b48a-0bb5440b7d00',
  'SBX Cars': '37b84b5e-ee28-410a-bea5-8d4851e39525',
};

// Known makes for parsing
const MAKES = [
  'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
  'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'GMC',
  'Jaguar', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Maserati', 'Alfa Romeo', 'Lancia',
  'Toyota', 'Nissan', 'Honda', 'Mazda', 'Datsun', 'Lexus', 'Acura', 'Subaru', 'Mitsubishi',
  'Infiniti', 'Suzuki', 'Isuzu',
  'Jeep', 'Land Rover', 'Range Rover', 'McLaren', 'Lotus', 'MG', 'Triumph', 'Austin-Healey',
  'Shelby', 'AC', 'DeLorean', 'Tucker', 'Studebaker', 'Packard', 'Hudson', 'Nash',
  'Volkswagen', 'VW', 'Volvo', 'Saab', 'Fiat', 'Peugeot', 'Citroën', 'Renault',
  'Hyundai', 'Kia', 'Genesis',
  'Lincoln', 'Mercury', 'Oldsmobile', 'Saturn', 'Hummer',
  'AM General', 'International', 'Willys',
];

function parseMake(title: string): string | null {
  for (const make of MAKES) {
    const pattern = new RegExp(`\\b${make.replace('-', '[-\\s]?')}\\b`, 'i');
    if (pattern.test(title)) {
      if (make === 'Chevy') return 'Chevrolet';
      if (make === 'VW') return 'Volkswagen';
      return make;
    }
  }
  return null;
}

function parseModel(title: string, make: string | null): string | null {
  if (!make) return null;

  const pattern = new RegExp(make.replace('-', '[-\\s]?'), 'i');
  const parts = title.split(pattern);
  if (parts.length < 2) return null;

  let afterMake = parts[1].trim();

  // Remove common suffixes
  afterMake = afterMake.replace(/Watch$/i, '').trim();

  // Take first few words as model
  const model = afterMake
    .split(/[,\-–]|\s{2,}/)[0]
    .replace(/^\s*[-–]\s*/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .replace(/[^\w\s\-\/\.]/g, '')
    .trim();

  return model.length > 1 ? model : null;
}

function cleanTitle(title: string): string {
  // Remove "Watch" suffix that gets scraped from C&B
  return title.replace(/Watch$/i, '').trim();
}

async function fixVehicleDataQuality() {
  console.log('=== FIXING VEHICLE DATA QUALITY ===\n');

  // 1. Fix organization_id based on auction_source
  console.log('1. Linking vehicles to organizations by auction_source...');

  for (const [source, orgId] of Object.entries(SOURCE_TO_ORG)) {
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('auction_source', source)
      .is('organization_id', null);

    if (vehicles && vehicles.length > 0) {
      const { error } = await supabase
        .from('vehicles')
        .update({ organization_id: orgId })
        .eq('auction_source', source)
        .is('organization_id', null);

      if (!error) {
        console.log(`  ${source}: linked ${vehicles.length} vehicles to org`);
      } else {
        console.log(`  ${source}: error - ${error.message}`);
      }
    }
  }

  // 2. Fix make/model parsing for vehicles with Unknown
  console.log('\n2. Fixing make/model parsing...');

  const { data: unknownVehicles } = await supabase
    .from('vehicles')
    .select('id, listing_title, make, model')
    .or('make.eq.Unknown,model.eq.Unknown')
    .not('listing_title', 'is', null);

  let fixedCount = 0;
  for (const v of unknownVehicles || []) {
    const title = v.listing_title || '';
    const cleanedTitle = cleanTitle(title);
    const make = parseMake(cleanedTitle);
    const model = parseModel(cleanedTitle, make);

    const updates: Record<string, any> = {};
    if (make && v.make === 'Unknown') updates.make = make;
    if (model && v.model === 'Unknown') updates.model = model;
    if (cleanedTitle !== title) updates.listing_title = cleanedTitle;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', v.id);

      if (!error) {
        fixedCount++;
        if (fixedCount <= 10) {
          console.log(`  Fixed: "${title.slice(0, 50)}..." -> Make: ${make}, Model: ${model}`);
        }
      }
    }
  }
  console.log(`  Total fixed: ${fixedCount} vehicles`);

  // 3. Clean "Watch" suffix from titles
  console.log('\n3. Cleaning "Watch" suffix from titles...');

  const { data: watchTitles } = await supabase
    .from('vehicles')
    .select('id, listing_title')
    .ilike('listing_title', '%Watch');

  let cleanedCount = 0;
  for (const v of watchTitles || []) {
    const cleanedTitle = cleanTitle(v.listing_title || '');
    if (cleanedTitle !== v.listing_title) {
      await supabase.from('vehicles').update({ listing_title: cleanedTitle }).eq('id', v.id);
      cleanedCount++;
    }
  }
  console.log(`  Cleaned: ${cleanedCount} titles`);

  // 4. Verification
  console.log('\n=== VERIFICATION ===');

  for (const [source, orgId] of Object.entries(SOURCE_TO_ORG)) {
    const { count } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    console.log(`${source.padEnd(25)} Vehicles linked: ${count || 0}`);
  }

  const { count: stillUnknown } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.eq.Unknown,model.eq.Unknown');
  console.log(`\nVehicles still with Unknown make/model: ${stillUnknown}`);
}

fixVehicleDataQuality().catch(console.error);
