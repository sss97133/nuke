import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Raw scraped data (from the scrape test)
const rawData = {
  make: "Chevrolet",
  model: "Blazer in Sedona , Arizona",
  transmission: "manual",
  drivetrain: "Part-time 4WD\n\t\t\t\n\t\t\n\t\n\n\n\n\t\t\t\t\t\t\n\t\t\t\t\t\t\n\t\t\t\t\t\t\n\t\t\t\t\t\t\t\n\t\t\t\t\t\t\t\t\n\t\t\t\t\t\t\t\t\twindow",
  year: 1977,
  color: "Silver",
  exterior_color: "Silver",
  interior_color: "Red",
  mileage: 92799,
  asking_price: 29450,
  seller: "Private Seller",
  seller_phone: "480-285-1600",
  seller_address: "7400 E Monte Cristo AveScottsdale, AZ 85260",
  description: "1977 Chevrolet K-5 Blazer for sale by actual owner private party sale clean Arizona title in hand! Absolute rust free dry desert survivor original paint patina, original interior, absolutely zero rust or corrosion truly are rare find! Full LS 5.3 Swap professionally built top to bottom with rear wheel dyno tune making 320HP and 340FTLBS at the \"rear wheels\"!!!",
  engine: "Rebuilt",
  listing_id: "1985175"
};

