import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const CLASSICCARS_URL = 'https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325';

async function importAndShowProfile() {
  console.log('🚀 Importing ClassicCars.com listing with data normalization...\n');
  console.log(`URL: ${CLASSICCARS_URL}\n`);

  try {
    // Get a user ID
    const { data: users } = await supabase.auth.admin.listUsers();
    if (!users || users.users.length === 0) {
      throw new Error('No users found. Please create a user first.');
    }
    const userId = users.users[0].id;
    console.log(`Using user ID: ${userId}\n`);

    // Call the import function using Supabase client
    console.log('📥 Calling import-classiccars-listing function...\n');
    const { data: result, error: invokeError } = await supabase.functions.invoke('import-classiccars-listing', {
      body: {
        url: CLASSICCARS_URL,
        userId: userId
      }
    });

    if (invokeError) {
      console.error('❌ Import failed:', invokeError.message);
      if (invokeError.context) {
        console.error('Context:', invokeError.context);
        // Try to read the error body
        if (invokeError.context.body && typeof invokeError.context.body.getReader === 'function') {
          try {
            const reader = invokeError.context.body.getReader();
            const { value } = await reader.read();
            const errorText = new TextDecoder().decode(value);
            console.error('Error details:', errorText);
          } catch (e) {
            // Ignore
          }
        }
      }
      return;
    }

    if (!result || !result.success) {
      console.error('❌ Import failed:', result?.error || 'Unknown error');
      return;
    }

    console.log('✅ Import Successful!\n');
    console.log('Results:');
    console.log(`  Vehicle ID: ${result.vehicleId}`);
    console.log(`  Images Processed: ${result.imagesProcessed}`);
    console.log(`  Condition Score: ${result.conditionScore}/10\n`);

    // Wait a moment for DB to sync
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Fetch the full normalized vehicle profile
    console.log('📋 Fetching normalized vehicle profile...\n');
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', result.vehicleId)
      .single();

    if (vehicleError) {
      console.error('⚠️  Could not fetch vehicle:', vehicleError.message);
      return;
    }

    // Display normalized profile
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 NORMALIZED VEHICLE PROFILE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('IDENTIFICATION:');
    console.log(`  Year: ${vehicle.year}`);
    console.log(`  Make: ${vehicle.make} ${vehicle.origin_metadata?.original_data?.original_make ? `(normalized from "${vehicle.origin_metadata.original_data.original_make}")` : ''}`);
    console.log(`  Model: ${vehicle.model} ${vehicle.origin_metadata?.original_data?.original_model ? `(normalized from "${vehicle.origin_metadata.original_data.original_model}")` : ''}`);
    if (vehicle.series) console.log(`  Series: ${vehicle.series}`);
    if (vehicle.trim) console.log(`  Trim: ${vehicle.trim}`);
    if (vehicle.vin) console.log(`  VIN: ${vehicle.vin}`);
    console.log('');

    console.log('SPECIFICATIONS:');
    if (vehicle.color) console.log(`  Color: ${vehicle.color}`);
    if (vehicle.mileage) console.log(`  Mileage: ${vehicle.mileage.toLocaleString()} miles`);
    if (vehicle.transmission) console.log(`  Transmission: ${vehicle.transmission} ${vehicle.origin_metadata?.original_data?.original_transmission ? `(normalized from "${vehicle.origin_metadata.original_data.original_transmission}")` : ''}`);
    if (vehicle.drivetrain) console.log(`  Drivetrain: ${vehicle.drivetrain} ${vehicle.origin_metadata?.original_data?.original_drivetrain ? `(normalized from "${vehicle.origin_metadata.original_data.original_drivetrain}")` : ''}`);
    if (vehicle.engine_size) console.log(`  Engine: ${vehicle.engine_size}`);
    if (vehicle.condition_rating) console.log(`  Condition Rating: ${vehicle.condition_rating}/10`);
    console.log('');

    console.log('SELLER INFORMATION:');
    if (vehicle.origin_metadata?.seller) console.log(`  Seller: ${vehicle.origin_metadata.seller}`);
    if (vehicle.origin_metadata?.seller_phone) console.log(`  Phone: ${vehicle.origin_metadata.seller_phone}`);
    if (vehicle.origin_metadata?.seller_email) console.log(`  Email: ${vehicle.origin_metadata.seller_email}`);
    if (vehicle.origin_metadata?.seller_address) console.log(`  Address: ${vehicle.origin_metadata.seller_address}`);
    if (vehicle.origin_metadata?.asking_price) console.log(`  Asking Price: $${vehicle.origin_metadata.asking_price.toLocaleString()}`);
    console.log('');

    // Get images
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, metadata, category')
      .eq('vehicle_id', result.vehicleId)
      .order('created_at', { ascending: true });

    if (!imagesError && images) {
      console.log(`IMAGES (${images.length} total):`);
      images.slice(0, 5).forEach((img, i) => {
        console.log(`  ${i + 1}. ${img.category || 'exterior'}`);
        if (img.metadata?.ai_analysis) {
          console.log(`     Condition: ${img.metadata.ai_analysis.condition_score}/10`);
          if (img.metadata.ai_analysis.analysis) {
            console.log(`     Analysis: ${img.metadata.ai_analysis.analysis.substring(0, 80)}...`);
          }
        }
      });
      if (images.length > 5) {
        console.log(`  ... and ${images.length - 5} more images`);
      }
      console.log('');
    }

    console.log('METADATA:');
    console.log(`  Source: ${vehicle.discovery_source}`);
    console.log(`  Imported: ${new Date(vehicle.created_at).toLocaleString()}`);
    console.log(`  Normalization Applied: ${vehicle.origin_metadata?.normalization_applied ? 'Yes ✓' : 'No'}`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`🔗 View full profile: https://n-zero.dev/vehicles/${result.vehicleId}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

importAndShowProfile();