// Normalization function (same as in edge function)
function normalizeVehicleData(data) {
  const normalized = { ...data };

  // Normalize Make
  if (normalized.make) {
    const makeLower = normalized.make.toLowerCase().trim();
    const makeMap = {
      'chevy': 'Chevrolet',
      'chevrolet': 'Chevrolet',
      'gmc': 'GMC',
      'ford': 'Ford'
    };
    normalized.make = makeMap[makeLower] || normalized.make;
  }

  // Normalize Model - remove location
  if (normalized.model) {
    // Remove "in [City], [State]" pattern - be more aggressive
    normalized.model = normalized.model
      .replace(/\s+in\s+[^,]+(?:,\s*[A-Z]{2})?/gi, '')
      .replace(/\s+in\s+[A-Z][a-z]+/gi, '')
      .trim();
    
    // Extract series (K5, K-5, etc.) - check description too
    if (normalized.description && normalized.description.includes('K-5')) {
      normalized.series = 'K5';
      normalized.model = 'Blazer';
    } else {
      const seriesMatch = normalized.model.match(/\b(K-?5|K5|Blazer)\b/i);
      if (seriesMatch) {
        normalized.series = 'K5';
        normalized.model = 'Blazer';
      } else {
        // Just take first word
        normalized.model = normalized.model.split(' ')[0].trim();
        // If it's Blazer, add series
        if (normalized.model.toLowerCase() === 'blazer') {
          normalized.series = 'K5';
        }
      }
    }
  }

  // Normalize Transmission
  if (normalized.transmission) {
    const transLower = normalized.transmission.toLowerCase().trim();
    normalized.transmission = transLower === 'manual' ? 'Manual' : 
                              transLower === 'automatic' || transLower === 'auto' ? 'Automatic' :
                              normalized.transmission;
  }

  // Normalize Drivetrain
  if (normalized.drivetrain) {
    const cleaned = normalized.drivetrain.replace(/[\n\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    const driveMap = {
      'part-time': '4WD',
      'part-time 4wd': '4WD',
      '4wd': '4WD',
      '4x4': '4WD'
    };
    const driveLower = cleaned.toLowerCase();
    normalized.drivetrain = driveMap[driveLower] || '4WD';
  }

  // Normalize Engine
  if (normalized.engine) {
    if (normalized.description && normalized.description.includes('5.3')) {
      normalized.engine_size = '5.3L V8';
    } else {
      normalized.engine_size = normalized.engine;
    }
  }

  return normalized;
}

async function createNormalizedVehicle() {
  console.log('🔧 Normalizing scraped data...\n');
  
  const normalized = normalizeVehicleData(rawData);
  
  console.log('BEFORE → AFTER (Normalization):');
  console.log(`  Make: "${rawData.make}" → "${normalized.make}"`);
  console.log(`  Model: "${rawData.model}" → "${normalized.model}"`);
  console.log(`  Transmission: "${rawData.transmission}" → "${normalized.transmission}"`);
  console.log(`  Drivetrain: "${rawData.drivetrain.substring(0, 30)}..." → "${normalized.drivetrain}"`);
  console.log(`  Series: (extracted) → "${normalized.series}"`);
  console.log(`  Engine: "${rawData.engine}" → "${normalized.engine_size}"`);
  console.log('');

  // Get user
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;

  console.log('💾 Creating vehicle in database...\n');

  // Check if vehicle already exists
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('year', normalized.year)
    .eq('make', normalized.make)
    .eq('model', normalized.model)
    .maybeSingle();

  if (existing) {
    console.log('⚠️  Vehicle already exists, updating...\n');
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .update({
        series: normalized.series || null,
        color: normalized.color,
        mileage: normalized.mileage,
        transmission: normalized.transmission,
        drivetrain: normalized.drivetrain,
        engine_size: normalized.engine_size,
        origin_metadata: {
          listing_id: normalized.listing_id,
          seller: normalized.seller,
          seller_phone: normalized.seller_phone,
          seller_address: normalized.seller_address,
          asking_price: normalized.asking_price,
          imported_at: new Date().toISOString(),
          original_data: {
            original_make: rawData.make,
            original_model: rawData.model,
            original_transmission: rawData.transmission,
            original_drivetrain: rawData.drivetrain
          },
          normalization_applied: true
        }
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('❌ Update error:', error.message);
      return;
    }
    showProfile(vehicle);
    return;
  }

  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .insert({
      uploaded_by: userId,
      year: normalized.year,
      make: normalized.make,
      model: normalized.model,
      series: normalized.series || null,
      color: normalized.color,
      mileage: normalized.mileage,
      transmission: normalized.transmission,
      drivetrain: normalized.drivetrain,
      engine_size: normalized.engine_size,
      discovery_source: 'classiccars_com',
      discovery_url: 'https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325',
      profile_origin: 'classiccars_import',
      origin_metadata: {
        listing_id: normalized.listing_id,
        seller: normalized.seller,
        seller_phone: normalized.seller_phone,
        seller_address: normalized.seller_address,
        asking_price: normalized.asking_price,
        imported_at: new Date().toISOString(),
        original_data: {
          original_make: rawData.make,
          original_model: rawData.model,
          original_transmission: rawData.transmission,
          original_drivetrain: rawData.drivetrain
        },
        normalization_applied: true
      },
      notes: normalized.description
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('✅ Vehicle created!\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 NORMALIZED VEHICLE PROFILE');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('IDENTIFICATION:');
  console.log(`  Year: ${vehicle.year}`);
  console.log(`  Make: ${vehicle.make}`);
  console.log(`  Model: ${vehicle.model}`);
  if (vehicle.series) console.log(`  Series: ${vehicle.series}`);
  console.log('');
  
  console.log('SPECIFICATIONS:');
  console.log(`  Color: ${vehicle.color}`);
  console.log(`  Mileage: ${vehicle.mileage.toLocaleString()} miles`);
  console.log(`  Transmission: ${vehicle.transmission}`);
  console.log(`  Drivetrain: ${vehicle.drivetrain}`);
  console.log(`  Engine: ${vehicle.engine_size}`);
  console.log('');
  
  console.log('SELLER:');
  console.log(`  ${vehicle.origin_metadata.seller}`);
  console.log(`  Phone: ${vehicle.origin_metadata.seller_phone}`);
  console.log(`  Address: ${vehicle.origin_metadata.seller_address}`);
  console.log(`  Asking: $${vehicle.origin_metadata.asking_price.toLocaleString()}`);
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔗 View profile: https://n-zero.dev/vehicles/${vehicle.id}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

function showProfile(vehicle) {
  console.log('✅ Vehicle saved!\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 NORMALIZED VEHICLE PROFILE');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('IDENTIFICATION:');
  console.log(`  Year: ${vehicle.year}`);
  console.log(`  Make: ${vehicle.make}`);
  console.log(`  Model: ${vehicle.model}`);
  if (vehicle.series) console.log(`  Series: ${vehicle.series}`);
  console.log('');
  
  console.log('SPECIFICATIONS:');
  if (vehicle.color) console.log(`  Color: ${vehicle.color}`);
  if (vehicle.mileage) console.log(`  Mileage: ${vehicle.mileage.toLocaleString()} miles`);
  if (vehicle.transmission) console.log(`  Transmission: ${vehicle.transmission}`);
  if (vehicle.drivetrain) console.log(`  Drivetrain: ${vehicle.drivetrain}`);
  if (vehicle.engine_size) console.log(`  Engine: ${vehicle.engine_size}`);
  console.log('');
  
  if (vehicle.origin_metadata) {
    console.log('SELLER:');
    if (vehicle.origin_metadata.seller) console.log(`  ${vehicle.origin_metadata.seller}`);
    if (vehicle.origin_metadata.seller_phone) console.log(`  Phone: ${vehicle.origin_metadata.seller_phone}`);
    if (vehicle.origin_metadata.seller_address) console.log(`  Address: ${vehicle.origin_metadata.seller_address}`);
    if (vehicle.origin_metadata.asking_price) console.log(`  Asking: $${vehicle.origin_metadata.asking_price.toLocaleString()}`);
    console.log('');
    
    if (vehicle.origin_metadata.original_data) {
      console.log('NORMALIZATION PROOF:');
      const orig = vehicle.origin_metadata.original_data;
      console.log(`  Make: "${orig.original_make}" → "${vehicle.make}"`);
      console.log(`  Model: "${orig.original_model}" → "${vehicle.model}"`);
      if (orig.original_transmission) {
        console.log(`  Transmission: "${orig.original_transmission}" → "${vehicle.transmission}"`);
      }
      if (orig.original_drivetrain) {
        console.log(`  Drivetrain: "${orig.original_drivetrain.substring(0, 40)}..." → "${vehicle.drivetrain}"`);
      }
      console.log('');
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🔗 View profile: https://n-zero.dev/vehicles/${vehicle.id}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

createNormalizedVehicle().catch(console.error);

